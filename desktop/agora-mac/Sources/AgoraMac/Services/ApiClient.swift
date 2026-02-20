import Foundation

class ApiClient {
    private var baseURL: String
    private var token: String?
    private let session: URLSession

    init(baseURL: String) {
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL

        // Accept self-signed certificates for development
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config, delegate: InsecureURLSessionDelegate(), delegateQueue: nil)
    }

    func setToken(_ token: String) {
        self.token = token
    }

    func getBaseURL() -> String {
        return baseURL
    }

    func getToken() -> String? {
        return token
    }

    // MARK: - Auth

    func login(username: String, password: String) async throws -> LoginResponse {
        let body = LoginRequest(username: username, password: password)
        let response: LoginResponse = try await post("/api/auth/login", body: body)
        self.token = response.accessToken
        return response
    }

    func getMe() async throws -> User {
        return try await get("/api/auth/me")
    }

    func getAuthConfig() async throws -> AuthConfig {
        return try await get("/api/auth/config")
    }

    // MARK: - Channels

    func getChannels() async throws -> [Channel] {
        return try await get("/api/channels/")
    }

    func getChannel(id: String) async throws -> Channel {
        return try await get("/api/channels/\(id)")
    }

    func getChannelMembers(channelId: String) async throws -> [ChannelMember] {
        return try await get("/api/channels/\(channelId)/members")
    }

    func createDirectChannel(userId: String) async throws -> Channel {
        let body = ["user_id": userId]
        return try await post("/api/channels/direct", body: body)
    }

    func updateReadPosition(channelId: String, messageId: String) async throws {
        let body = ["last_read_message_id": messageId]
        let _: EmptyResponse = try await put("/api/channels/\(channelId)/read-position", body: body)
    }

    // MARK: - Messages

    func getMessages(channelId: String, limit: Int = 50, before: String? = nil) async throws -> [Message] {
        var path = "/api/channels/\(channelId)/messages/?limit=\(limit)"
        if let before = before {
            path += "&before=\(before)"
        }
        return try await get(path)
    }

    func sendMessage(channelId: String, content: String, messageType: String = "text", replyToId: String? = nil) async throws -> Message {
        let body = SendMessageRequest(content: content, messageType: messageType, fileReferenceId: nil, replyToId: replyToId)
        return try await post("/api/channels/\(channelId)/messages/", body: body)
    }

    func editMessage(channelId: String, messageId: String, content: String) async throws -> Message {
        let body = ["content": content]
        return try await patch("/api/channels/\(channelId)/messages/\(messageId)", body: body)
    }

    func deleteMessage(channelId: String, messageId: String) async throws {
        try await delete("/api/channels/\(channelId)/messages/\(messageId)")
    }

    func addReaction(channelId: String, messageId: String, emoji: String) async throws {
        let body = ["emoji": emoji]
        let _: EmptyResponse = try await post("/api/channels/\(channelId)/messages/\(messageId)/reactions", body: body)
    }

    // MARK: - Calendar

    func getCalendarEvents(start: Date, end: Date) async throws -> [CalendarEvent] {
        let formatter = ISO8601DateFormatter()
        let startStr = formatter.string(from: start)
        let endStr = formatter.string(from: end)
        return try await get("/api/calendar/events?start=\(startStr)&end=\(endStr)")
    }

    // MARK: - Users

    func searchUsers(query: String) async throws -> [User] {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try await get("/api/users/?search=\(encoded)")
    }

    // MARK: - File Download

    func downloadFile(path: String) async throws -> Data {
        let url = URL(string: "\(baseURL)\(path)")!
        var request = URLRequest(url: url)
        if let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw ApiError.requestFailed(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return data
    }

    // MARK: - HTTP Methods

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let request = try buildRequest(path: path, method: "GET")
        return try await execute(request)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = try buildRequest(path: path, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await execute(request)
    }

    private func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = try buildRequest(path: path, method: "PUT")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await execute(request)
    }

    private func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = try buildRequest(path: path, method: "PATCH")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await execute(request)
    }

    private func delete(_ path: String) async throws {
        let request = try buildRequest(path: path, method: "DELETE")
        let (_, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw ApiError.requestFailed(statusCode: code)
        }
    }

    private func buildRequest(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw ApiError.invalidURL(path)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ApiError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw ApiError.httpError(statusCode: httpResponse.statusCode, body: body)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ApiError.decodingFailed(error.localizedDescription)
        }
    }
}

// MARK: - SSL Delegate

class InsecureURLSessionDelegate: NSObject, URLSessionDelegate {
    func urlSession(_ session: URLSession,
                    didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}

// MARK: - Error Types

enum ApiError: LocalizedError {
    case invalidURL(String)
    case invalidResponse
    case requestFailed(statusCode: Int)
    case httpError(statusCode: Int, body: String)
    case decodingFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let path):
            return "Invalid URL: \(path)"
        case .invalidResponse:
            return "Invalid response from server"
        case .requestFailed(let code):
            return "Request failed with status \(code)"
        case .httpError(let code, let body):
            return "HTTP \(code): \(body)"
        case .decodingFailed(let detail):
            return "Failed to decode response: \(detail)"
        }
    }
}

struct EmptyResponse: Decodable {}
