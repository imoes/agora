using System;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using AgoraWindows.Models;
using AgoraWindows.Services;

namespace AgoraWindows.Views;

// Simple converter for unread badge visibility
public static class Converters
{
    public static readonly IValueConverter IntToVisibility = new IntToVisibilityConverter();

    private class IntToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is int n && n > 0 ? Visibility.Visible : Visibility.Collapsed;

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

    public MainWindow(ApiClient apiClient)
    {
        _api = apiClient;
        InitializeComponent();

        UserDisplayName.Text = _api.CurrentUser?.DisplayName ?? "Benutzer";
        UserStatus.Text = "Online";

        ChannelList.ItemsSource = _channels;
        MessageList.ItemsSource = _messages;

        Loaded += async (_, _) => await LoadChannelsAsync();
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

    private async void ChannelList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ChannelList.SelectedItem is not Channel channel) return;

        _currentChannelId = channel.Id;
        ChatTitle.Text = channel.Name;
        EmptyState.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Visible;

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
            if (type == "new_message" && msg.TryGetProperty("message", out var m))
            {
                var message = JsonSerializer.Deserialize<Message>(m.GetRawText());
                if (message != null)
                {
                    _messages.Add(message);
                    ScrollToBottom();
                }
            }
            else if (type == "channel_deleted")
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
        });
    }

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
