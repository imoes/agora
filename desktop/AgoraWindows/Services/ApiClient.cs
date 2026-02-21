using System;
using System.Collections.Generic;
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
            // Accept self-signed certificates for development
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

    // --- Channels ---

    public async Task<List<Channel>> GetChannelsAsync()
    {
        return await _http.GetFromJsonAsync<List<Channel>>("/api/channels/")
               ?? new List<Channel>();
    }

    // --- Messages ---

    public async Task<List<Message>> GetMessagesAsync(string channelId, int limit = 50)
    {
        return await _http.GetFromJsonAsync<List<Message>>(
                   $"/api/channels/{channelId}/messages/?limit={limit}")
               ?? new List<Message>();
    }

    public async Task<Message> SendMessageAsync(string channelId, string content)
    {
        var body = new { content, message_type = "text" };
        var response = await _http.PostAsJsonAsync(
            $"/api/channels/{channelId}/messages/", body);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<Message>()
               ?? throw new Exception("Failed to send message");
    }

    // --- Calendar ---

    public async Task<List<dynamic>> GetCalendarEventsAsync(string? start = null, string? end = null)
    {
        var query = "";
        if (start != null || end != null)
        {
            var parts = new List<string>();
            if (start != null) parts.Add($"start={Uri.EscapeDataString(start)}");
            if (end != null) parts.Add($"end={Uri.EscapeDataString(end)}");
            query = "?" + string.Join("&", parts);
        }
        return await _http.GetFromJsonAsync<List<dynamic>>($"/api/calendar/events{query}")
               ?? new List<dynamic>();
    }

    // --- Teams ---

    public async Task<List<Team>> GetTeamsAsync()
    {
        return await _http.GetFromJsonAsync<List<Team>>("/api/teams/")
               ?? new List<Team>();
    }

    public async Task<List<Channel>> GetTeamChannelsAsync(string teamId)
    {
        return await _http.GetFromJsonAsync<List<Channel>>($"/api/teams/{teamId}/channels")
               ?? new List<Channel>();
    }

    // --- Profile ---

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

    // --- Users ---

    public async Task<List<User>> SearchUsersAsync(string query)
    {
        return await _http.GetFromJsonAsync<List<User>>($"/api/users/?search={Uri.EscapeDataString(query)}")
               ?? new List<User>();
    }

    public void Dispose()
    {
        _http.Dispose();
    }
}
