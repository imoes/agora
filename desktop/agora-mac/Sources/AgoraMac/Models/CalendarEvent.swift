import Foundation

struct CalendarEvent: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let description: String?
    let startTime: String
    let endTime: String
    let allDay: Bool
    let channelId: String?
    let createdBy: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description
        case startTime = "start_time"
        case endTime = "end_time"
        case allDay = "all_day"
        case channelId = "channel_id"
        case createdBy = "created_by"
    }

    static func == (lhs: CalendarEvent, rhs: CalendarEvent) -> Bool {
        lhs.id == rhs.id
    }

    var startDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: startTime) { return date }
        let fallback = ISO8601DateFormatter()
        return fallback.date(from: startTime)
    }

    func minutesUntilStart() -> Int? {
        guard let start = startDate else { return nil }
        let diff = start.timeIntervalSinceNow
        return Int(diff / 60)
    }

    func countdownString() -> String {
        guard let start = startDate else { return "" }
        let seconds = Int(start.timeIntervalSinceNow)
        if seconds <= 0 { return "00:00" }
        let mins = seconds / 60
        let secs = seconds % 60
        return String(format: "%02d:%02d", mins, secs)
    }
}
