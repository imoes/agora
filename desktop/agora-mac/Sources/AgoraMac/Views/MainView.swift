import SwiftUI
import UserNotifications
import AVFoundation
import WebKit

class AppState: ObservableObject {
    @Published var isLoggedIn = false
    @Published var currentUser: User?
    @Published var channels: [Channel] = []
    @Published var teams: [Team] = []
    @Published var teamChannels: [Channel] = []
    @Published var teamChannelsMap: [String: [Channel]] = [:]
    @Published var selectedTeam: Team?
    @Published var selectedChannel: Channel?
    @Published var messages: [Message] = []
    @Published var typingUsers: [String: Date] = [:]
    @Published var toastMessage: ToastData?
    @Published var currentEvent: CalendarEvent?
    @Published var showEventReminder = false
    @Published var eventCountdown = ""
    @Published var showVideoOverlay = false
    @Published var videoURL: URL?
    @Published var userStatuses: [String: String] = [:]
    @Published var currentChannelMembers: [ChannelMember] = []
    @Published var showTeamDetail = false
    @Published var teamDetailTeam: Team?
    @Published var teamDetailMembers: [TeamMember] = []
    @Published var teamDetailChannels: [Channel] = []
    @Published var teamDetailFiles: [[String: Any]] = []

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
        loadTeams()
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
        teamChannelsMap = [:]
        selectedChannel = nil
        messages = []
        userStatuses = [:]
        currentChannelMembers = []
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

    func loadTeams() {
        guard let api = api else { return }
        Task {
            do {
                let teams = try await api.getTeams()
                await MainActor.run {
                    self.teams = teams
                }
            } catch {
                print("Failed to load teams: \(error)")
            }
        }
    }

    func selectTeam(_ team: Team) {
        selectedTeam = team
        loadTeamChannels(team)
    }

    func loadTeamChannels(_ team: Team) {
        guard let api = api else { return }
        Task {
            do {
                let channels = try await api.getTeamChannels(teamId: team.id)
                await MainActor.run {
                    self.teamChannelsMap[team.id] = channels
                    self.teamChannels = channels
                }
            } catch {
                print("Failed to load team channels: \(error)")
            }
        }
    }

    // MARK: - Team Detail

    func openTeamDetail(_ team: Team) {
        teamDetailTeam = team
        showTeamDetail = true
        selectedChannel = nil
        loadTeamDetailData(team)
    }

    func closeTeamDetail() {
        showTeamDetail = false
        teamDetailTeam = nil
        teamDetailMembers = []
        teamDetailChannels = []
        teamDetailFiles = []
    }

    func loadTeamDetailData(_ team: Team) {
        guard let api = api else { return }
        Task {
            do {
                let channels = try await api.getTeamChannels(teamId: team.id)
                let members = try await api.getTeamMembers(teamId: team.id)
                let files = try await api.getTeamFiles(teamId: team.id)
                await MainActor.run {
                    self.teamDetailChannels = channels
                    self.teamDetailMembers = members
                    self.teamDetailFiles = files
                }
            } catch {
                print("Failed to load team detail: \(error)")
            }
        }
    }

    func leaveTeam(_ team: Team) {
        guard let api = api else { return }
        Task {
            do {
                try await api.leaveTeam(teamId: team.id)
                await MainActor.run {
                    self.closeTeamDetail()
                    self.loadTeams()
                }
            } catch {
                print("Failed to leave team: \(error)")
            }
        }
    }

    func removeTeamMember(teamId: String, userId: String) {
        guard let api = api else { return }
        Task {
            do {
                try await api.removeTeamMember(teamId: teamId, userId: userId)
                await MainActor.run {
                    self.teamDetailMembers.removeAll { $0.user.id == userId }
                    self.loadTeams()
                }
            } catch {
                print("Failed to remove team member: \(error)")
            }
        }
    }

    func addTeamMember(teamId: String, userId: String) {
        guard let api = api else { return }
        Task {
            do {
                try await api.addTeamMember(teamId: teamId, userId: userId)
                let members = try await api.getTeamMembers(teamId: teamId)
                await MainActor.run {
                    self.teamDetailMembers = members
                    self.loadTeams()
                }
            } catch {
                print("Failed to add team member: \(error)")
            }
        }
    }

    func createTeamChannel(teamId: String, name: String, description: String?) {
        guard let api = api else { return }
        Task {
            do {
                _ = try await api.createChannel(name: name, channelType: "team", teamId: teamId)
                let channels = try await api.getTeamChannels(teamId: teamId)
                await MainActor.run {
                    self.teamDetailChannels = channels
                    self.teamChannelsMap[teamId] = channels
                    self.loadTeams()
                }
            } catch {
                print("Failed to create team channel: \(error)")
            }
        }
    }

    func searchUsers(query: String) async -> [User] {
        guard let api = api else { return [] }
        do {
            return try await api.searchUsers(query: query)
        } catch {
            return []
        }
    }

    func selectChannel(_ channel: Channel) {
        channelWS?.disconnect()
        showTeamDetail = false
        selectedChannel = channel
        messages = []
        typingUsers = [:]
        currentChannelMembers = []
        loadMessages(channelId: channel.id)
        connectChannelWebSocket(channelId: channel.id)
        loadChannelMembers(channelId: channel.id)

        // Mark as read
        if channel.unreadCount > 0 {
            if let idx = channels.firstIndex(where: { $0.id == channel.id }) {
                channels[idx].unreadCount = 0
            }
        }
    }

    func loadChannelMembers(channelId: String) {
        guard let api = api else { return }
        Task {
            do {
                let members = try await api.getChannelMembers(channelId: channelId)
                await MainActor.run {
                    self.currentChannelMembers = members
                    for member in members {
                        self.userStatuses[member.id] = member.status
                    }
                }
            } catch {
                print("Failed to load channel members: \(error)")
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
            videoURL = url
            showVideoOverlay = true
        }
        dismissEvent()
    }

    func leaveVideoCall() {
        showVideoOverlay = false
        videoURL = nil
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
        // Reconnect notification WebSocket after a delay
        if client.identifier == "notifications" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                self?.connectNotificationWebSocket()
                // Reload data that may have been missed while disconnected
                self?.loadTeams()
                self?.loadChannels()
            }
        }
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
            handleUserStatuses(data)
        case "status_change":
            handleStatusChange(data)
        case "video_call_invite":
            handleCallInvite(data)
        case "team_member_added":
            loadTeams()
            loadChannels()
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
        let displayName = data["display_name"] as? String ?? "?"

        if let idx = messages.firstIndex(where: { $0.id == messageId }) {
            var reactions = messages[idx].reactions ?? []

            if action == "add" {
                if !reactions.contains(where: { $0.emoji == emoji && $0.userId == userId }) {
                    reactions.append(Reaction(emoji: emoji, userId: userId, displayName: displayName))
                }
            } else {
                reactions.removeAll { $0.emoji == emoji && $0.userId == userId }
            }
            messages[idx].reactions = reactions

            // Toast for reactions from others
            if userId != currentUser?.id {
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
        loadTeams()
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

    private func handleUserStatuses(_ data: [String: Any]) {
        guard let statuses = data["user_statuses"] as? [String: String] else { return }
        for (userId, status) in statuses {
            userStatuses[userId] = status
            if let idx = currentChannelMembers.firstIndex(where: { $0.id == userId }) {
                currentChannelMembers[idx].status = status
            }
            for i in messages.indices where messages[i].senderId == userId {
                messages[i].senderStatus = status
            }
        }
    }

    private func handleStatusChange(_ data: [String: Any]) {
        guard let userId = data["user_id"] as? String,
              let status = data["status"] as? String else { return }
        userStatuses[userId] = status
        // Update in currentChannelMembers as well
        if let idx = currentChannelMembers.firstIndex(where: { $0.id == userId }) {
            currentChannelMembers[idx].status = status
        }
        // Update status dots on existing messages
        for i in messages.indices where messages[i].senderId == userId {
            messages[i].senderStatus = status
        }
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
        ZStack {
            NavigationSplitView {
                SidebarView(appState: appState)
                    .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 320)
            } detail: {
                if appState.showTeamDetail, let team = appState.teamDetailTeam {
                    TeamDetailView(appState: appState, team: team)
                } else if appState.selectedChannel != nil {
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

            if appState.showVideoOverlay, let url = appState.videoURL {
                VideoOverlayView(
                    url: url,
                    token: appState.api?.getToken() ?? "",
                    currentUser: appState.currentUser,
                    onLeave: { appState.leaveVideoCall() }
                )
            }
        }
    }
}

// MARK: - Video Overlay

struct VideoOverlayView: View {
    let url: URL
    let token: String
    let currentUser: User?
    let onLeave: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Header bar
            HStack {
                Text("Video")
                    .font(.headline)
                    .foregroundColor(.white)
                Spacer()
                Button(action: onLeave) {
                    Text(T("reminder.dismiss"))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.red)
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color(nsColor: .windowBackgroundColor))

            VideoWebViewRepresentable(
                url: url,
                token: token,
                currentUser: currentUser,
                onLeave: onLeave
            )
        }
        .background(Color.black)
    }
}

class VideoWebViewCoordinator: NSObject, WKScriptMessageHandler {
    let onLeave: () -> Void

    init(onLeave: @escaping () -> Void) {
        self.onLeave = onLeave
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "leaveCall" {
            DispatchQueue.main.async {
                self.onLeave()
            }
        }
    }
}

struct VideoWebViewRepresentable: NSViewRepresentable {
    let url: URL
    let token: String
    let currentUser: User?
    let onLeave: () -> Void

    func makeCoordinator() -> VideoWebViewCoordinator {
        VideoWebViewCoordinator(onLeave: onLeave)
    }

    func makeNSView(context: Context) -> WKWebView {
        let userController = WKUserContentController()

        // Register message handler for leaveCall
        userController.add(context.coordinator, name: "leaveCall")

        // Build UserScript: auth + CSS hiding + pushState hook
        let userId = currentUser?.id ?? ""
        let displayName = currentUser?.displayName ?? ""
        let escapedToken = token.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        let userJson = "{\"id\":\"\(userId)\",\"display_name\":\"\(displayName)\"}"
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")

        let js = """
        (function(){
        localStorage.setItem('access_token','\(escapedToken)');
        localStorage.setItem('current_user','\(userJson)');
        var css='nav.sidebar{display:none !important}.chat-sidebar{display:none !important}.top-bar{display:none !important}.main-body>.content{flex:1 !important;width:100% !important}';
        function hide(){
            if(!document.getElementById('_ah')){
                var s=document.createElement('style');s.id='_ah';s.textContent=css;
                var t=document.head||document.documentElement;
                if(t)t.appendChild(s);}
            var sels=['nav.sidebar','.chat-sidebar','.top-bar'];
            for(var i=0;i<sels.length;i++){
                var el=document.querySelector(sels[i]);
                if(el)el.style.setProperty('display','none','important');}}
        try{hide();}catch(e){}
        document.addEventListener('DOMContentLoaded',function(){
            hide();
            new MutationObserver(function(){hide();})
                .observe(document.body||document.documentElement,
                {childList:true,subtree:true});});
        var n=0,iv=setInterval(function(){hide();n++;if(n>300)clearInterval(iv);},100);
        var _ps=history.pushState,_rs=history.replaceState;
        function _chk(url){
            var s=(url&&url.toString())||location.href;
            if(s.indexOf('/video/')===-1){
                try{window.webkit.messageHandlers.leaveCall.postMessage('leave');}catch(e){}}}
        history.pushState=function(){_ps.apply(this,arguments);_chk(arguments[2]);};
        history.replaceState=function(){_rs.apply(this,arguments);_chk(arguments[2]);};
        window.addEventListener('popstate',function(){_chk();});
        })();
        """

        let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        userController.addUserScript(script)

        let config = WKWebViewConfiguration()
        config.userContentController = userController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // No dynamic updates needed
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
    @State private var expandedTeams: Set<String> = []

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

            // Channel list
            List(selection: Binding(
                get: { appState.selectedChannel },
                set: { channel in
                    if let channel = channel {
                        appState.selectChannel(channel)
                    }
                }
            )) {
                Section(T("chat.chats")) {
                    ForEach(appState.channels) { channel in
                        ChannelRowView(channel: channel)
                            .tag(channel)
                    }
                }

                if !appState.teams.isEmpty {
                    Section(T("teams.teams")) {
                        ForEach(appState.teams) { team in
                            DisclosureGroup(
                                isExpanded: Binding(
                                    get: { expandedTeams.contains(team.id) },
                                    set: { isExpanded in
                                        if isExpanded {
                                            expandedTeams.insert(team.id)
                                        } else {
                                            expandedTeams.remove(team.id)
                                        }
                                    }
                                )
                            ) {
                                ForEach(appState.teamChannelsMap[team.id] ?? []) { channel in
                                    ChannelRowView(channel: channel)
                                        .tag(channel)
                                }
                            } label: {
                                TeamRowView(team: team, appState: appState)
                            }
                            .onAppear {
                                expandedTeams.insert(team.id)
                                appState.loadTeamChannels(team)
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }
}

struct TeamRowView: View {
    let team: Team
    @ObservedObject var appState: AppState

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.accentColor)
                .frame(width: 24, height: 24)
                .overlay(
                    Text(String(team.name.prefix(1).uppercased()))
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(team.name)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)

                Text("\(team.memberCount) \(T("chat.members"))")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }

            Spacer()

            Button(action: {
                appState.openTeamDetail(team)
            }) {
                Image(systemName: "gearshape")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .help(T("teams.team_settings"))
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Team Detail View

struct TeamDetailView: View {
    @ObservedObject var appState: AppState
    let team: Team
    @State private var selectedTab = 0
    @State private var searchQuery = ""
    @State private var searchResults: [User] = []
    @State private var showNewChannelSheet = false
    @State private var newChannelName = ""
    @State private var newChannelDescription = ""
    @State private var showLeaveConfirm = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(team.name)
                        .font(.system(size: 20, weight: .semibold))

                    Text("\(team.memberCount) \(T("chat.members"))" +
                         (team.description != nil ? " \u{00B7} \(team.description!)" : ""))
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }

                Spacer()

                Button(action: { showLeaveConfirm = true }) {
                    Text(T("teams.leave_team"))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(Color.red)
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
                .alert(T("teams.leave_team"), isPresented: $showLeaveConfirm) {
                    Button(T("teams.leave_team"), role: .destructive) {
                        appState.leaveTeam(team)
                    }
                    Button(T("chat.cancel"), role: .cancel) {}
                } message: {
                    Text("\(T("teams.leave_confirm")) \"\(team.name)\"?")
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .background(Color(nsColor: .windowBackgroundColor))

            Divider()

            // Tab picker
            Picker("", selection: $selectedTab) {
                Text(T("teams.tab_channels")).tag(0)
                Text(T("teams.tab_members")).tag(1)
                Text(T("teams.tab_files")).tag(2)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 24)
            .padding(.vertical, 12)

            // Tab content
            switch selectedTab {
            case 0:
                TeamChannelsTab(appState: appState, teamId: team.id, channels: appState.teamDetailChannels)
            case 1:
                TeamMembersTab(appState: appState, teamId: team.id, members: appState.teamDetailMembers)
            case 2:
                TeamFilesTab(files: appState.teamDetailFiles)
            default:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct TeamChannelsTab: View {
    @ObservedObject var appState: AppState
    let teamId: String
    let channels: [Channel]
    @State private var showNewChannelSheet = false
    @State private var newChannelName = ""
    @State private var newChannelDescription = ""

    var body: some View {
        VStack(spacing: 0) {
            // New channel button
            HStack {
                Button(action: { showNewChannelSheet = true }) {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 11))
                        Text(T("teams.new_channel"))
                            .font(.system(size: 12))
                    }
                    .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
                Spacer()
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 8)

            // Channel list
            List {
                ForEach(channels) { channel in
                    HStack {
                        Text("# \(channel.name)")
                            .font(.system(size: 13))

                        Spacer()

                        Text("\(channel.memberCount) \(T("chat.members"))")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        appState.showTeamDetail = false
                        appState.selectChannel(channel)
                    }
                }
            }
        }
        .sheet(isPresented: $showNewChannelSheet) {
            VStack(spacing: 16) {
                Text(T("teams.new_channel"))
                    .font(.headline)

                TextField(T("teams.channel_name"), text: $newChannelName)
                    .textFieldStyle(.roundedBorder)

                TextField(T("teams.description"), text: $newChannelDescription)
                    .textFieldStyle(.roundedBorder)

                HStack {
                    Button(T("chat.cancel")) { showNewChannelSheet = false }
                    Spacer()
                    Button(T("chat.create")) {
                        let desc = newChannelDescription.isEmpty ? nil : newChannelDescription
                        appState.createTeamChannel(teamId: teamId, name: newChannelName, description: desc)
                        newChannelName = ""
                        newChannelDescription = ""
                        showNewChannelSheet = false
                    }
                    .disabled(newChannelName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(24)
            .frame(width: 360)
        }
    }
}

struct TeamMembersTab: View {
    @ObservedObject var appState: AppState
    let teamId: String
    let members: [TeamMember]
    @State private var searchQuery = ""
    @State private var searchResults: [User] = []
    @State private var showRemoveConfirm = false
    @State private var memberToRemove: String?

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack {
                TextField(T("teams.search_add_user"), text: $searchQuery)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
                    .onChange(of: searchQuery) { newValue in
                        Task {
                            if newValue.count >= 2 {
                                let results = await appState.searchUsers(query: newValue)
                                await MainActor.run {
                                    // Filter out already existing members
                                    let memberIds = Set(members.map { $0.user.id })
                                    searchResults = results.filter { !memberIds.contains($0.id) }
                                }
                            } else {
                                searchResults = []
                            }
                        }
                    }

                Button(T("chat.add_member_btn")) {
                    // This is handled per search result below
                }
                .disabled(true)
                .font(.system(size: 12))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 8)

            // Search results
            if !searchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(searchResults, id: \.id) { user in
                        HStack {
                            Circle()
                                .fill(Color.accentColor)
                                .frame(width: 24, height: 24)
                                .overlay(
                                    Text(String(user.displayName.prefix(1).uppercased()))
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundColor(.white)
                                )

                            Text("\(user.displayName) (@\(user.username))")
                                .font(.system(size: 12))

                            Spacer()

                            Button(T("chat.add_member_btn")) {
                                appState.addTeamMember(teamId: teamId, userId: user.id)
                                searchQuery = ""
                                searchResults = []
                            }
                            .font(.system(size: 11))
                        }
                        .padding(.horizontal, 24)
                        .padding(.vertical, 4)
                    }
                }
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(6)
                .padding(.horizontal, 24)
                .padding(.bottom, 8)
            }

            // Members list
            List {
                ForEach(members) { member in
                    HStack(spacing: 10) {
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 32, height: 32)
                            .overlay(
                                Text(String(member.user.displayName.prefix(1).uppercased()))
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(.white)
                            )

                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(member.user.displayName)
                                    .font(.system(size: 13, weight: .semibold))
                                Text("(\(member.role))")
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary)
                            }
                            if !member.user.email.isEmpty {
                                Text(member.user.email)
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary)
                            }
                        }

                        Spacer()

                        if member.role != "admin" {
                            Button(action: {
                                memberToRemove = member.user.id
                                showRemoveConfirm = true
                            }) {
                                Image(systemName: "xmark")
                                    .font(.system(size: 11))
                                    .foregroundColor(.red)
                            }
                            .buttonStyle(.plain)
                            .help(T("teams.remove_member"))
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .alert(T("teams.remove_member"), isPresented: $showRemoveConfirm) {
                Button(T("teams.remove_member"), role: .destructive) {
                    if let userId = memberToRemove {
                        appState.removeTeamMember(teamId: teamId, userId: userId)
                    }
                    memberToRemove = nil
                }
                Button(T("chat.cancel"), role: .cancel) {
                    memberToRemove = nil
                }
            } message: {
                Text(T("teams.remove_member_confirm"))
            }
        }
    }
}

struct TeamFilesTab: View {
    let files: [[String: Any]]

    var body: some View {
        if files.isEmpty {
            VStack {
                Spacer()
                Text(T("teams.no_files"))
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            List {
                ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                    HStack(spacing: 10) {
                        Image(systemName: "doc")
                            .font(.system(size: 16))
                            .foregroundColor(.secondary)
                            .frame(width: 24)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(file["original_filename"] as? String ?? "Unknown")
                                .font(.system(size: 13))
                                .lineLimit(1)

                            if let fileInfo = file["file"] as? [String: Any],
                               let size = fileInfo["file_size"] as? Int {
                                Text(formatFileSize(size))
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary)
                            }
                        }

                        Spacer()

                        if let dateStr = file["created_at"] as? String {
                            Text(formatDate(dateStr))
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func formatFileSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024.0) }
        return String(format: "%.1f MB", Double(bytes) / (1024.0 * 1024.0))
    }

    private func formatDate(_ dateStr: String) -> String {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: dateStr) {
            let display = DateFormatter()
            display.dateFormat = "dd.MM.yyyy"
            return display.string(from: date)
        }
        return ""
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
