# Agora Android App

Diese Android-App stellt alle Features der mobilen Agora-Webseite bereit, indem sie das bestehende responsive Web-Frontend in einer nativen WebView kapselt.

## Start

1. URL im `MainActivity.kt` setzen (`AGORA_URL`).
2. In Android Studio `android-app/` öffnen.
3. App auf Emulator oder Gerät starten.

## Benachrichtigungen

- Native Telefon-Benachrichtigungen sind aktiviert.
- Für Android 13+ fragt die App beim Start die Berechtigung `POST_NOTIFICATIONS` an.
- Die WebView patcht die Browser-`Notification`-API und leitet Titel/Text an Android weiter.
- Hinweis: Dies sind lokale native Notifications aus der laufenden WebView (kein FCM/Server-Push im Hintergrund).

## Hinweise

- Kamera/Mikrofon/WebRTC-Berechtigungen werden an die Seite durchgereicht.
- Pull-to-refresh ist integriert.
- Navigation zurück nutzt die WebView-History.
