using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using AgoraWindows.Models;
using AgoraWindows.Services;

namespace AgoraWindows.Views;

// Converters for XAML bindings
public static class Converters
{
    public static readonly IValueConverter IntToVisibility = new IntToVisibilityConverter();
    public static readonly IValueConverter StringToVisibility = new StringToVisibilityConverter();

    private class IntToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is int n && n > 0 ? Visibility.Visible : Visibility.Collapsed;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    private class StringToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is string s && !string.IsNullOrEmpty(s) ? Visibility.Visible : Visibility.Collapsed;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }
}

// Alias for XAML namespace
using local = AgoraWindows.Views;

public partial class MainWindow : Window
{
    private readonly ApiClient _api;
    private readonly WebSocketClient _notificationWs = new();
    private WebSocketClient? _chatWs;
    private ObservableCollection<Channel> _channels = new();
    private ObservableCollection<Message> _messages = new();
    private string? _currentChannelId;
    private string? _currentChannelName;

    // Typing indicator
    private readonly Dictionary<string, DispatcherTimer> _typingTimers = new();
    private readonly HashSet<string> _typingUsers = new();
    private DispatcherTimer? _typingSendTimer;

    // Toast notification
    private DispatcherTimer? _toastTimer;

    // Notification sound
    private MediaPlayer? _notificationPlayer;
    private string? _notificationSoundPath;

    // Event reminder
    private DispatcherTimer? _reminderPollTimer;
    private DispatcherTimer? _reminderTickTimer;
    private string? _reminderEventId;
    private string? _reminderChannelId;
    private DateTime _reminderStartTime;
    private readonly HashSet<string> _dismissedReminders = new();

    public MainWindow(ApiClient apiClient)
    {
        _api = apiClient;
        InitializeComponent();

        UserDisplayName.Text = _api.CurrentUser?.DisplayName ?? Translations.T("common.user");
        UserStatus.Text = Translations.T("status.online");
        ApplyTranslations();

        ChannelList.ItemsSource = _channels;
        MessageList.ItemsSource = _messages;

        Loaded += async (_, _) =>
        {
            await LoadChannelsAsync();
            await ConnectNotificationWsAsync();
            StartReminderPolling();
            await DownloadNotificationSoundAsync();
        };
    }

    private void ApplyTranslations()
    {
        // These elements have hardcoded text in XAML, override at runtime
        EmptyStateTitle.Text = Translations.T("welcome.title");
        EmptyStateSubtitle.Text = Translations.T("welcome.subtitle");
        ChatsHeader.Text = Translations.T("chat.chats");
        SendButton.Content = Translations.T("chat.send");
        MessageInput.ToolTip = Translations.T("chat.input_placeholder");
    }

    private async System.Threading.Tasks.Task LoadChannelsAsync()
    {
        try
        {
            var channels = await _api.GetChannelsAsync();
            _channels.Clear();
            foreach (var ch in channels)
            {
                _channels.Add(ch);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("chat.error_loading_chats")}: {ex.Message}", Translations.T("common.error"),
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async System.Threading.Tasks.Task ConnectNotificationWsAsync()
    {
        try
        {
            var wsUrl = _api.BaseUrl
                .Replace("https://", "wss://")
                .Replace("http://", "ws://");
            wsUrl = wsUrl.Replace("/api", "") + "/ws/notifications";
            _notificationWs.OnMessage += OnNotificationMessage;
            await _notificationWs.ConnectAsync(wsUrl, _api.Token!);
        }
        catch
        {
            // Notification WS is optional
        }
    }

    private void OnNotificationMessage(JsonElement msg)
    {
        Dispatcher.Invoke(() =>
        {
            var type = msg.GetProperty("type").GetString();

            if (type == "video_call_invite")
            {
                var from = msg.TryGetProperty("display_name", out var dn) ? dn.GetString() : "?";
                ShowToast(Translations.T("notify.incoming_call"), $"{from} {Translations.T("notify.calling")}");
            }
        });
    }

    private async void ChannelList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ChannelList.SelectedItem is not Channel channel) return;

        _currentChannelId = channel.Id;
        _currentChannelName = channel.Name;
        ChatTitle.Text = channel.Name;
        EmptyState.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Visible;

        // Clear typing state
        _typingUsers.Clear();
        UpdateTypingIndicator();

        // Disconnect old chat WebSocket
        if (_chatWs != null)
        {
            await _chatWs.DisconnectAsync();
            _chatWs.Dispose();
        }

        // Load messages
        try
        {
            var messages = await _api.GetMessagesAsync(channel.Id);
            _messages.Clear();
            foreach (var msg in messages)
            {
                _messages.Add(msg);
            }
            ScrollToBottom();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("chat.error_loading_messages")}: {ex.Message}", Translations.T("common.error"),
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        // Connect WebSocket for real-time messages
        try
        {
            var wsUrl = _api.BaseUrl
                .Replace("https://", "wss://")
                .Replace("http://", "ws://");
            wsUrl = wsUrl.Replace("/api", "") + "/ws/" + channel.Id;

            _chatWs = new WebSocketClient();
            _chatWs.OnMessage += OnChatMessage;
            await _chatWs.ConnectAsync(wsUrl, _api.Token!);
        }
        catch
        {
            // WebSocket is optional - chat still works via REST
        }

        MessageInput.Focus();
    }

    private void OnChatMessage(JsonElement msg)
    {
        Dispatcher.Invoke(() =>
        {
            var type = msg.GetProperty("type").GetString();

            switch (type)
            {
                case "new_message":
                    HandleNewMessage(msg);
                    break;

                case "message_edited":
                    HandleMessageEdited(msg);
                    break;

                case "message_deleted":
                    HandleMessageDeleted(msg);
                    break;

                case "reaction_update":
                    HandleReactionUpdate(msg);
                    break;

                case "typing":
                    HandleTyping(msg);
                    break;

                case "channel_deleted":
                    HandleChannelDeleted(msg);
                    break;
            }
        });
    }

    private void HandleNewMessage(JsonElement msg)
    {
        if (!msg.TryGetProperty("message", out var m)) return;

        var message = JsonSerializer.Deserialize<Message>(m.GetRawText());
        if (message == null) return;

        _messages.Add(message);
        ScrollToBottom();

        // Remove from typing
        if (!string.IsNullOrEmpty(message.SenderName))
        {
            _typingUsers.Remove(message.SenderName);
            UpdateTypingIndicator();
        }

        // Play notification sound and show toast for messages from others
        if (message.SenderId != _api.CurrentUser?.Id)
        {
            PlayNotificationSound();
        }

        // Show toast notification if window is not focused or different channel
        if (!IsActive && message.SenderId != _api.CurrentUser?.Id)
        {
            ShowToast(
                $"{message.SenderName} in {_currentChannelName}",
                message.MessageType == "file"
                    ? Translations.T("chat.file_sent")
                    : message.Content.Length > 80
                        ? message.Content[..80] + "..."
                        : message.Content
            );
        }
    }

    private void HandleMessageEdited(JsonElement msg)
    {
        var messageId = msg.GetProperty("message_id").GetString();
        var content = msg.GetProperty("content").GetString();
        var editedAt = msg.TryGetProperty("edited_at", out var ea) ? ea.GetString() : null;

        var existing = _messages.FirstOrDefault(m => m.Id == messageId);
        if (existing != null)
        {
            var idx = _messages.IndexOf(existing);
            existing.Content = content ?? existing.Content;
            existing.EditedAt = editedAt;
            existing.Edited = true;
            // Force UI refresh
            _messages[idx] = existing;
        }
    }

    private void HandleMessageDeleted(JsonElement msg)
    {
        var messageId = msg.GetProperty("message_id").GetString();
        var toRemove = _messages.FirstOrDefault(m => m.Id == messageId);
        if (toRemove != null)
        {
            _messages.Remove(toRemove);
        }
    }

    private void HandleReactionUpdate(JsonElement msg)
    {
        var messageId = msg.GetProperty("message_id").GetString();
        var userId = msg.GetProperty("user_id").GetString();
        var displayName = msg.TryGetProperty("display_name", out var dn) ? dn.GetString() : "?";
        var emoji = msg.GetProperty("emoji").GetString();
        var action = msg.GetProperty("action").GetString();

        var existing = _messages.FirstOrDefault(m => m.Id == messageId);
        if (existing != null)
        {
            existing.Reactions ??= new Dictionary<string, List<string>>();

            if (action == "add" && emoji != null && userId != null)
            {
                if (!existing.Reactions.ContainsKey(emoji))
                    existing.Reactions[emoji] = new List<string>();
                if (!existing.Reactions[emoji].Contains(userId))
                    existing.Reactions[emoji].Add(userId);
            }
            else if (action == "remove" && emoji != null && userId != null)
            {
                if (existing.Reactions.ContainsKey(emoji))
                {
                    existing.Reactions[emoji].Remove(userId);
                    if (existing.Reactions[emoji].Count == 0)
                        existing.Reactions.Remove(emoji);
                }
            }

            // Force UI refresh
            var idx = _messages.IndexOf(existing);
            _messages[idx] = existing;

            // Show toast for reactions from others
            if (userId != _api.CurrentUser?.Id && action == "add")
            {
                ShowToast(
                    $"{displayName} {Translations.T("notify.reacted")}",
                    $"{emoji} {Translations.T("notify.reaction_body")}"
                );
            }
        }
    }

    private void HandleTyping(JsonElement msg)
    {
        var displayName = msg.TryGetProperty("display_name", out var dn) ? dn.GetString() : null;
        if (string.IsNullOrEmpty(displayName)) return;

        _typingUsers.Add(displayName);
        UpdateTypingIndicator();

        // Reset timer for this user
        if (_typingTimers.TryGetValue(displayName, out var existingTimer))
        {
            existingTimer.Stop();
        }

        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        timer.Tick += (_, _) =>
        {
            _typingUsers.Remove(displayName);
            UpdateTypingIndicator();
            timer.Stop();
            _typingTimers.Remove(displayName);
        };
        timer.Start();
        _typingTimers[displayName] = timer;
    }

    private void HandleChannelDeleted(JsonElement msg)
    {
        var channelId = msg.GetProperty("channel_id").GetString();
        var toRemove = _channels.FirstOrDefault(c => c.Id == channelId);
        if (toRemove != null)
        {
            _channels.Remove(toRemove);
            if (_currentChannelId == channelId)
            {
                _currentChannelId = null;
                EmptyState.Visibility = Visibility.Visible;
                ChatView.Visibility = Visibility.Collapsed;
                _messages.Clear();
            }
        }
    }

    private void UpdateTypingIndicator()
    {
        if (_typingUsers.Count == 0)
        {
            TypingBar.Visibility = Visibility.Collapsed;
            return;
        }

        TypingBar.Visibility = Visibility.Visible;
        var names = string.Join(", ", _typingUsers);
        TypingText.Text = _typingUsers.Count == 1
            ? $"{names} {Translations.T("chat.typing_one")}"
            : $"{names} {Translations.T("chat.typing_many")}";
    }

    // --- Toast notification (3 seconds) ---

    private void ShowToast(string title, string body)
    {
        ToastTitle.Text = title;
        ToastBody.Text = body;
        ToastBorder.Visibility = Visibility.Visible;

        _toastTimer?.Stop();
        _toastTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        _toastTimer.Tick += (_, _) =>
        {
            ToastBorder.Visibility = Visibility.Collapsed;
            _toastTimer.Stop();
        };
        _toastTimer.Start();
    }

    // --- Notification sound ---

    private async System.Threading.Tasks.Task DownloadNotificationSoundAsync()
    {
        try
        {
            var baseUrl = _api.BaseUrl.TrimEnd('/').Replace("/api", "");
            string soundUrl;
            if (!string.IsNullOrEmpty(_api.CurrentUser?.NotificationSoundPath))
                soundUrl = $"{baseUrl}{_api.CurrentUser.NotificationSoundPath}";
            else
                soundUrl = $"{baseUrl}/assets/sounds/star-trek-communicator.mp3";

            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback = (_, _, _, _) => true,
            };
            using var http = new HttpClient(handler);
            var data = await http.GetByteArrayAsync(soundUrl);

            _notificationSoundPath = Path.Combine(Path.GetTempPath(), "agora-notification.mp3");
            await File.WriteAllBytesAsync(_notificationSoundPath, data);
        }
        catch
        {
            // Sound download is optional
        }
    }

    private void PlayNotificationSound()
    {
        if (_notificationSoundPath == null || !File.Exists(_notificationSoundPath)) return;

        try
        {
            _notificationPlayer ??= new MediaPlayer();
            _notificationPlayer.Open(new Uri(_notificationSoundPath));
            _notificationPlayer.Position = TimeSpan.Zero;
            _notificationPlayer.Play();
        }
        catch
        {
            // Sound playback is optional
        }
    }

    // --- Send message ---

    private async void SendButton_Click(object sender, RoutedEventArgs e)
    {
        await SendMessageAsync();
    }

    private async void MessageInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            await SendMessageAsync();
            e.Handled = true;
        }
        else
        {
            // Send typing indicator (throttled)
            SendTypingIndicator();
        }
    }

    private void SendTypingIndicator()
    {
        if (_chatWs?.IsConnected != true || _currentChannelId == null) return;

        if (_typingSendTimer != null && _typingSendTimer.IsEnabled) return;

        _typingSendTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _typingSendTimer.Tick += (_, _) => _typingSendTimer.Stop();
        _typingSendTimer.Start();

        _ = _chatWs.SendAsync(new { type = "typing" });
    }

    private async System.Threading.Tasks.Task SendMessageAsync()
    {
        var content = MessageInput.Text.Trim();
        if (string.IsNullOrEmpty(content) || _currentChannelId == null) return;

        MessageInput.Text = "";

        try
        {
            // Send via WebSocket if connected, otherwise via REST
            if (_chatWs?.IsConnected == true)
            {
                await _chatWs.SendAsync(new
                {
                    type = "message",
                    content,
                    message_type = "text",
                });
            }
            else
            {
                var msg = await _api.SendMessageAsync(_currentChannelId, content);
                _messages.Add(msg);
                ScrollToBottom();
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("chat.error_sending")}: {ex.Message}", Translations.T("common.error"),
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void ScrollToBottom()
    {
        Dispatcher.BeginInvoke(new Action(() =>
        {
            MessageScroll.ScrollToEnd();
        }), System.Windows.Threading.DispatcherPriority.Loaded);
    }

    // --- Event Reminder ---

    private void StartReminderPolling()
    {
        // Apply translations to reminder buttons
        ReminderJoinBtn.Content = Translations.T("reminder.join");
        ReminderDismissBtn.Content = Translations.T("reminder.dismiss");

        // Check immediately
        _ = CheckEventRemindersAsync();

        // Poll every 60 seconds
        _reminderPollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
        _reminderPollTimer.Tick += async (_, _) => await CheckEventRemindersAsync();
        _reminderPollTimer.Start();
    }

    private async System.Threading.Tasks.Task CheckEventRemindersAsync()
    {
        try
        {
            var now = DateTime.UtcNow;
            var end = now.AddMinutes(16);
            var events = await _api.GetCalendarEventsAsync(now.ToString("o"), end.ToString("o"));
            EvaluateReminders(events);
        }
        catch { /* Calendar API might not be available */ }
    }

    private void EvaluateReminders(List<dynamic> events)
    {
        var now = DateTime.UtcNow;
        var fifteenMin = TimeSpan.FromMinutes(15);

        dynamic? nearest = null;
        TimeSpan nearestDiff = TimeSpan.MaxValue;

        foreach (var ev in events)
        {
            string? id = ev.id?.ToString();
            bool allDay = ev.all_day == true;
            if (allDay || id == null || _dismissedReminders.Contains(id)) continue;

            DateTime startTime = DateTime.Parse(ev.start_time.ToString()).ToUniversalTime();
            var diff = startTime - now;
            if (diff > TimeSpan.Zero && diff <= fifteenMin && diff < nearestDiff)
            {
                nearest = ev;
                nearestDiff = diff;
            }
        }

        if (nearest != null)
        {
            string id = nearest.id.ToString();
            if (_reminderEventId != id)
            {
                _reminderEventId = id;
                _reminderChannelId = nearest.channel_id?.ToString();
                _reminderStartTime = DateTime.Parse(nearest.start_time.ToString()).ToLocalTime();

                ReminderTitle.Text = nearest.title?.ToString() ?? "";
                ReminderTime.Text = _reminderStartTime.ToString("HH:mm");

                ReminderJoinBtn.Visibility = _reminderChannelId != null
                    ? Visibility.Visible : Visibility.Collapsed;

                StartReminderTick();
                ReminderBorder.Visibility = Visibility.Visible;
            }
        }
        else if (_reminderEventId != null)
        {
            // Check if current reminder event has passed
            if (DateTime.UtcNow >= _reminderStartTime.ToUniversalTime())
            {
                _dismissedReminders.Add(_reminderEventId);
                HideReminder();
            }
        }
    }

    private void StartReminderTick()
    {
        _reminderTickTimer?.Stop();
        _reminderTickTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _reminderTickTimer.Tick += (_, _) => UpdateReminderCountdown();
        _reminderTickTimer.Start();
        UpdateReminderCountdown();
    }

    private void UpdateReminderCountdown()
    {
        var diff = _reminderStartTime - DateTime.Now;
        if (diff <= TimeSpan.Zero)
        {
            ReminderCountdown.Text = $"{Translations.T("reminder.starts_in")} {Translations.T("reminder.now")}";
            _reminderTickTimer?.Stop();
            return;
        }
        int totalSec = (int)diff.TotalSeconds;
        int min = totalSec / 60;
        int sec = totalSec % 60;
        ReminderCountdown.Text = $"{Translations.T("reminder.starts_in")} {min}:{sec:D2}";
    }

    private void ReminderJoin_Click(object sender, RoutedEventArgs e)
    {
        if (_reminderEventId != null)
            _dismissedReminders.Add(_reminderEventId);
        HideReminder();

        // Open video room URL in browser
        if (_reminderChannelId != null)
        {
            var baseUrl = _api.BaseUrl.TrimEnd('/').Replace("/api", "");
            var url = $"{baseUrl}/video/{_reminderChannelId}";
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
        }
    }

    private void ReminderDismiss_Click(object sender, RoutedEventArgs e)
    {
        if (_reminderEventId != null)
            _dismissedReminders.Add(_reminderEventId);
        HideReminder();
    }

    private void HideReminder()
    {
        ReminderBorder.Visibility = Visibility.Collapsed;
        _reminderTickTimer?.Stop();
        _reminderEventId = null;
        _reminderChannelId = null;
    }

    private async void Window_Closing(object sender, System.ComponentModel.CancelEventArgs e)
    {
        _toastTimer?.Stop();
        _reminderPollTimer?.Stop();
        _reminderTickTimer?.Stop();
        foreach (var timer in _typingTimers.Values) timer.Stop();

        if (_chatWs != null)
        {
            await _chatWs.DisconnectAsync();
            _chatWs.Dispose();
        }
        await _notificationWs.DisconnectAsync();
        _notificationWs.Dispose();
        _notificationPlayer?.Close();
        _api.Dispose();
    }
}
