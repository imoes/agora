import Foundation

struct Team: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let description: String?
    let avatarPath: String?
    let ownerId: String
    let createdAt: String
    var memberCount: Int

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case avatarPath = "avatar_path"
        case ownerId = "owner_id"
        case createdAt = "created_at"
        case memberCount = "member_count"
    }

    static func == (lhs: Team, rhs: Team) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

struct TeamMember: Codable, Identifiable {
    let user: User
    let role: String
    let joinedAt: String

    var id: String { user.id }

    enum CodingKeys: String, CodingKey {
        case user, role
        case joinedAt = "joined_at"
    }
}

struct FeedEvent: Codable, Identifiable {
    let id: String
    let eventType: String
    let channelId: String?
    let channelName: String?
    let actorId: String?
    let actorName: String?
    let message: String?
    let isRead: Bool
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, message
        case eventType = "event_type"
        case channelId = "channel_id"
        case channelName = "channel_name"
        case actorId = "actor_id"
        case actorName = "actor_name"
        case isRead = "is_read"
        case createdAt = "created_at"
    }
}

struct FeedResponse: Codable {
    let events: [FeedEvent]
    let unreadCount: Int

    enum CodingKeys: String, CodingKey {
        case events
        case unreadCount = "unread_count"
    }
}

struct AuthConfig: Codable {
    let registrationEnabled: Bool?

    enum CodingKeys: String, CodingKey {
        case registrationEnabled = "registration_enabled"
    }
}
