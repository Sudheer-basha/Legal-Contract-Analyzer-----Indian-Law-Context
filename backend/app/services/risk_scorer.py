import httpx
import json
import re
from typing import Dict, Any
from app.core.config import settings

class RiskScorer:
    @classmethod
    def score_groq(cls, clause_text: str, category: str) -> Dict[str, Any]:
        """Queries Groq to evaluate legal risk under Indian Law."""
        if not settings.GROQ_API_KEY:
            raise ValueError("Groq API Key is not set")
            
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json"
            }
            
            system_prompt = (
                "You are an expert Indian corporate lawyer. Analyze the following contract clause for compliance with Indian laws "
                "(Indian Contract Act 1872, RERA 2016, Companies Act 2013, IT Act 2000, and standard Indian NDA/employment templates). "
                "Identify any non-standard terms, unreasonable liabilities, or void conditions under Indian law defaults. "
                "Rate the risk level as LOW, MEDIUM, or HIGH.\n\n"
                "Particularly check for:\n"
                "1. Non-compete covenants extending post-employment (Void under Section 27, Indian Contract Act).\n"
                "2. Limitations on legal proceedings or shortening limitation periods below 3 years (Void under Section 28, Indian Contract Act).\n"
                "3. Astronomical penalty charges (Sections 73 & 74, Contract Act - Courts only award reasonable compensation).\n"
                "4. Real estate clauses violating RERA 2016 (e.g. asymmetrical interest charges or allocation rules under RERA Section 19).\n"
                "5. Data privacy missing standard safeguards (Section 43A, IT Act 2000).\n\n"
                "Provide your analysis in clean JSON format matching this schema:\n"
                "{\n"
                "  \"risk_level\": \"LOW\" | \"MEDIUM\" | \"HIGH\",\n"
                "  \"explanation\": \"Detailed legal reason why, citing specific acts/sections.\",\n"
                "  \"legal_citations\": [\"Act name, Section X\", ...]\n"
                "}\n"
                "Ensure you only output valid JSON. Do not write anything else."
            )
            
            payload = {
                "model": "llama-3.1-8b-instant",
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Category: {category}\nClause Text: {clause_text}"}
                ],
                "temperature": 0.1,
                "max_tokens": 1024
            }
            
            with httpx.Client(timeout=15.0) as client:
                res = client.post(url, headers=headers, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    response_text = data["choices"][0]["message"]["content"].strip()
                    parsed = json.loads(response_text)
                    
                    # Validate keys
                    if "risk_level" in parsed and "explanation" in parsed:
                        # Normalize risk level
                        risk = parsed["risk_level"].upper()
                        if risk not in ["LOW", "MEDIUM", "HIGH"]:
                            risk = "MEDIUM"
                        parsed["risk_level"] = risk
                        return parsed
                    
                    raise ValueError("JSON missing required fields")
                else:
                    raise Exception(f"Groq API error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"Groq risk scoring failed: {e}")
            raise

    @classmethod
    def score_local(cls, clause_text: str, category: str) -> Dict[str, Any]:
        """
        Local legal rule engine evaluating risk against Indian Law defaults.
        Runs when Groq is not configured or offline.
        """
        text = clause_text.lower()
        
        # Default starting values
        risk_level = "LOW"
        explanation = "This clause appears standard and compliant with general Indian business contracting standards."
        citations = []
        
        # 1. Non-compete post-employment check (Sec 27)
        if category == "Non-Compete / Restraint of Trade" or "compete" in text or "restraint" in text:
            if re.search(r'\b(post-employment|after termination|ceases to be|survive termination|for a period of \d+ (month|year))\b', text):
                risk_level = "HIGH"
                explanation = (
                    "This clause imposes a post-employment non-compete restriction. Under Section 27 of the Indian Contract Act, 1872, "
                    "any agreement in restraint of trade, profession, or business is void to that extent. Unlike common law jurisdictions, "
                    "India enforces a strict prohibition on post-employment non-competes, making this term legally unenforceable."
                )
                citations.append("Indian Contract Act 1872, Section 27")
            elif "during" in text or "term of employment" in text:
                risk_level = "LOW"
                explanation = "This covenant operates only during the term of employment, which is valid and enforceable under Indian law."
                citations.append("Indian Contract Act 1872, Section 27")

        # 2. Restricting legal proceedings (Sec 28)
        elif category == "Governing Law & Jurisdiction" or "jurisdiction" in text or "limitation" in text:
            # Check for shortening the limitation period (standard is 3 years under Limitation Act)
            limit_match = re.search(r'\b(\d+)\s*(month|year)s?\s*(to file|to bring|limitation period|within which)\b', text)
            if limit_match:
                period = int(limit_match.group(1))
                unit = limit_match.group(2)
                if (unit == "month" and period < 36) or (unit == "year" and period < 3):
                    risk_level = "HIGH"
                    explanation = (
                        "This clause limits the period within which a party can file a legal claim to less than the statutory 3 years. "
                        "Under Section 28 of the Indian Contract Act, 1872, any clause that limits the time within which a party may enforce "
                        "their legal rights is void. Standard limitation periods are governed by the Limitation Act, 1963."
                    )
                    citations.append("Indian Contract Act 1872, Section 28")
                    citations.append("Limitation Act 1963")
            elif "exclusive jurisdiction" in text and not re.search(r'\b(india|mumbai|delhi|bangalore|kolkata|chennai|hyderabad|pune)\b', text):
                risk_level = "MEDIUM"
                explanation = (
                    "The clause vests exclusive jurisdiction in foreign courts. While Indian companies contracting with foreign parties "
                    "can choose neutral foreign seats, if both contracting parties are Indian, choosing a foreign court with no connection "
                    "to the transaction can be challenged as contrary to public policy under Section 23 of the Contract Act."
                )
                citations.append("Indian Contract Act 1872, Section 23")

        # 3. Penalties & Liquidated damages (Sec 74)
        elif "penalty" in text or "liquidated damages" in text or "forfeit" in text:
            if re.search(r'\b(entire|100%|all fees|astronomical|double|triple|10x|ten times)\b', text) or "interest of" in text:
                # Check for high interest rates
                high_interest = re.search(r'\b(18%|24%|30%|36%)\b', text)
                if high_interest:
                    risk_level = "HIGH"
                    explanation = (
                        f"This clause specifies an extremely high default rate of interest ({high_interest.group(1)}). Under Section 74 of the "
                        "Indian Contract Act, 1872, if a sum is named in the contract as a penalty, courts will only award reasonable compensation "
                        "not exceeding the amount named. Exorbitant default interest rates are frequently struck down or read down by Indian courts."
                    )
                    citations.append("Indian Contract Act 1872, Section 74")
                else:
                    risk_level = "MEDIUM"
                    explanation = (
                        "The clause stipulates a forfeiture or liquidated damages clause that may be viewed as penal rather than a genuine pre-estimate "
                        "of loss. In India (under Section 74 of the Contract Act), courts will evaluate whether the damages are reasonable, and will not "
                        "automatically enforce arbitrary penal rates."
                    )
                    citations.append("Indian Contract Act 1872, Section 74")

        # 4. RERA Asymmetrical Clauses (Developer vs Buyer)
        elif "rera" in text or "developer" in text or "promoter" in text or "allottee" in text:
            # Check for unequal default rates or possession delay limits
            if re.search(r'\b(15%|18%|24%)\b', text) and "allottee" in text:
                risk_level = "HIGH"
                explanation = (
                    "This real estate agreement imposes high default charges on the Buyer (Allottee). Section 19 of the RERA Act, 2016, "
                    "stipulates that the interest rate payable by the allottee for defaults must be equal to the rate payable by the promoter "
                    "for delays. Asymmetrical interest clauses favoring the promoter are void under RERA."
                )
                citations.append("RERA Act 2016, Section 19")
            elif "not be liable for any delay" in text or "extension of" in text:
                risk_level = "MEDIUM"
                explanation = (
                    "This clause attempts to exempt the promoter from delay liabilities. RERA 2016 heavily regulates possession timelines, "
                    "and any clause limiting the promoter's liability for delays conflicts with the statutory rules of RERA."
                )
                citations.append("RERA Act 2016, Section 18")

        # 5. IT Act Data Protection
        elif category == "Confidentiality" and re.search(r'\b(personal data|sensitive|biometric|aadhaar|information security)\b', text):
            if not re.search(r'\b(consent|secure|encryption|policy|standard)\b', text):
                risk_level = "MEDIUM"
                explanation = (
                    "This clause deals with sensitive personal data but lacks clear data protection safeguards, encryption, or security standards. "
                    "Under Section 43A of the IT Act, 2000 (and the Reasonable Security Practices Rules), corporate bodies handling sensitive "
                    "personal data are liable to pay compensation for negligence in maintaining reasonable security practices."
                )
                citations.append("Information Technology Act 2000, Section 43A")

        # 6. Limitation of Liability gross negligence carve-outs
        elif category == "Limitation of Liability":
            if not re.search(r'\b(gross negligence|willful misconduct|fraud|breach of confidentiality)\b', text):
                risk_level = "HIGH"
                explanation = (
                    "This limitation of liability clause does not carve out gross negligence, fraud, or willful misconduct. Under Indian law, "
                    "any contract that attempts to limit liability for fraud or intentional wrongdoing is void as it violates public policy "
                    "(Section 23 of the Indian Contract Act)."
                )
                citations.append("Indian Contract Act 1872, Section 23")
            else:
                risk_level = "LOW"
                explanation = "Standard liability cap that includes necessary carve-outs for fraud and confidentiality breaches."
                citations.append("Indian Contract Act 1872, Section 73")

        # 7. Unreasonable Termination
        elif category == "Termination":
            if "sole discretion" in text and "without notice" in text:
                risk_level = "MEDIUM"
                explanation = (
                    "This clause allows one party to terminate at sole discretion without notice, while requiring notice from the other party. "
                    "While Indian courts respect freedom of contract, heavily one-sided termination terms in consumer/employment agreements "
                    "can be challenged as unconscionable under public policy principles."
                )
                citations.append("Indian Contract Act 1872, Section 23")

        return {
            "risk_level": risk_level,
            "explanation": explanation,
            "legal_citations": citations
        }

    @classmethod
    def score(cls, clause_text: str, category: str) -> Dict[str, Any]:
        """Evaluates clause risk level and generates citations, falling back to local engine if needed."""
        if settings.GROQ_API_KEY:
            try:
                return cls.score_groq(clause_text, category)
            except Exception:
                print("Falling back to local legal risk engine...")
        
        return cls.score_local(clause_text, category)
