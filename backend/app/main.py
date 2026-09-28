import json

from app.argus_lite import analyze_stream
from app.extract_text import extract_text
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

app = FastAPI(
    title="ARGUS-Lite API",
    description="Two ideas from ARGUS: verify evidence is grounded, score by formula, not by asking",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE = 8 * 1024 * 1024  # 8MB, plenty for a report and well under Caddy's cap


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze-stream")
async def analyze_stream_endpoint(
    question: str = Form(...),
    document_text: str = Form(""),
    file: UploadFile | None = File(None),
):
    if file is not None:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 8MB)")
        document = extract_text(file.filename, content)
    else:
        document = document_text

    if not document.strip():
        raise HTTPException(status_code=400, detail="No document text or file provided")
    if not question.strip():
        raise HTTPException(status_code=400, detail="question is empty")

    def event_stream():
        for event in analyze_stream(document, question):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
