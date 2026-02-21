using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace AgoraWindows.Models;

public class FeedEvent
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("event_type")]
    public string EventType { get; set; } = "";

    [JsonPropertyName("channel_id")]
    public string? ChannelId { get; set; }

    [JsonPropertyName("channel_name")]
    public string? ChannelName { get; set; }

    [JsonPropertyName("actor_id")]
    public string? ActorId { get; set; }

    [JsonPropertyName("actor_name")]
    public string? ActorName { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("is_read")]
    public bool IsRead { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public bool IsReadInverted => !IsRead;

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
}

public class FeedResponse
{
    [JsonPropertyName("events")]
    public List<FeedEvent> Events { get; set; } = new();

    [JsonPropertyName("unread_count")]
    public int UnreadCount { get; set; }
}
