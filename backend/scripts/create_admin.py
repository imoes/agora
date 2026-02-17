#!/usr/bin/env python3
"""
Create an admin user directly in the database.

Usage:
    # Interactive mode (prompts for password):
    python create_admin.py --username admin --email admin@agora.local --name "Administrator"

    # Non-interactive mode:
    python create_admin.py --username admin --email admin@agora.local --name "Administrator" --password MySecret123!

    # Custom database URL:
    python create_admin.py --username admin --email admin@agora.local --name "Admin" --password secret \
        --db-url postgresql://agora:agora_secret@localhost:5432/agora

    # Inside Docker:
    docker compose exec backend python scripts/create_admin.py \
        --username admin --email admin@agora.local --name "Administrator" --password MySecret123!
"""
import argparse
import asyncio
import getpass
import sys

import asyncpg
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


async def create_admin(db_url: str, username: str, email: str, display_name: str, password: str) -> None:
    # Convert SQLAlchemy URL to plain PostgreSQL URL for asyncpg
    dsn = db_url.replace("postgresql+asyncpg://", "postgresql://")

    conn = await asyncpg.connect(dsn)
    try:
        # Check if user already exists
        row = await conn.fetchrow(
            "SELECT id, is_admin FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)",
            username,
            email,
        )

        if row:
            user_id, is_admin = row["id"], row["is_admin"]
            if is_admin:
                print(f"User '{username}' already exists and is already an admin.")
            else:
                await conn.execute("UPDATE users SET is_admin = true WHERE id = $1", user_id)
                print(f"User '{username}' already exists. Promoted to admin.")
            return

        # Create new admin user
        pw_hash = hash_password(password)
        new_id = await conn.fetchval(
            """
            INSERT INTO users (id, username, email, password_hash, display_name, is_admin, status, auth_source, language, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, true, 'offline', 'local', 'en', NOW(), NOW())
            RETURNING id
            """,
            username,
            email,
            pw_hash,
            display_name,
        )
        print("Admin user created successfully!")
        print(f"  Username:     {username}")
        print(f"  Email:        {email}")
        print(f"  Display Name: {display_name}")
        print(f"  ID:           {new_id}")
    finally:
        await conn.close()


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

    asyncio.run(create_admin(args.db_url, args.username, args.email, args.name, password))


if __name__ == "__main__":
    main()
