import SwiftUI

struct LoginView: View {
    @ObservedObject var appState: AppState
    @State private var serverURL = "https://localhost"
    @State private var username = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage = ""

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 48))
                    .foregroundColor(.accentColor)

                Text("Agora")
                    .font(.system(size: 28, weight: .bold))

                Text(T("login.title"))
                    .font(.headline)
                    .foregroundColor(.secondary)
            }
            .padding(.top, 40)
            .padding(.bottom, 32)

            // Form
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(T("login.server_url"))
                        .font(.caption)
                        .foregroundColor(.secondary)
                    TextField("https://localhost", text: $serverURL)
                        .textFieldStyle(.roundedBorder)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(T("login.username"))
                        .font(.caption)
                        .foregroundColor(.secondary)
                    TextField(T("login.username"), text: $username)
                        .textFieldStyle(.roundedBorder)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(T("login.password"))
                        .font(.caption)
                        .foregroundColor(.secondary)
                    SecureField(T("login.password"), text: $password)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { login() }
                }

                if !errorMessage.isEmpty {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(action: login) {
                    if isLoading {
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                            Text(T("login.submitting"))
                        }
                    } else {
                        Text(T("login.submit"))
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
                .disabled(isLoading)
            }
            .padding(.horizontal, 40)

            Spacer()
        }
        .frame(width: 380, height: 480)
    }

    private func login() {
        let trimmedURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUser = username.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPass = password.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedURL.isEmpty, !trimmedUser.isEmpty, !trimmedPass.isEmpty else {
            errorMessage = T("login.fill_fields")
            return
        }

        isLoading = true
        errorMessage = ""

        let api = ApiClient(baseURL: trimmedURL)

        Task {
            do {
                let response = try await api.login(username: trimmedUser, password: trimmedPass)
                await MainActor.run {
                    Translations.shared.setLanguage(response.user.language)
                    appState.login(api: api, user: response.user)
                }
            } catch {
                await MainActor.run {
                    errorMessage = T("login.error")
                    isLoading = false
                }
            }
        }
    }
}
