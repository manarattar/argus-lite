"""Turn an uploaded file into plain text, whatever format it came in."""

import io


def extract_text(filename: str, content: bytes) -> str:
    name = filename.lower()

    if name.endswith(".pdf"):
        import fitz  # PyMuPDF

        doc = fitz.open(stream=content, filetype="pdf")
        return "\n".join(page.get_text() for page in doc)

    if name.endswith(".docx"):
        import docx

        document = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs)

    # Fall back to treating it as plain text (.txt or anything else).
    return content.decode("utf-8", errors="ignore")
