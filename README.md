# Agora

Agora ist eine selbst-gehostete Kollaborationsplattform mit Chat, Videokonferenzen, Dateiverwaltung und Kalenderintegration - eine Open-Source-Alternative zu Microsoft Teams.

## Features

- **Chat** - Echtzeit-Messaging mit Dateianhängen, Mentions und Lesebestätigungen
- **Videokonferenzen** - WebRTC-basiert über Janus Gateway mit Mehrbenutzer-Unterstützung
- **Dateiverwaltung** - Upload und Verwaltung von Dateien (bis zu 100 MB)
- **Kalender** - Interner Kalender + Synchronisation mit Google Calendar, WebDAV/CalDAV und Outlook/Exchange
- **Teams & Channels** - Organisationsstruktur mit Teams, Channels und Direktnachrichten
- **Activity Feed** - Zentraler Feed mit ungelesenen Nachrichten und Benachrichtigungen
- **LDAP/Active Directory** - Optionale Benutzerauthentifizierung über LDAP
- **E-Mail-Einladungen** - Einladungen per E-Mail mit ICS-Kalenderanhang
- **Admin-Panel** - Benutzerverwaltung und Systemstatistiken

---

## Schnellstart

### Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) und [Docker Compose](https://docs.docker.com/compose/install/)

### Installation

1. Repository klonen:
   ```bash
   git clone <repository-url>
   cd agora
   ```

2. Konfiguration erstellen:
   ```bash
   cp .env.example .env
   ```

3. `.env` anpassen - mindestens `JWT_SECRET` setzen:
   ```bash
   # Zufaelliges Secret generieren:
   openssl rand -hex 32
   ```

4. Starten:
   ```bash
   docker compose up -d
   ```

5. Im Browser oeffnen: [http://localhost](http://localhost)

### Dienste

| Dienst   | Port  | Beschreibung                      |
|----------|-------|-----------------------------------|
| Nginx    | 80    | Reverse-Proxy (HTTP)              |
| Nginx    | 443   | Reverse-Proxy (HTTPS)             |
| Backend  | 8000  | FastAPI REST-API                  |
| Frontend | -     | Angular SPA (ueber Nginx)         |
| Postgres | 5432  | Datenbank                         |
| Redis    | 6379  | Cache und Sessions                |
| Janus    | 8088  | WebRTC Gateway                    |
| MailHog  | 8025  | E-Mail-Test-UI (nur Entwicklung)  |

---

## Architektur

### Uebersicht

```
                    ┌──────────┐
                    │  Browser  │
                    └─────┬─────┘
                          │ HTTP/HTTPS/WS
                    ┌─────▼─────┐
                    │   Nginx   │ :80 / :443
                    │  Reverse  │
                    │   Proxy   │
                    └──┬──┬──┬──┘
            ┌──────────┘  │  └──────────┐
            │ /api/*      │ /ws/*       │ /*
            │             │             │
     ┌──────▼──────┐      │      ┌──────▼──────┐
     │   Backend   │◄─────┘      │  Frontend   │
     │  (FastAPI)  │ :8000       │  (Angular)  │
     └──┬──┬───┬───┘             └─────────────┘
        │  │   │
   ┌────┘  │   └────┐
   │       │        │
┌──▼──┐ ┌──▼──┐ ┌───▼───┐
│ PG  │ │Redis│ │ Janus │
│     │ │     │ │WebRTC │
└─────┘ └─────┘ └───────┘
```

### Verzeichnisstruktur

```
agora/
├── backend/                  # Python FastAPI Backend
│   ├── app/
│   │   ├── api/              # REST-API-Endpunkte (Router)
│   │   │   ├── admin.py      # Admin-Panel API
│   │   │   ├── auth.py       # Login, Register, JWT
│   │   │   ├── calendar.py   # Kalender + Google OAuth2
│   │   │   ├── channels.py   # Channels & Direktnachrichten
│   │   │   ├── feed.py       # Activity Feed
│   │   │   ├── files.py      # Datei-Upload/Download
│   │   │   ├── invitations.py# E-Mail-Einladungen
│   │   │   ├── messages.py   # Nachrichten
│   │   │   ├── teams.py      # Teams-Verwaltung
│   │   │   ├── users.py      # Benutzer-Endpunkte
│   │   │   └── video.py      # Video-Raum-Verwaltung
│   │   ├── models/           # SQLAlchemy ORM-Modelle
│   │   │   ├── base.py       # Basis-Mixins (UUID, Timestamps)
│   │   │   ├── calendar.py   # CalendarEvent, CalendarIntegration
│   │   │   ├── channel.py    # Channel, ChannelMember
│   │   │   ├── feed.py       # FeedEvent
│   │   │   ├── file.py       # FileReference
│   │   │   ├── invitation.py # Invitation
│   │   │   ├── team.py       # Team, TeamMember
│   │   │   └── user.py       # User
│   │   ├── schemas/          # Pydantic Request/Response Schemas
│   │   ├── services/         # Business-Logik
│   │   │   ├── auth.py       # JWT-Authentifizierung
│   │   │   ├── calendar_sync.py # Google/WebDAV/Outlook Sync
│   │   │   ├── chat_db.py    # SQLite Chat-Speicher
│   │   │   ├── email.py      # SMTP E-Mail-Versand
│   │   │   ├── feed.py       # Feed-Event-Erstellung
│   │   │   ├── file_store.py # Datei-Speicherung
│   │   │   ├── ics.py        # ICS-Kalender-Generierung
│   │   │   ├── janus.py      # Janus WebRTC API
│   │   │   ├── ldap_auth.py  # LDAP-Authentifizierung
│   │   │   └── mentions.py   # @Mention-Parsing
│   │   ├── websocket/        # WebSocket-Handler
│   │   │   ├── handlers.py   # WS-Endpunkte
│   │   │   └── manager.py    # Verbindungs-Manager
│   │   ├── config.py         # Pydantic Settings
│   │   ├── database.py       # SQLAlchemy AsyncEngine
│   │   └── main.py           # FastAPI App-Setup
│   ├── tests/                # Pytest-Tests
│   ├── scripts/              # Seed-Skripte
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                 # Angular 17 SPA
│   ├── src/app/
│   │   ├── core/             # Guards, Interceptors
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts
│   │   │   └── interceptors/
│   │   │       └── auth.interceptor.ts
│   │   ├── features/         # Feature-Module
│   │   │   ├── admin/        # Admin-Panel
│   │   │   ├── auth/         # Login, Register
│   │   │   ├── calendar/     # Kalender-Ansicht
│   │   │   ├── chat/         # Chat-List, Chat-Room
│   │   │   ├── feed/         # Activity Feed
│   │   │   ├── invite/       # Einladungs-Annahme
│   │   │   ├── layout/       # Haupt-Layout mit Sidebar
│   │   │   ├── teams/        # Team-List, Team-Detail
│   │   │   └── video/        # Video-Raum
│   │   ├── services/
│   │   │   └── api.service.ts # Zentraler API-Client
│   │   ├── app.routes.ts     # Routing-Konfiguration
│   │   └── app.config.ts     # Angular-Providers
│   ├── src/environments/     # Umgebungskonfiguration
│   ├── Dockerfile            # Produktions-Build
│   ├── Dockerfile.dev        # Entwicklungs-Server
│   └── angular.json
├── nginx/
│   ├── Dockerfile            # Nginx mit Self-Signed Certs
│   └── nginx.conf            # Reverse-Proxy-Config
├── janus/
│   └── Dockerfile            # Janus WebRTC Gateway
├── docker-compose.yml
├── .env.example              # Konfigurations-Vorlage
└── README.md
```

### Backend (FastAPI / Python 3.12)

**Technologie-Stack:**
- **FastAPI** - Async REST-API Framework
- **SQLAlchemy 2.0** - Async ORM mit PostgreSQL
- **Pydantic v2** - Request/Response-Validierung und Settings
- **SQLite** - Chat-Nachrichten-Speicher (eine DB pro Channel)
- **Redis** - Caching und Pub/Sub
- **JWT** - Token-basierte Authentifizierung
- **httpx** - Async HTTP-Client (fuer OAuth2, WebDAV, etc.)

**Datenbank-Design:**
- PostgreSQL fuer Benutzer, Teams, Channels, Kalender, Feed, Dateien
- SQLite fuer Chat-Nachrichten (isoliert pro Channel fuer Performance)
- Tabellen werden beim Start automatisch erstellt/migriert (`main.py:_add_missing_columns`)

**API-Endpunkte:**

| Prefix              | Beschreibung                                |
|----------------------|---------------------------------------------|
| `POST /api/auth`     | Login, Register, Profil                    |
| `GET /api/users`     | Benutzer-Suche und -Details                |
| `GET /api/teams`     | Teams erstellen, verwalten                 |
| `GET /api/channels`  | Channels, Direktnachrichten                |
| `GET /api/channels/{id}/messages` | Nachrichten lesen/senden      |
| `POST /api/files`    | Datei-Upload/Download                      |
| `GET /api/feed`      | Activity Feed mit Unread-Count             |
| `GET /api/calendar`  | Kalender-Events und -Synchronisation       |
| `GET /api/video`     | Video-Raum erstellen/beitreten             |
| `POST /api/invitations` | E-Mail-Einladungen mit ICS             |
| `GET /api/admin`     | Admin-Statistiken und Benutzerverwaltung   |

**WebSocket-Endpunkte:**
- `ws://.../ws/{channel_id}` - Echtzeit-Chat pro Channel
- `ws://.../ws/notifications` - Globale Benachrichtigungen (neue Nachrichten, Mentions)

### Frontend (Angular 17)

**Technologie-Stack:**
- **Angular 17** - Standalone Components (kein NgModule)
- **Angular Material** - UI-Komponenten (MatIcon, MatButton, MatSnackBar, etc.)
- **RxJS** - Reaktive Programmierung
- **Lazy Loading** - Alle Feature-Components werden lazy geladen

**Authentifizierung:**
- JWT-Token wird in `localStorage` gespeichert
- `authInterceptor` fuegt automatisch `Authorization: Bearer` Header hinzu
- `authGuard` schuetzt alle Routen ausser Login/Register

**Routing:**
- `/login`, `/register` - Oeffentliche Seiten
- `/feed` - Activity Feed (Standard-Startseite)
- `/teams`, `/teams/:teamId` - Team-Uebersicht und -Details
- `/chat`, `/chat/:channelId` - Chat-Liste und Chat-Raum
- `/video/:channelId` - Video-Konferenz
- `/calendar` - Kalender mit Integration
- `/calendar/google/callback` - Google OAuth2 Callback
- `/admin` - Admin-Panel

### Infrastruktur

**Nginx** (Reverse-Proxy):
- Port 80 (HTTP) und 443 (HTTPS) - beide dienen die App
- `/api/*` → Backend (FastAPI :8000)
- `/ws/*` → Backend WebSocket
- `/*` → Frontend (Angular)

**Janus WebRTC Gateway:**
- Verwaltet WebRTC-Signaling und Media-Relay
- REST-API auf Port 8088
- UDP-Ports 10000-10100 fuer Media-Streams

---

## Konfiguration

Alle Einstellungen werden ueber Umgebungsvariablen in der `.env`-Datei gesteuert. Siehe [.env.example](.env.example) fuer alle verfuegbaren Optionen.

### JWT Secret (Pflicht fuer Produktion)

```env
JWT_SECRET=dein-sicheres-secret-hier
```

Generiere ein sicheres Secret mit: `openssl rand -hex 32`

### E-Mail (SMTP)

Im Entwicklungsmodus laeuft MailHog als E-Mail-Catcher auf [http://localhost:8025](http://localhost:8025). Fuer Produktion einen echten SMTP-Server konfigurieren:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=deine-email@gmail.com
SMTP_PASSWORD=dein-app-passwort
SMTP_FROM=noreply@deine-domain.de
SMTP_USE_TLS=true
```

### LDAP / Active Directory

Fuer Benutzerauthentifizierung ueber ein bestehendes Active Directory:

```env
LDAP_ENABLED=true
LDAP_SERVER=ldap://dein-dc.firma.local
LDAP_PORT=389
LDAP_BIND_DN=CN=ldap-reader,OU=Service,DC=firma,DC=local
LDAP_BIND_PASSWORD=geheim
LDAP_BASE_DN=OU=Benutzer,DC=firma,DC=local
LDAP_USER_FILTER=(sAMAccountName={username})
```

---

## Google Kalender einrichten

Agora kann Termine mit Google Calendar synchronisieren. Dafuer werden einmalig OAuth2-Zugangsdaten benoetigt. Die Einrichtung dauert ca. 10 Minuten.

> **Wichtig:** Die `FRONTEND_URL` in deiner `.env` muss die URL sein, unter der du Agora im Browser oeffnest. Fuer Docker ist das standardmaessig `http://localhost`. Die **Redirect-URI** in Google Console muss dazu passen: `{FRONTEND_URL}/calendar/google/callback`

### Schritt 1: Google Cloud Projekt erstellen

1. Oeffne die [Google Cloud Console](https://console.cloud.google.com/)
2. Klicke oben auf das Projekt-Dropdown und waehle **"Neues Projekt"**
3. Name: z.B. `Agora Calendar` und klicke **"Erstellen"**
4. Warte bis das Projekt erstellt ist und waehle es aus

### Schritt 2: Google Calendar API aktivieren

1. Gehe zu **"APIs und Dienste"** > **"Bibliothek"**
2. Suche nach **"Google Calendar API"**
3. Klicke auf **"Google Calendar API"** und dann **"Aktivieren"**

### Schritt 3: OAuth-Zustimmungsbildschirm konfigurieren

1. Gehe zu **"APIs und Dienste"** > **"OAuth-Zustimmungsbildschirm"**
2. Waehle **"Extern"** (oder "Intern" fuer Google Workspace Organisationen)
3. Fuelle aus:
   - **App-Name**: `Agora`
   - **Support-E-Mail**: Deine E-Mail-Adresse
   - **Kontaktdaten des Entwicklers**: Deine E-Mail-Adresse
4. Klicke **"Speichern und fortfahren"**
5. Bei **"Bereiche"**: Klicke **"Bereiche hinzufuegen"**, suche nach `Google Calendar API` und waehle:
   - `.../auth/calendar` (Termine lesen und schreiben)
6. Klicke **"Speichern und fortfahren"**
7. Bei **"Testnutzer"**: Fuege die Google-E-Mail-Adressen hinzu, die den Kalender nutzen sollen
8. Klicke **"Speichern und fortfahren"**

> **Hinweis:** Solange die App im "Test"-Modus ist, koennen nur die eingetragenen Testnutzer den Kalender verbinden. Fuer unbegrenzte Nutzer muss die App bei Google verifiziert werden.

### Schritt 4: OAuth-Client-ID erstellen

1. Gehe zu **"APIs und Dienste"** > **"Anmeldedaten"**
2. Klicke **"Anmeldedaten erstellen"** > **"OAuth-Client-ID"**
3. Anwendungstyp: **"Webanwendung"**
4. Name: z.B. `Agora Web Client`
5. **Autorisierte Weiterleitungs-URIs** - fuege hinzu:
   ```
   http://localhost/calendar/google/callback
   ```
   > **Wichtig:** Diese URI muss EXAKT mit `{FRONTEND_URL}/calendar/google/callback` uebereinstimmen!
   > - Docker (Standard): `http://localhost/calendar/google/callback`
   > - Ohne Docker (ng serve): `http://localhost:4200/calendar/google/callback`
   > - Produktion: `https://agora.deine-domain.de/calendar/google/callback`
6. Klicke **"Erstellen"**
7. Kopiere **Client-ID** und **Client-Secret**

### Schritt 5: Agora konfigurieren

Trage die Werte in deine `.env`-Datei ein:

```env
GOOGLE_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
FRONTEND_URL=http://localhost
```

Starte die Container neu:

```bash
docker compose down && docker compose up -d
```

### Schritt 6: Kalender verbinden

1. Melde dich in Agora an
2. Gehe in den **Kalender**-Bereich
3. Klicke auf das **Zahnrad-Symbol** (Einstellungen)
4. Waehle als Anbieter **"Google Calendar"**
5. Klicke **"Mit Google verbinden"**
6. Melde dich mit deinem Google-Konto an und erteile die Berechtigung
7. Deine Google-Termine werden automatisch synchronisiert

### Fehlerbehebung Google OAuth

| Problem | Loesung |
|---------|---------|
| `redirect_uri_mismatch` | Die Redirect-URI in Google Console muss EXAKT `{FRONTEND_URL}/calendar/google/callback` sein. Pruefe auch HTTP vs. HTTPS und den Port. |
| `access_denied` | Stelle sicher, dass deine E-Mail als Testnutzer eingetragen ist (Schritt 3.7). |
| `Google OAuth nicht verfuegbar` | `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` sind nicht in der `.env` gesetzt. |
| Seite nicht erreichbar nach Google-Login | `FRONTEND_URL` stimmt nicht mit der tatsaechlichen App-URL ueberein. Fuer Docker: `http://localhost` |

---

## Weitere Kalender-Integrationen

### WebDAV / CalDAV

Fuer Nextcloud, Baikal, Radicale oder andere CalDAV-Server:

1. Gehe in den Kalender-Einstellungen auf **"WebDAV"**
2. Gib die CalDAV-URL, Benutzername und Passwort ein
3. Beispiel-URL fuer Nextcloud:
   ```
   https://nextcloud.deine-domain.de/remote.php/dav/calendars/benutzername/personal/
   ```

### Outlook / Exchange

Fuer Microsoft Exchange Server (on-premise):

1. Gehe in den Kalender-Einstellungen auf **"Outlook"**
2. Gib die EWS-URL, Benutzername und Passwort ein
3. Beispiel-URL:
   ```
   https://mail.firma.de/EWS/Exchange.asmx
   ```

---

## Entwicklung

### Backend (FastAPI / Python)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend (Angular)

```bash
cd frontend
npm install
ng serve --port 4200
```

> **Hinweis bei Entwicklung ohne Docker:** Setze `FRONTEND_URL=http://localhost:4200` in der `.env`, damit OAuth-Callbacks korrekt funktionieren.

### Tests

```bash
cd backend
pytest
```

---

## Authentifizierungs-Flow

### Lokale Authentifizierung
1. Benutzer registriert sich (`POST /api/auth/register`)
2. Login mit E-Mail/Passwort (`POST /api/auth/login`) → JWT-Token
3. Alle API-Aufrufe enthalten `Authorization: Bearer <token>`
4. Token ist 24 Stunden gueltig

### LDAP-Authentifizierung
1. Benutzer gibt AD-Benutzername/Passwort ein
2. Backend bindet an LDAP-Server und prueft Credentials
3. Optional: Gruppenmitgliedschaft (`LDAP_GROUP_DN`) wird geprueft
4. Bei Erfolg: Lokaler Benutzer wird erstellt/aktualisiert → JWT-Token

### Google OAuth2 (Kalender)
1. Frontend ruft `/api/calendar/google/auth` auf → Erhaelt Google-Auth-URL
2. Benutzer wird zu Google weitergeleitet → Erlaubt Kalender-Zugriff
3. Google leitet zurueck zu `{FRONTEND_URL}/calendar/google/callback?code=XXX`
4. Frontend sendet Code an Backend (`POST /api/calendar/google/callback`)
5. Backend tauscht Code gegen Access-Token + Refresh-Token
6. Tokens werden in der Datenbank gespeichert
7. Kalender-Sync nutzt die Tokens automatisch (inkl. Token-Refresh)

---

## Lizenz

Siehe [LICENSE](LICENSE) Datei.
