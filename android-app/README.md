# Agora Android App

This Android app provides all features of the mobile Agora website by wrapping the existing responsive web frontend in a native WebView.

## Getting Started

1. Set the URL in `MainActivity.kt` (`AGORA_URL`).
2. Open `android-app/` in Android Studio.
3. Run the app on an emulator or physical device.

## Notifications

- Native phone notifications are enabled.
- On Android 13+, the app requests the `POST_NOTIFICATIONS` permission on startup.
- The WebView patches the browser `Notification` API and forwards title/body text to Android notifications.
- Note: these are local native notifications from the running WebView process (no FCM/server push in the background).

## Notes

- Camera/microphone/WebRTC permissions are forwarded to the page.
- Pull-to-refresh is included.
- Back navigation uses WebView history.
