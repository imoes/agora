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

public partial class MainWindow : Window
{
    private readonly ApiClient _api;
    private readonly WebSocketClient _notificationWs = new();
    private WebSocketClient? _chatWs;
    private ObservableCollection<Channel> _channels = new();
    private ObservableCollection<Team> _teams = new();
    private ObservableCollection<Channel> _teamChannels = new();
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
        TeamList.ItemsSource = _teams;
        TeamChannelList.ItemsSource = _teamChannels;
        MessageList.ItemsSource = _messages;

        InitLanguageComboBox();

        Loaded += async (_, _) =>
        {
            await LoadChannelsAsync();
            await LoadTeamsAsync();
            await ConnectNotificationWsAsync();
            StartReminderPolling();
            await DownloadNotificationSoundAsync();
        };
    }

    private void ApplyTranslations()
    {
        EmptyStateTitle.Text = Translations.T("welcome.title");
        EmptyStateSubtitle.Text = Translations.T("welcome.subtitle");
        ChatsHeader.Text = Translations.T("chat.chats");
        TeamsHeader.Text = Translations.T("teams.teams");
        SendButton.Content = Translations.T("chat.send");
        MessageInput.ToolTip = Translations.T("chat.input_placeholder");
        SettingsTitle.Text = Translations.T("settings.title");
        SettingsDisplayNameLabel.Text = Translations.T("settings.display_name");
        SettingsEmailLabel.Text = Translations.T("settings.email");
        SettingsLanguageLabel.Text = Translations.T("settings.language");
        SettingsPasswordHeader.Text = Translations.T("settings.change_password");
        SettingsCurrentPasswordLabel.Text = Translations.T("settings.current_password");
        SettingsNewPasswordLabel.Text = Translations.T("settings.new_password");
        SettingsSaveBtn.Content = Translations.T("settings.save");
        SettingsCancelBtn.Content = Translations.T("settings.cancel");
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

    private async System.Threading.Tasks.Task LoadTeamsAsync()
    {
        try
        {
            var teams = await _api.GetTeamsAsync();
            _teams.Clear();
            foreach (var t in teams)
            {
                _teams.Add(t);
            }
        }
        catch
        {
            // Teams loading is optional
        }
    }

    private async void TeamList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TeamList.SelectedItem is not Team team) return;

        // Deselect channel list
        ChannelList.SelectedIndex = -1;

        TeamChannelsHeader.Text = team.Name;
        TeamChannelsBorder.Visibility = Visibility.Visible;

        try
        {
            var channels = await _api.GetTeamChannelsAsync(team.Id);
            _teamChannels.Clear();
            foreach (var ch in channels)
            {
                _teamChannels.Add(ch);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("teams.error_loading")}: {ex.Message}", Translations.T("common.error"),
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void TeamChannelList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TeamChannelList.SelectedItem is not Channel channel) return;

        // Deselect main channel list
        ChannelList.SelectedIndex = -1;

        await OpenChannelAsync(channel);
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

        // Deselect team channel list
        TeamChannelList.SelectedIndex = -1;

        await OpenChannelAsync(channel);
    }

    private async System.Threading.Tasks.Task OpenChannelAsync(Channel channel)
    {
        _currentChannelId = channel.Id;
        _currentChannelName = channel.Name;
        ChatTitle.Text = channel.Name;
        EmptyState.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
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
            existing.Reactions ??= new List<Reaction>();

            if (action == "add" && emoji != null && userId != null)
            {
                if (!existing.Reactions.Any(r => r.Emoji == emoji && r.UserId == userId))
                    existing.Reactions.Add(new Reaction { Emoji = emoji, UserId = userId, DisplayName = displayName ?? "?" });
            }
            else if (action == "remove" && emoji != null && userId != null)
            {
                existing.Reactions.RemoveAll(r => r.Emoji == emoji && r.UserId == userId);
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

    // --- Settings ---

    private static readonly string[] LanguageCodes =
    {
        "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
        "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt",
        "ro", "sk", "sl", "sv"
    };

    private static readonly Dictionary<string, string> LanguageNames = new()
    {
        ["bg"] = "Bulgarian", ["cs"] = "Czech", ["da"] = "Danish", ["de"] = "Deutsch",
        ["el"] = "Greek", ["en"] = "English", ["es"] = "Spanish", ["et"] = "Estonian",
        ["fi"] = "Finnish", ["fr"] = "French", ["ga"] = "Irish", ["hr"] = "Croatian",
        ["hu"] = "Hungarian", ["it"] = "Italian", ["lt"] = "Lithuanian", ["lv"] = "Latvian",
        ["mt"] = "Maltese", ["nl"] = "Dutch", ["pl"] = "Polish", ["pt"] = "Portuguese",
        ["ro"] = "Romanian", ["sk"] = "Slovak", ["sl"] = "Slovenian", ["sv"] = "Swedish"
    };

    private void InitLanguageComboBox()
    {
        foreach (var code in LanguageCodes)
        {
            SettingsLanguage.Items.Add(new ComboBoxItem
            {
                Content = LanguageNames.GetValueOrDefault(code, code),
                Tag = code
            });
        }
    }

    private void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        // Populate fields with current user data
        var user = _api.CurrentUser;
        SettingsDisplayName.Text = user?.DisplayName ?? "";
        SettingsEmail.Text = user?.Email ?? "";
        SettingsCurrentPassword.Password = "";
        SettingsNewPassword.Password = "";
        SettingsStatus.Visibility = Visibility.Collapsed;

        // Select current language
        var userLang = user?.Language ?? Translations.CurrentLang;
        for (int i = 0; i < SettingsLanguage.Items.Count; i++)
        {
            if (SettingsLanguage.Items[i] is ComboBoxItem item && (string)item.Tag == userLang)
            {
                SettingsLanguage.SelectedIndex = i;
                break;
            }
        }

        EmptyState.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Visible;
    }

    private async void SettingsSave_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            SettingsSaveBtn.IsEnabled = false;

            var displayName = SettingsDisplayName.Text.Trim();
            var email = SettingsEmail.Text.Trim();
            var lang = SettingsLanguage.SelectedItem is ComboBoxItem sel ? (string)sel.Tag : null;
            var currentPw = SettingsCurrentPassword.Password;
            var newPw = SettingsNewPassword.Password;

            string? password = null;
            string? currentPassword = null;
            if (!string.IsNullOrEmpty(newPw))
            {
                if (string.IsNullOrEmpty(currentPw))
                {
                    ShowSettingsStatus(Translations.T("settings.current_password_required"), true);
                    return;
                }
                password = newPw;
                currentPassword = currentPw;
            }

            var updatedUser = await _api.UpdateProfileAsync(
                displayName: string.IsNullOrEmpty(displayName) ? null : displayName,
                email: string.IsNullOrEmpty(email) ? null : email,
                language: lang,
                password: password,
                currentPassword: currentPassword
            );

            // Update UI
            UserDisplayName.Text = updatedUser.DisplayName;
            if (lang != null)
            {
                Translations.InitFromUser(lang);
                ApplyTranslations();
            }

            SettingsCurrentPassword.Password = "";
            SettingsNewPassword.Password = "";
            ShowSettingsStatus(Translations.T("settings.saved"), false);
        }
        catch (Exception ex)
        {
            ShowSettingsStatus($"{Translations.T("settings.error")}: {ex.Message}", true);
        }
        finally
        {
            SettingsSaveBtn.IsEnabled = true;
        }
    }

    private void SettingsCancel_Click(object sender, RoutedEventArgs e)
    {
        SettingsView.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Visible;
    }

    private void ShowSettingsStatus(string message, bool isError)
    {
        SettingsStatus.Text = message;
        SettingsStatus.Foreground = isError
            ? new SolidColorBrush(Colors.Red)
            : new SolidColorBrush((Color)ColorConverter.ConvertFromString("#4CAF50"));
        SettingsStatus.Visibility = Visibility.Visible;
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
