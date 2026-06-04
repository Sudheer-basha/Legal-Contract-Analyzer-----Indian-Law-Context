from datetime import datetime
import uuid
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Contract(Base):
    __tablename__ = "contracts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)
    file_type = Column(String(10), nullable=False)  # 'pdf' or 'docx'
    language = Column(String(20), default="english")  # 'english' or 'hindi'
    
    # Contract ingestion / review status
    status = Column(String(50), default="PENDING")  # PENDING, PROCESSING, PENDING_REVIEW, APPROVED, ESCALATED
    overall_risk_score = Column(String(20), default="LOW")  # LOW, MEDIUM, HIGH
    
    # Audit and Reviewer Fields
    reviewer_id = Column(String(100), nullable=True)
    review_completed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    clauses = relationship("Clause", back_populates="contract", cascade="all, delete-orphan")
    chat_messages = relationship("ChatMessage", back_populates="contract", cascade="all, delete-orphan")


class Clause(Base):
    __tablename__ = "clauses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    contract_id = Column(String(36), ForeignKey("contracts.id"), nullable=False)
    
    page_number = Column(Integer, default=1)
    sequence_number = Column(Integer, nullable=False)
    
    raw_text_hindi = Column(Text, nullable=True)     # Original text if contract is in Hindi
    raw_text_english = Column(Text, nullable=False)    # Translated or original English text
    
    clause_type = Column(String(100), default="Other")  # Indemnity, Termination, Governing Law, etc.
    similarity_score = Column(Float, default=0.0)      # Similarity score with templates
    matched_template_clause = Column(Text, nullable=True) # The standard template text it matched
    
    risk_level = Column(String(20), default="LOW")     # LOW, MEDIUM, HIGH
    risk_explanation = Column(Text, nullable=True)    # Why is it risky, citing Indian law defaults
    
    # Reviewer Override Details
    status = Column(String(50), default="unreviewed")  # unreviewed, approved, overridden
    reviewer_comments = Column(Text, nullable=True)
    original_risk_level = Column(String(20), nullable=True) # Store original level before review override

    created_at = Column(DateTime, default=datetime.utcnow)

    contract = relationship("Contract", back_populates="clauses")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    contract_id = Column(String(36), ForeignKey("contracts.id"), nullable=True) # Nullable for general AI chat
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)         # Nullable for user association
    role = Column(String(20), nullable=False)           # 'user' or 'assistant'
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    contract = relationship("Contract", back_populates="chat_messages")
    user = relationship("User", back_populates="chat_messages")


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False)           # 'advocate', 'lawyer', 'judge', 'common', 'admin'
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    chat_messages = relationship("ChatMessage", back_populates="user", cascade="all, delete-orphan")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(100), nullable=False)    # INGESTION_START, INGESTION_SUCCESS, REVIEW_APPROVE, REVIEW_ESCALATE, EXPORT_REPORT
    contract_id = Column(String(36), nullable=True)
    details = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)
