using System.Text.Json.Serialization;

namespace AgoraWindows.Models;

public class Channel
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("channel_type")]
    public string ChannelType { get; set; } = "";

    [JsonPropertyName("member_count")]
    public int MemberCount { get; set; }

    [JsonPropertyName("unread_count")]
    public int UnreadCount { get; set; }

    [JsonPropertyName("last_activity_at")]
    public string? LastActivityAt { get; set; }
}
