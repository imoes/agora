import SwiftUI

struct ToastView: View {
    let data: ToastData

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(data.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)

                Text(data.body)
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.85))
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(12)
        .frame(width: 280)
        .background(Color(nsColor: NSColor(red: 0.196, green: 0.196, blue: 0.196, alpha: 0.95)))
        .cornerRadius(8)
        .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
    }
}
