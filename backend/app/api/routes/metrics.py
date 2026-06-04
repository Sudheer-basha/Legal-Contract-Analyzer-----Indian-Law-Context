from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.database import get_db
from app.db.models import Contract, Clause, AuditLog, ChatMessage
import datetime

router = APIRouter(prefix="/metrics", tags=["Observability Metrics"])

@router.get("")
async def get_dashboard_metrics(db: AsyncSession = Depends(get_db)):
    """
    Computes all analytics and workflow metrics from database state.
    Used by the dashboard and suitable for Grafana panel mappings.
    """
    # 1. Contract Counts & Ingestion Metrics
    q_total = select(func.count(Contract.id))
    q_completed = select(func.count(Contract.id)).where(Contract.status.in_(["APPROVED", "ESCALATED", "PENDING_REVIEW"]))
    q_failed = select(func.count(Contract.id)).where(Contract.status == "FAILED")
    
    total = (await db.execute(q_total)).scalar() or 0
    completed = (await db.execute(q_completed)).scalar() or 0
    failed = (await db.execute(q_failed)).scalar() or 0
    
    # 2. Risk Score Distribution
    q_high = select(func.count(Contract.id)).where(Contract.overall_risk_score == "HIGH")
    q_medium = select(func.count(Contract.id)).where(Contract.overall_risk_score == "MEDIUM")
    q_low = select(func.count(Contract.id)).where(Contract.overall_risk_score == "LOW")
    
    high_count = (await db.execute(q_high)).scalar() or 0
    medium_count = (await db.execute(q_medium)).scalar() or 0
    low_count = (await db.execute(q_low)).scalar() or 0
    
    # Clause level average
    q_clauses_total = select(func.count(Clause.id))
    total_clauses = (await db.execute(q_clauses_total)).scalar() or 0
    avg_clauses_per_contract = round(total_clauses / total, 1) if total > 0 else 0
    
    # 3. Reviewer Workflow Metrics
    q_approved = select(func.count(Contract.id)).where(Contract.status == "APPROVED")
    q_escalated = select(func.count(Contract.id)).where(Contract.status == "ESCALATED")
    
    approved_count = (await db.execute(q_approved)).scalar() or 0
    escalated_count = (await db.execute(q_escalated)).scalar() or 0
    
    total_reviewed = approved_count + escalated_count
    approval_rate = round((approved_count / total_reviewed) * 100, 1) if total_reviewed > 0 else 0.0
    escalation_rate = round((escalated_count / total_reviewed) * 100, 1) if total_reviewed > 0 else 0.0
    
    # Reviewer processing times
    q_times = select(Contract.created_at, Contract.review_completed_at).where(Contract.review_completed_at.isnot(None))
    times_res = await db.execute(q_times)
    times_list = times_res.all()
    
    avg_review_time_mins = 0.0
    if times_list:
        total_time_diff_secs = 0.0
        for created, reviewed in times_list:
            diff = (reviewed - created).total_seconds()
            total_time_diff_secs += diff
        avg_review_time_mins = round((total_time_diff_secs / len(times_list)) / 60, 1)

    # 4. Audit Log List (Top 20 most recent entries)
    q_audit = select(AuditLog).order_by(AuditLog.timestamp.desc()).limit(20)
    audit_res = await db.execute(q_audit)
    audit_logs = audit_res.scalars().all()
    
    # Audit log format
    audit_list = []
    for log in audit_logs:
        audit_list.append({
            "id": log.id,
            "event_type": log.event_type,
            "contract_id": log.contract_id,
            "details": log.details,
            "timestamp": log.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        })

    return {
        "summary": {
            "total_contracts": total,
            "completed_analyses": completed,
            "failed_analyses": failed,
            "avg_clauses_per_contract": avg_clauses_per_contract
        },
        "risk_distribution": {
            "high": high_count,
            "medium": medium_count,
            "low": low_count
        },
        "reviewer_metrics": {
            "total_reviewed": total_reviewed,
            "approved_count": approved_count,
            "escalated_count": escalated_count,
            "approval_rate_percent": approval_rate,
            "escalation_rate_percent": escalation_rate,
            "avg_review_time_minutes": avg_review_time_mins
        },
        "audit_logs": audit_list
    }
