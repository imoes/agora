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

    # SMTP settings for email invitations
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@agora.local"
    smtp_use_tls: bool = True

    # Frontend URL for invitation links
    frontend_url: str = "http://localhost"

    # Google OAuth2 for Calendar
    google_client_id: str = ""
    google_client_secret: str = ""

    # LDAP / Active Directory settings
    ldap_enabled: bool = False
    ldap_server: str = ""
    ldap_port: int = 389
    ldap_use_ssl: bool = False
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    ldap_base_dn: str = ""
    ldap_user_filter: str = "(sAMAccountName={username})"
    ldap_group_dn: str = ""  # Required LDAP group for access
    ldap_username_attr: str = "sAMAccountName"
    ldap_email_attr: str = "mail"
    ldap_display_name_attr: str = "displayName"
    ldap_admin_group_dn: str = ""  # Optional: members get admin role

    model_config = {"env_file": ".env"}


settings = Settings()
