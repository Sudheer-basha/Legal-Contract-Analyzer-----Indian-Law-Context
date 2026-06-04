import os
from fastapi import APIRouter, UploadFile, File, Depends, BackgroundTasks, HTTPException, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.db.database import get_db
from app.db.models import Contract, Clause, AuditLog, User
from app.core.config import settings
from app.tasks.tasks import async_analyze_contract, analyze_contract_task
from app.services.pdf_generator import PDFReportGenerator
import datetime

router = APIRouter(prefix="/contracts", tags=["Contracts"])

@router.post("/upload")
async def upload_contract(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Uploads a legal contract, parses metadata, and triggers async analysis.
    """
    # 1. Validate file format
    ext = file.filename.split(".")[-1].lower()
    if ext not in ["pdf", "docx"]:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX file formats are supported.")
    
    # 2. Save file to disk
    contract_id = None
    try:
        # Create unique database record first to get ID
        db_contract = Contract(
            filename=file.filename,
            file_path="",  # Filled below
            file_type=ext,
            status="PENDING"
        )
        db.add(db_contract)
        await db.commit()
        await db.refresh(db_contract)
        
        contract_id = db_contract.id
        
        # Save file to uploads folder named by ID
        saved_filename = f"{contract_id}.{ext}"
        saved_path = settings.UPLOAD_DIR / saved_filename
        
        with open(saved_path, "wb") as f:
            f.write(await file.read())
            
        db_contract.file_path = str(saved_path)
        await db.commit()
        
    except Exception as e:
        if contract_id:
            # Clean up db if error
            q = select(Contract).where(Contract.id == contract_id)
            res = await db.execute(q)
            c = res.scalar_one_or_none()
            if c:
                await db.delete(c)
                await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # 3. Trigger Background analysis (Celery or Local thread)
    if settings.SIMULATE_BACKGROUND_SERVICES:
        print("SIMULATION MODE: Running analysis using local FastAPI BackgroundTasks...")
        background_tasks.add_task(async_analyze_contract, contract_id)
    else:
        print("PRODUCTION MODE: Dispatching job to Celery...")
        analyze_contract_task.delay(contract_id)

    return {"contract_id": contract_id, "filename": file.filename, "status": "PENDING"}

@router.get("")
async def list_contracts(db: AsyncSession = Depends(get_db)):
    """Lists all uploaded contracts sorted by creation time."""
    q = select(Contract).order_by(desc(Contract.created_at))
    res = await db.execute(q)
    contracts = res.scalars().all()
    return contracts

@router.get("/{contract_id}")
async def get_contract_details(contract_id: str, db: AsyncSession = Depends(get_db)):
    """Retrieves contract metadata and its parsed annotated clauses."""
    # Fetch contract
    q_contract = select(Contract).where(Contract.id == contract_id)
    res_contract = await db.execute(q_contract)
    contract = res_contract.scalar_one_or_none()
    
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    # Fetch clauses
    q_clauses = select(Clause).where(Clause.contract_id == contract_id).order_by(Clause.sequence_number)
    res_clauses = await db.execute(q_clauses)
    clauses = res_clauses.scalars().all()
    
    return {
        "contract": contract,
        "clauses": clauses
    }

@router.get("/{contract_id}/report")
async def export_annotated_pdf(contract_id: str, db: AsyncSession = Depends(get_db)):
    """Generates and downloads the annotated legal PDF report."""
    # Fetch contract
    q_contract = select(Contract).where(Contract.id == contract_id)
    res_contract = await db.execute(q_contract)
    contract = res_contract.scalar_one_or_none()
    
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    # Strict mode review gate:
    # If contract is pending review, don't allow reports unless approved,
    # OR we allow with draft warning. Let's block exports of unapproved HIGH risk reports
    # to enforce the Reviewer Workflow requirement.
    if contract.status == "PENDING_REVIEW":
        # Check if there are high risk terms
        q_high = select(Clause).where(Clause.contract_id == contract_id, Clause.risk_level == "HIGH")
        res_high = await db.execute(q_high)
        high_clauses = res_high.scalars().all()
        if high_clauses:
            raise HTTPException(
                status_code=403, 
                detail="Access Denied: This contract contains HIGH risk terms and must be approved by a legal reviewer before report export."
            )
            
    # Fetch clauses
    q_clauses = select(Clause).where(Clause.contract_id == contract_id).order_by(Clause.sequence_number)
    res_clauses = await db.execute(q_clauses)
    clauses = res_clauses.scalars().all()
    
    # Audit log
    audit = AuditLog(
        event_type="EXPORT_REPORT",
        contract_id=contract_id,
        details=f"Exported annotated PDF report for contract: {contract.filename}"
    )
    db.add(audit)
    await db.commit()
    
    # Generate PDF in memory
    contract_dict = {
        "filename": contract.filename,
        "language": contract.language,
        "status": contract.status,
        "overall_risk_score": contract.overall_risk_score,
        "review_notes": contract.review_notes,
        "created_at": contract.created_at.strftime("%Y-%m-%d %H:%M")
    }
    
    clauses_list = []
    for c in clauses:
        clauses_list.append({
            "sequence_number": c.sequence_number,
            "page_number": c.page_number,
            "raw_text_hindi": c.raw_text_hindi,
            "raw_text_english": c.raw_text_english,
            "clause_type": c.clause_type,
            "risk_level": c.risk_level,
            "risk_explanation": c.risk_explanation,
            "matched_template_clause": c.matched_template_clause,
            "similarity_score": c.similarity_score,
            "reviewer_comments": c.reviewer_comments
        })
        
    pdf_buffer = PDFReportGenerator.generate(contract_dict, clauses_list)
    
    clean_filename = contract.filename.rsplit(".", 1)[0]
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=Risk_Report_{clean_filename}.pdf"}
    )


@router.delete("/flush")
async def flush_database(authorization: str = Header(None), db: AsyncSession = Depends(get_db)):
    """Wipes all contracts, clauses, chat history, and audit logs. Restrict to Admin role."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    token = authorization.split(" ")[1]
    email = token.replace("token-", "")
    
    # Verify current user is admin
    admin_stmt = select(User).where(User.email == email)
    res_admin = await db.execute(admin_stmt)
    admin_user = res_admin.scalar_one_or_none()
    
    if not admin_user or admin_user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden. Admin privilege required.")
        
    # Import other models to delete
    from app.db.models import Clause, ChatMessage, AuditLog
    from sqlalchemy import delete
    
    # Delete all clauses, chats, audit logs, and contracts
    await db.execute(delete(Clause))
    await db.execute(delete(ChatMessage))
    await db.execute(delete(AuditLog))
    await db.execute(delete(Contract))
    
    # Commit changes
    await db.commit()
    
    # Write fresh audit log for the action
    new_audit = AuditLog(
        event_type="SYSTEM_RESET",
        contract_id=None,
        details=f"System reset and database flush executed by admin user: {admin_user.email}"
    )
    db.add(new_audit)
    await db.commit()
    
    return {"message": "Database successfully wiped."}
