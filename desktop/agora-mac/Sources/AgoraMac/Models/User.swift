import Foundation

struct User: Codable, Identifiable, Equatable {
    let id: String
    let username: String
    let email: String
    var displayName: String
    var status: String
    let isAdmin: Bool
    var language: String
    var notificationSoundPath: String?
    var avatarPath: String?

    enum CodingKeys: String, CodingKey {
        case id, username, email, status, language
        case displayName = "display_name"
        case isAdmin = "is_admin"
        case notificationSoundPath = "notification_sound_path"
        case avatarPath = "avatar_path"
    }

    static func == (lhs: User, rhs: User) -> Bool {
        lhs.id == rhs.id
    }
}

struct LoginResponse: Codable {
    let accessToken: String
    let user: User

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case user
    }
}

struct LoginRequest: Codable {
    let username: String
    let password: String
}

struct AuthConfig: Codable {
    let ldapEnabled: Bool
    let registrationEnabled: Bool

    enum CodingKeys: String, CodingKey {
        case ldapEnabled = "ldap_enabled"
        case registrationEnabled = "registration_enabled"
    }
}
