import SwiftUI
import AppKit

struct ChatView: View {
    @ObservedObject var appState: AppState
    @State private var messageText = ""
    @State private var scrollProxy: ScrollViewProxy?

    var body: some View {
        VStack(spacing: 0) {
            // Channel header
            HStack {
                Image(systemName: appState.selectedChannel?.typeIcon ?? "bubble.left.fill")
                    .foregroundColor(.accentColor)
                Text(appState.selectedChannel?.name ?? "")
                    .font(.headline)
                if appState.selectedChannel?.channelType == "direct" {
                    if let otherStatus = otherUserStatus {
                        Circle()
                            .fill(statusColor(for: otherStatus))
                            .frame(width: 8, height: 8)
                        Text(statusLabel(for: otherStatus))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                } else {
                    Text("\(appState.selectedChannel?.memberCount ?? 0) \(T("chat.members"))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(appState.messages) { message in
                            MessageBubbleView(
                                message: message,
                                isOwnMessage: message.senderId == appState.currentUser?.id,
                                onReaction: { emoji in
                                    addReaction(messageId: message.id, emoji: emoji)
                                },
                                onDownloadFile: {
                                    downloadFile(message: message)
                                }
                            )
                            .id(message.id)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }
                .onAppear { scrollProxy = proxy }
                .onChange(of: appState.messages.count) { _, _ in
                    scrollToBottom(proxy: proxy)
                }
            }

            // Typing indicator
            if !appState.typingIndicator.isEmpty {
                HStack {
                    Text(appState.typingIndicator)
                        .font(.system(size: 12, weight: .regular))
                        .italic()
                        .foregroundColor(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }

            Divider()

            // Input area
            HStack(spacing: 8) {
                TextField(T("chat.input_placeholder"), text: $messageText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .padding(8)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .cornerRadius(8)
                    .onSubmit { sendMessage() }
                    .onChange(of: messageText) { _, _ in
                        appState.sendTyping()
                    }

                Button(action: sendMessage) {
                    Image(systemName: "paperplane.fill")
                        .foregroundColor(.white)
                        .frame(width: 32, height: 32)
                        .background(Color.accentColor)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(12)
        }
    }

    private func sendMessage() {
        let text = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        messageText = ""
        appState.sendMessage(text)
    }

    private func addReaction(messageId: String, emoji: String) {
        guard let channelId = appState.selectedChannel?.id else { return }
        appState.channelWS?.sendReaction(emoji: emoji, messageId: messageId, action: "add")
    }

    private func downloadFile(message: Message) {
        guard let fileRefId = message.fileReferenceId, let api = appState.api else { return }

        let panel = NSSavePanel()
        panel.nameFieldStringValue = message.fileDisplayName.isEmpty ? "download" : message.fileDisplayName
        panel.canCreateDirectories = true

        guard panel.runModal() == .OK, let saveURL = panel.url else { return }

        Task {
            do {
                let data = try await api.downloadFile(path: "/api/files/download/\(fileRefId)")
                try data.write(to: saveURL)
            } catch {
                print("Failed to download file: \(error)")
            }
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        if let lastMessage = appState.messages.last {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(lastMessage.id, anchor: .bottom)
            }
        }
    }

    private var otherUserStatus: String? {
        guard let currentUserId = appState.currentUser?.id else { return nil }
        let otherMember = appState.currentChannelMembers.first { $0.id != currentUserId }
        guard let memberId = otherMember?.id else { return nil }
        return appState.userStatuses[memberId] ?? otherMember?.status
    }

    private func statusColor(for status: String) -> Color {
        switch status {
        case "online": return .green
        case "away": return .orange
        default: return .gray
        }
    }

    private func statusLabel(for status: String) -> String {
        switch status {
        case "online": return T("status.online")
        case "away": return T("status.away")
        default: return T("status.offline")
        }
    }
}

// MARK: - Message Bubble

struct MessageBubbleView: View {
    let message: Message
    let isOwnMessage: Bool
    let onReaction: (String) -> Void
    let onDownloadFile: () -> Void

    @State private var isHovered = false

    private let commonReactions = ["👍", "👎", "😂", "❤️", "🎉", "😮"]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Reply quote
            if let replyContent = message.replyToContent,
               let replySender = message.replyToSender {
                HStack(spacing: 0) {
                    Rectangle()
                        .fill(Color.accentColor)
                        .frame(width: 3)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(replySender)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.accentColor)
                        Text(replyContent)
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                }
                .background(Color(nsColor: .quaternaryLabelColor).opacity(0.3))
                .cornerRadius(4)
            }

            // Message header
            HStack(alignment: .firstTextBaseline) {
                // Avatar with status dot
                Circle()
                    .fill(avatarColor)
                    .frame(width: 28, height: 28)
                    .overlay(
                        Text(String(message.senderName.prefix(1).uppercased()))
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.white)
                    )
                    .overlay(alignment: .bottomTrailing) {
                        Circle()
                            .fill(messageStatusColor)
                            .frame(width: 10, height: 10)
                            .overlay(
                                Circle()
                                    .stroke(Color.white, lineWidth: 2)
                                    .frame(width: 10, height: 10)
                            )
                            .offset(x: 1, y: 1)
                    }

                Text(message.senderName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.accentColor)

                if message.isEdited {
                    Text(T("chat.edited"))
                        .font(.system(size: 11))
                        .italic()
                        .foregroundColor(.secondary)
                }

                Spacer()

                Text(message.formattedTime)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }

            // Content
            if message.messageType == "system" {
                Text(message.content)
                    .font(.system(size: 13))
                    .italic()
                    .foregroundColor(.secondary)
                    .padding(.leading, 36)
            } else if message.messageType == "file" {
                HStack(spacing: 8) {
                    Image(systemName: "doc.fill")
                        .foregroundColor(.accentColor)
                    Text(message.fileDisplayName.isEmpty ? T("chat.file_sent") : message.fileDisplayName)
                        .font(.system(size: 13))
                        .lineLimit(1)
                    Button(action: onDownloadFile) {
                        Label(T("chat.download_file"), systemImage: "arrow.down.circle")
                            .labelStyle(.iconOnly)
                    }
                    .buttonStyle(.plain)
                    .help(T("chat.download_file"))
                }
                .padding(.leading, 36)
            } else {
                Text(message.content)
                    .font(.system(size: 13))
                    .textSelection(.enabled)
                    .padding(.leading, 36)
            }

            // Reactions
            if !message.reactionsDisplay.isEmpty {
                HStack(spacing: 4) {
                    ForEach(message.reactionsDisplay, id: \.emoji) { reaction in
                        Button(action: { onReaction(reaction.emoji) }) {
                            HStack(spacing: 2) {
                                Text(reaction.emoji)
                                    .font(.system(size: 12))
                                Text("\(reaction.count)")
                                    .font(.system(size: 11))
                                    .foregroundColor(.secondary)
                            }
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color(nsColor: .quaternaryLabelColor).opacity(0.3))
                            .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 36)
            }

            // Reaction picker on hover
            if isHovered {
                HStack(spacing: 2) {
                    ForEach(commonReactions, id: \.self) { emoji in
                        Button(action: { onReaction(emoji) }) {
                            Text(emoji)
                                .font(.system(size: 14))
                                .padding(4)
                                .background(Color(nsColor: .quaternaryLabelColor).opacity(0.2))
                                .cornerRadius(4)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 36)
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isHovered ? Color(nsColor: .quaternaryLabelColor).opacity(0.15) : .clear)
        )
        .onHover { hovering in
            isHovered = hovering
        }
    }

    private var avatarColor: Color {
        let hash = abs(message.senderId.hashValue)
        let colors: [Color] = [.blue, .green, .orange, .purple, .pink, .teal, .indigo, .mint]
        return colors[hash % colors.count]
    }

    private var messageStatusColor: Color {
        switch message.senderStatus {
        case "online": return Color(red: 0, green: 0.784, blue: 0.318)
        case "busy", "dnd": return Color(red: 0.769, green: 0.192, blue: 0.294)
        case "away": return Color(red: 0.988, green: 0.729, blue: 0.016)
        default: return Color(red: 0.576, green: 0.576, blue: 0.561)
        }
    }
}
