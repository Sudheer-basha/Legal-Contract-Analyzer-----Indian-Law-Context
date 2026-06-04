from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from pathlib import Path

from app.core.config import settings
from app.db.database import init_db
from app.services.qdrant_service import QdrantService
from app.api.routes import contracts, reviewer, chat, metrics, auth

# Resolve frontend directory path relative to this file
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for startup and shutdown execution."""
    print("Starting Legal Contract Analyzer Backend...")
    
    # 1. Initialize DB tables
    await init_db()
    print("Database tables initialized.")
    
    # 2. Populate standard templates into Vector search store
    QdrantService.initialize_kb()
    print("Knowledge base of standard templates loaded.")
    
    yield
    print("Shutting down Legal Contract Analyzer Backend...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="AI-powered analysis and compliance checks against Indian Law Defaults",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(auth.router, prefix="/api")
app.include_router(contracts.router, prefix="/api")
app.include_router(reviewer.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")

# Mount frontend folder for static assets (style.css, app.js, etc.)
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR)), name="assets")

@app.get("/")
def serve_frontend():
    """Serves the single-page application at root."""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {"message": "Legal Contract Analyzer API. Frontend assets missing."}
