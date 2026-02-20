import SwiftUI
import UserNotifications
import AVFoundation

class AppState: ObservableObject {
    @Published var isLoggedIn = false
    @Published var currentUser: User?
    @Published var channels: [Channel] = []
    @Published var selectedChannel: Channel?
    @Published var messages: [Message] = []
    @Published var typingUsers: [String: Date] = [:]
    @Published var toastMessage: ToastData?
    @Published var currentEvent: CalendarEvent?
    @Published var showEventReminder = false
    @Published var eventCountdown = ""

    var api: ApiClient?
    var notificationWS: WebSocketClient?
    var channelWS: WebSocketClient?
    private var lastTypingSent: Date = .distantPast
    private var typingCleanupTimer: Timer?
    private var eventPollTimer: Timer?
    private var eventCountdownTimer: Timer?
    private var dismissedEventIds: Set<String> = []
    private var notificationSoundData: Data?
    private var audioPlayer: AVAudioPlayer?

    func login(api: ApiClient, user: User) {
        self.api = api
        self.currentUser = user
        self.isLoggedIn = true
        loadChannels()
        connectNotificationWebSocket()
        startTypingCleanup()
        startEventPolling()
        downloadNotificationSound()
        requestNotificationPermission()
    }

    func logout() {
        notificationWS?.disconnect()
        channelWS?.disconnect()
        typingCleanupTimer?.invalidate()
        eventPollTimer?.invalidate()
        eventCountdownTimer?.invalidate()
        isLoggedIn = false
        currentUser = nil
        channels = []
        selectedChannel = nil
        messages = []
        api = nil
    }

    // MARK: - Channels

    func loadChannels() {
        guard let api = api else { return }
        Task {
            do {
                let channels = try await api.getChannels()
                await MainActor.run {
                    self.channels = channels.sorted {
                        ($0.lastActivityAt ?? "") > ($1.lastActivityAt ?? "")
                    }
                }
            } catch {
                print("Failed to load channels: \(error)")
            }
        }
    }

    func selectChannel(_ channel: Channel) {
        channelWS?.disconnect()
        selectedChannel = channel
        messages = []
        typingUsers = [:]
        loadMessages(channelId: channel.id)
        connectChannelWebSocket(channelId: channel.id)

        // Mark as read
        if channel.unreadCount > 0 {
            if let idx = channels.firstIndex(where: { $0.id == channel.id }) {
                channels[idx].unreadCount = 0
            }
        }
    }

    // MARK: - Messages

    func loadMessages(channelId: String) {
        guard let api = api else { return }
        Task {
            do {
                let msgs = try await api.getMessages(channelId: channelId)
                await MainActor.run {
                    if self.selectedChannel?.id == channelId {
                        self.messages = msgs.reversed()
                        // Update read position
                        if let lastMsg = msgs.first {
                            self.updateReadPosition(channelId: channelId, messageId: lastMsg.id)
                        }
                    }
                }
            } catch {
                print("Failed to load messages: \(error)")
            }
        }
    }

    func sendMessage(_ content: String) {
        guard let channel = selectedChannel else { return }
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        channelWS?.sendChatMessage(content: trimmed)
    }

    func sendTyping() {
        let now = Date()
        if now.timeIntervalSince(lastTypingSent) > 2 {
            channelWS?.sendTyping()
            lastTypingSent = now
        }
    }

    private func updateReadPosition(channelId: String, messageId: String) {
        guard let api = api else { return }
        Task {
            try? await api.updateReadPosition(channelId: channelId, messageId: messageId)
        }
    }

    // MARK: - WebSocket

    private func connectNotificationWebSocket() {
        guard let api = api, let token = api.getToken() else { return }
        let baseURL = api.getBaseURL()
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
        guard let url = URL(string: "\(baseURL)/ws/notifications?token=\(token)") else { return }

        let ws = WebSocketClient(url: url, identifier: "notifications")
        ws.delegate = self
        ws.connect()
        notificationWS = ws
    }

    func connectChannelWebSocket(channelId: String) {
        guard let api = api, let token = api.getToken() else { return }
        let baseURL = api.getBaseURL()
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
        guard let url = URL(string: "\(baseURL)/ws/\(channelId)?token=\(token)") else { return }

        let ws = WebSocketClient(url: url, identifier: "channel")
        ws.delegate = self
        ws.connect()
        channelWS = ws
    }

    // MARK: - Typing

    private func startTypingCleanup() {
        typingCleanupTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let cutoff = Date().addingTimeInterval(-3)
            self.typingUsers = self.typingUsers.filter { $0.value > cutoff }
        }
    }

    var typingIndicator: String {
        let names = Array(typingUsers.keys)
        guard !names.isEmpty else { return "" }
        let joined = names.joined(separator: ", ")
        if names.count == 1 {
            return "\(joined) \(T("chat.typing_one"))"
        }
        return "\(joined) \(T("chat.typing_many"))"
    }

    // MARK: - Notifications

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func showNotification(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func downloadNotificationSound() {
        guard let api = api, let user = currentUser else { return }
        let soundPath = user.notificationSoundPath ?? "/assets/sounds/star-trek-communicator.mp3"

        Task {
            do {
                let data = try await api.downloadFile(path: soundPath)
                await MainActor.run {
                    self.notificationSoundData = data
                }
            } catch {
                print("Failed to download notification sound: \(error)")
            }
        }
    }

    func playNotificationSound() {
        guard let data = notificationSoundData else { return }
        do {
            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.play()
        } catch {
            print("Failed to play notification sound: \(error)")
        }
    }

    func showToast(title: String, body: String) {
        toastMessage = ToastData(title: title, body: body)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.toastMessage = nil
        }
    }

    // MARK: - Event Reminders

    private func startEventPolling() {
        pollEvents()
        eventPollTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.pollEvents()
        }
    }

    private func pollEvents() {
        guard let api = api else { return }
        let now = Date()
        let end = now.addingTimeInterval(16 * 60)

        Task {
            do {
                let events = try await api.getCalendarEvents(start: now, end: end)
                await MainActor.run {
                    let upcoming = events
                        .filter { !$0.allDay && !dismissedEventIds.contains($0.id) }
                        .compactMap { event -> (CalendarEvent, Int)? in
                            guard let mins = event.minutesUntilStart(), mins >= 0, mins <= 15 else { return nil }
                            return (event, mins)
                        }
                        .sorted { $0.1 < $1.1 }
                        .first

                    if let (event, _) = upcoming {
                        if currentEvent?.id != event.id {
                            currentEvent = event
                            showEventReminder = true
                            startCountdownTimer()
                        }
                    }
                }
            } catch {
                // Fail silently
            }
        }
    }

    private func startCountdownTimer() {
        eventCountdownTimer?.invalidate()
        eventCountdownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self = self, let event = self.currentEvent else { return }
            let countdown = event.countdownString()
            self.eventCountdown = countdown
            if countdown == "00:00" {
                self.showEventReminder = false
                self.eventCountdownTimer?.invalidate()
            }
        }
    }

    func dismissEvent() {
        if let event = currentEvent {
            dismissedEventIds.insert(event.id)
        }
        showEventReminder = false
        eventCountdownTimer?.invalidate()
    }

    func joinEvent() {
        guard let event = currentEvent, let channelId = event.channelId,
              let api = api else { return }
        let baseURL = api.getBaseURL()
        if let url = URL(string: "\(baseURL)/video/\(channelId)") {
            NSWorkspace.shared.open(url)
        }
        dismissEvent()
    }
}

// MARK: - WebSocket Delegate

extension AppState: WebSocketClientDelegate {
    func webSocketDidConnect(_ client: WebSocketClient) {
        if client.identifier == "channel", let userId = currentUser?.id {
            client.sendStatusChange(status: "online")
            client.sendRead(userId: userId)
        }
    }

    func webSocketDidDisconnect(_ client: WebSocketClient, error: Error?) {
        // Fail gracefully
    }

    func webSocketDidReceiveMessage(_ client: WebSocketClient, type: String, data: [String: Any]) {
        switch type {
        case "new_message":
            handleNewMessage(data)
        case "message_edited":
            handleMessageEdited(data)
        case "message_deleted":
            handleMessageDeleted(data)
        case "reaction_update":
            handleReactionUpdate(data)
        case "typing":
            handleTyping(data)
        case "channel_renamed":
            handleChannelRenamed(data)
        case "member_added", "member_left":
            handleMemberChange(data)
        case "user_joined", "user_statuses":
            break // Status updates handled in UI
        case "status_change":
            break
        case "video_call_invite":
            handleCallInvite(data)
        default:
            break
        }
    }

    private func handleNewMessage(_ data: [String: Any]) {
        guard let msgData = data["message"] as? [String: Any] else { return }
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: msgData)
            let message = try JSONDecoder().decode(Message.self, from: jsonData)

            // Add to current view if it's the active channel
            if let channelId = data["channel_id"] as? String,
               channelId == selectedChannel?.id {
                if !messages.contains(where: { $0.id == message.id }) {
                    messages.append(message)
                }
                // Update read position
                updateReadPosition(channelId: channelId, messageId: message.id)
            }

            // Remove sender from typing
            typingUsers.removeValue(forKey: message.senderName)

            // Notify for messages from others
            if message.senderId != currentUser?.id {
                playNotificationSound()

                if !NSApp.isActive {
                    let channelName = selectedChannel?.name ?? ""
                    showNotification(
                        title: "\(message.senderName) in #\(channelName)",
                        body: message.content
                    )
                }

                showToast(
                    title: message.senderName,
                    body: message.content
                )

                // Update unread count
                if let channelId = data["channel_id"] as? String,
                   channelId != selectedChannel?.id,
                   let idx = channels.firstIndex(where: { $0.id == channelId }) {
                    channels[idx].unreadCount += 1
                }
            }

            // Update channel activity
            if let channelId = data["channel_id"] as? String,
               let idx = channels.firstIndex(where: { $0.id == channelId }) {
                let formatter = ISO8601DateFormatter()
                channels[idx].lastActivityAt = formatter.string(from: Date())
                // Re-sort channels
                channels.sort { ($0.lastActivityAt ?? "") > ($1.lastActivityAt ?? "") }
            }
        } catch {
            print("Failed to decode message: \(error)")
        }
    }

    private func handleMessageEdited(_ data: [String: Any]) {
        guard let messageId = data["message_id"] as? String,
              let content = data["content"] as? String,
              let editedAt = data["edited_at"] as? String else { return }

        if let idx = messages.firstIndex(where: { $0.id == messageId }) {
            messages[idx].content = content
            messages[idx].editedAt = editedAt
        }
    }

    private func handleMessageDeleted(_ data: [String: Any]) {
        guard let messageId = data["message_id"] as? String else { return }
        messages.removeAll { $0.id == messageId }
    }

    private func handleReactionUpdate(_ data: [String: Any]) {
        guard let messageId = data["message_id"] as? String,
              let userId = data["user_id"] as? String,
              let emoji = data["emoji"] as? String,
              let action = data["action"] as? String else { return }

        if let idx = messages.firstIndex(where: { $0.id == messageId }) {
            var reactions = messages[idx].reactions ?? [:]
            var users = reactions[emoji] ?? []

            if action == "add" {
                if !users.contains(userId) {
                    users.append(userId)
                }
            } else {
                users.removeAll { $0 == userId }
            }

            if users.isEmpty {
                reactions.removeValue(forKey: emoji)
            } else {
                reactions[emoji] = users
            }
            messages[idx].reactions = reactions

            // Toast for reactions from others
            if userId != currentUser?.id,
               let displayName = data["display_name"] as? String {
                showToast(
                    title: "\(displayName) \(T("notify.reacted")) \(emoji)",
                    body: T("notify.reaction_body")
                )
            }
        }
    }

    private func handleTyping(_ data: [String: Any]) {
        guard let displayName = data["display_name"] as? String,
              let userId = data["user_id"] as? String,
              userId != currentUser?.id else { return }
        typingUsers[displayName] = Date()
    }

    private func handleChannelRenamed(_ data: [String: Any]) {
        guard let channelName = data["channel_name"] as? String else { return }
        if let idx = channels.firstIndex(where: { $0.id == selectedChannel?.id }) {
            channels[idx].name = channelName
        }
        selectedChannel?.name = channelName
    }

    private func handleMemberChange(_ data: [String: Any]) {
        if let memberCount = data["member_count"] as? Int {
            if let idx = channels.firstIndex(where: { $0.id == selectedChannel?.id }) {
                channels[idx].memberCount = memberCount
            }
        }
        loadChannels()
    }

    private func handleCallInvite(_ data: [String: Any]) {
        let displayName = data["display_name"] as? String ?? T("notify.someone")
        showNotification(
            title: T("notify.incoming_call"),
            body: "\(displayName) \(T("notify.calling"))"
        )
        showToast(
            title: T("notify.incoming_call"),
            body: "\(displayName) \(T("notify.calling"))"
        )
    }
}

struct ToastData: Identifiable {
    let id = UUID()
    let title: String
    let body: String
}

// MARK: - Main View

struct MainView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        NavigationSplitView {
            SidebarView(appState: appState)
                .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 320)
        } detail: {
            if appState.selectedChannel != nil {
                ChatView(appState: appState)
            } else {
                WelcomeView()
            }
        }
        .frame(minWidth: 800, minHeight: 500)
        .overlay(alignment: .topTrailing) {
            if let toast = appState.toastMessage {
                ToastView(data: toast)
                    .padding(16)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                    .animation(.easeInOut(duration: 0.3), value: appState.toastMessage?.id)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if appState.showEventReminder, let event = appState.currentEvent {
                EventReminderView(
                    event: event,
                    countdown: appState.eventCountdown,
                    onJoin: { appState.joinEvent() },
                    onDismiss: { appState.dismissEvent() }
                )
                .padding(16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.easeInOut(duration: 0.3), value: appState.showEventReminder)
            }
        }
    }
}

// MARK: - Welcome View

struct WelcomeView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 64))
                .foregroundColor(.accentColor)
                .opacity(0.6)

            Text(T("welcome.title"))
                .font(.title)
                .fontWeight(.semibold)

            Text(T("welcome.subtitle"))
                .font(.body)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Sidebar

struct SidebarView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            // User header
            HStack(spacing: 10) {
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 32, height: 32)
                    .overlay(
                        Text(String(appState.currentUser?.displayName.prefix(1).uppercased() ?? "?"))
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(appState.currentUser?.displayName ?? "")
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)

                    Text(T("status.online"))
                        .font(.system(size: 11))
                        .foregroundColor(.green)
                }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)

            Divider()

            // Section header
            HStack {
                Text(T("chat.chats"))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.secondary)
                    .textCase(.uppercase)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 4)

            // Channel list
            List(appState.channels, selection: Binding(
                get: { appState.selectedChannel },
                set: { channel in
                    if let channel = channel {
                        appState.selectChannel(channel)
                    }
                }
            )) { channel in
                ChannelRowView(channel: channel)
                    .tag(channel)
            }
            .listStyle(.sidebar)
        }
    }
}

struct ChannelRowView: View {
    let channel: Channel

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: channel.typeIcon)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(channel.name)
                    .font(.system(size: 13, weight: channel.unreadCount > 0 ? .bold : .regular))
                    .lineLimit(1)

                Text("\(channel.memberCount) \(T("chat.members"))")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }

            Spacer()

            if channel.unreadCount > 0 {
                Text("\(channel.unreadCount)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.accentColor)
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 2)
    }
}
