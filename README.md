# Agora

Agora is a self-hosted collaboration platform with chat, video conferencing, file management, and calendar integration - an open-source alternative to Microsoft Teams.

## Features

- **Chat** - Real-time messaging with file attachments, mentions, and read receipts
- **Video Conferencing** - WebRTC-based via Janus Gateway with multi-user support
- **File Management** - Upload and manage files (up to 100 MB)
- **Calendar** - Built-in calendar + sync with Google Calendar, WebDAV/CalDAV, and Outlook/Exchange
- **Teams & Channels** - Organizational structure with teams, channels, and direct messages
- **Activity Feed** - Central feed with unread messages and notifications
- **LDAP/Active Directory** - Optional user authentication via LDAP
- **Email Invitations** - Invitations via email with ICS calendar attachment
- **Admin Panel** - User management and system statistics

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd agora
   ```

2. Create configuration:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` - at minimum set `JWT_SECRET`:
   ```bash
   # Generate a random secret:
   openssl rand -hex 32
   ```

4. Start:
   ```bash
   docker compose up -d --build
   ```

5. Open in browser: [https://localhost](https://localhost)

### Services

| Service  | Port  | Description                       |
|----------|-------|-----------------------------------|
| Nginx    | 80    | Reverse proxy (HTTP)              |
| Nginx    | 443   | Reverse proxy (HTTPS)             |
| Backend  | 8000  | FastAPI REST API                  |
| Frontend | -     | Angular SPA (via Nginx)           |
| Postgres | 5432  | Database                          |
| Redis    | 6379  | Cache and sessions                |
| Janus    | 8088  | WebRTC Gateway                    |
| MailHog  | 8025  | Email test UI (development only)  |

---

## Architecture

### Overview

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

### Directory Structure

```
agora/
├── backend/                  # Python FastAPI backend
│   ├── app/
│   │   ├── api/              # REST API endpoints (routers)
│   │   │   ├── admin.py      # Admin panel API
│   │   │   ├── auth.py       # Login, register, JWT
│   │   │   ├── calendar.py   # Calendar + Google OAuth2
│   │   │   ├── channels.py   # Channels & direct messages
│   │   │   ├── feed.py       # Activity feed
│   │   │   ├── files.py      # File upload/download
│   │   │   ├── invitations.py# Email invitations
│   │   │   ├── messages.py   # Messages
│   │   │   ├── teams.py      # Team management
│   │   │   ├── users.py      # User endpoints
│   │   │   └── video.py      # Video room management
│   │   ├── models/           # SQLAlchemy ORM models
│   │   │   ├── base.py       # Base mixins (UUID, timestamps)
│   │   │   ├── calendar.py   # CalendarEvent, CalendarIntegration
│   │   │   ├── channel.py    # Channel, ChannelMember
│   │   │   ├── feed.py       # FeedEvent
│   │   │   ├── file.py       # FileReference
│   │   │   ├── invitation.py # Invitation
│   │   │   ├── team.py       # Team, TeamMember
│   │   │   └── user.py       # User
│   │   ├── schemas/          # Pydantic request/response schemas
│   │   ├── services/         # Business logic
│   │   │   ├── auth.py       # JWT authentication
│   │   │   ├── calendar_sync.py # Google/WebDAV/Outlook sync
│   │   │   ├── chat_db.py    # SQLite chat storage
│   │   │   ├── email.py      # SMTP email sending
│   │   │   ├── feed.py       # Feed event creation
│   │   │   ├── file_store.py # File storage
│   │   │   ├── ics.py        # ICS calendar generation
│   │   │   ├── janus.py      # Janus WebRTC API
│   │   │   ├── ldap_auth.py  # LDAP authentication
│   │   │   └── mentions.py   # @mention parsing
│   │   ├── websocket/        # WebSocket handlers
│   │   │   ├── handlers.py   # WS endpoints
│   │   │   └── manager.py    # Connection manager
│   │   ├── config.py         # Pydantic Settings
│   │   ├── database.py       # SQLAlchemy AsyncEngine
│   │   └── main.py           # FastAPI app setup
│   ├── tests/                # Pytest tests
│   ├── scripts/              # Seed scripts
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                 # Angular 17 SPA
│   ├── src/app/
│   │   ├── core/             # Guards, interceptors
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts
│   │   │   └── interceptors/
│   │   │       └── auth.interceptor.ts
│   │   ├── features/         # Feature modules
│   │   │   ├── admin/        # Admin panel
│   │   │   ├── auth/         # Login, register
│   │   │   ├── calendar/     # Calendar view
│   │   │   ├── chat/         # Chat list, chat room
│   │   │   ├── feed/         # Activity feed
│   │   │   ├── invite/       # Invitation acceptance
│   │   │   ├── layout/       # Main layout with sidebar
│   │   │   ├── teams/        # Team list, team detail
│   │   │   └── video/        # Video room
│   │   ├── services/
│   │   │   └── api.service.ts # Central API client
│   │   ├── app.routes.ts     # Routing configuration
│   │   └── app.config.ts     # Angular providers
│   ├── src/environments/     # Environment configuration
│   ├── Dockerfile            # Production build
│   ├── Dockerfile.dev        # Development server
│   └── angular.json
├── nginx/
│   ├── Dockerfile            # Nginx with self-signed certs
│   └── nginx.conf            # Reverse proxy config
├── janus/
│   └── Dockerfile            # Janus WebRTC Gateway
├── docker-compose.yml
├── .env.example              # Configuration template
└── README.md
```

### Backend (FastAPI / Python 3.12)

**Tech Stack:**
- **FastAPI** - Async REST API framework
- **SQLAlchemy 2.0** - Async ORM with PostgreSQL
- **Pydantic v2** - Request/response validation and settings
- **SQLite** - Chat message storage (one DB per channel)
- **Redis** - Caching and pub/sub
- **JWT** - Token-based authentication
- **httpx** - Async HTTP client (for OAuth2, WebDAV, etc.)

**Database Design:**
- PostgreSQL for users, teams, channels, calendar, feed, files
- SQLite for chat messages (isolated per channel for performance)
- Tables are auto-created/migrated on startup (`main.py:_add_missing_columns`)

**API Endpoints:**

| Prefix              | Description                                 |
|----------------------|---------------------------------------------|
| `POST /api/auth`     | Login, register, profile                   |
| `GET /api/users`     | User search and details                    |
| `GET /api/teams`     | Create and manage teams                    |
| `GET /api/channels`  | Channels, direct messages                  |
| `GET /api/channels/{id}/messages` | Read/send messages           |
| `POST /api/files`    | File upload/download                       |
| `GET /api/feed`      | Activity feed with unread count            |
| `GET /api/calendar`  | Calendar events and synchronization        |
| `GET /api/video`     | Create/join video rooms                    |
| `POST /api/invitations` | Email invitations with ICS              |
| `GET /api/admin`     | Admin statistics and user management       |

**WebSocket Endpoints:**
- `ws://.../ws/{channel_id}` - Real-time chat per channel
- `ws://.../ws/notifications` - Global notifications (new messages, mentions)

### Frontend (Angular 17)

**Tech Stack:**
- **Angular 17** - Standalone components (no NgModule)
- **Angular Material** - UI components (MatIcon, MatButton, MatSnackBar, etc.)
- **RxJS** - Reactive programming
- **Lazy Loading** - All feature components are lazy loaded

**Authentication:**
- JWT token stored in `localStorage`
- `authInterceptor` automatically adds `Authorization: Bearer` header
- `authGuard` protects all routes except login/register

**Routes:**
- `/login`, `/register` - Public pages
- `/feed` - Activity feed (default home page)
- `/teams`, `/teams/:teamId` - Team overview and details
- `/chat`, `/chat/:channelId` - Chat list and chat room
- `/video/:channelId` - Video conference
- `/calendar` - Calendar with integration
- `/calendar/google/callback` - Google OAuth2 callback
- `/admin` - Admin panel

### Infrastructure

**Nginx** (Reverse Proxy):
- Port 80 (HTTP) and 443 (HTTPS) - both serve the app
- `/api/*` → Backend (FastAPI :8000)
- `/ws/*` → Backend WebSocket
- `/*` → Frontend (Angular)

**Janus WebRTC Gateway:**
- Manages WebRTC signaling and media relay
- REST API on port 8088
- UDP ports 10000-10100 for media streams

---

## Configuration

All settings are controlled via environment variables in the `.env` file. See [.env.example](.env.example) for all available options.

### JWT Secret (required for production)

```env
JWT_SECRET=your-secure-secret-here
```

Generate a secure secret with: `openssl rand -hex 32`

### Email (SMTP)

In development mode, MailHog runs as an email catcher at [https://localhost:8025](https://localhost:8025). For production, configure a real SMTP server:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@your-domain.com
SMTP_USE_TLS=true
```

### LDAP / Active Directory

For user authentication via an existing Active Directory:

```env
LDAP_ENABLED=true
LDAP_SERVER=ldap://your-dc.company.local
LDAP_PORT=389
LDAP_BIND_DN=CN=ldap-reader,OU=Service,DC=company,DC=local
LDAP_BIND_PASSWORD=secret
LDAP_BASE_DN=OU=Users,DC=company,DC=local
LDAP_USER_FILTER=(sAMAccountName={username})
```

---

## Google Calendar Setup

Agora can sync events with Google Calendar. This requires a one-time setup of OAuth2 credentials (~10 minutes).

> **Important:** The `FRONTEND_URL` in your `.env` must be the URL where you access Agora in the browser. For Docker this is `https://localhost` by default. The **redirect URI** in Google Console must match: `{FRONTEND_URL}/calendar/google/callback`

### Step 1: Create a Google Cloud Project

1. Open the [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top and select **"New Project"**
3. Name: e.g. `Agora Calendar`, then click **"Create"**
4. Wait for the project to be created and select it

### Step 2: Enable the Google Calendar API

1. Go to **"APIs & Services"** > **"Library"**
2. Search for **"Google Calendar API"**
3. Click **"Google Calendar API"** then **"Enable"**

### Step 3: Configure the OAuth Consent Screen

1. Go to **"APIs & Services"** > **"OAuth consent screen"**
2. Select **"External"** (or "Internal" for Google Workspace organizations)
3. Fill in:
   - **App name**: `Agora`
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
4. Click **"Save and Continue"**
5. Under **"Scopes"**: Click **"Add or Remove Scopes"**, search for `Google Calendar API` and select:
   - `.../auth/calendar` (read and write events)
6. Click **"Save and Continue"**
7. Under **"Test users"**: Add the Google email addresses that should be able to connect their calendar
8. Click **"Save and Continue"**

> **Note:** While the app is in "Testing" mode, only registered test users can connect their calendar. For unlimited users, the app must be verified by Google.

### Step 4: Create OAuth Client ID

1. Go to **"APIs & Services"** > **"Credentials"**
2. Click **"Create Credentials"** > **"OAuth client ID"**
3. Application type: **"Web application"**
4. Name: e.g. `Agora Web Client`
5. **Authorized redirect URIs** - add:
   ```
   http://localhost/calendar/google/callback
   ```
   > **Important:** Google does NOT allow `https://localhost` as a redirect URI.
   > For localhost you MUST use `http://`. Agora handles this automatically.
   > - Docker (default): `http://localhost/calendar/google/callback`
   > - Without Docker (ng serve): `http://localhost:4200/calendar/google/callback`
   > - Production: `https://agora.your-domain.com/calendar/google/callback`
6. Click **"Create"**
7. Copy the **Client ID** and **Client Secret**

### Step 5: Configure Agora

Add the values to your `.env` file:

```env
GOOGLE_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
FRONTEND_URL=https://localhost
```

Restart the containers:

```bash
docker compose down && docker compose up -d --build
```

### Step 6: Connect Your Calendar

1. Log in to Agora
2. Go to the **Calendar** section
3. Click the **gear icon** (settings)
4. Select **"Google Calendar"** as provider
5. Click **"Mit Google verbinden"** (Connect with Google)
6. Sign in with your Google account and grant permission
7. Your Google events will sync automatically

### Troubleshooting Google OAuth

| Problem | Solution |
|---------|----------|
| `redirect_uri_mismatch` | The redirect URI in Google Console must EXACTLY match `{FRONTEND_URL}/calendar/google/callback`. Check HTTP vs. HTTPS and port number. |
| `access_denied` | Make sure your email is added as a test user (Step 3.7). |
| `Google OAuth not available` | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are not set in `.env`. |
| Page not reachable after Google login | `FRONTEND_URL` doesn't match the actual app URL. For Docker: `https://localhost` |

---

## Additional Calendar Integrations

### WebDAV / CalDAV

For Nextcloud, Baikal, Radicale, or other CalDAV servers:

1. In calendar settings, select **"WebDAV / CalDAV"**
2. Enter the CalDAV URL, username, and password
3. Example URL for Nextcloud:
   ```
   https://nextcloud.your-domain.com/remote.php/dav/calendars/username/personal/
   ```

### Outlook / Exchange

For Microsoft Exchange Server (on-premise):

1. In calendar settings, select **"Outlook / Microsoft 365"**
2. Enter the EWS URL, username, and password
3. Example URL:
   ```
   https://mail.company.com/EWS/Exchange.asmx
   ```

---

## Development

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

> **Note for development without Docker:** Set `FRONTEND_URL=http://localhost:4200` in `.env` so OAuth callbacks work correctly.

### Tests

```bash
cd backend
pytest
```

---

## Authentication Flows

### Local Authentication
1. User registers (`POST /api/auth/register`)
2. Login with email/password (`POST /api/auth/login`) → JWT token
3. All API calls include `Authorization: Bearer <token>`
4. Token is valid for 24 hours

### LDAP Authentication
1. User enters AD username/password
2. Backend binds to LDAP server and verifies credentials
3. Optional: Group membership (`LDAP_GROUP_DN`) is checked
4. On success: Local user is created/updated → JWT token

### Google OAuth2 (Calendar)
1. Frontend calls `/api/calendar/google/auth` → Receives Google auth URL
2. User is redirected to Google → Grants calendar access
3. Google redirects back to `{FRONTEND_URL}/calendar/google/callback?code=XXX`
4. Frontend sends code to backend (`POST /api/calendar/google/callback`)
5. Backend exchanges code for access token + refresh token
6. Tokens are stored in the database
7. Calendar sync uses the tokens automatically (including token refresh)

---

## License

See [LICENSE](LICENSE) file.
