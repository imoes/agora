import Foundation

struct Message: Codable, Identifiable, Equatable {
    let id: String
    let senderId: String
    let senderName: String
    let senderAvatarPath: String?
    let senderStatus: String?
    var content: String
    let messageType: String
    let fileReferenceId: String?
    let replyToId: String?
    let replyToContent: String?
    let replyToSender: String?
    let mentions: [String]?
    var reactions: [String: [String]]?
    let createdAt: String
    var editedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, content, mentions, reactions
        case senderId = "sender_id"
        case senderName = "sender_name"
        case senderAvatarPath = "sender_avatar_path"
        case senderStatus = "sender_status"
        case messageType = "message_type"
        case fileReferenceId = "file_reference_id"
        case replyToId = "reply_to_id"
        case replyToContent = "reply_to_content"
        case replyToSender = "reply_to_sender"
        case createdAt = "created_at"
        case editedAt = "edited_at"
    }

    static func == (lhs: Message, rhs: Message) -> Bool {
        lhs.id == rhs.id
    }

    var isEdited: Bool {
        editedAt != nil
    }

    var formattedTime: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: createdAt) else {
            let fallback = ISO8601DateFormatter()
            guard let d = fallback.date(from: createdAt) else { return "" }
            return formatTime(d)
        }
        return formatTime(date)
    }

    private func formatTime(_ date: Date) -> String {
        let calendar = Calendar.current
        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm"

        if calendar.isDateInToday(date) {
            return timeFormatter.string(from: date)
        }
        if calendar.isDateInYesterday(date) {
            return "Yesterday \(timeFormatter.string(from: date))"
        }
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "dd.MM.yyyy HH:mm"
        return dateFormatter.string(from: date)
    }

    var reactionsDisplay: [(emoji: String, count: Int, userIds: [String])] {
        guard let reactions = reactions else { return [] }
        return reactions.map { (emoji: $0.key, count: $0.value.count, userIds: $0.value) }
            .sorted { $0.emoji < $1.emoji }
    }
}

struct SendMessageRequest: Codable {
    let content: String
    let messageType: String
    let fileReferenceId: String?
    let replyToId: String?

    enum CodingKeys: String, CodingKey {
        case content
        case messageType = "message_type"
        case fileReferenceId = "file_reference_id"
        case replyToId = "reply_to_id"
    }
}
