import io
import datetime
from typing import List, Dict, Any
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.graphics.shapes import Drawing, Rect, String, Group

class PDFReportGenerator:
    @classmethod
    def generate(cls, contract_data: Dict[str, Any], clauses: List[Dict[str, Any]]) -> io.BytesIO:
        """
        Generates an annotated legal review report PDF.
        """
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=36,
            leftMargin=36,
            topMargin=36,
            bottomMargin=36
        )
        
        styles = getSampleStyleSheet()
        
        # Define Custom Styles
        title_style = ParagraphStyle(
            name='DocTitle',
            parent=styles['Heading1'],
            fontName='Helvetica-Bold',
            fontSize=22,
            leading=26,
            textColor=colors.HexColor('#1A365D'),
            spaceAfter=15
        )
        
        section_style = ParagraphStyle(
            name='SectionHeader',
            parent=styles['Heading2'],
            fontName='Helvetica-Bold',
            fontSize=14,
            leading=18,
            textColor=colors.HexColor('#2C5282'),
            spaceBefore=15,
            spaceAfter=8,
            keepWithNext=True
        )
        
        body_style = ParagraphStyle(
            name='BodyCustom',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=14,
            textColor=colors.HexColor('#2D3748'),
            spaceAfter=6
        )

        bold_label_style = ParagraphStyle(
            name='BoldLabel',
            parent=body_style,
            fontName='Helvetica-Bold'
        )

        clause_text_style = ParagraphStyle(
            name='ClauseText',
            parent=body_style,
            fontName='Helvetica-Oblique',
            textColor=colors.HexColor('#4A5568')
        )
        
        story = []
        
        # 1. Document Title / Header
        story.append(Paragraph("LEGAL CONTRACT REVIEW REPORT", title_style))
        story.append(Paragraph("<b>Indian Law Compliance Assessment</b>", body_style))
        story.append(Spacer(1, 10))
        
        # 2. Metadata Table
        meta_data = [
            [Paragraph("<b>Contract Filename:</b>", bold_label_style), Paragraph(contract_data.get("filename", "Unknown"), body_style)],
            [Paragraph("<b>Ingestion Date:</b>", bold_label_style), Paragraph(str(contract_data.get("created_at", datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))), body_style)],
            [Paragraph("<b>Detected Language:</b>", bold_label_style), Paragraph(contract_data.get("language", "English").capitalize(), body_style)],
            [Paragraph("<b>Approval Status:</b>", bold_label_style), Paragraph(f"<b>{contract_data.get('status', 'PENDING')}</b>", body_style)],
            [Paragraph("<b>Overall Risk Level:</b>", bold_label_style), Paragraph(f"<b>{contract_data.get('overall_risk_score', 'LOW')}</b>", body_style)]
        ]
        
        meta_table = Table(meta_data, colWidths=[2.0 * inch, 5.0 * inch])
        meta_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F7FAFC')),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
            ('PADDING', (0,0), (-1,-1), 6),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        story.append(meta_table)
        story.append(Spacer(1, 20))
        
        # 3. Risk Distribution Chart & Legend
        # Count risk levels
        high_count = sum(1 for c in clauses if c.get("risk_level") == "HIGH")
        med_count = sum(1 for c in clauses if c.get("risk_level") == "MEDIUM")
        low_count = sum(1 for c in clauses if c.get("risk_level") == "LOW")
        total_clauses = len(clauses)
        
        story.append(Paragraph("Risk Score Distribution", section_style))
        
        # Draw a custom horizontal bar chart representing the proportions
        drawing = Drawing(504, 50)
        drawing.add(Rect(0, 10, 504, 25, fillColor=colors.HexColor('#E2E8F0'), strokeColor=None))
        
        # Compute segment widths
        w_high = 0
        w_med = 0
        w_low = 0
        
        if total_clauses > 0:
            w_high = (high_count / total_clauses) * 504
            w_med = (med_count / total_clauses) * 504
            w_low = (low_count / total_clauses) * 504
            
        x_cursor = 0
        if w_high > 0:
            drawing.add(Rect(x_cursor, 10, w_high, 25, fillColor=colors.HexColor('#E53E3E'), strokeColor=None))
            x_cursor += w_high
        if w_med > 0:
            drawing.add(Rect(x_cursor, 10, w_med, 25, fillColor=colors.HexColor('#DD6B20'), strokeColor=None))
            x_cursor += w_med
        if w_low > 0:
            drawing.add(Rect(x_cursor, 10, w_low, 25, fillColor=colors.HexColor('#38A169'), strokeColor=None))
            
        story.append(drawing)
        story.append(Spacer(1, 8))
        
        # Legend and text counts
        legend_data = [[
            Paragraph(f"<font color='#E53E3E'>■</font> <b>High Risk:</b> {high_count} clauses", body_style),
            Paragraph(f"<font color='#DD6B20'>■</font> <b>Medium Risk:</b> {med_count} clauses", body_style),
            Paragraph(f"<font color='#38A169'>■</font> <b>Low Risk:</b> {low_count} clauses", body_style),
            Paragraph(f"<b>Total:</b> {total_clauses} clauses", body_style)
        ]]
        legend_table = Table(legend_data, colWidths=[1.7 * inch, 1.7 * inch, 1.7 * inch, 1.9 * inch])
        legend_table.setStyle(TableStyle([
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        story.append(legend_table)
        story.append(Spacer(1, 20))
        
        # 4. Auditor/Reviewer Notes Section
        if contract_data.get("review_notes"):
            notes_section = []
            notes_section.append(Paragraph("Reviewer Notes & Action Items", section_style))
            notes_section.append(Paragraph(contract_data["review_notes"], body_style))
            notes_section.append(Spacer(1, 15))
            story.append(KeepTogether(notes_section))
            
        story.append(PageBreak())
        
        # 5. Detailed Clause Annotations
        story.append(Paragraph("Detailed Clause-by-Clause Annotations", section_style))
        story.append(Spacer(1, 10))
        
        for idx, clause in enumerate(clauses):
            risk = clause.get("risk_level", "LOW")
            risk_color = '#38A169'
            if risk == "HIGH":
                risk_color = '#E53E3E'
            elif risk == "MEDIUM":
                risk_color = '#DD6B20'
                
            clause_elements = []
            
            # Clause header row
            clause_title = f"Clause #{clause.get('sequence_number', idx+1)} — Page {clause.get('page_number', 1)}"
            clause_elements.append(Paragraph(f"<b>{clause_title}</b>", section_style))
            
            # Sub-table inside the layout
            clause_info = []
            
            # Text row (supporting Hindi translated side-by-side if required)
            if clause.get("raw_text_hindi"):
                clause_info.append([
                    Paragraph("<b>Original Text (Hindi):</b>", bold_label_style),
                    Paragraph(clause["raw_text_hindi"], clause_text_style)
                ])
                clause_info.append([
                    Paragraph("<b>English Translation:</b>", bold_label_style),
                    Paragraph(clause["raw_text_english"], body_style)
                ])
            else:
                clause_info.append([
                    Paragraph("<b>Clause Text:</b>", bold_label_style),
                    Paragraph(clause["raw_text_english"], body_style)
                ])
                
            clause_info.append([
                Paragraph("<b>Category:</b>", bold_label_style),
                Paragraph(clause.get("clause_type", "Other"), body_style)
            ])
            
            clause_info.append([
                Paragraph("<b>Risk Rating:</b>", bold_label_style),
                Paragraph(f"<font color='{risk_color}'><b>{risk}</b></font>", body_style)
            ])
            
            clause_info.append([
                Paragraph("<b>Risk Analysis:</b>", bold_label_style),
                Paragraph(clause.get("risk_explanation", "No risk explanation provided."), body_style)
            ])
            
            citations = clause.get("matched_template_clause")
            # If there's legal citations
            citations_list = clause.get("risk_explanation") # wait, legal citations are saved, let's extract them
            # Let's check if we have a field for citations. In the model, we put it in risk_explanation or matched_template_clause.
            # Let's check what fields we have: matched_template_clause, risk_explanation
            if clause.get("matched_template_clause"):
                # Check if similarity score
                similarity = clause.get("similarity_score", 0.0)
                sim_percent = f"{similarity * 100:.1f}%" if similarity > 0 else "0%"
                clause_info.append([
                    Paragraph("<b>Deviation Match:</b>", bold_label_style),
                    Paragraph(f"Similar template clause found (Similarity: {sim_percent}):<br/><i>{clause.get('matched_template_clause')[:250]}...</i>", body_style)
                ])
                
            if clause.get("reviewer_comments"):
                clause_info.append([
                    Paragraph("<b>Reviewer Comments:</b>", bold_label_style),
                    Paragraph(clause["reviewer_comments"], body_style)
                ])

            clause_table = Table(clause_info, colWidths=[1.8 * inch, 5.2 * inch])
            clause_table.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LINEBELOW', (0,0), (-1,-1), 0.5, colors.HexColor('#EDF2F7')),
                ('PADDING', (0,0), (-1,-1), 4),
            ]))
            
            # Left boundary colored bar based on risk
            outer_table = Table([[Paragraph("", body_style), clause_table]], colWidths=[0.1 * inch, 7.0 * inch])
            outer_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (0,0), colors.HexColor(risk_color)),
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('BOTTOMPADDING', (0,0), (-1,-1), 10),
            ]))
            
            clause_elements.append(outer_table)
            clause_elements.append(Spacer(1, 10))
            
            story.append(KeepTogether(clause_elements))
            
        doc.build(story)
        buffer.seek(0)
        return buffer
