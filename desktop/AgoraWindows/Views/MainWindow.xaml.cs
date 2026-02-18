using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
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

    public MainWindow(ApiClient apiClient)
    {
        _api = apiClient;
        InitializeComponent();

        UserDisplayName.Text = _api.CurrentUser?.DisplayName ?? "Benutzer";
        UserStatus.Text = "Online";

        ChannelList.ItemsSource = _channels;
        MessageList.ItemsSource = _messages;

        Loaded += async (_, _) =>
        {
            await LoadChannelsAsync();
            await ConnectNotificationWsAsync();
        };
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
            MessageBox.Show($"Fehler beim Laden der Chats: {ex.Message}", "Fehler",
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
                var from = msg.TryGetProperty("display_name", out var dn) ? dn.GetString() : "Jemand";
                ShowToast("Eingehender Anruf", $"{from} ruft an...");
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
            MessageBox.Show($"Fehler beim Laden der Nachrichten: {ex.Message}", "Fehler",
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

        // Show toast notification if window is not focused or different channel
        if (!IsActive && message.SenderId != _api.CurrentUser?.Id)
        {
            ShowToast(
                $"{message.SenderName} in {_currentChannelName}",
                message.MessageType == "file"
                    ? "Datei gesendet"
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
        var displayName = msg.TryGetProperty("display_name", out var dn) ? dn.GetString() : "Jemand";
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
                    $"{displayName} hat reagiert",
                    $"{emoji} auf eine Nachricht"
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
            ? $"{names} tippt..."
            : $"{names} tippen...";
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
            MessageBox.Show($"Fehler beim Senden: {ex.Message}", "Fehler",
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

    private async void Window_Closing(object sender, System.ComponentModel.CancelEventArgs e)
    {
        _toastTimer?.Stop();
        foreach (var timer in _typingTimers.Values) timer.Stop();

        if (_chatWs != null)
        {
            await _chatWs.DisconnectAsync();
            _chatWs.Dispose();
        }
        await _notificationWs.DisconnectAsync();
        _notificationWs.Dispose();
        _api.Dispose();
    }
}
