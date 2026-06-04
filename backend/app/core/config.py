import os
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

TEMPLATE_DIR = BASE_DIR / "templates"
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)

# Parse .env file locally if exists
env_path = BASE_DIR / ".env"
if env_path.exists():
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    # Strip spaces and optional surrounding quotes
                    k_str = k.strip()
                    v_str = v.strip().strip('"').strip("'")
                    if k_str not in os.environ:
                        os.environ[k_str] = v_str
    except Exception as e:
        print(f"Warning: Failed to load .env file: {e}")

# Configuration values with defaults
class Settings:
    PROJECT_NAME: str = "Legal Contract Analyzer - Indian Law Context"
    UPLOAD_DIR: Path = UPLOAD_DIR
    TEMPLATE_DIR: Path = TEMPLATE_DIR
    
    # Database configuration (Postgres default, fallback to local SQLite)
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "postgres")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "postgres")
    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: str = os.getenv("POSTGRES_PORT", "5432")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "contract_analyzer")
    
    @property
    def DATABASE_URL(self) -> str:
        # Check if we should use Postgres or SQLite fallback
        use_sqlite = os.getenv("USE_SQLITE", "true").lower() == "true"
        if use_sqlite:
            db_path = BASE_DIR / "contracts.db"
            return f"sqlite+aiosqlite:///{db_path}"
        return f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
    
    # Celery & Redis
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: str = os.getenv("REDIS_PORT", "6379")
    
    @property
    def CELERY_BROKER_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"
        
    @property
    def CELERY_RESULT_BACKEND(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"

    # Qdrant Vector DB
    QDRANT_HOST: str = os.getenv("QDRANT_HOST", "localhost")
    QDRANT_PORT: int = int(os.getenv("QDRANT_PORT", "6333"))
    QDRANT_COLLECTION: str = "contract_templates"
    
    # API Keys
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    
    # Embedding Model Name
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    
    # Flag to simulate services if Docker compose is not running
    SIMULATE_BACKGROUND_SERVICES: bool = os.getenv("SIMULATE_BACKGROUND_SERVICES", "true").lower() == "true"

settings = Settings()
