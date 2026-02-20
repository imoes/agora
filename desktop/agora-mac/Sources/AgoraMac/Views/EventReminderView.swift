import SwiftUI

struct EventReminderView: View {
    let event: CalendarEvent
    let countdown: String
    let onJoin: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            // Blue accent bar
            Rectangle()
                .fill(Color.accentColor)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "bell.fill")
                        .foregroundColor(.orange)
                        .font(.system(size: 14))

                    Text(event.title)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                }

                HStack(spacing: 8) {
                    if countdown == "00:00" {
                        Text(T("reminder.now"))
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.red)
                    } else {
                        Text("\(T("reminder.starts_in")) \(countdown)")
                            .font(.system(size: 13))
                            .foregroundColor(.secondary)
                            .monospacedDigit()
                    }
                }

                HStack(spacing: 8) {
                    if event.channelId != nil {
                        Button(action: onJoin) {
                            Text(T("reminder.join"))
                                .font(.system(size: 12, weight: .medium))
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }

                    Button(action: onDismiss) {
                        Text(T("reminder.dismiss"))
                            .font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            .padding(12)
        }
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
        .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
        .frame(width: 280)
    }
}
