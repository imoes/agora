using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading.Tasks;
using AgoraWindows.Models;

namespace AgoraWindows.Services;

public class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    private string? _token;
    private User? _currentUser;

    public string BaseUrl { get; }
    public string? Token => _token;
    public User? CurrentUser => _currentUser;

    public ApiClient(string baseUrl)
    {
        BaseUrl = baseUrl.TrimEnd('/');
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, _, _, _) => true,
        };
        _http = new HttpClient(handler)
        {
            BaseAddress = new Uri(BaseUrl),
            Timeout = TimeSpan.FromSeconds(30),
        };
    }

    public void SetToken(string token)
    {
        _token = token;
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);
    }

    // --- Auth ---

    public async Task<LoginResponse> LoginAsync(string username, string password)
    {
        var request = new LoginRequest { Username = username, Password = password };
        var response = await _http.PostAsJsonAsync("/api/auth/login", request);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadFromJsonAsync<LoginResponse>()
                     ?? throw new Exception("Invalid login response");
        _token = result.AccessToken;
        _currentUser = result.User;
        _http.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", _token);
        return result;
    }

    public async Task<User> GetProfileAsync()
    {
        var user = await _http.GetFromJsonAsync<User>("/api/auth/me")
                   ?? throw new Exception("Failed to load profile");
        _currentUser = user;
        return user;
    }

    public async Task<User> UpdateProfileAsync(string? displayName = null, string? email = null,
        string? language = null, string? password = null, string? currentPassword = null)
    {
        var body = new Dictionary<string, string?>();
        if (displayName != null) body["display_name"] = displayName;
        if (email != null) body["email"] = email;
        if (language != null) body["language"] = language;
        if (password != null) body["password"] = password;
        if (currentPassword != null) body["current_password"] = currentPassword;

        var response = await _http.PatchAsJsonAsync("/api/auth/me", body);
        response.EnsureSuccessStatusCode();
        var user = await response.Content.ReadFromJsonAsync<User>()
                   ?? throw new Exception("Failed to update profile");
        _currentUser = user;
        return user;
    }

    // --- Channels ---

    public async Task<List<Channel>> GetChannelsAsync()
    {
        return await _http.GetFromJsonAsync<List<Channel>>("/api/channels/")
               ?? new List<Channel>();
    }

    public async Task<Channel> CreateChannelAsync(string name, string channelType = "group",
        string? description = null, string? teamId = null, List<string>? memberIds = null)
    {
        var body = new Dictionary<string, object?> { ["name"] = name, ["channel_type"] = channelType };
        if (description != null) body["description"] = description;
        if (teamId != null) body["team_id"] = teamId;
        if (memberIds != null) body["member_ids"] = memberIds;

        var response = await _http.PostAsJsonAsync("/api/channels/", body);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<Channel>()
               ?? throw new Exception("Failed to create channel");
    }

    public async Task<Channel> CreateDirectChatAsync(string userId)
    {
        var response = await _http.PostAsJsonAsync("/api/channels/direct", new { user_id = userId });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<Channel>()
               ?? throw new Exception("Failed to create direct chat");
    }

    public async Task<List<ChannelMember>> GetChannelMembersAsync(string channelId)
    {
        return await _http.GetFromJsonAsync<List<ChannelMember>>($"/api/channels/{channelId}/members")
               ?? new List<ChannelMember>();
    }

    public async Task AddChannelMemberAsync(string channelId, string userId)
    {
        var response = await _http.PostAsync($"/api/channels/{channelId}/members/{userId}", null);
        response.EnsureSuccessStatusCode();
    }

    public async Task LeaveChannelAsync(string channelId)
    {
        var response = await _http.DeleteAsync($"/api/channels/{channelId}/members/me");
        response.EnsureSuccessStatusCode();
    }

    public async Task DeleteChannelAsync(string channelId)
    {
        var response = await _http.DeleteAsync($"/api/channels/{channelId}");
        response.EnsureSuccessStatusCode();
    }

    public async Task UpdateReadPositionAsync(string channelId, string lastReadMessageId)
    {
        var response = await _http.PutAsJsonAsync(
            $"/api/channels/{channelId}/read-position",
            new { last_read_message_id = lastReadMessageId });
        response.EnsureSuccessStatusCode();
    }

    // --- Messages ---

    public async Task<List<Message>> GetMessagesAsync(string channelId, int limit = 50, string? before = null)
    {
        var url = $"/api/channels/{channelId}/messages/?limit={limit}";
        if (before != null) url += $"&before={Uri.EscapeDataString(before)}";
        return await _http.GetFromJsonAsync<List<Message>>(url)
               ?? new List<Message>();
    }

    public async Task<Message> SendMessageAsync(string channelId, string content,
        string messageType = "text", string? replyToId = null, string? replyToContent = null,
        string? replyToSender = null, string? fileReferenceId = null)
    {
        var body = new Dictionary<string, object?> { ["content"] = content, ["message_type"] = messageType };
        if (replyToId != null) body["reply_to_id"] = replyToId;
        if (replyToContent != null) body["reply_to_content"] = replyToContent;
        if (replyToSender != null) body["reply_to_sender"] = replyToSender;
        if (fileReferenceId != null) body["file_reference_id"] = fileReferenceId;

        var response = await _http.PostAsJsonAsync($"/api/channels/{channelId}/messages/", body);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<Message>()
               ?? throw new Exception("Failed to send message");
    }

    public async Task<Message> EditMessageAsync(string channelId, string messageId, string content)
    {
        var response = await _http.PatchAsJsonAsync(
            $"/api/channels/{channelId}/messages/{messageId}",
            new { content });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<Message>()
               ?? throw new Exception("Failed to edit message");
    }

    public async Task DeleteMessageAsync(string channelId, string messageId)
    {
        var response = await _http.DeleteAsync($"/api/channels/{channelId}/messages/{messageId}");
        response.EnsureSuccessStatusCode();
    }

    public async Task AddReactionAsync(string channelId, string messageId, string emoji)
    {
        var response = await _http.PostAsJsonAsync(
            $"/api/channels/{channelId}/messages/{messageId}/reactions",
            new { emoji });
        response.EnsureSuccessStatusCode();
    }

    public async Task RemoveReactionAsync(string channelId, string messageId, string emoji)
    {
        var response = await _http.DeleteAsync(
            $"/api/channels/{channelId}/messages/{messageId}/reactions/{Uri.EscapeDataString(emoji)}");
        response.EnsureSuccessStatusCode();
    }

    // --- Teams ---

    public async Task<List<Team>> GetTeamsAsync()
    {
        return await _http.GetFromJsonAsync<List<Team>>("/api/teams/")
               ?? new List<Team>();
    }

    public async Task<List<Channel>> GetTeamChannelsAsync(string teamId)
    {
        return await _http.GetFromJsonAsync<List<Channel>>($"/api/channels/?team_id={teamId}")
               ?? new List<Channel>();
    }

    public async Task<Team> CreateTeamAsync(string name, string? description = null)
    {
        var response = await _http.PostAsJsonAsync("/api/teams/", new { name, description });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<Team>()
               ?? throw new Exception("Failed to create team");
    }

    public async Task<List<TeamMember>> GetTeamMembersAsync(string teamId)
    {
        return await _http.GetFromJsonAsync<List<TeamMember>>($"/api/teams/{teamId}/members")
               ?? new List<TeamMember>();
    }

    public async Task AddTeamMemberAsync(string teamId, string userId, string role = "member")
    {
        var response = await _http.PostAsJsonAsync(
            $"/api/teams/{teamId}/members",
            new { user_id = userId, role });
        response.EnsureSuccessStatusCode();
    }

    // --- Files ---

    public async Task<FileReference> UploadFileAsync(string channelId, Stream fileStream, string fileName)
    {
        using var content = new MultipartFormDataContent();
        content.Add(new StreamContent(fileStream), "file", fileName);
        content.Add(new StringContent(channelId), "channel_id");

        var response = await _http.PostAsync("/api/files/upload", content);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<FileReference>()
               ?? throw new Exception("Failed to upload file");
    }

    public async Task<byte[]> DownloadFileAsync(string fileRefId)
    {
        return await _http.GetByteArrayAsync($"/api/files/download/{fileRefId}");
    }

    public string GetFileInlineUrl(string fileRefId)
    {
        return $"{BaseUrl}/api/files/inline/{fileRefId}";
    }

    public async Task<List<FileReference>> GetChannelFilesAsync(string channelId)
    {
        return await _http.GetFromJsonAsync<List<FileReference>>($"/api/files/channel/{channelId}")
               ?? new List<FileReference>();
    }

    // --- Feed ---

    public async Task<FeedResponse> GetFeedAsync(int limit = 20, int offset = 0, bool unreadOnly = false)
    {
        var url = $"/api/feed/?limit={limit}&offset={offset}";
        if (unreadOnly) url += "&unread_only=true";
        return await _http.GetFromJsonAsync<FeedResponse>(url)
               ?? new FeedResponse();
    }

    public async Task<int> GetUnreadCountAsync()
    {
        var result = await _http.GetFromJsonAsync<Dictionary<string, int>>("/api/feed/unread-count");
        return result?.GetValueOrDefault("unread_count", 0) ?? 0;
    }

    public async Task MarkFeedReadAsync(List<string>? eventIds = null, string? channelId = null)
    {
        var body = new Dictionary<string, object?>();
        if (eventIds != null) body["event_ids"] = eventIds;
        if (channelId != null) body["channel_id"] = channelId;
        var response = await _http.PostAsJsonAsync("/api/feed/read", body);
        response.EnsureSuccessStatusCode();
    }

    // --- Calendar ---

    public async Task<List<System.Text.Json.JsonElement>> GetCalendarEventsAsync(string? start = null, string? end = null)
    {
        var query = "";
        if (start != null || end != null)
        {
            var parts = new List<string>();
            if (start != null) parts.Add($"start={Uri.EscapeDataString(start)}");
            if (end != null) parts.Add($"end={Uri.EscapeDataString(end)}");
            query = "?" + string.Join("&", parts);
        }
        return await _http.GetFromJsonAsync<List<System.Text.Json.JsonElement>>($"/api/calendar/events{query}")
               ?? new List<System.Text.Json.JsonElement>();
    }

    public async Task CreateCalendarEventAsync(object eventData)
    {
        var response = await _http.PostAsJsonAsync("/api/calendar/events", eventData);
        response.EnsureSuccessStatusCode();
    }

    public async Task<System.Text.Json.JsonElement?> GetCalendarIntegrationAsync()
    {
        try
        {
            var response = await _http.GetAsync("/api/calendar/integration");
            if (!response.IsSuccessStatusCode) return null;
            return await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        }
        catch { return null; }
    }

    public async Task SaveCalendarIntegrationAsync(object integrationData)
    {
        var response = await _http.PutAsJsonAsync("/api/calendar/integration", integrationData);
        response.EnsureSuccessStatusCode();
    }

    public async Task SyncCalendarAsync()
    {
        var response = await _http.PostAsync("/api/calendar/sync", null);
        response.EnsureSuccessStatusCode();
    }

    // --- Video ---

    public async Task<Dictionary<string, object>> CreateVideoRoomAsync(string channelId)
    {
        var response = await _http.PostAsync($"/api/video/rooms?channel_id={channelId}", null);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<Dictionary<string, object>>()
               ?? new Dictionary<string, object>();
    }

    // --- Users ---

    public async Task<List<User>> SearchUsersAsync(string query)
    {
        return await _http.GetFromJsonAsync<List<User>>($"/api/users/?search={Uri.EscapeDataString(query)}")
               ?? new List<User>();
    }

    public async Task<List<User>> GetAllUsersAsync()
    {
        return await _http.GetFromJsonAsync<List<User>>("/api/users/")
               ?? new List<User>();
    }

    public void Dispose()
    {
        _http.Dispose();
    }
}
