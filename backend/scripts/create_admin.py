#!/usr/bin/env python3
"""
Create an admin user directly in the database.

Usage:
    # Interactive mode (prompts for password):
    python create_admin.py --username admin --email admin@agora.local --name "Administrator"

    # Non-interactive mode:
    python create_admin.py --username admin --email admin@agora.local --name "Administrator" --password MySecret123!

    # Custom database URL:
    python create_admin.py --username admin --email admin@agora.local --name "Admin" --password secret \\
        --db-url postgresql://agora:agora_secret@localhost:5432/agora

    # Inside Docker:
    docker compose exec backend python scripts/create_admin.py \\
        --username admin --email admin@agora.local --name "Administrator" --password MySecret123!
"""
import argparse
import getpass
import sys

import bcrypt
import psycopg2


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def create_admin(db_url: str, username: str, email: str, display_name: str, password: str) -> None:
    # Convert async URL to sync psycopg2 URL
    sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    conn = psycopg2.connect(sync_url)
    try:
        cur = conn.cursor()

        # Check if user already exists
        cur.execute(
            "SELECT id, is_admin FROM users WHERE LOWER(username) = LOWER(%s) OR LOWER(email) = LOWER(%s)",
            (username, email),
        )
        existing = cur.fetchone()

        if existing:
            user_id, is_admin = existing
            if is_admin:
                print(f"User '{username}' already exists and is already an admin.")
            else:
                cur.execute("UPDATE users SET is_admin = true WHERE id = %s", (user_id,))
                conn.commit()
                print(f"User '{username}' already exists. Promoted to admin.")
            return

        # Create new admin user
        pw_hash = hash_password(password)
        cur.execute(
            """
            INSERT INTO users (id, username, email, password_hash, display_name, is_admin, status, auth_source, language, created_at, updated_at)
            VALUES (gen_random_uuid(), %s, %s, %s, %s, true, 'offline', 'local', 'en', NOW(), NOW())
            RETURNING id
            """,
            (username, email, pw_hash, display_name),
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        print(f"Admin user created successfully!")
        print(f"  Username:     {username}")
        print(f"  Email:        {email}")
        print(f"  Display Name: {display_name}")
        print(f"  ID:           {new_id}")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Create an admin user in the Agora database")
    parser.add_argument("--username", "-u", required=True, help="Username for the admin")
    parser.add_argument("--email", "-e", required=True, help="Email for the admin")
    parser.add_argument("--name", "-n", required=True, help="Display name for the admin")
    parser.add_argument("--password", "-p", default=None, help="Password (prompted if not provided)")
    parser.add_argument(
        "--db-url",
        default="postgresql+asyncpg://agora:agora_secret@postgres:5432/agora",
        help="Database URL (default: Docker internal)",
    )
    args = parser.parse_args()

    password = args.password
    if not password:
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("ERROR: Passwords do not match.", file=sys.stderr)
            sys.exit(1)

    if len(password) < 4:
        print("ERROR: Password must be at least 4 characters.", file=sys.stderr)
        sys.exit(1)

    create_admin(args.db_url, args.username, args.email, args.name, password)


if __name__ == "__main__":
    main()
