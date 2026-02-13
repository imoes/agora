#!/usr/bin/env python3
"""
Seed-Skript: Erstellt eine bestimmte Anzahl von Benutzern über die REST-API.

Verwendung:
    python seed_users.py --count 20
    python seed_users.py --count 50 --base-url http://localhost:8000
    python seed_users.py --count 10 --prefix testuser --password geheim123
"""
import argparse
import sys

import httpx


def create_users(
    base_url: str,
    count: int,
    prefix: str,
    password: str,
) -> list[dict]:
    created = []
    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        for i in range(1, count + 1):
            username = f"{prefix}{i:04d}"
            payload = {
                "username": username,
                "email": f"{username}@agora.local",
                "password": password,
                "display_name": f"{prefix.title()} {i}",
            }

            resp = client.post("/api/auth/register", json=payload)
            if resp.status_code == 201:
                data = resp.json()
                created.append(data["user"])
                print(f"  [{i}/{count}] Benutzer erstellt: {username}")
            elif resp.status_code == 409:
                print(f"  [{i}/{count}] Bereits vorhanden: {username} (uebersprungen)")
            else:
                print(
                    f"  [{i}/{count}] FEHLER bei {username}: "
                    f"{resp.status_code} - {resp.text}"
                )

    return created


def main():
    parser = argparse.ArgumentParser(
        description="Erstellt Testbenutzer in der Agora-Datenbank"
    )
    parser.add_argument(
        "--count", "-n",
        type=int,
        default=10,
        help="Anzahl der zu erstellenden Benutzer (Standard: 10)",
    )
    parser.add_argument(
        "--base-url", "-u",
        type=str,
        default="http://localhost:8000",
        help="Backend-URL (Standard: http://localhost:8000)",
    )
    parser.add_argument(
        "--prefix", "-p",
        type=str,
        default="user",
        help="Praefix fuer Benutzernamen (Standard: user)",
    )
    parser.add_argument(
        "--password",
        type=str,
        default="Test1234!",
        help="Passwort fuer alle Benutzer (Standard: Test1234!)",
    )
    args = parser.parse_args()

    print(f"Erstelle {args.count} Benutzer auf {args.base_url} ...")
    print(f"  Praefix: {args.prefix}, Passwort: {args.password}")
    print()

    users = create_users(args.base_url, args.count, args.prefix, args.password)

    print()
    print(f"Fertig: {len(users)} Benutzer erfolgreich erstellt.")
    if users:
        print(f"  Erster: {users[0]['username']} (ID: {users[0]['id']})")
        print(f"  Letzter: {users[-1]['username']} (ID: {users[-1]['id']})")


if __name__ == "__main__":
    main()
