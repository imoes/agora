using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

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
    public CornerRadius BubbleCornerRadius { get; set; } = new CornerRadius(12, 12, 12, 2);

    [JsonIgnore]
    public Thickness BubbleMargin { get; set; } = new Thickness(0, 3, 60, 3);

    [JsonIgnore]
    public List<Views.ReactionGroup>? ReactionGroups { get; set; }

    [JsonIgnore]
    public bool HasReactions { get; set; }

    [JsonIgnore]
    public BitmapImage? ImageSource { get; set; }

    [JsonIgnore]
    public bool HasImage => ImageSource != null;

    /// <summary>
    /// Extract the actual filename from Content which may be in format:
    /// "filename.ext" or "Datei: filename.ext\nmime:image/jpeg\ncaption:text"
    /// </summary>
    public string GetFileName()
    {
        if (string.IsNullOrEmpty(Content)) return "";
        var firstLine = Content.Split('\n')[0].Trim();
        if (firstLine.StartsWith("Datei: ", System.StringComparison.OrdinalIgnoreCase))
            return firstLine.Substring(7).Trim();
        return firstLine;
    }

    /// <summary>
    /// Extract mime type from content if present (format: "\nmime:image/jpeg")
    /// </summary>
    public string? GetMimeType()
    {
        if (string.IsNullOrEmpty(Content)) return null;
        var match = Regex.Match(Content, @"\nmime:([^\n]+)");
        return match.Success ? match.Groups[1].Value.Trim() : null;
    }

    [JsonIgnore]
    public bool IsImageMessage
    {
        get
        {
            if (MessageType != "file" || string.IsNullOrEmpty(FileReferenceId)) return false;

            // Check mime type first
            var mime = GetMimeType();
            if (mime != null && mime.StartsWith("image/")) return true;

            // Fall back to extension check using extracted filename
            var fileName = GetFileName();
            var ext = System.IO.Path.GetExtension(fileName)?.ToLower();
            return ext is ".png" or ".jpg" or ".jpeg" or ".gif" or ".webp" or ".bmp" or ".svg";
        }
    }

    [JsonIgnore]
    public bool IsNonImageFile => MessageType == "file" && !IsImageMessage;

    /// <summary>
    /// Whether this message contains HTML/rich content that needs special rendering.
    /// </summary>
    [JsonIgnore]
    public bool IsRichMessage
    {
        get
        {
            if (MessageType == "rich") return true;
            if (MessageType != "text" || string.IsNullOrEmpty(Content)) return false;
            return Regex.IsMatch(Content,
                @"<(h[1-6]|p|div|br\s*/?>|strong|em|b|i|u|s|blockquote|pre|code|ul|ol|li|a)\b",
                RegexOptions.IgnoreCase);
        }
    }

    /// <summary>
    /// Whether this is a plain text message (not rich/HTML, not file).
    /// </summary>
    [JsonIgnore]
    public bool IsPlainTextMessage => !IsRichMessage;
}
