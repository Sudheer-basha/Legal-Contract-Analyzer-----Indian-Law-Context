import os
import json
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Tuple
from app.core.config import settings

class EmbeddingModel:
    _model = None

    @classmethod
    def get_model(cls):
        """Lazy loads sentence-transformers model to save memory on startups."""
        if cls._model is None:
            try:
                from sentence_transformers import SentenceTransformer
                print(f"Loading Sentence-Transformer: {settings.EMBEDDING_MODEL}...")
                cls._model = SentenceTransformer(settings.EMBEDDING_MODEL)
                print("Embedding model loaded successfully.")
            except Exception as e:
                print(f"Failed to load sentence-transformers: {e}")
                # Return a dummy model that generates random vectors
                class DummyModel:
                    def encode(self, sentences, **kwargs):
                        if isinstance(sentences, str):
                            sentences = [sentences]
                        return np.random.randn(len(sentences), 384).astype(np.float32)
                cls._model = DummyModel()
        return cls._model

class QdrantService:
    _qdrant_client = None
    _in_memory_db: List[Dict[str, Any]] = []  # Fallback vector database
    
    @classmethod
    def get_qdrant_client(cls):
        """Returns QdrantClient if available and online, otherwise returns None."""
        if cls._qdrant_client is None:
            try:
                from qdrant_client import QdrantClient
                client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
                # Check connection
                client.get_collections()
                cls._qdrant_client = client
                print("Successfully connected to Qdrant Vector DB.")
            except Exception as e:
                print(f"Qdrant DB not available (will use in-memory vector fallback): {e}")
                cls._qdrant_client = False
        return cls._qdrant_client if cls._qdrant_client else None

    @classmethod
    def initialize_kb(cls):
        """
        Loads standard templates, chunks them, embeds them,
        and saves them to Qdrant (or in-memory fallback).
        Runs at application startup.
        """
        templates_path = settings.TEMPLATE_DIR
        # Define some basic template paths
        template_files = {
            "nda": "standard_nda.txt",
            "employment": "standard_employment.txt",
            "service": "standard_service.txt",
            "rera": "standard_rera_sale.txt"
        }
        
        # Verify templates exist, else create standard boilerplate templates
        cls._create_default_templates_if_missing(templates_path, template_files)
        
        # Load and encode templates
        all_chunks = []
        for template_type, filename in template_files.items():
            filepath = templates_path / filename
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                
                # Simple chunking by paragraph
                paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
                for idx, para in enumerate(paragraphs):
                    all_chunks.append({
                        "id": f"{template_type}_{idx}",
                        "template_type": template_type,
                        "text": para
                    })
            except Exception as e:
                print(f"Error loading template {filename}: {e}")

        if not all_chunks:
            print("No templates found to index.")
            return

        print(f"Found {len(all_chunks)} standard template clauses. Generating embeddings...")
        model = EmbeddingModel.get_model()
        texts = [chunk["text"] for chunk in all_chunks]
        embeddings = model.encode(texts)
        
        for chunk, emb in zip(all_chunks, embeddings):
            chunk["embedding"] = emb

        # Store in-memory fallback
        cls._in_memory_db = all_chunks
        
        # Store in Qdrant if available
        client = cls.get_qdrant_client()
        if client:
            try:
                from qdrant_client.models import Distance, VectorParams, PointStruct
                # Re-create collection
                client.recreate_collection(
                    collection_name=settings.QDRANT_COLLECTION,
                    vectors_config=VectorParams(size=len(embeddings[0]), distance=Distance.COSINE),
                )
                
                points = [
                    PointStruct(
                        id=i,
                        vector=chunk["embedding"].tolist(),
                        payload={
                            "template_type": chunk["template_type"],
                            "text": chunk["text"]
                        }
                    )
                    for i, chunk in enumerate(all_chunks)
                ]
                client.upsert(
                    collection_name=settings.QDRANT_COLLECTION,
                    wait=True,
                    points=points
                )
                print(f"Successfully loaded {len(all_chunks)} clauses into Qdrant collection '{settings.QDRANT_COLLECTION}'.")
            except Exception as e:
                print(f"Failed loading templates into Qdrant: {e}. Falling back to In-Memory vector store.")

    @classmethod
    def search_similar_clause(cls, clause_text: str, template_type: str = None) -> Tuple[str, float]:
        """
        Searches standard templates for the most similar clause.
        Returns a tuple of (matched_text, similarity_score).
        """
        model = EmbeddingModel.get_model()
        query_vector = model.encode([clause_text])[0]
        
        client = cls.get_qdrant_client()
        if client:
            try:
                from qdrant_client.models import Filter, FieldCondition, MatchValue
                
                # Apply filter if specific template type is provided
                query_filter = None
                if template_type:
                    query_filter = Filter(
                        must=[FieldCondition(key="template_type", match=MatchValue(value=template_type))]
                    )
                
                search_result = client.search(
                    collection_name=settings.QDRANT_COLLECTION,
                    query_vector=query_vector.tolist(),
                    limit=1,
                    query_filter=query_filter
                )
                
                if search_result:
                    match = search_result[0]
                    return match.payload["text"], match.score
            except Exception as e:
                print(f"Qdrant search failed, falling back to In-Memory search: {e}")

        # In-Memory Search Fallback using cosine similarity (numpy)
        db_to_search = cls._in_memory_db
        if template_type:
            db_to_search = [c for c in cls._in_memory_db if c["template_type"] == template_type]
            
        if not db_to_search:
            return "No templates loaded.", 0.0
            
        best_match = None
        best_score = -1.0
        
        # Compute cosine similarity
        for chunk in db_to_search:
            emb = chunk["embedding"]
            # Cosine similarity: dot product divided by magnitude product
            dot = np.dot(query_vector, emb)
            norm_q = np.linalg.norm(query_vector)
            norm_e = np.linalg.norm(emb)
            score = dot / (norm_q * norm_e) if (norm_q > 0 and norm_e > 0) else 0.0
            
            if score > best_score:
                best_score = score
                best_match = chunk["text"]
                
        return best_match if best_match else "", float(best_score)

    @classmethod
    def _create_default_templates_if_missing(cls, folder: Path, files: Dict[str, str]):
        """Helper to create dummy files containing sample clauses if they don't exist."""
        # Standard NDA
        nda_content = (
            "Standard Non-Disclosure Agreement (NDA) Template - Indian Contract Act 1872\n\n"
            "This Agreement is made under the provisions of the Indian Contract Act, 1872.\n\n"
            "1. Definition of Confidential Information: 'Confidential Information' means all proprietary "
            "information disclosed by one party to the other, whether orally or in writing.\n\n"
            "2. Non-Disclosure Obligations: The receiving party shall hold the Confidential Information in "
            "strict confidence and shall not disclose it to any third party without written consent.\n\n"
            "3. Permitted Disclosures: The receiving party may disclose Confidential Information to its "
            "employees on a need-to-know basis, or if required under standard judicial orders.\n\n"
            "4. Governing Law and Jurisdiction: This Agreement shall be governed by and construed in accordance "
            "with the laws of India, and any disputes shall be subject to the exclusive jurisdiction of courts "
            "located in Mumbai, India.\n\n"
            "5. Term and Termination: The obligations under this Agreement shall survive for a period of "
            "3 (three) years from the date of disclosure."
        )
        
        # Standard Employment
        employment_content = (
            "Standard Employment Agreement Template - Indian Law defaults\n\n"
            "1. Duties and Services: The Employee agrees to perform the duties of the assigned role diligently "
            "and in accordance with company policies.\n\n"
            "2. Non-Compete Restriction: The Employee agrees that during their employment and for a period of "
            "1 (one) year post termination, they shall not engage in any competing business. (Note: Under Section 27 "
            "of the Indian Contract Act 1872, post-employment non-competes are generally void).\n\n"
            "3. Intellectual Property Ownership: Any intellectual property or inventions created by the Employee "
            "during the hours of employment and utilizing company resources shall vest exclusively in the Company.\n\n"
            "4. Termination Notice: Either party may terminate this agreement by providing 30 (thirty) days written "
            "notice, or payment of salary in lieu of notice.\n\n"
            "5. Dispute Resolution: Any disputes arising out of this employment contract shall be resolved by "
            "arbitration in Bangalore in accordance with the Arbitration and Conciliation Act, 1996."
        )
        
        # Standard Service
        service_content = (
            "Standard Master Service Agreement (MSA) - Indian Corporate Context\n\n"
            "1. Scope of Work: The Vendor shall provide the services specified in the individual Statements of "
            "Work (SOW) signed by both parties.\n\n"
            "2. Payment Terms: Payments shall be made within 45 (forty-five) days of receipt of a valid tax invoice. "
            "Late payments shall incur an interest fee of 12% per annum.\n\n"
            "3. Limitation of Liability: Neither party shall be liable for indirect, incidental, or consequential "
            "damages. The Vendor's maximum liability under this agreement shall be capped at the total fees paid "
            "in the preceding 6 months.\n\n"
            "4. Indemnification: The Vendor shall indemnify and hold harmless the Client against any third-party claims "
            "resulting from intellectual property infringement or gross negligence of the Vendor.\n\n"
            "5. Force Majeure: Neither party shall be liable for failure to perform due to acts of God, war, government "
            "regulations, pandemics, or other events beyond their reasonable control."
        )
        
        # Standard RERA Sale
        rera_content = (
            "Standard Developer-Buyer Sale Agreement - Real Estate Regulation and Development Act (RERA) 2016\n\n"
            "1. Purchase Price and Payments: The Allottee agrees to purchase the apartment for the specified total "
            "consideration, payable in installments linked to construction milestones.\n\n"
            "2. Delay Interest Rates: In the event of default or delay in payment by the Allottee, or delay in possession "
            "by the Promoter, interest shall be payable at the Rate prescribed under RERA Rules (SBI Highest Marginal "
            "Cost of Funds Lending Rate + 2%).\n\n"
            "3. Possession Timeline: The Promoter agrees to complete construction and hand over possession of the unit "
            "by the specified target date, subject to force majeure conditions.\n\n"
            "4. Allocation of Parking: Covered parking spaces allocated to the Allottee form part of the common areas "
            "and are subject to provisions of the RERA Act, 2016.\n\n"
            "5. Cancellation Right: The Allottee has the right to cancel the booking. In case of cancellation without "
            "promoter default, the promoter may forfeit an amount not exceeding 10% of the booking cost."
        )
        
        contents = {
            "nda": nda_content,
            "employment": employment_content,
            "service": service_content,
            "rera": rera_content
        }
        
        for key, fname in files.items():
            path = folder / fname
            if not path.exists():
                with open(path, "w", encoding="utf-8") as f:
                    f.write(contents[key])
                print(f"Created default template file: {fname}")
