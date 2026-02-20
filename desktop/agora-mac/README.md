# Agora macOS Desktop Client

Native macOS desktop client for the Agora collaboration platform, built with Swift and SwiftUI.

## Requirements

- macOS 13.0 (Ventura) or later
- Swift 5.9+
- Xcode Command Line Tools (`xcode-select --install`)

## Build

```bash
# Debug build
make build

# Release build
make release

# Build and run
make run
```

## Create Application Bundle

```bash
# Create Agora.app bundle
make bundle

# Install to /Applications
make install
```

## Features

- **Real-time messaging** via WebSocket with typing indicators
- **Channel management** - direct messages, group chats, and team channels
- **Message reactions** with emoji picker on hover
- **Message replies** with quoted context
- **Desktop notifications** via macOS Notification Center
- **Custom notification sounds** (configurable per user)
- **Calendar event reminders** with countdown timer and video call join
- **Multi-language support** - 24 languages with automatic system language detection
  (bg, cs, da, de, el, en, es, et, fi, fr, ga, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, sk, sl, sv)
- **Self-signed certificate support** for development environments
- **Native macOS UI** with SwiftUI, NavigationSplitView sidebar, and system theme integration

## Architecture

```
Sources/AgoraMac/
├── main.swift                    # App entry point, NSApplication setup, menu bar
├── Models/
│   ├── User.swift                # User, LoginResponse, AuthConfig
│   ├── Channel.swift             # Channel, ChannelMember
│   ├── Message.swift             # Message, SendMessageRequest
│   └── CalendarEvent.swift       # CalendarEvent with countdown
├── Services/
│   ├── ApiClient.swift           # REST API client (URLSession, SSL bypass)
│   ├── WebSocketClient.swift     # WebSocket client (URLSessionWebSocketTask)
│   └── Translations.swift        # i18n with 24 languages
└── Views/
    ├── LoginView.swift           # Login form
    ├── MainView.swift            # AppState, sidebar, welcome screen
    ├── ChatView.swift            # Chat view, message bubbles, input
    ├── EventReminderView.swift   # Calendar event reminder popup
    └── ToastView.swift           # Toast notification overlay
```

## API Compatibility

The client communicates with the Agora backend via:

- **REST API** (`/api/*`) - authentication, channels, messages, calendar, users
- **WebSocket** (`/ws/notifications`, `/ws/{channel_id}`) - real-time messaging, typing, reactions, status

Matches the same API contract as the Windows (.NET/WPF) and Linux (GTK3/C) desktop clients.
