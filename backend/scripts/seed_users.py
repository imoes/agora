#!/usr/bin/env python3
"""
Seed-Skript: Erstellt eine bestimmte Anzahl von Benutzern ueber die REST-API
und schreibt alle Zugangsdaten in user.txt.

Verwendung:
    python seed_users.py --count 20
    python seed_users.py --count 50 --base-url http://localhost:8000
    python seed_users.py --count 10 --prefix testuser --password geheim123

Die erzeugte user.txt wird von seed_chats.py eingelesen.
"""
import argparse
import os
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
                user = data["user"]
                user["password"] = password
                created.append(user)
                print(f"  [{i}/{count}] Benutzer erstellt: {username}")
            elif resp.status_code == 409:
                # User exists - try to login to get the ID
                login_resp = client.post(
                    "/api/auth/login",
                    json={"username": username, "password": password},
                )
                if login_resp.status_code == 200:
                    user = login_resp.json()["user"]
                    user["password"] = password
                    created.append(user)
                print(f"  [{i}/{count}] Bereits vorhanden: {username} (uebersprungen)")
            else:
                print(
                    f"  [{i}/{count}] FEHLER bei {username}: "
                    f"{resp.status_code} - {resp.text}"
                )

    return created


def write_user_file(users: list[dict], admin_user: dict | None, filepath: str) -> None:
    """Schreibt alle Benutzer (inkl. Admin) in user.txt im TSV-Format."""
    with open(filepath, "w") as f:
        f.write("# Agora Benutzerliste (generiert von seed_users.py)\n")
        f.write("# Format: username<TAB>password<TAB>display_name<TAB>email<TAB>id<TAB>role\n")
        f.write("#\n")

        # Admin zuerst
        if admin_user:
            f.write(
                f"{admin_user['username']}\t{admin_user['password']}\t"
                f"{admin_user['display_name']}\t{admin_user['email']}\t"
                f"{admin_user['id']}\tadmin\n"
            )

        # Normale Benutzer
        for u in users:
            f.write(
                f"{u['username']}\t{u['password']}\t"
                f"{u['display_name']}\t{u['email']}\t"
                f"{u['id']}\tuser\n"
            )

    print(f"Benutzerliste geschrieben: {filepath}")


def ensure_admin(base_url: str, admin_password: str) -> dict | None:
    """Erstellt oder findet den Admin-Benutzer und gibt seine Daten zurueck."""
    admin_data = {
        "username": "admin",
        "email": "admin@agora.local",
        "password": admin_password,
        "display_name": "Administrator",
    }

    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        # Versuche Admin zu registrieren
        resp = client.post("/api/auth/register", json=admin_data)
        if resp.status_code == 201:
            user = resp.json()["user"]
            user["password"] = admin_password
            print("  Admin-Benutzer erstellt: admin")
            return user

        # Admin existiert bereits - einloggen
        login_resp = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": admin_password},
        )
        if login_resp.status_code == 200:
            user = login_resp.json()["user"]
            user["password"] = admin_password
            print("  Admin-Benutzer vorhanden: admin (uebersprungen)")
            return user

        print("  WARNUNG: Admin-Benutzer konnte nicht erstellt/gefunden werden.")
        print("           Erstellen Sie den Admin mit create_admin.py")
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Erstellt Testbenutzer in der Agora-Datenbank und schreibt user.txt"
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
    parser.add_argument(
        "--admin-password",
        type=str,
        default="Admin1234!",
        help="Passwort fuer den Admin-Benutzer (Standard: Admin1234!)",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="user.txt",
        help="Ausgabedatei (Standard: user.txt)",
    )
    args = parser.parse_args()

    print(f"Erstelle {args.count} Benutzer auf {args.base_url} ...")
    print(f"  Praefix: {args.prefix}, Passwort: {args.password}")
    print()

    # 1. Admin-Benutzer erstellen/finden
    print("Admin-Benutzer ...")
    admin_user = ensure_admin(args.base_url, args.admin_password)

    # 2. Testbenutzer erstellen
    print()
    users = create_users(args.base_url, args.count, args.prefix, args.password)

    # 3. user.txt schreiben
    print()
    write_user_file(users, admin_user, args.output)

    print()
    print(f"Fertig: {len(users)} Benutzer erstellt.")
    if admin_user:
        print(f"  Admin:  {admin_user['username']} (Passwort: {args.admin_password})")
    if users:
        print(f"  Erster: {users[0]['username']} (Passwort: {args.password})")
        print(f"  Letzter: {users[-1]['username']}")
    print(f"\n  Datei: {args.output}")


if __name__ == "__main__":
    main()
