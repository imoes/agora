using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Media;

namespace AgoraWindows.Models;

public class Reaction
{
    [JsonPropertyName("emoji")]
    public string Emoji { get; set; } = "";

    [JsonPropertyName("user_id")]
    public string UserId { get; set; } = "";

    [JsonPropertyName("display_name")]
    public string DisplayName { get; set; } = "";
}

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
    public List<Reaction>? Reactions { get; set; }

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
            var grouped = Reactions
                .GroupBy(r => r.Emoji)
                .Select(g => $"{g.Key} {g.Count()}");
            return string.Join("  ", grouped);
        }
    }

    [JsonIgnore]
    public string EditedIndicator => EditedAt != null ? $" {Services.Translations.T("chat.edited")}" : "";

    // UI binding properties
    [JsonIgnore]
    public Brush BubbleColor { get; set; } = new SolidColorBrush(Color.FromRgb(0xF0, 0xF0, 0xF0));

    [JsonIgnore]
    public HorizontalAlignment BubbleAlignment { get; set; } = HorizontalAlignment.Left;

    [JsonIgnore]
    public List<Views.ReactionGroup>? ReactionGroups { get; set; }

    [JsonIgnore]
    public bool HasReactions { get; set; }

    [JsonIgnore]
    public bool IsReadInverted => !true; // placeholder for feed events
}
