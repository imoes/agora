# Agora

Agora ist eine selbst-gehostete Kollaborationsplattform mit Chat, Videokonferenzen, Dateiverwaltung und Kalenderintegration.

## Features

- **Chat** - Echtzeit-Messaging mit Dateianhängen
- **Videokonferenzen** - WebRTC-basiert über Janus Gateway
- **Dateiverwaltung** - Upload und Verwaltung von Dateien
- **Kalender** - Interner Kalender + Synchronisation mit Google Calendar, WebDAV/CalDAV und Outlook/Exchange
- **LDAP/Active Directory** - Optionale Benutzerauthentifizierung über LDAP

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
| Nginx    | 80    | Reverse-Proxy (Frontend + API)    |
| Backend  | 8000  | FastAPI REST-API                  |
| Frontend | -     | Angular SPA (ueber Nginx)         |
| Postgres | 5432  | Datenbank                         |
| Redis    | 6379  | Cache und Sessions                |
| Janus    | 8088  | WebRTC Gateway                    |
| MailHog  | 8025  | E-Mail-Test-UI (nur Entwicklung)  |

## Konfiguration

Alle Einstellungen werden ueber Umgebungsvariablen in der `.env`-Datei gesteuert. Siehe [.env.example](.env.example) fuer alle verfuegbaren Optionen.

### JWT Secret (Pflicht fuer Produktion)

```env
JWT_SECRET=dein-sicheres-secret-hier
```

Generiere ein sicheres Secret mit: `openssl rand -hex 32`

### E-Mail (SMTP)

Im Entwicklungsmodus laeuft MailHog als E-Mail-Catcher. Fuer Produktion einen echten SMTP-Server konfigurieren:

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
   http://localhost:4200/calendar/google/callback
   ```
   (In Produktion die echte Domain verwenden, z.B. `https://agora.deine-domain.de/calendar/google/callback`)
6. Klicke **"Erstellen"**
7. Kopiere **Client-ID** und **Client-Secret**

### Schritt 5: Agora konfigurieren

Trage die Werte in deine `.env`-Datei ein:

```env
GOOGLE_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
FRONTEND_URL=http://localhost:4200
```

Starte die Container neu:

```bash
docker compose down && docker compose up -d
```

### Schritt 6: Kalender verbinden

1. Melde dich in Agora an
2. Gehe in den Kalender-Bereich
3. Klicke **"Mit Google verbinden"**
4. Melde dich mit deinem Google-Konto an und erteile die Berechtigung
5. Deine Google-Termine werden automatisch synchronisiert

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

### Tests

```bash
cd backend
pytest
```

## Lizenz

Siehe [LICENSE](LICENSE) Datei.
