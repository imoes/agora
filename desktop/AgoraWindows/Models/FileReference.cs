using System.Text.Json.Serialization;

namespace AgoraWindows.Models;

public class FileReference
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("file_id")]
    public string FileId { get; set; } = "";

    [JsonPropertyName("channel_id")]
    public string? ChannelId { get; set; }

    [JsonPropertyName("uploader_id")]
    public string UploaderId { get; set; } = "";

    [JsonPropertyName("original_filename")]
    public string OriginalFilename { get; set; } = "";

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";

    [JsonPropertyName("file")]
    public FileInfo? File { get; set; }
}

public class FileInfo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("md5_hash")]
    public string? Md5Hash { get; set; }

    [JsonPropertyName("file_size")]
    public long FileSize { get; set; }

    [JsonPropertyName("mime_type")]
    public string MimeType { get; set; } = "";

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";
}
