using System.Text.Json.Serialization;

namespace AgoraWindows.Models;

public class Message
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("channel_id")]
    public string ChannelId { get; set; } = "";

    [JsonPropertyName("user_id")]
    public string UserId { get; set; } = "";

    [JsonPropertyName("sender_name")]
    public string SenderName { get; set; } = "";

    [JsonPropertyName("content")]
    public string Content { get; set; } = "";

    [JsonPropertyName("message_type")]
    public string MessageType { get; set; } = "text";

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";

    [JsonPropertyName("edited")]
    public bool Edited { get; set; }
}
