using System.Text.Json.Serialization;

namespace AgoraWindows.Models;

public class Team
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("avatar_path")]
    public string? AvatarPath { get; set; }

    [JsonPropertyName("owner_id")]
    public string OwnerId { get; set; } = "";

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = "";

    [JsonPropertyName("member_count")]
    public int MemberCount { get; set; }
}

public class TeamMember
{
    [JsonPropertyName("user")]
    public User? User { get; set; }

    [JsonPropertyName("role")]
    public string Role { get; set; } = "member";

    [JsonPropertyName("joined_at")]
    public string? JoinedAt { get; set; }
}
