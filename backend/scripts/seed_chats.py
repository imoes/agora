#!/usr/bin/env python3
"""
Seed-Skript: Erstellt Chats und Nachrichten ueber die REST-API.

Liest die Benutzerdaten aus user.txt (erstellt von seed_users.py).

Verwendung:
    python seed_chats.py --chats 5 --messages 20
    python seed_chats.py --chats 10 --messages 50 --user-file user.txt
    python seed_chats.py --chats 3 --messages 100 --base-url http://localhost:8000
"""
import argparse
import os
import random
import sys

import httpx

SAMPLE_MESSAGES = [
    "Hallo zusammen! Wie geht es euch?",
    "Hat jemand die Praesentation fuer morgen fertig?",
    "Meeting um 14:00 Uhr im Konferenzraum B",
    "Ich habe den Bug in der Login-Seite gefunden und behoben.",
    "Kann jemand das Code-Review fuer PR #42 uebernehmen?",
    "Die Deployment-Pipeline ist wieder gruen!",
    "Mittagspause? Wer kommt mit zur Kantine?",
    "Ich bin heute im Homeoffice erreichbar.",
    "Das neue Feature ist fertig und bereit fuer QA.",
    "Kurze Erinnerung: Sprint-Review morgen um 10:00 Uhr.",
    "Die Datenbank-Migration lief erfolgreich durch.",
    "Danke fuer die Hilfe beim Debugging!",
    "Ich habe die Dokumentation aktualisiert.",
    "Hat jemand Erfahrung mit WebRTC?",
    "Der Server braucht ein Update auf die neue Version.",
    "Feedback zum Design: Sieht gut aus!",
    "Wer uebernimmt die On-Call-Schicht naechste Woche?",
    "Die API-Antwortzeiten sind deutlich besser geworden.",
    "Neues Ticket erstellt: Performance-Optimierung Feed.",
    "Frohe Feiertage und schoene Gruesse an alle!",
    "Kurze Frage: Wie konfiguriert man den Redis-Cache?",
    "Pull Request gemergt. Bitte testet auf Staging.",
    "Ich arbeite gerade am Datei-Upload Feature.",
    "Team-Meeting verschoben auf 15:30 Uhr.",
    "Die Unit-Tests laufen alle gruen durch.",
]

CHAT_NAMES = [
    "Projekt Alpha", "Backend-Team", "Frontend-Crew",
    "DevOps", "Design-Review", "Sprint Planning",
    "Architektur-Diskussion", "Bug-Reports", "Feature-Ideen",
    "Allgemein", "Off-Topic", "Code-Review",
    "Release-Planung", "Infrastruktur", "Dokumentation",
    "Testing-Strategie", "Security-Audit", "Performance",
    "Onboarding", "Retrospektive",
]


def read_user_file(filepath: str) -> list[dict]:
    """Liest Benutzer aus user.txt (TSV-Format von seed_users.py)."""
    users = []
    if not os.path.exists(filepath):
        print(f"FEHLER: Datei '{filepath}' nicht gefunden.")
        print("  Fuehre zuerst seed_users.py aus, um user.txt zu erzeugen.")
        sys.exit(1)

    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 5:
                continue
            users.append({
                "username": parts[0],
                "password": parts[1],
                "display_name": parts[2],
                "email": parts[3],
                "id": parts[4],
                "role": parts[5] if len(parts) > 5 else "user",
            })

    return users


def login_user(client: httpx.Client, username: str, password: str) -> dict | None:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    if resp.status_code == 200:
        return resp.json()
    return None


def get_auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def seed_chats_and_messages(
    base_url: str,
    num_chats: int,
    num_messages_per_chat: int,
    user_file: str,
) -> None:
    # 1. Benutzer aus user.txt lesen
    file_users = read_user_file(user_file)
    print(f"  {len(file_users)} Benutzer aus {user_file} gelesen.")

    if len(file_users) < 2:
        print("FEHLER: Mindestens 2 Benutzer in user.txt erforderlich.")
        sys.exit(1)

    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        # 2. Alle Benutzer einloggen
        print("\nMelde Benutzer an ...")
        users = []
        for fu in file_users:
            auth = login_user(client, fu["username"], fu["password"])
            if auth:
                users.append({
                    "id": auth["user"]["id"],
                    "username": auth["user"]["username"],
                    "display_name": auth["user"].get("display_name", fu["display_name"]),
                    "token": auth["access_token"],
                    "role": fu.get("role", "user"),
                })
                print(f"    Angemeldet: {fu['username']} ({fu.get('role', 'user')})")
            else:
                print(f"    FEHLER: Login fehlgeschlagen fuer {fu['username']}")

        print(f"  {len(users)} Benutzer angemeldet.")

        if len(users) < 2:
            print("FEHLER: Mindestens 2 Benutzer muessen eingeloggt sein.")
            sys.exit(1)

        # 3. Chats erstellen (nur mit normalen Benutzern, nicht Admin)
        normal_users = [u for u in users if u["role"] != "admin"]
        if len(normal_users) < 2:
            normal_users = users  # Fallback: alle Benutzer verwenden

        print(f"\nErstelle {num_chats} Chats ...")
        channels = []
        for i in range(num_chats):
            creator = random.choice(normal_users)
            # 2-6 zufaellige Teilnehmer (ohne Creator)
            other_users = [u for u in normal_users if u["id"] != creator["id"]]
            members = random.sample(
                other_users,
                min(random.randint(2, 6), len(other_users)),
            )
            member_ids = [m["id"] for m in members]

            chat_name = CHAT_NAMES[i % len(CHAT_NAMES)]
            if i >= len(CHAT_NAMES):
                chat_name = f"{chat_name} {i // len(CHAT_NAMES) + 1}"

            resp = client.post(
                "/api/channels/",
                json={
                    "name": chat_name,
                    "channel_type": "group",
                    "member_ids": member_ids,
                },
                headers=get_auth_headers(creator["token"]),
            )

            if resp.status_code == 201:
                channel = resp.json()
                # Merken welche User Zugriff haben
                participant_tokens = [creator["token"]] + [
                    u["token"] for u in members
                ]
                channels.append({
                    "id": channel["id"],
                    "name": channel["name"],
                    "tokens": participant_tokens,
                })
                print(f"  [{i + 1}/{num_chats}] Chat erstellt: {chat_name} "
                      f"({len(member_ids) + 1} Mitglieder)")
            else:
                print(f"  [{i + 1}/{num_chats}] FEHLER: {resp.status_code} - {resp.text}")

        # 4. Nachrichten erstellen
        total = num_chats * num_messages_per_chat
        print(f"\nErstelle {num_messages_per_chat} Nachrichten pro Chat "
              f"({total} gesamt) ...")

        msg_count = 0
        for ch in channels:
            for j in range(num_messages_per_chat):
                token = random.choice(ch["tokens"])
                content = random.choice(SAMPLE_MESSAGES)

                resp = client.post(
                    f"/api/channels/{ch['id']}/messages/",
                    json={"content": content, "message_type": "text"},
                    headers=get_auth_headers(token),
                )
                if resp.status_code == 201:
                    msg_count += 1
                else:
                    print(f"  FEHLER Nachricht in {ch['name']}: "
                          f"{resp.status_code} - {resp.text}")

            print(f"  Chat '{ch['name']}': "
                  f"{num_messages_per_chat} Nachrichten erstellt")

        print(f"\nFertig: {len(channels)} Chats, {msg_count} Nachrichten erstellt.")


def main():
    parser = argparse.ArgumentParser(
        description="Erstellt Testchats und Nachrichten in Agora (liest Benutzer aus user.txt)"
    )
    parser.add_argument(
        "--chats", "-c",
        type=int,
        default=5,
        help="Anzahl der zu erstellenden Chats (Standard: 5)",
    )
    parser.add_argument(
        "--messages", "-m",
        type=int,
        default=20,
        help="Nachrichten pro Chat (Standard: 20)",
    )
    parser.add_argument(
        "--base-url", "-u",
        type=str,
        default="http://localhost:8000",
        help="Backend-URL (Standard: http://localhost:8000)",
    )
    parser.add_argument(
        "--user-file", "-f",
        type=str,
        default="user.txt",
        help="Pfad zur user.txt Datei (Standard: user.txt)",
    )
    args = parser.parse_args()

    print(f"Seed: {args.chats} Chats mit je {args.messages} Nachrichten")
    print(f"  Backend: {args.base_url}")
    print(f"  Benutzerdatei: {args.user_file}")
    print()

    seed_chats_and_messages(
        base_url=args.base_url,
        num_chats=args.chats,
        num_messages_per_chat=args.messages,
        user_file=args.user_file,
    )


if __name__ == "__main__":
    main()
