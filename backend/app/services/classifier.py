import httpx
import re
from app.core.config import settings

class ClauseClassifier:
    VALID_CATEGORIES = [
        "Confidentiality",
        "Termination",
        "Indemnity",
        "Limitation of Liability",
        "Governing Law & Jurisdiction",
        "Intellectual Property",
        "Payment Terms",
        "Non-Compete / Restraint of Trade",
        "Dispute Resolution",
        "Force Majeure",
        "Other"
    ]

    @classmethod
    def classify_groq(cls, clause_text: str) -> str:
        """Classifies a clause using Groq API."""
        if not settings.GROQ_API_KEY:
            raise ValueError("Groq API Key is not set")

        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json"
            }
            
            categories_str = ", ".join(cls.VALID_CATEGORIES)
            payload = {
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            f"You are a professional legal expert. Classify the following legal clause into exactly one of "
                            f"these standard categories: [{categories_str}]. "
                            f"Return ONLY the category name. Do not include quotes, preamble, or explanations."
                        )
                    },
                    {
                        "role": "user",
                        "content": clause_text
                    }
                ],
                "temperature": 0.1,
                "max_tokens": 50
            }
            
            with httpx.Client(timeout=10.0) as client:
                res = client.post(url, headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    category = data["choices"][0]["message"]["content"].strip()
                    # Clean up output
                    category = category.replace('"', '').replace("'", "")
                    # Ensure matching one of the categories
                    for cat in cls.VALID_CATEGORIES:
                        if cat.lower() in category.lower():
                            return cat
                    return "Other"
                else:
                    raise Exception(f"Groq API error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"Groq classification failed: {e}")
            raise

    @classmethod
    def classify_local(cls, clause_text: str) -> str:
        """Rule-based heuristic classifier used when Groq is not configured or offline."""
        text = clause_text.lower()
        
        if re.search(r'\b(confidential|proprietary|non-disclosure|disclosure|secret|privacy)\b', text):
            return "Confidentiality"
        if re.search(r'\b(terminate|termination|expiry|expire|cancel|cancellation)\b', text):
            return "Termination"
        if re.search(r'\b(indemnity|indemnify|harmless|indemnification|defend)\b', text):
            return "Indemnity"
        if re.search(r'\b(liability|cap|consequential|indirect damages|maximum liability|sole remedy)\b', text):
            return "Limitation of Liability"
        if re.search(r'\b(governing law|jurisdiction|courts of|exclusive jurisdiction|applicable law)\b', text):
            return "Governing Law & Jurisdiction"
        if re.search(r'\b(intellectual property|ipr|patent|copyright|trademark|invention|ownership of work)\b', text):
            return "Intellectual Property"
        if re.search(r'\b(payment|invoice|fees|interest rate|late fee|billing|price)\b', text):
            return "Payment Terms"
        if re.search(r'\b(non-compete|compete|solicit|non-solicitation|restraint of trade|restraint)\b', text):
            return "Non-Compete / Restraint of Trade"
        if re.search(r'\b(arbitration|dispute|dispute resolution|amicable|mediator|arbitral)\b', text):
            return "Dispute Resolution"
        if re.search(r'\b(force majeure|act of god|earthquake|pandemic|epidemic|government order|war|hostilities)\b', text):
            return "Force Majeure"
            
        return "Other"

    @classmethod
    def classify(cls, clause_text: str) -> str:
        """Main classification function. Defaults to Groq API, falls back to heuristic rules."""
        if settings.GROQ_API_KEY:
            try:
                return cls.classify_groq(clause_text)
            except Exception:
                print("Falling back to local heuristic classification...")
        
        return cls.classify_local(clause_text)
