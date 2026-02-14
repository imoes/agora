"""LDAP/Active Directory authentication service."""

import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


def ldap_authenticate(username: str, password: str) -> dict[str, Any] | None:
    """Authenticate user against LDAP/AD and return user attributes.

    Returns dict with username, email, display_name, is_admin or None if auth fails.
    """
    if not settings.ldap_enabled or not settings.ldap_server:
        return None

    try:
        import ldap3
        from ldap3 import Server, Connection, ALL, SUBTREE
    except ImportError:
        logger.error("ldap3 package not installed. Run: pip install ldap3")
        return None

    try:
        server = Server(
            settings.ldap_server,
            port=settings.ldap_port,
            use_ssl=settings.ldap_use_ssl,
            get_info=ALL,
        )

        # First bind with service account to search for the user
        if settings.ldap_bind_dn:
            conn = Connection(
                server,
                user=settings.ldap_bind_dn,
                password=settings.ldap_bind_password,
                auto_bind=True,
            )
        else:
            conn = Connection(server, auto_bind=True)

        # Search for user
        user_filter = settings.ldap_user_filter.replace("{username}", username)
        conn.search(
            search_base=settings.ldap_base_dn,
            search_filter=user_filter,
            search_scope=SUBTREE,
            attributes=[
                settings.ldap_username_attr,
                settings.ldap_email_attr,
                settings.ldap_display_name_attr,
                "memberOf",
            ],
        )

        if not conn.entries:
            logger.info(f"LDAP: User '{username}' not found")
            conn.unbind()
            return None

        user_entry = conn.entries[0]
        user_dn = user_entry.entry_dn
        conn.unbind()

        # Check group membership if required
        if settings.ldap_group_dn:
            member_of = [str(g) for g in getattr(user_entry, "memberOf", [])]
            if settings.ldap_group_dn not in member_of:
                logger.info(f"LDAP: User '{username}' not in required group")
                return None

        # Verify password by binding as the user
        user_conn = Connection(server, user=user_dn, password=password, auto_bind=True)
        user_conn.unbind()

        # Extract attributes
        email = str(getattr(user_entry, settings.ldap_email_attr, f"{username}@ldap.local"))
        display_name = str(getattr(user_entry, settings.ldap_display_name_attr, username))

        # Check admin group membership
        is_admin = False
        if settings.ldap_admin_group_dn:
            member_of = [str(g) for g in getattr(user_entry, "memberOf", [])]
            is_admin = settings.ldap_admin_group_dn in member_of

        return {
            "username": username,
            "email": email,
            "display_name": display_name,
            "is_admin": is_admin,
        }

    except Exception as e:
        logger.error(f"LDAP authentication error: {e}")
        return None
