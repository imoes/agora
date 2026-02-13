from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://agora:agora_secret@localhost:5432/agora"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24h
    janus_url: str = "http://localhost:8088/janus"
    janus_api_secret: str = "janus-api-secret"
    upload_dir: str = "/data/uploads"
    chat_db_dir: str = "/data/chats"
    max_upload_size: int = 104857600  # 100MB

    model_config = {"env_file": ".env"}


settings = Settings()
