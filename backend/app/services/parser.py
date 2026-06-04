import re
import concurrent.futures
from pathlib import Path
from typing import List, Dict, Any
import pdfplumber
import docx

def parse_pdf_page(file_path: str, page_num: int) -> str:
    """Parses a single PDF page. Run inside an executor for parallel processing."""
    try:
        with pdfplumber.open(file_path) as pdf:
            if page_num < len(pdf.pages):
                page_text = pdf.pages[page_num].extract_text()
                return page_text if page_text else ""
    except Exception as e:
        print(f"Error parsing PDF page {page_num}: {e}")
    return ""

class DocumentParser:
    @staticmethod
    def is_hindi(text: str) -> bool:
        """Detects if Devanagari script is present in the text."""
        # Devanagari Unicode range: \u0900-\u097F
        return bool(re.search(r'[\u0900-\u097F]', text))

    @classmethod
    def parse_pdf(cls, file_path: str) -> List[Dict[str, Any]]:
        """Parses a PDF page-by-page concurrently."""
        file_path_str = str(file_path)
        try:
            with pdfplumber.open(file_path_str) as pdf:
                num_pages = len(pdf.pages)
            
            pages_text = [""] * num_pages
            # Parallelize page extraction
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future_to_page = {
                    executor.submit(parse_pdf_page, file_path_str, idx): idx 
                    for idx in range(num_pages)
                }
                for future in concurrent.futures.as_completed(future_to_page):
                    idx = future_to_page[future]
                    pages_text[idx] = future.result()
            
            # Combine pages into structured output
            structured_pages = []
            for idx, text in enumerate(pages_text):
                structured_pages.append({
                    "page_number": idx + 1,
                    "text": text
                })
            return structured_pages
        except Exception as e:
            print(f"Failed parsing PDF: {e}")
            raise

    @classmethod
    def parse_docx(cls, file_path: str) -> List[Dict[str, Any]]:
        """Parses a DOCX document into simulated pages."""
        try:
            doc = docx.Document(file_path)
            full_text = []
            for para in doc.paragraphs:
                if para.text.strip():
                    full_text.append(para.text)
            
            # Since docx does not have explicit physical pages easily,
            # we group paragraphs into chunks of ~30 lines to simulate pages.
            simulated_pages = []
            current_page_text = []
            current_line_count = 0
            page_idx = 1
            
            for para_text in full_text:
                current_page_text.append(para_text)
                current_line_count += max(1, len(para_text) // 80)
                if current_line_count >= 30:
                    simulated_pages.append({
                        "page_number": page_idx,
                        "text": "\n\n".join(current_page_text)
                    })
                    page_idx += 1
                    current_page_text = []
                    current_line_count = 0
            
            if current_page_text:
                simulated_pages.append({
                    "page_number": page_idx,
                    "text": "\n\n".join(current_page_text)
                })
                
            return simulated_pages
        except Exception as e:
            print(f"Failed parsing DOCX: {e}")
            raise

    @classmethod
    def segment_clauses(cls, pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Segments raw page text into logical clause blocks using heuristics.
        Groups short section headings with the succeeding paragraphs.
        """
        clauses = []
        seq_num = 1
        
        for page in pages:
            page_num = page["page_number"]
            text = page["text"]
            
            # Split text by double newlines or single newlines that look like bullet points
            paragraphs = [p.strip() for p in re.split(r'\n\n+', text) if p.strip()]
            
            temp_header = ""
            for p in paragraphs:
                # Heuristic: If paragraph is very short (e.g. less than 120 chars) and matches 
                # a common heading pattern like "Section 1", "Clause A", "Definitions" etc.
                is_heading = (
                    len(p) < 120 and 
                    (
                        re.match(r'^(?:section|clause|article|schedule|point|\d+\.|\w\.)', p, re.IGNORECASE) or
                        p.isupper()
                    )
                )
                
                if is_heading:
                    if temp_header:
                        # Append the previous dangling header as its own clause if we encounter another header
                        clauses.append({
                            "page_number": page_num,
                            "sequence_number": seq_num,
                            "text": temp_header
                        })
                        seq_num += 1
                    temp_header = p
                else:
                    if temp_header:
                        combined_text = f"{temp_header}\n{p}"
                        temp_header = ""
                    else:
                        combined_text = p
                        
                    clauses.append({
                        "page_number": page_num,
                        "sequence_number": seq_num,
                        "text": combined_text
                    })
                    seq_num += 1
            
            # Flush any remaining header at the end of the page
            if temp_header:
                clauses.append({
                    "page_number": page_num,
                    "sequence_number": seq_num,
                    "text": temp_header
                })
                seq_num += 1

        return clauses
