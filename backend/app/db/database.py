from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.core.config import settings

# Setup engine args depending on database dialect
engine_kwargs = {}
if settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

# Create async engine
engine = create_async_engine(settings.DATABASE_URL, echo=False, **engine_kwargs)

# Create sessionmaker
async_session = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()

async def get_db():
    """Dependency for getting database sessions in FastAPI routes."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()

async def init_db():
    """Initializes tables. Safe to call multiple times."""
    async with engine.begin() as conn:
        # Import models here to register metadata
        from app.db.models import Contract, Clause, ChatMessage, AuditLog, User
        await conn.run_sync(Base.metadata.create_all)
