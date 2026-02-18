using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace AgoraWindows.Models;

public class Message
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("channel_id")]
    public string ChannelId { get; set; } = "";

    [JsonPropertyName("sender_id")]
    public string SenderId { get; set; } = "";

    [JsonPropertyName("user_id")]
    public string UserId { get; set; } = "";

    [JsonPropertyName("sender_name")]
    public string SenderName { get; set; } = "";

    [JsonPropertyName("sender_avatar_path")]
    public string? SenderAvatarPath { get; set; }

    [JsonPropertyName("sender_status")]
    public string? SenderStatus { get; set; }

    [JsonPropertyName("content")]
    public string Content { get; set; } = "";

    [JsonPropertyName("message_type")]
    public string MessageType { get; set; } = "text";

    [JsonPropertyName("file_reference_id")]
    public string? FileReferenceId { get; set; }

    [JsonPropertyName("reply_to_id")]
    public string? ReplyToId { get; set; }

    [JsonPropertyName("reply_to_content")]
    public string? ReplyToContent { get; set; }

    [JsonPropertyName("reply_to_sender")]
    public string? ReplyToSender { get; set; }

    [JsonPropertyName("mentions")]
    public List<string>? Mentions { get; set; }

    [JsonPropertyName("reactions")]
    public Dictionary<string, List<string>>? Reactions { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";

    [JsonPropertyName("edited_at")]
    public string? EditedAt { get; set; }

    [JsonPropertyName("edited")]
    public bool Edited { get; set; }

    // Display helpers
    [JsonIgnore]
    public string DisplayReactions
    {
        get
        {
            if (Reactions == null || Reactions.Count == 0) return "";
            var parts = new List<string>();
            foreach (var (emoji, users) in Reactions)
            {
                parts.Add($"{emoji} {users.Count}");
            }
            return string.Join("  ", parts);
        }
    }

    [JsonIgnore]
    public string EditedIndicator => EditedAt != null ? $" {Services.Translations.T("chat.edited")}" : "";
}
