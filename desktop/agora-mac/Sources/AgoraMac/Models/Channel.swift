import Foundation

struct Channel: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var name: String
    var description: String?
    let channelType: String
    var memberCount: Int
    var unreadCount: Int
    var lastActivityAt: String?
    let createdAt: String
    var teamId: String?
    var inviteToken: String?
    var isSubscribed: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case channelType = "channel_type"
        case memberCount = "member_count"
        case unreadCount = "unread_count"
        case lastActivityAt = "last_activity_at"
        case createdAt = "created_at"
        case teamId = "team_id"
        case inviteToken = "invite_token"
        case isSubscribed = "is_subscribed"
    }

    static func == (lhs: Channel, rhs: Channel) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    var displayName: String {
        if channelType == "direct" {
            return name
        }
        return "#\(name)"
    }

    var typeIcon: String {
        switch channelType {
        case "direct": return "person.fill"
        case "group": return "person.3.fill"
        case "team": return "building.2.fill"
        default: return "bubble.left.fill"
        }
    }
}

struct ChannelMember: Codable, Identifiable {
    let id: String
    let username: String
    let displayName: String
    let status: String
    let avatarPath: String?
    let lastReadAt: String?

    enum CodingKeys: String, CodingKey {
        case id, username, status
        case displayName = "display_name"
        case avatarPath = "avatar_path"
        case lastReadAt = "last_read_at"
    }
}
