import asyncio
import os
from celery import Celery
from app.tasks.celery_app import celery_app
from app.db.database import async_session
from app.db.models import Contract, Clause, AuditLog
from app.services.parser import DocumentParser
from app.services.translator import TranslationService
from app.services.qdrant_service import QdrantService
from app.services.classifier import ClauseClassifier
from app.services.risk_scorer import RiskScorer
from sqlalchemy import select

# Embedded Cache for sentences to satisfy embedding cache requirement
EMBEDDING_CACHE = {}

def get_cached_similarity(clause_text: str, template_type: str) -> tuple:
    """Returns cached similarity search results if text is identical to avoid re-embedding."""
    cache_key = f"{template_type}:{clause_text}"
    if cache_key in EMBEDDING_CACHE:
        print(f"Embedding Cache Hit for text snippet: {clause_text[:40]}...")
        return EMBEDDING_CACHE[cache_key]
    return None

def set_cached_similarity(clause_text: str, template_type: str, match_text: str, score: float):
    cache_key = f"{template_type}:{clause_text}"
    EMBEDDING_CACHE[cache_key] = (match_text, score)

async def async_analyze_contract(contract_id: str):
    """
    Asynchronous core of the contract analysis pipeline.
    Parses, translates, classifies, detects deviations, and scores risk.
    """
    print(f"Starting async analysis for contract ID: {contract_id}")
    
    async with async_session() as session:
        # 1. Fetch Contract
        query = select(Contract).where(Contract.id == contract_id)
        res = await session.execute(query)
        contract = res.scalar_one_or_none()
        
        if not contract:
            print(f"Contract {contract_id} not found in database.")
            return False
            
        try:
            # 2. Update Status to PROCESSING
            contract.status = "PROCESSING"
            await session.commit()
            
            # Log audit
            audit = AuditLog(
                event_type="INGESTION_START",
                contract_id=contract_id,
                details=f"Started parsing and analyzing contract: {contract.filename}"
            )
            session.add(audit)
            await session.commit()

            # 3. Detect Template Type for targeted deviation detection
            name_lower = contract.filename.lower()
            detected_type = "nda"
            if "employment" in name_lower or "job" in name_lower or "offer" in name_lower:
                detected_type = "employment"
            elif "service" in name_lower or "vendor" in name_lower or "consulting" in name_lower or "msa" in name_lower:
                detected_type = "service"
            elif "rera" in name_lower or "sale" in name_lower or "builder" in name_lower or "property" in name_lower:
                detected_type = "rera"

            # 4. Parse pages
            file_path = contract.file_path
            if contract.file_type == "pdf":
                raw_pages = DocumentParser.parse_pdf(file_path)
            else:
                raw_pages = DocumentParser.parse_docx(file_path)

            if not raw_pages:
                raise ValueError("No pages or text extracted from document.")

            # Segment into clauses
            segmented = DocumentParser.segment_clauses(raw_pages)
            print(f"Segmented contract into {len(segmented)} clause candidates.")

            # 5. Process each clause
            clauses_to_insert = []
            has_hindi = False
            
            for index, item in enumerate(segmented):
                clause_text = item["text"]
                page_num = item["page_number"]
                
                # Check Language
                is_hi = DocumentParser.is_hindi(clause_text)
                
                raw_hindi = None
                raw_english = clause_text
                
                if is_hi:
                    has_hindi = True
                    raw_hindi = clause_text
                    # Translate to English
                    raw_english = TranslationService.translate(clause_text)
                
                # Classify Clause
                category = ClauseClassifier.classify(raw_english)
                
                # Deviation detection (Embedding + Qdrant similarity match)
                # Look in cache first
                cached_match = get_cached_similarity(raw_english, detected_type)
                if cached_match:
                    matched_text, similarity_score = cached_match
                else:
                    matched_text, similarity_score = QdrantService.search_similar_clause(raw_english, detected_type)
                    set_cached_similarity(raw_english, detected_type, matched_text, similarity_score)

                # Risk scoring
                risk_data = RiskScorer.score(raw_english, category)
                risk_level = risk_data.get("risk_level", "LOW")
                # Combine explanation and citations
                citations_str = f"\n\n[Indian Legal Citations: {', '.join(risk_data.get('legal_citations', []))}]" if risk_data.get("legal_citations") else ""
                explanation = risk_data.get("explanation", "") + citations_str
                
                clause_obj = Clause(
                    contract_id=contract_id,
                    page_number=page_num,
                    sequence_number=index + 1,
                    raw_text_hindi=raw_hindi,
                    raw_text_english=raw_english,
                    clause_type=category,
                    similarity_score=similarity_score,
                    matched_template_clause=matched_text,
                    risk_level=risk_level,
                    original_risk_level=risk_level,
                    risk_explanation=explanation,
                    status="unreviewed"
                )
                clauses_to_insert.append(clause_obj)
            
            # Save clauses
            for c_obj in clauses_to_insert:
                session.add(c_obj)
            await session.commit()

            # Determine Overall Risk of contract
            has_high = any(c.risk_level == "HIGH" for c in clauses_to_insert)
            has_medium = any(c.risk_level == "MEDIUM" for c in clauses_to_insert)
            
            overall_risk = "LOW"
            if has_high:
                overall_risk = "HIGH"
            elif has_medium:
                overall_risk = "MEDIUM"

            # Update contract details
            contract.overall_risk_score = overall_risk
            contract.language = "hindi" if has_hindi else "english"
            contract.status = "PENDING_REVIEW"
            await session.commit()

            # Audit Success
            audit_success = AuditLog(
                event_type="INGESTION_SUCCESS",
                contract_id=contract_id,
                details=f"Successfully analyzed contract. Detected {len(clauses_to_insert)} clauses. Overall Risk: {overall_risk}"
            )
            session.add(audit_success)
            await session.commit()
            
            print(f"Contract analysis complete for {contract.filename}.")
            return True

        except Exception as e:
            # Mark contract as FAILED if error occurs
            contract.status = "FAILED"
            await session.commit()
            
            audit_fail = AuditLog(
                event_type="INGESTION_FAILED",
                contract_id=contract_id,
                details=f"Analysis failed. Error: {str(e)}"
            )
            session.add(audit_fail)
            await session.commit()
            
            print(f"Failed analyzing contract {contract_id}: {e}")
            import traceback
            traceback.print_exc()
            return False

@celery_app.task(name="app.tasks.analyze_contract")
def analyze_contract_task(contract_id: str):
    """Celery task entry point."""
    return asyncio.run(async_analyze_contract(contract_id))
