from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.db.database import get_db
from app.db.models import Contract, Clause, AuditLog
import datetime

router = APIRouter(prefix="/reviewer", tags=["Reviewer Workflow"])

# Request Schemas
class ReviewActionReq(BaseModel):
    action: str = Field(..., description="APPROVED or ESCALATED")
    notes: str = Field(None, description="Reviewer feedback and audit trail summary.")

class ClauseOverrideReq(BaseModel):
    risk_level: str = Field(..., description="LOW, MEDIUM, HIGH")
    comments: str = Field(..., description="Explanation of why this risk was updated.")

@router.get("/queue")
async def get_reviewer_queue(db: AsyncSession = Depends(get_db)):
    """Returns contracts requiring reviewer attention (PENDING_REVIEW, ESCALATED, etc.)"""
    q = select(Contract).where(Contract.status.in_(["PENDING_REVIEW", "ESCALATED"])).order_by(desc(Contract.created_at))
    res = await db.execute(q)
    queue = res.scalars().all()
    return queue

@router.post("/contracts/{contract_id}/action")
async def perform_contract_action(
    contract_id: str,
    req: ReviewActionReq,
    db: AsyncSession = Depends(get_db)
):
    """Approves or escalates an analyzed contract, writing to the immutable audit log."""
    action = req.action.upper()
    if action not in ["APPROVED", "ESCALATED"]:
        raise HTTPException(status_code=400, detail="Action must be either APPROVED or ESCALATED")
        
    # Fetch contract
    q = select(Contract).where(Contract.id == contract_id)
    res = await db.execute(q)
    contract = res.scalar_one_or_none()
    
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    # Update status
    contract.status = action
    contract.review_notes = req.notes
    contract.review_completed_at = datetime.datetime.utcnow()
    contract.reviewer_id = "Legal_Reviewer_1" # Hardcoded for demo/role compliance
    
    # Audit log
    audit_event = "REVIEW_APPROVE" if action == "APPROVED" else "REVIEW_ESCALATE"
    audit = AuditLog(
        event_type=audit_event,
        contract_id=contract_id,
        details=f"Contract {action} by legal reviewer. Notes: {req.notes or 'None'}"
    )
    db.add(audit)
    await db.commit()
    await db.refresh(contract)
    
    return {"status": "success", "contract_status": contract.status}

@router.post("/clauses/{clause_id}/override")
async def override_clause_risk(
    clause_id: int,
    req: ClauseOverrideReq,
    db: AsyncSession = Depends(get_db)
):
    """Allows a reviewer to override a clause's risk score and save audit comments."""
    new_risk = req.risk_level.upper()
    if new_risk not in ["LOW", "MEDIUM", "HIGH"]:
        raise HTTPException(status_code=400, detail="Risk level must be LOW, MEDIUM, or HIGH")
        
    # Fetch clause
    q_clause = select(Clause).where(Clause.id == clause_id)
    res_clause = await db.execute(q_clause)
    clause = res_clause.scalar_one_or_none()
    
    if not clause:
        raise HTTPException(status_code=404, detail="Clause not found")
        
    # Apply override
    clause.status = "overridden"
    clause.reviewer_comments = req.comments
    clause.risk_level = new_risk
    
    await db.commit()
    
    # Re-evaluate overall contract risk score dynamically!
    contract_id = clause.contract_id
    q_all_clauses = select(Clause).where(Clause.contract_id == contract_id)
    res_all = await db.execute(q_all_clauses)
    all_clauses = res_all.scalars().all()
    
    has_high = any(c.risk_level == "HIGH" for c in all_clauses)
    has_medium = any(c.risk_level == "MEDIUM" for c in all_clauses)
    
    overall_risk = "LOW"
    if has_high:
        overall_risk = "HIGH"
    elif has_medium:
        overall_risk = "MEDIUM"
        
    q_contract = select(Contract).where(Contract.id == contract_id)
    res_contract = await db.execute(q_contract)
    contract = res_contract.scalar_one_or_none()
    if contract:
        contract.overall_risk_score = overall_risk
        
    # Write Audit Log
    audit = AuditLog(
        event_type="CLAUSE_OVERRIDE",
        contract_id=contract_id,
        details=f"Clause #{clause.sequence_number} risk level overridden to {new_risk}. Reason: {req.comments}"
    )
    db.add(audit)
    await db.commit()
    
    return {"status": "success", "clause_risk": clause.risk_level, "contract_overall_risk": overall_risk}
