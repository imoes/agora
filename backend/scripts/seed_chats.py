#!/usr/bin/env python3
"""
Seed-Skript: Erstellt Chats und Nachrichten ueber die REST-API.

Voraussetzung: Benutzer muessen bereits existieren (z.B. via seed_users.py).

Verwendung:
    python seed_chats.py --chats 5 --messages 20
    python seed_chats.py --chats 10 --messages 50 --base-url http://localhost:8000
    python seed_chats.py --chats 3 --messages 100 --user-prefix user --user-password Test1234!
"""
import argparse
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
    user_prefix: str,
    user_password: str,
    num_users: int,
) -> None:
    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        # 1. Login aller verfuegbaren User
        print("Melde Benutzer an ...")
        users = []
        for i in range(1, num_users + 1):
            username = f"{user_prefix}{i:04d}"
            auth = login_user(client, username, user_password)
            if auth:
                users.append({
                    "id": auth["user"]["id"],
                    "username": auth["user"]["username"],
                    "token": auth["access_token"],
                })
        print(f"  {len(users)} Benutzer angemeldet.")

        if len(users) < 2:
            print("FEHLER: Mindestens 2 Benutzer erforderlich. "
                  "Fuehre zuerst seed_users.py aus.")
            sys.exit(1)

        # 2. Chats erstellen
        print(f"\nErstelle {num_chats} Chats ...")
        channels = []
        for i in range(num_chats):
            creator = random.choice(users)
            # 2-6 zufaellige Teilnehmer (ohne Creator)
            other_users = [u for u in users if u["id"] != creator["id"]]
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

        # 3. Nachrichten erstellen
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
        description="Erstellt Testchats und Nachrichten in Agora"
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
        "--user-prefix",
        type=str,
        default="user",
        help="Praefix der Benutzer (Standard: user)",
    )
    parser.add_argument(
        "--user-password",
        type=str,
        default="Test1234!",
        help="Passwort der Benutzer (Standard: Test1234!)",
    )
    parser.add_argument(
        "--num-users",
        type=int,
        default=10,
        help="Anzahl der Benutzer die eingeloggt werden (Standard: 10)",
    )
    args = parser.parse_args()

    print(f"Seed: {args.chats} Chats mit je {args.messages} Nachrichten")
    print(f"  Backend: {args.base_url}")
    print(f"  Benutzer: {args.user_prefix}0001 - {args.user_prefix}{args.num_users:04d}")
    print()

    seed_chats_and_messages(
        base_url=args.base_url,
        num_chats=args.chats,
        num_messages_per_chat=args.messages,
        user_prefix=args.user_prefix,
        user_password=args.user_password,
        num_users=args.num_users,
    )


if __name__ == "__main__":
    main()
