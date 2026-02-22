using System;
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

    [JsonPropertyName("sender_id")]
    public string? ActorId { get; set; }

    [JsonPropertyName("sender_name")]
    public string? ActorName { get; set; }

    [JsonPropertyName("preview_text")]
    public string? Message { get; set; }

    [JsonPropertyName("is_read")]
    public bool IsRead { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public bool IsReadInverted => !IsRead;

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";

    [JsonIgnore]
    public string FormattedTime
    {
        get
        {
            if (DateTime.TryParse(CreatedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
            {
                var diff = DateTime.UtcNow - dt.ToUniversalTime();
                if (diff.TotalMinutes < 1) return "Jetzt";
                if (diff.TotalMinutes < 60) return $"vor {(int)diff.TotalMinutes}m";
                if (diff.TotalHours < 24) return $"vor {(int)diff.TotalHours}h";
                if (diff.TotalDays < 7) return $"vor {(int)diff.TotalDays}d";
                return dt.ToLocalTime().ToString("dd.MM");
            }
            return CreatedAt;
        }
    }

    [JsonIgnore]
    public DateTime CreatedAtDateTime
    {
        get
        {
            if (DateTime.TryParse(CreatedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
                return dt.ToUniversalTime();
            return DateTime.MinValue;
        }
    }
}

public class FeedResponse
{
    [JsonPropertyName("events")]
    public List<FeedEvent> Events { get; set; } = new();

    [JsonPropertyName("unread_count")]
    public int UnreadCount { get; set; }
}
