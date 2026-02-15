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

    // --- Teams ---

    public async Task<List<Dictionary<string, object>>> GetTeamsAsync()
    {
        return await _http.GetFromJsonAsync<List<Dictionary<string, object>>>("/api/teams/")
               ?? new List<Dictionary<string, object>>();
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
