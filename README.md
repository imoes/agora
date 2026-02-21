# Agora

Agora is a self-hosted collaboration platform with chat, video conferencing, file management, and calendar integration - an open-source alternative to Microsoft Teams.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Services](#services)
- [Architecture](#architecture)
  - [Overview](#overview)
  - [Directory Structure](#directory-structure)
  - [Backend (FastAPI / Python 3.12)](#backend-fastapi--python-312)
  - [Frontend (Angular 17)](#frontend-angular-17)
  - [Infrastructure](#infrastructure)
- [Configuration](#configuration)
  - [JWT Secret](#jwt-secret-required-for-production)
  - [Email (SMTP)](#email-smtp)
  - [LDAP / Active Directory](#ldap--active-directory)
- [Google Calendar Setup](#google-calendar-setup)
- [Additional Calendar Integrations](#additional-calendar-integrations)
  - [WebDAV / CalDAV](#webdav--caldav)
  - [Outlook / Exchange](#outlook--exchange)
- [Desktop Applications](#desktop-applications)
  - [Windows (.NET/WPF)](#windows-netwpf)
  - [Linux (GTK3 / X Server)](#linux-gtk3--x-server)
  - [macOS (Swift / SwiftUI)](#macos-swift--swiftui)
- [Development](#development)
- [Admin User & User Management](#admin-user--user-management)
- [Authentication Flows](#authentication-flows)
- [License](#license)

---

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
- **Windows Desktop App** - Native .NET/WPF client for Windows
- **Linux Desktop App** - Native GTK3 client for Linux (X Server)
- **macOS Desktop App** - Native Swift/SwiftUI client for macOS

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/imoes/agora.git
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

5. Create the initial admin user:
   ```bash
   docker compose exec backend python scripts/create_admin.py \
     --username admin \
     --email admin@agora.local \
     --name "Administrator" \
     --password YourSecurePassword123!
   ```

6. Open in browser: [https://localhost](https://localhost) and log in with the admin credentials.

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
├── desktop/                  # Native desktop clients
│   ├── AgoraWindows/         # .NET/WPF Windows application
│   │   ├── Models/           # Data models (User, Channel, Message)
│   │   ├── Services/         # API client, WebSocket client
│   │   ├── Views/            # WPF windows (Login, Main)
│   │   └── AgoraWindows.csproj
│   ├── agora-linux/          # GTK3 Linux application (X Server)
│   │   ├── src/              # C source files
│   │   ├── resources/        # Desktop entry, icons
│   │   └── Makefile
│   └── agora-mac/            # SwiftUI macOS application
│       ├── Sources/AgoraMac/ # Swift source files
│       ├── Package.swift     # Swift Package Manager config
│       └── Makefile
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

> **Important:** The `FRONTEND_URL` in your `.env` must be the URL where you access Agora in the browser. For Docker this is `https://localhost` by default. The **redirect URI** in Google Console must exactly match the URI the backend sends to Google. For localhost this is `http://localhost/api/calendar/google/callback` (HTTP, not HTTPS, via Nginx). For production: `https://your-domain.com/api/calendar/google/callback`. You can override this with the `GOOGLE_OAUTH_REDIRECT_URI` environment variable.

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
   http://localhost/api/calendar/google/callback
   ```
   > **Important:** Google does NOT allow `https://localhost` as a redirect URI.
   > For localhost you MUST use `http://`. The callback goes through Nginx
   > (port 80) to the backend, which then redirects back to the HTTPS frontend.
   > - Docker (default): `http://localhost/api/calendar/google/callback`
   > - Production: `https://agora.your-domain.com/api/calendar/google/callback`
   > - Custom: Set `GOOGLE_OAUTH_REDIRECT_URI` in `.env` to override
6. Click **"Create"**
7. Copy the **Client ID** and **Client Secret**

### Step 5: Configure Agora

Add the values to your `.env` file:

```env
GOOGLE_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
FRONTEND_URL=https://localhost
# Optional: Override redirect URI (default is derived from FRONTEND_URL)
# GOOGLE_OAUTH_REDIRECT_URI=http://localhost/api/calendar/google/callback
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
| `redirect_uri_mismatch` | The redirect URI in Google Console must EXACTLY match the URI the backend sends. For Docker/localhost: `http://localhost/api/calendar/google/callback` (HTTP, not HTTPS!). For production: `https://your-domain.com/api/calendar/google/callback`. You can also set `GOOGLE_OAUTH_REDIRECT_URI` explicitly in `.env`. |
| `access_denied` | Make sure your email is added as a test user (Step 3.7). |
| `Google OAuth not available` | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are not set in `.env`. |
| Page not reachable after Google login | `FRONTEND_URL` doesn't match the actual app URL. For Docker: `https://localhost`. |
| `invalid_grant` or token errors | The authorization code was already used or expired. Try disconnecting and reconnecting Google Calendar. |

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

## Desktop Applications

In addition to the web frontend, Agora provides native desktop clients for Windows and Linux.

### Windows (.NET/WPF)

A native Windows desktop application built with .NET 8 and WPF.

**Prerequisites:**
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

**Build & Run:**

```bash
cd desktop/AgoraWindows
dotnet build
dotnet run
```

**Publish (standalone executable):**

```bash
dotnet publish -c Release -r win-x64 --self-contained
```

**Features:**
- Login with server URL, username, and password
- Channel list with unread badges
- Real-time chat via WebSocket
- Message sending via Enter key or button

### Linux (GTK3 / X Server)

A native Linux desktop application built with GTK3 and libsoup, designed for X Server environments.

**Prerequisites (Debian/Ubuntu):**

```bash
sudo apt install build-essential libgtk-3-dev libjson-glib-dev libsoup2.4-dev libnotify-dev libgstreamer1.0-dev gstreamer1.0-plugins-bad libwebkit2gtk-4.1-dev
```

**Prerequisites (Fedora):**

```bash
sudo dnf install gcc make gtk3-devel json-glib-devel libsoup-devel libnotify-devel gstreamer1-devel gstreamer1-plugins-bad-free webkit2gtk4.1-devel
```

**Prerequisites (Arch Linux):**

```bash
sudo pacman -S base-devel gtk3 json-glib libsoup libnotify gstreamer gst-plugins-bad webkit2gtk-4.1
```

**Build & Run:**

```bash
cd desktop/agora-linux
make
./agora-linux
```

**Install (system-wide):**

```bash
sudo make install
```

**Features:**
- Login with server URL, username, and password
- 3-column layout: navigation sidebar, channel/team sidebar, content area
- Activity feed with real-time event display
- Channel list sidebar with member count and unread indicators
- Teams with expandable channel lists
- Message display and sending with WebSocket real-time updates
- Integrated video calls via embedded WebKitWebView
- File upload and attachment support
- Calendar event reminders with countdown timer
- Desktop notifications via libnotify
- Custom notification sounds via GStreamer
- Multi-language support (24 languages)
- Native X Server integration with `.desktop` file

### macOS (Swift / SwiftUI)

A native macOS desktop application built with Swift and SwiftUI.

**Prerequisites:**
- macOS 13.0 (Ventura) or later
- Swift 5.9+
- Xcode Command Line Tools (`xcode-select --install`)

**Build & Run:**

```bash
cd desktop/agora-mac
make build
make run
```

**Create Application Bundle:**

```bash
# Create Agora.app bundle
make bundle

# Install to /Applications
make install
```

**Release Build:**

```bash
make release
```

**Features:**
- Real-time messaging via WebSocket with typing indicators
- Channel management - direct messages, group chats, and team channels
- Message reactions with emoji picker
- Message replies with quoted context
- Desktop notifications via macOS Notification Center
- Custom notification sounds (configurable per user)
- Calendar event reminders with countdown timer and video call join
- Multi-language support (24 languages with automatic system language detection)
- Self-signed certificate support for development environments
- Native macOS UI with SwiftUI, NavigationSplitView sidebar, and system theme integration

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

## Admin User & User Management

Self-registration is **disabled**. All users must be created by an administrator. The first admin user must be created via the CLI script.

### Creating the First Admin User

**Inside Docker (recommended):**

```bash
docker compose exec backend python scripts/create_admin.py \
  --username admin \
  --email admin@agora.local \
  --name "Administrator" \
  --password YourSecurePassword123!
```

**Interactive mode** (prompts for password):

```bash
docker compose exec backend python scripts/create_admin.py \
  --username admin \
  --email admin@agora.local \
  --name "Administrator"
```

**Outside Docker** (direct database access):

```bash
cd backend
python scripts/create_admin.py \
  --username admin \
  --email admin@agora.local \
  --name "Administrator" \
  --password YourSecurePassword123! \
  --db-url postgresql://agora:agora_secret@localhost:5432/agora
```

If the user already exists, the script will promote them to admin.

### Managing Users via Admin Panel

1. Log in with an admin account
2. Click the **Admin** icon in the sidebar (visible only to admins)
3. In the **User Management** section you can:
   - **Create users** - Click "Create User" and fill in username, display name, email, and password
   - **Edit users** - Click the edit icon to change display name, email, or admin status
   - **Reset passwords** - Click the lock icon to set a new password for a user
   - **Delete users** - Click the delete icon (you cannot delete your own account)

### Admin API Endpoints

| Method   | Endpoint                                 | Description                 |
|----------|------------------------------------------|-----------------------------|
| `GET`    | `/api/admin/users`                       | List all users              |
| `POST`   | `/api/admin/users`                       | Create a new user           |
| `PUT`    | `/api/admin/users/{id}`                  | Update a user               |
| `DELETE` | `/api/admin/users/{id}`                  | Delete a user               |
| `POST`   | `/api/admin/users/{id}/reset-password`   | Reset a user's password     |
| `GET`    | `/api/admin/stats`                       | System statistics           |

All admin endpoints require a valid JWT token from an admin user.

---

## Authentication Flows

### Local Authentication
1. Admin creates user via Admin Panel or CLI script
2. Login with username/password (`POST /api/auth/login`) → JWT token
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
