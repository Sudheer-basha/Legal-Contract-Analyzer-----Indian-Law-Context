import httpx
import json
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.db.models import Contract, Clause, ChatMessage, User
from app.core.config import settings

router = APIRouter(prefix="/chat", tags=["Dialogue System"])

class GeneralChatReq(BaseModel):
    message: str


@router.post("/general")
async def chat_general_legal(
    req: GeneralChatReq,
    authorization: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Direct General Legal AI assistant chat. Not bound to a specific contract.
    Used by Advocates, Lawyers, and Judges.
    """
    user = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        if token.startswith("token-"):
            email = token.replace("token-", "")
            stmt = select(User).where(User.email == email)
            res = await db.execute(stmt)
            user = res.scalar_one_or_none()
            
    user_id = user.id if user else None
    user_query = req.message
    
    # Save user message
    if user_id:
        user_msg = ChatMessage(contract_id=None, user_id=user_id, role="user", message=user_query)
        db.add(user_msg)
        await db.commit()
        
    # Get last 10 general messages for context
    history = []
    if user_id:
        stmt = select(ChatMessage).where(
            ChatMessage.user_id == user_id,
            ChatMessage.contract_id == None
        ).order_by(ChatMessage.created_at)
        res = await db.execute(stmt)
        history = res.scalars().all()[-10:]
        
    # Ask Groq or local solver
    reply = ""
    if settings.GROQ_API_KEY:
        try:
            reply = await query_groq_general_chat(user_query, history)
        except Exception as e:
            print(f"Groq general chat query failed: {e}. Falling back to local solver...")
            
    if not reply:
        reply = solve_general_chat_locally(user_query)
        
    # Save assistant response
    if user_id:
        assistant_msg = ChatMessage(contract_id=None, user_id=user_id, role="assistant", message=reply)
        db.add(assistant_msg)
        await db.commit()
        
    return {"reply": reply}


@router.get("/general")
async def get_general_chat_history(
    authorization: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves general AI assistant chat messages for the logged-in user."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    token = authorization.split(" ")[1]
    email = token.replace("token-", "")
    
    stmt = select(User).where(User.email == email)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=401, detail="User session not found")
        
    stmt = select(ChatMessage).where(
        ChatMessage.user_id == user.id,
        ChatMessage.contract_id == None
    ).order_by(ChatMessage.created_at)
    res = await db.execute(stmt)
    messages = res.scalars().all()
    
    return [{"role": m.role, "message": m.message} for m in messages]


@router.get("/{contract_id}")
async def get_contract_chat_history(
    contract_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Retrieves chat messages context for the specific contract."""
    stmt = select(ChatMessage).where(ChatMessage.contract_id == contract_id).order_by(ChatMessage.created_at)
    res = await db.execute(stmt)
    messages = res.scalars().all()
    return [{"role": m.role, "message": m.message} for m in messages]


class ChatMessageReq(BaseModel):
    message: str

@router.post("/{contract_id}")
async def chat_about_contract(
    contract_id: str,
    req: ChatMessageReq,
    db: AsyncSession = Depends(get_db)
):
    """
    RAG-powered conversational endpoint. Reads contract clauses, historical message threads,
    and replies under Indian law defaults.
    """
    # 1. Fetch Contract and Clauses
    q_contract = select(Contract).where(Contract.id == contract_id)
    res_contract = await db.execute(q_contract)
    contract = res_contract.scalar_one_or_none()
    
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    q_clauses = select(Clause).where(Clause.contract_id == contract_id).order_by(Clause.sequence_number)
    res_clauses = await db.execute(q_clauses)
    clauses = res_clauses.scalars().all()
    
    # 2. Fetch Chat History (Limit to last 10 messages for token context window)
    q_chat = select(ChatMessage).where(ChatMessage.contract_id == contract_id).order_by(ChatMessage.created_at)
    res_chat = await db.execute(q_chat)
    history = res_chat.scalars().all()[-10:]
    
    user_query = req.message
    
    # Save User message
    user_msg_db = ChatMessage(contract_id=contract_id, role="user", message=user_query)
    db.add(user_msg_db)
    await db.commit()
    
    # 3. Formulate RAG context
    context_clauses = []
    for c in clauses:
        lang_clause = f"Hindi: {c.raw_text_hindi} | Translated: {c.raw_text_english}" if c.raw_text_hindi else f"Text: {c.raw_text_english}"
        context_clauses.append(
            f"Clause #{c.sequence_number} (Type: {c.clause_type}, Risk: {c.risk_level})\n"
            f"{lang_clause}\n"
            f"Risk analysis notes: {c.risk_explanation or 'Standard terms.'}"
        )
    
    context_str = "\n\n".join(context_clauses[:15])  # Cap at 15 clauses to avoid context bloat
    
    # Try Groq first, fallback to Local Legal Query Solver
    reply = ""
    if settings.GROQ_API_KEY:
        try:
            reply = await query_groq_chat(user_query, context_str, history, contract.filename)
        except Exception as e:
            print(f"Groq chat query failed: {e}. Falling back to rule-based chat solver...")
            
    if not reply:
        reply = solve_chat_locally(user_query, clauses)
        
    # Save Assistant Response
    assistant_msg_db = ChatMessage(contract_id=contract_id, role="assistant", message=reply)
    db.add(assistant_msg_db)
    await db.commit()
    
    return {"reply": reply}

async def query_groq_chat(query: str, context: str, history: list, filename: str) -> str:
    """Assembles prompt and queries Groq API for multi-turn RAG chat."""
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert legal assistant specialized in Indian law. You are reviewing the contract file and answering "
                "user questions about it. Refer directly to the provided contract clauses, risk levels, and legal explanations "
                "in your responses. Incorporate citations to Indian statutes (e.g. Indian Contract Act 1872, RERA 2016, IT Act 2000) "
                "where relevant. Be precise, helpful, and concise. Do not guess; if the contract does not mention an item, say so."
            )
        }
    ]
    
    # Append conversation history
    for msg in history:
        messages.append({"role": msg.role, "content": msg.message})
        
    # Append current message with context
    current_prompt = (
        f"Contract Document: {filename}\n\n"
        f"--- CONTRACT CLAUSES AND RISK ANALYSIS CONTEXT ---\n"
        f"{context}\n"
        f"--------------------------------------------------\n\n"
        f"User Question: {query}\n"
        f"Answer:"
    )
    
    messages.append({"role": "user", "content": current_prompt})
    
    payload = {
        "model": "llama-3.1-8b-instant",
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 1024
    }
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(url, headers=headers, json=payload)
        if res.status_code == 200:
            data = res.json()
            return data["choices"][0]["message"]["content"].strip()
        else:
            raise Exception(f"Groq API chat failure: {res.text}")

def solve_chat_locally(query: str, clauses: list) -> str:
    """Keyword-based RAG chat simulator mapping questions to actual clauses."""
    q_lower = query.lower()
    
    # Identify what they are asking about
    matched_type = None
    if "indemnity" in q_lower or "indemnify" in q_lower:
        matched_type = "Indemnity"
    elif "terminate" in q_lower or "termination" in q_lower:
        matched_type = "Termination"
    elif "liability" in q_lower or "cap" in q_lower:
        matched_type = "Limitation of Liability"
    elif "governing" in q_lower or "jurisdiction" in q_lower or "court" in q_lower:
        matched_type = "Governing Law & Jurisdiction"
    elif "intellectual" in q_lower or "patent" in q_lower or "ip" in q_lower:
        matched_type = "Intellectual Property"
    elif "payment" in q_lower or "fee" in q_lower or "invoice" in q_lower:
        matched_type = "Payment Terms"
    elif "non-compete" in q_lower or "compete" in q_lower or "restrict" in q_lower:
        matched_type = "Non-Compete / Restraint of Trade"
    elif "arbitration" in q_lower or "dispute" in q_lower:
        matched_type = "Dispute Resolution"
    elif "force majeure" in q_lower or "god" in q_lower:
        matched_type = "Force Majeure"
        
    relevant_clauses = []
    for c in clauses:
        if matched_type and c.clause_type == matched_type:
            relevant_clauses.append(c)
        elif not matched_type and any(kw in c.raw_text_english.lower() for kw in q_lower.split() if len(kw) > 4):
            relevant_clauses.append(c)
            
    if not relevant_clauses:
        # Fallback to listing clauses overall
        if len(clauses) > 0:
            return (
                f"I couldn't locate a specific clause matching '{query}' directly, but the contract contains "
                f"{len(clauses)} segmented clauses. The overall assessed risk level is "
                f"dependent on the terms. Ask me about specific issues like 'indemnity', 'termination', or 'non-compete' "
                f"which are evaluated under standard Indian Law defaults."
            )
        else:
            return "This contract has not been fully processed or is empty. Please check back shortly."
            
    # Compile answers from matched clauses
    response_parts = [
        f"Based on my analysis of the contract, I found {len(relevant_clauses)} relevant clause(s) related to your query:\n"
    ]
    
    for c in relevant_clauses:
        response_parts.append(
            f"- **Clause #{c.sequence_number} (Page {c.page_number})**:\n"
            f"  *Text:* \"{c.raw_text_english[:180]}...\"\n"
            f"  *Assessment (Risk: {c.risk_level}):* {c.risk_explanation}\n"
        )
        
    response_parts.append(
        "Disclaimer: This is an automated assessment based on Indian Law defaults. For official actions, please consult a legal professional."
    )
    
    return "\n".join(response_parts)





async def query_groq_general_chat(query: str, history: list) -> str:
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert AI Legal Consultant specialized in Indian Law. You are answering direct legal questions "
                "from a verified legal practitioner (Advocate, Lawyer, or Judge) or citizen. Cite specific Indian statutes "
                "(e.g. Indian Contract Act 1872, RERA 2016, IT Act 2000, Arbitration and Conciliation Act, etc.) and give "
                "precise, professional, and clear explanations. Be concise and authoritative."
            )
        }
    ]
    
    for msg in history:
        messages.append({"role": msg.role, "content": msg.message})
        
    messages.append({"role": "user", "content": query})
    
    payload = {
        "model": "llama-3.1-8b-instant",
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 1024
    }
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(url, headers=headers, json=payload)
        if res.status_code == 200:
            data = res.json()
            return data["choices"][0]["message"]["content"].strip()
        else:
            raise Exception(f"Groq general API chat failure: {res.text}")


def solve_general_chat_locally(query: str) -> str:
    q_lower = query.lower()
    
    if "section 56" in q_lower or "force majeure" in q_lower or "frustration" in q_lower:
        return (
            "Under Indian Law, **Section 56 of the Indian Contract Act, 1872** governs the doctrine of frustration. "
            "It states that a contract to do an act which, after the contract is made, becomes impossible or, by reason "
            "of some event which the promisor could not prevent, unlawful, becomes void when the act becomes impossible or unlawful. "
            "Force Majeure is a contractual clause that regulates the consequences of such events."
        )
    elif "section 27" in q_lower or "non-compete" in q_lower or "restraint of trade" in q_lower:
        return (
            "Under **Section 27 of the Indian Contract Act, 1872**, any agreement in restraint of trade is void. "
            "Indian courts strictly enforce this, meaning post-employment non-compete clauses are generally held invalid "
            "and unenforceable against employees in India, unlike in some Western jurisdictions. Restraints during the "
            "active term of employment are, however, valid."
        )
    elif "rera" in q_lower or "builder" in q_lower or "real estate" in q_lower:
        return (
            "Under the **Real Estate (Regulation and Development) Act, 2016 (RERA)**, developers must register projects, "
            "deposit 70% of collections into an escrow account, and pay standard interest rates (SBI's highest marginal cost "
            "of funds rate plus 2%) in case of construction delays. Any default clause in a builder-buyer agreement setting "
            "unbalanced interest rates violates RERA standards."
        )
    elif "data privacy" in q_lower or "information technology" in q_lower or "it act" in q_lower or "section 43a" in q_lower:
        return (
            "The **Information Technology Act, 2000 (specifically Section 43A)** governs data privacy in India, "
            "requiring corporate entities holding sensitive personal data to implement reasonable security practices. "
            "This is supplemented by the **Digital Personal Data Protection Act, 2023 (DPDP)**, which introduces "
            "strict consent frameworks, data principal rights, and significant penalties for personal data breaches."
        )
    elif "arbitration" in q_lower or "dispute resolution" in q_lower:
        return (
            "Dispute resolution in commercial contracts in India is governed by the **Arbitration and Conciliation Act, 1996**. "
            "Standard clauses should designate a seat of arbitration (which determines court jurisdiction), a venue for hearings, "
            "and specify the rules (e.g., DIAC, MCIA) and number of arbitrators (typically a sole arbitrator or a panel of three)."
        )
    elif "indemnity" in q_lower or "indemnify" in q_lower:
        return (
            "**Section 124 of the Indian Contract Act, 1872** defines a contract of indemnity as a contract by which "
            "one party promises to save the other from loss caused to him by the conduct of the promisor himself, or by the "
            "conduct of any other person. Commercial contracts in India often expand this definition to cover third-party claims, "
            "intellectual property breaches, and regulatory violations."
        )
    else:
        return (
            "Welcome to the **General Legal AI Assistant**! I am calibrated with Indian Law defaults "
            "(including the Indian Contract Act 1872, RERA 2016, and IT Act/DPDP). \n\n"
            "Try asking me direct legal queries such as:\n"
            "- 'Tell me about Section 27 of the Indian Contract Act'\n"
            "- 'What are the builder requirements under RERA?'\n"
            "- 'Explain Section 56 regarding frustration of contract'\n\n"
            "*(Note: Provide a Groq API key in your server environment settings to activate advanced GPT-based reasoning.)*"
        )
