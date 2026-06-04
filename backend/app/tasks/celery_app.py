from celery import Celery
from app.core.config import settings

# Create Celery instance
celery_app = Celery(
    "contract_analyzer_tasks",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND
)

# Optional Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=True,
)

# Auto-discover tasks
celery_app.autodiscover_tasks(["app.tasks"])
