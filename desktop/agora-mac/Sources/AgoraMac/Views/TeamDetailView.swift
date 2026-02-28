import SwiftUI

struct TeamDetailView: View {
    @ObservedObject var appState: AppState
    @State private var selectedTab = 0

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(appState.selectedTeamForDetail?.name ?? "")
                        .font(.title2)
                        .fontWeight(.semibold)

                    Text("\(appState.teamDetailMembers.count) \(T("chat.members")) · \(appState.selectedTeamForDetail?.description ?? "")")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Button(action: { appState.leaveTeam() }) {
                    Text(T("teams.leave_team"))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.red)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.red.opacity(0.5), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)

            Divider()

            // Tab picker
            Picker("", selection: $selectedTab) {
                Text(T("teams.channels")).tag(0)
                Text(T("teams.members_tab")).tag(1)
                Text(T("teams.files")).tag(2)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)

            // Tab content
            switch selectedTab {
            case 0:
                TeamChannelsTabView(appState: appState)
            case 1:
                TeamMembersTabView(appState: appState)
            case 2:
                TeamFilesTabView(appState: appState)
            default:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

// MARK: - Channels Tab

struct TeamChannelsTabView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        if appState.teamDetailChannels.isEmpty {
            VStack {
                Spacer()
                Text(T("teams.no_channels"))
                    .foregroundColor(.secondary)
                    .font(.subheadline)
                Spacer()
            }
        } else {
            List(appState.teamDetailChannels) { channel in
                Button(action: {
                    appState.closeTeamDetail()
                    appState.selectChannel(channel)
                }) {
                    HStack(spacing: 10) {
                        Text("#")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.accentColor)
                            .frame(width: 24)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(channel.name)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.primary)

                            Text("\(channel.memberCount) \(T("chat.members"))")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Button(action: {
                            appState.toggleTeamChannelSubscription(channelId: channel.id)
                        }) {
                            Image(systemName: channel.isSubscribed ? "bell.fill" : "bell.slash")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(channel.isSubscribed ? .accentColor : .secondary)
                                .frame(width: 22, height: 22)
                        }
                        .buttonStyle(.plain)
                        .help(channel.isSubscribed ? T("teams.unsubscribe") : T("teams.subscribe"))

                        if channel.unreadCount > 0 {
                            Text("\(channel.unreadCount)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.accentColor)
                                .clipShape(Capsule())
                        }
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Members Tab

struct TeamMembersTabView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            // Search to add members
            HStack {
                TextField(T("teams.search_users"), text: Binding(
                    get: { appState.memberSearchQuery },
                    set: { newValue in
                        appState.memberSearchQuery = newValue
                        appState.searchUsersForTeam(query: newValue)
                    }
                ))
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }

            // Search results
            if !appState.memberSearchResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(appState.memberSearchResults, id: \.id) { user in
                        HStack {
                            Text(user.displayName)
                                .font(.system(size: 13))
                            Text("@\(user.username)")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                            Spacer()
                            Button(T("teams.add_member")) {
                                appState.addMemberToTeam(userId: user.id)
                            }
                            .font(.system(size: 12))
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)

                        Divider().padding(.leading, 16)
                    }
                }
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(8)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }

            // Members list
            if appState.teamDetailMembers.isEmpty {
                VStack {
                    Spacer()
                    Text(T("teams.no_members"))
                        .foregroundColor(.secondary)
                        .font(.subheadline)
                    Spacer()
                }
            } else {
                List(appState.teamDetailMembers) { member in
                    HStack(spacing: 10) {
                        // Avatar
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 32, height: 32)
                            .overlay(
                                Text(String(member.user.displayName.prefix(1).uppercased()))
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(.white)
                            )

                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.user.displayName)
                                .font(.system(size: 13, weight: .semibold))

                            Text("\(member.role) · \(member.user.email)")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        if member.role != "admin" {
                            Button(action: {
                                appState.removeMemberFromTeam(userId: member.user.id)
                            }) {
                                Image(systemName: "xmark")
                                    .font(.system(size: 11))
                                    .foregroundColor(.red)
                            }
                            .buttonStyle(.plain)
                            .help(T("teams.remove_member"))
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }
}

// MARK: - Files Tab

struct TeamFilesTabView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        if appState.teamDetailFiles.isEmpty {
            VStack {
                Spacer()
                Text(T("teams.no_files"))
                    .foregroundColor(.secondary)
                    .font(.subheadline)
                Spacer()
            }
        } else {
            List(appState.teamDetailFiles.indices, id: \.self) { index in
                let file = appState.teamDetailFiles[index]
                HStack(spacing: 10) {
                    Image(systemName: "doc")
                        .font(.system(size: 16))
                        .foregroundColor(.accentColor)
                        .frame(width: 24)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(file["filename"] as? String ?? "Unknown")
                            .font(.system(size: 13))
                            .lineLimit(1)

                        let size = file["file_size"] as? Int ?? 0
                        let sizeStr = size > 1_000_000
                            ? String(format: "%.1f MB", Double(size) / 1_000_000.0)
                            : String(format: "%.1f KB", Double(size) / 1_000.0)
                        let uploaded = file["uploaded_at"] as? String ?? ""
                        Text("\(sizeStr) · \(uploaded)")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }

                    Spacer()
                }
                .padding(.vertical, 4)
            }
        }
    }
}
