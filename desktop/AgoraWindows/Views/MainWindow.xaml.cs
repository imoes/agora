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
using System.Windows.Media.Imaging;
using System.Threading.Tasks;
using System.Windows.Threading;
using AgoraWindows.Models;
using AgoraWindows.Services;
using Microsoft.Win32;

namespace AgoraWindows.Views;

// Converters for XAML bindings
public static class Converters
{
    public static readonly IValueConverter IntToVisibility = new IntToVisibilityConverter();
    public static readonly IValueConverter StringToVisibility = new StringToVisibilityConverter();
    public static readonly IValueConverter BoolToVisibility = new BoolToVisibilityConverter();
    public static readonly IValueConverter FileTypeToVisibility = new FileTypeToVisibilityConverter();
    public static readonly IValueConverter FirstChar = new FirstCharConverter();
    public static readonly IValueConverter NullToVisibility = new NullToVisibilityConverter();

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

    private class BoolToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is true ? Visibility.Visible : Visibility.Collapsed;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    private class FileTypeToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is string s && s == "file" ? Visibility.Visible : Visibility.Collapsed;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    private class FirstCharConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is string s && s.Length > 0 ? s[0].ToString().ToUpper() : "?";

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    private class NullToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value != null ? Visibility.Visible : Visibility.Collapsed;

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

    // Navigation state
    private string _activeNav = "chat";

    // Reply state
    private string? _replyToId;
    private string? _replyToContent;
    private string? _replyToSender;

    // Context menu target message
    private string? _contextMessageId;

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

    // Feed
    private ObservableCollection<FeedEvent> _feedEvents = new();

    // Calendar
    private ObservableCollection<CalendarEventItem> _calendarEvents = new();

    // WYSIWYG editor
    private bool _editorInitialized = false;

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
        FeedList.ItemsSource = _feedEvents;
        FeedMainList.ItemsSource = _feedEvents;
        CalendarList.ItemsSource = _calendarEvents;

        InitLanguageComboBox();

        Loaded += async (_, _) =>
        {
            await LoadChannelsAsync();
            await LoadTeamsAsync();
            await ConnectNotificationWsAsync();
            StartReminderPolling();
            await DownloadNotificationSoundAsync();
            await InitializeEditorAsync();
        };
    }

    private void ApplyTranslations()
    {
        EmptyStateTitle.Text = Translations.T("welcome.title");
        EmptyStateSubtitle.Text = Translations.T("welcome.subtitle");
        SidebarHeader.Text = Translations.T("chat.chats");
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
        CtxReply.Content = Translations.T("ctx.reply");
        CtxEdit.Content = Translations.T("ctx.edit");
        CtxDelete.Content = Translations.T("ctx.delete");
    }

    // === WYSIWYG Editor ===

    private static readonly string QuillEditorHtml = @"<!DOCTYPE html>
<html><head><meta charset=""UTF-8"">
<link href=""https://cdn.quilljs.com/1.3.7/quill.snow.css"" rel=""stylesheet"">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', sans-serif; overflow: hidden; }
#toolbar { border: none !important; border-bottom: 1px solid #e0e0e0 !important; padding: 2px 4px !important; background: #fafafa; }
#editor { font-size: 13px; }
.ql-container { border: none !important; }
.ql-editor { min-height: 36px; max-height: 100px; overflow-y: auto; padding: 6px 8px; }
.ql-editor.ql-blank::before { font-style: italic; color: #999; }
.ql-toolbar .ql-formats { margin-right: 6px !important; }
.ql-snow .ql-picker-label { padding: 0 2px !important; }
.ql-snow .ql-stroke { stroke: #666 !important; }
.ql-snow .ql-fill { fill: #666 !important; }
.ql-snow .ql-picker { font-size: 12px !important; }
.ql-snow button { width: 24px !important; height: 24px !important; }
</style>
</head><body>
<div id=""toolbar"">
<span class=""ql-formats"">
<button class=""ql-bold""></button>
<button class=""ql-italic""></button>
<button class=""ql-underline""></button>
<button class=""ql-strike""></button>
</span>
<span class=""ql-formats"">
<select class=""ql-header""><option value=""1"">H1</option><option value=""2"">H2</option><option value=""3"">H3</option><option selected>Normal</option></select>
</span>
<span class=""ql-formats"">
<button class=""ql-list"" value=""ordered""></button>
<button class=""ql-list"" value=""bullet""></button>
</span>
<span class=""ql-formats"">
<button class=""ql-blockquote""></button>
<button class=""ql-code-block""></button>
</span>
<span class=""ql-formats"">
<button class=""ql-link""></button>
<button class=""ql-clean""></button>
</span>
</div>
<div id=""editor""></div>
<script src=""https://cdn.quilljs.com/1.3.7/quill.min.js""></script>
<script>
var quill = new Quill('#editor', {
  theme: 'snow',
  placeholder: 'Type a message...',
  modules: { toolbar: '#toolbar' }
});
quill.root.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
    var range = quill.getSelection();
    if (range) {
      var fmt = quill.getFormat(range);
      if (fmt.list || fmt['code-block']) return;
    }
    e.preventDefault();
    e.stopPropagation();
    var html = quill.root.innerHTML;
    var text = quill.getText().trim();
    if (text.length > 0) {
      window.chrome.webview.postMessage(JSON.stringify({ type: 'send', html: html, text: text }));
    }
  } else if (e.key === 'Escape') {
    window.chrome.webview.postMessage(JSON.stringify({ type: 'escape' }));
  } else {
    window.chrome.webview.postMessage(JSON.stringify({ type: 'typing' }));
  }
});
function getContent() {
  return JSON.stringify({ html: quill.root.innerHTML, text: quill.getText().trim() });
}
function clearContent() { quill.setContents([]); }
function setContent(html) { quill.clipboard.dangerouslyPasteHTML(html); }
function focusEditor() { quill.focus(); }
function insertText(text) {
  var range = quill.getSelection(true);
  quill.insertText(range.index, text);
}
</script>
</body></html>";

    private async Task InitializeEditorAsync()
    {
        try
        {
            var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(
                null, null,
                new Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions(
                    "--ignore-certificate-errors"));
            await EditorWebView.EnsureCoreWebView2Async(env);

            EditorWebView.CoreWebView2.WebMessageReceived += OnEditorMessage;
            EditorWebView.NavigateToString(QuillEditorHtml);

            _editorInitialized = true;
            RichEditorContainer.Visibility = Visibility.Visible;
            PlainEditorContainer.Visibility = Visibility.Collapsed;
        }
        catch
        {
            // Fall back to plain TextBox
            RichEditorContainer.Visibility = Visibility.Collapsed;
            PlainEditorContainer.Visibility = Visibility.Visible;
        }
    }

    private void OnEditorMessage(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = JsonSerializer.Deserialize<JsonElement>(e.WebMessageAsJson);
            var type = json.GetProperty("type").GetString();

            switch (type)
            {
                case "send":
                    var html = json.GetProperty("html").GetString() ?? "";
                    var text = json.GetProperty("text").GetString() ?? "";
                    _ = SendRichMessageAsync(html, text);
                    break;
                case "escape":
                    ClearReplyState();
                    break;
                case "typing":
                    SendTypingIndicator();
                    break;
            }
        }
        catch { }
    }

    private async void EditorSendButton_Click(object sender, RoutedEventArgs e)
    {
        if (!_editorInitialized) return;
        try
        {
            var result = await EditorWebView.ExecuteScriptAsync("getContent()");
            var unescaped = JsonSerializer.Deserialize<string>(result) ?? "";
            var json = JsonSerializer.Deserialize<JsonElement>(unescaped);
            var html = json.GetProperty("html").GetString() ?? "";
            var text = json.GetProperty("text").GetString() ?? "";
            if (!string.IsNullOrEmpty(text))
            {
                await SendRichMessageAsync(html, text);
            }
        }
        catch { }
    }

    private async Task SendRichMessageAsync(string html, string plainText)
    {
        if (string.IsNullOrEmpty(plainText) || _currentChannelId == null) return;

        // Clear editor
        if (_editorInitialized)
        {
            try { await EditorWebView.ExecuteScriptAsync("clearContent()"); } catch { }
        }

        // Determine if content is truly rich (has formatting) or just plain text
        var isRich = html != $"<p>{plainText}</p>" && html != $"<p>{System.Net.WebUtility.HtmlEncode(plainText)}</p>";
        var content = isRich ? html : plainText;
        var messageType = isRich ? "rich" : "text";

        try
        {
            // Check if we're editing
            if (MessageInput.Tag is string tag && tag.StartsWith("edit:"))
            {
                var messageId = tag[5..];
                MessageInput.Tag = null;
                await _api.EditMessageAsync(_currentChannelId, messageId, content);
                ClearReplyState();
                return;
            }

            if (_chatWs?.IsConnected == true)
            {
                var wsMsg = new Dictionary<string, object?>
                {
                    ["type"] = "message",
                    ["content"] = content,
                    ["message_type"] = messageType,
                };
                if (_replyToId != null)
                {
                    wsMsg["reply_to_id"] = _replyToId;
                    wsMsg["reply_to_content"] = _replyToContent;
                    wsMsg["reply_to_sender"] = _replyToSender;
                }
                await _chatWs.SendAsync(wsMsg);
            }
            else
            {
                var msg = await _api.SendMessageAsync(_currentChannelId, content,
                    messageType: messageType,
                    replyToId: _replyToId, replyToContent: _replyToContent,
                    replyToSender: _replyToSender);
                SetMessageBubbleProperties(msg);
                _messages.Add(msg);
                ScrollToBottom();
            }

            ClearReplyState();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("chat.error_sending")}: {ex.Message}", Translations.T("common.error"),
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    // === Navigation ===

    private void NavFeed_Click(object sender, RoutedEventArgs e)
    {
        _activeNav = "feed";
        SidebarHeader.Text = Translations.T("nav.feed");
        ChannelList.Visibility = Visibility.Collapsed;
        TeamList.Visibility = Visibility.Collapsed;
        TeamChannelsBorder.Visibility = Visibility.Collapsed;
        FeedList.Visibility = Visibility.Visible;
        CalendarList.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Visible;
        FeedTitle.Text = Translations.T("nav.feed");
        _ = LoadFeedAsync();
    }

    private void NavChat_Click(object sender, RoutedEventArgs e)
    {
        _activeNav = "chat";
        SidebarHeader.Text = Translations.T("chat.chats");
        ChannelList.Visibility = Visibility.Visible;
        TeamList.Visibility = Visibility.Collapsed;
        TeamChannelsBorder.Visibility = Visibility.Collapsed;
        FeedList.Visibility = Visibility.Collapsed;
        CalendarList.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Collapsed;
        if (_currentChannelId == null)
        {
            EmptyState.Visibility = Visibility.Visible;
            EmptyStateTitle.Text = Translations.T("welcome.title");
            EmptyStateSubtitle.Text = Translations.T("welcome.subtitle");
        }
    }

    private void NavTeams_Click(object sender, RoutedEventArgs e)
    {
        _activeNav = "teams";
        SidebarHeader.Text = Translations.T("teams.teams");
        ChannelList.Visibility = Visibility.Collapsed;
        TeamList.Visibility = Visibility.Visible;
        TeamChannelsBorder.Visibility = Visibility.Collapsed;
        FeedList.Visibility = Visibility.Collapsed;
        CalendarList.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Visible;
        EmptyStateTitle.Text = Translations.T("teams.teams");
        EmptyStateSubtitle.Text = Translations.T("teams.subtitle");
    }

    private void NavCalendar_Click(object sender, RoutedEventArgs e)
    {
        _activeNav = "calendar";
        SidebarHeader.Text = Translations.T("nav.calendar");
        ChannelList.Visibility = Visibility.Collapsed;
        TeamList.Visibility = Visibility.Collapsed;
        TeamChannelsBorder.Visibility = Visibility.Collapsed;
        FeedList.Visibility = Visibility.Collapsed;
        CalendarList.Visibility = Visibility.Visible;
        ChatView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Visible;
        EmptyStateTitle.Text = Translations.T("nav.calendar");
        EmptyStateSubtitle.Text = Translations.T("calendar.subtitle");
        _ = LoadCalendarAsync();
    }

    // === Feed ===

    private async System.Threading.Tasks.Task LoadFeedAsync()
    {
        try
        {
            var feed = await _api.GetFeedAsync(limit: 50);
            _feedEvents.Clear();
            if (feed.Events != null)
            {
                foreach (var ev in feed.Events)
                    _feedEvents.Add(ev);
            }
        }
        catch { }
    }

    private void FeedRefresh_Click(object sender, RoutedEventArgs e)
    {
        _ = LoadFeedAsync();
    }

    // === Calendar ===

    private async System.Threading.Tasks.Task LoadCalendarAsync()
    {
        try
        {
            var now = DateTime.UtcNow;
            var end = now.AddDays(30);
            var events = await _api.GetCalendarEventsAsync(now.ToString("o"), end.ToString("o"));
            _calendarEvents.Clear();
            foreach (var ev in events)
            {
                try
                {
                    var title = ev.GetProperty("title").GetString() ?? "";
                    var startTime = ev.GetProperty("start_time").GetString() ?? "";
                    var endTime = ev.TryGetProperty("end_time", out var et) ? et.GetString() : null;
                    var desc = ev.TryGetProperty("description", out var d) ? d.GetString() : null;
                    var allDay = ev.TryGetProperty("all_day", out var ad) && ad.GetBoolean();

                    var start = DateTime.Parse(startTime).ToLocalTime();
                    var timeRange = allDay ? "All day" : start.ToString("ddd dd MMM, HH:mm");
                    if (endTime != null)
                    {
                        var endDt = DateTime.Parse(endTime).ToLocalTime();
                        timeRange += " - " + endDt.ToString("HH:mm");
                    }

                    _calendarEvents.Add(new CalendarEventItem
                    {
                        Title = title,
                        TimeRange = timeRange,
                        Description = desc
                    });
                }
                catch { }
            }
        }
        catch { }
    }

    // === Channels ===

    private async System.Threading.Tasks.Task LoadChannelsAsync()
    {
        try
        {
            var channels = await _api.GetChannelsAsync();
            _channels.Clear();
            foreach (var ch in channels)
            {
                // Filter out team channels - they belong in the Teams view
                if (!string.IsNullOrEmpty(ch.TeamId) || ch.ChannelType == "team")
                    continue;
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
        TeamChannelList.SelectedIndex = -1;
        await OpenChannelAsync(channel);
    }

    private async System.Threading.Tasks.Task OpenChannelAsync(Channel channel)
    {
        _currentChannelId = channel.Id;
        _currentChannelName = channel.Name;
        ChatTitle.Text = channel.Name;
        ChatSubtitle.Text = $"{channel.MemberCount} {Translations.T("chat.members")}";
        EmptyState.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Visible;

        // Clear reply state
        ClearReplyState();

        // Clear typing state
        _typingUsers.Clear();
        UpdateTypingIndicator();

        // Disconnect old chat WebSocket
        if (_chatWs != null)
        {
            try { await _chatWs.DisconnectAsync(); } catch { }
            try { _chatWs.Dispose(); } catch { }
            _chatWs = null;
        }

        // Load messages
        try
        {
            var messages = await _api.GetMessagesAsync(channel.Id);
            _messages.Clear();

            // Set bubble colors based on sender
            foreach (var msg in messages)
            {
                SetMessageBubbleProperties(msg);
                _messages.Add(msg);
            }
            ScrollToBottom();
            _ = LoadMessageImagesAsync();
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

        // Focus editor
        if (_editorInitialized)
        {
            try { await EditorWebView.ExecuteScriptAsync("focusEditor()"); } catch { }
        }
        else
        {
            MessageInput.Focus();
        }
    }

    private void SetMessageBubbleProperties(Message msg)
    {
        var isOwn = msg.SenderId == _api.CurrentUser?.Id;
        msg.BubbleColor = isOwn
            ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E8E5FC"))
            : new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F0F0F0"));
        msg.BubbleAlignment = isOwn ? HorizontalAlignment.Right : HorizontalAlignment.Left;

        // Reaction groups
        if (msg.Reactions != null && msg.Reactions.Count > 0)
        {
            msg.ReactionGroups = msg.Reactions
                .GroupBy(r => r.Emoji)
                .Select(g => new ReactionGroup { Emoji = g.Key, Count = g.Count() })
                .ToList();
            msg.HasReactions = true;
        }
    }

    private async System.Threading.Tasks.Task LoadSingleMessageImageAsync(Message msg)
    {
        try
        {
            var bytes = await _api.DownloadFileAsync(msg.FileReferenceId!);
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = new MemoryStream(bytes);
            bitmap.DecodePixelWidth = 300;
            bitmap.EndInit();
            bitmap.Freeze();
            msg.ImageSource = bitmap;
            var idx = _messages.IndexOf(msg);
            if (idx >= 0) _messages[idx] = msg;
        }
        catch { }
    }

    private async System.Threading.Tasks.Task LoadMessageImagesAsync()
    {
        foreach (var msg in _messages.ToList())
        {
            if (msg.IsImageMessage && msg.ImageSource == null)
            {
                try
                {
                    var bytes = await _api.DownloadFileAsync(msg.FileReferenceId!);
                    var bitmap = new BitmapImage();
                    bitmap.BeginInit();
                    bitmap.CacheOption = BitmapCacheOption.OnLoad;
                    bitmap.StreamSource = new MemoryStream(bytes);
                    bitmap.DecodePixelWidth = 300;
                    bitmap.EndInit();
                    bitmap.Freeze();
                    msg.ImageSource = bitmap;
                    msg.HasReactions = msg.HasReactions; // force update
                    var idx = _messages.IndexOf(msg);
                    if (idx >= 0) _messages[idx] = msg; // refresh binding
                }
                catch { }
            }
        }
    }

    // === WebSocket message handlers ===

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

        SetMessageBubbleProperties(message);
        _messages.Add(message);
        ScrollToBottom();

        // Load image if applicable
        if (message.IsImageMessage)
            _ = LoadSingleMessageImageAsync(message);

        // Remove from typing
        if (!string.IsNullOrEmpty(message.SenderName))
        {
            _typingUsers.Remove(message.SenderName);
            UpdateTypingIndicator();
        }

        // Play notification sound for messages from others
        if (message.SenderId != _api.CurrentUser?.Id)
        {
            PlayNotificationSound();
        }

        // Show toast if window is not focused
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

            // Update groups
            existing.ReactionGroups = existing.Reactions
                .GroupBy(r => r.Emoji)
                .Select(g => new ReactionGroup { Emoji = g.Key, Count = g.Count() })
                .ToList();
            existing.HasReactions = existing.ReactionGroups.Count > 0;

            var idx = _messages.IndexOf(existing);
            _messages[idx] = existing;

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

    // === Message context menu ===

    private void Message_RightClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement fe && fe.Tag is string messageId)
        {
            _contextMessageId = messageId;
            var message = _messages.FirstOrDefault(m => m.Id == messageId);

            // Show/hide edit and delete based on ownership
            var isOwn = message?.SenderId == _api.CurrentUser?.Id;
            CtxEdit.Visibility = isOwn ? Visibility.Visible : Visibility.Collapsed;
            CtxDelete.Visibility = isOwn ? Visibility.Visible : Visibility.Collapsed;

            MessageContextMenu.IsOpen = true;
        }
    }

    private void CtxReply_Click(object sender, RoutedEventArgs e)
    {
        MessageContextMenu.IsOpen = false;
        var message = _messages.FirstOrDefault(m => m.Id == _contextMessageId);
        if (message == null) return;

        _replyToId = message.Id;
        _replyToContent = message.Content.Length > 80 ? message.Content[..80] + "..." : message.Content;
        _replyToSender = message.SenderName;

        ReplyToName.Text = message.SenderName;
        ReplyToPreview.Text = _replyToContent;
        ReplyBar.Visibility = Visibility.Visible;

        if (_editorInitialized)
        {
            try { _ = EditorWebView.ExecuteScriptAsync("focusEditor()"); } catch { }
        }
        else
        {
            MessageInput.Focus();
        }
    }

    private void CtxEdit_Click(object sender, RoutedEventArgs e)
    {
        MessageContextMenu.IsOpen = false;
        var message = _messages.FirstOrDefault(m => m.Id == _contextMessageId);
        if (message == null || _currentChannelId == null) return;

        if (_editorInitialized)
        {
            // Load content into rich editor
            var escaped = message.Content.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\n", "\\n");
            _ = EditorWebView.ExecuteScriptAsync($"setContent('{escaped}')");
            _ = EditorWebView.ExecuteScriptAsync("focusEditor()");
        }
        else
        {
            MessageInput.Text = message.Content;
            MessageInput.Focus();
        }
        MessageInput.Tag = $"edit:{message.Id}";
    }

    private async void CtxDelete_Click(object sender, RoutedEventArgs e)
    {
        MessageContextMenu.IsOpen = false;
        if (_contextMessageId == null || _currentChannelId == null) return;

        var result = MessageBox.Show(Translations.T("ctx.delete_confirm"),
            Translations.T("ctx.delete"), MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (result != MessageBoxResult.Yes) return;

        try
        {
            await _api.DeleteMessageAsync(_currentChannelId, _contextMessageId);
            var toRemove = _messages.FirstOrDefault(m => m.Id == _contextMessageId);
            if (toRemove != null) _messages.Remove(toRemove);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("common.error")}: {ex.Message}");
        }
    }

    private async void CtxReaction_Click(object sender, RoutedEventArgs e)
    {
        MessageContextMenu.IsOpen = false;
        if (sender is not Button btn || _contextMessageId == null || _currentChannelId == null) return;

        var emoji = btn.Tag?.ToString();
        if (emoji == null) return;

        try
        {
            await _api.AddReactionAsync(_currentChannelId, _contextMessageId, emoji);
        }
        catch { }
    }

    private async void Reaction_Click(object sender, MouseButtonEventArgs e)
    {
        // Toggle reaction on a message's existing reaction badge
        if (sender is not FrameworkElement fe || _currentChannelId == null) return;
        var emoji = fe.Tag?.ToString();
        if (emoji == null) return;

        // Find the message by walking up DataContext chain
        string? messageId = null;
        DependencyObject? parent = fe;
        while (parent != null)
        {
            if (parent is FrameworkElement pe && pe.DataContext is Message msg)
            {
                messageId = msg.Id;
                break;
            }
            parent = VisualTreeHelper.GetParent(parent);
        }

        if (messageId == null) return;

        try
        {
            var msg = _messages.FirstOrDefault(m => m.Id == messageId);
            if (msg?.Reactions != null &&
                msg.Reactions.Any(r => r.Emoji == emoji && r.UserId == _api.CurrentUser?.Id))
            {
                await _api.RemoveReactionAsync(_currentChannelId, messageId, emoji);
            }
            else
            {
                await _api.AddReactionAsync(_currentChannelId, messageId, emoji);
            }
        }
        catch { }
    }

    private void ReplyCancel_Click(object sender, RoutedEventArgs e)
    {
        ClearReplyState();
    }

    private void ClearReplyState()
    {
        _replyToId = null;
        _replyToContent = null;
        _replyToSender = null;
        ReplyBar.Visibility = Visibility.Collapsed;
    }

    // === File upload ===

    private async void FileUpload_Click(object sender, RoutedEventArgs e)
    {
        if (_currentChannelId == null) return;

        var dlg = new OpenFileDialog
        {
            Title = Translations.T("file.select"),
            Filter = "All Files|*.*"
        };

        if (dlg.ShowDialog() != true) return;

        try
        {
            using var stream = File.OpenRead(dlg.FileName);
            var fileRef = await _api.UploadFileAsync(_currentChannelId, stream, Path.GetFileName(dlg.FileName));

            // Send file message
            await _api.SendMessageAsync(
                _currentChannelId,
                Path.GetFileName(dlg.FileName),
                messageType: "file",
                fileReferenceId: fileRef.Id
            );
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("file.upload_error")}: {ex.Message}",
                Translations.T("common.error"), MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void FileAttachment_Click(object sender, MouseButtonEventArgs e)
    {
        if (sender is not FrameworkElement fe || fe.Tag is not string fileRefId) return;

        try
        {
            var data = await _api.DownloadFileAsync(fileRefId);

            var dlg = new SaveFileDialog
            {
                Title = Translations.T("file.save"),
                FileName = "download"
            };
            if (dlg.ShowDialog() == true)
            {
                await File.WriteAllBytesAsync(dlg.FileName, data);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("common.error")}: {ex.Message}");
        }
    }

    // === Video call ===

    private bool _webViewInitialized = false;

    private async Task InitializeVideoWebView()
    {
        if (_webViewInitialized) return;
        try
        {
            var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(
                null, null,
                new Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions(
                    "--ignore-certificate-errors"));
            await VideoWebView.EnsureCoreWebView2Async(env);
            _webViewInitialized = true;
        }
        catch { }
    }

    private async void VideoCall_Click(object sender, RoutedEventArgs e)
    {
        if (_currentChannelId == null) return;

        try
        {
            await _api.CreateVideoRoomAsync(_currentChannelId);
            var baseUrl = _api.BaseUrl.TrimEnd('/').Replace("/api", "");
            var url = $"{baseUrl}/video/{_currentChannelId}?token={Uri.EscapeDataString(_api.Token ?? "")}";

            await InitializeVideoWebView();

            if (_webViewInitialized)
            {
                VideoCallTitle.Text = $"Video - {ChatTitle.Text}";
                VideoCallLeaveBtn.Content = Services.Translations.T("reminder.dismiss");
                VideoWebView.CoreWebView2.Navigate(url);
                VideoCallView.Visibility = Visibility.Visible;
            }
            else
            {
                // Fallback: open in browser if WebView2 not available
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Services.Translations.T("common.error")}: {ex.Message}");
        }
    }

    private void VideoCallLeave_Click(object sender, RoutedEventArgs e)
    {
        VideoCallView.Visibility = Visibility.Collapsed;
        if (_webViewInitialized && VideoWebView.CoreWebView2 != null)
        {
            VideoWebView.CoreWebView2.Navigate("about:blank");
        }
    }

    // === Emoji picker ===

    private void EmojiButton_Click(object sender, RoutedEventArgs e)
    {
        EmojiPicker.PlacementTarget = sender as UIElement;
        EmojiPicker.IsOpen = true;
    }

    private void EmojiPick_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string emoji)
        {
            if (_editorInitialized)
            {
                var escaped = emoji.Replace("\\", "\\\\").Replace("'", "\\'");
                _ = EditorWebView.ExecuteScriptAsync($"insertText('{escaped}')");
            }
            else
            {
                MessageInput.Text += emoji;
                MessageInput.CaretIndex = MessageInput.Text.Length;
            }
        }
        EmojiPicker.IsOpen = false;

        if (_editorInitialized)
        {
            try { _ = EditorWebView.ExecuteScriptAsync("focusEditor()"); } catch { }
        }
        else
        {
            MessageInput.Focus();
        }
    }

    // === Toast notification ===

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

    // === Notification sound ===

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
        catch { }
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
        catch { }
    }

    // === Send message (plain TextBox fallback) ===

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
        else if (e.Key == Key.Escape)
        {
            ClearReplyState();
            MessageInput.Tag = null;
            MessageInput.Text = "";
        }
        else
        {
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
            // Check if we're editing
            if (MessageInput.Tag is string tag && tag.StartsWith("edit:"))
            {
                var messageId = tag[5..];
                MessageInput.Tag = null;
                await _api.EditMessageAsync(_currentChannelId, messageId, content);
                return;
            }

            // Send via WebSocket if connected, otherwise via REST
            if (_chatWs?.IsConnected == true)
            {
                var wsMsg = new Dictionary<string, object?>
                {
                    ["type"] = "message",
                    ["content"] = content,
                    ["message_type"] = "text",
                };
                if (_replyToId != null)
                {
                    wsMsg["reply_to_id"] = _replyToId;
                    wsMsg["reply_to_content"] = _replyToContent;
                    wsMsg["reply_to_sender"] = _replyToSender;
                }
                await _chatWs.SendAsync(wsMsg);
            }
            else
            {
                var msg = await _api.SendMessageAsync(_currentChannelId, content,
                    replyToId: _replyToId, replyToContent: _replyToContent,
                    replyToSender: _replyToSender);
                SetMessageBubbleProperties(msg);
                _messages.Add(msg);
                ScrollToBottom();
            }

            ClearReplyState();
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

    // === Event Reminder ===

    private void StartReminderPolling()
    {
        ReminderJoinBtn.Content = Translations.T("reminder.join");
        ReminderDismissBtn.Content = Translations.T("reminder.dismiss");

        _ = CheckEventRemindersAsync();

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
        catch { }
    }

    private void EvaluateReminders(List<JsonElement> events)
    {
        var now = DateTime.UtcNow;
        var fifteenMin = TimeSpan.FromMinutes(15);

        JsonElement? nearest = null;
        TimeSpan nearestDiff = TimeSpan.MaxValue;

        foreach (var ev in events)
        {
            var id = ev.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
            var allDay = ev.TryGetProperty("all_day", out var adProp) && adProp.ValueKind == JsonValueKind.True;
            if (allDay || id == null || _dismissedReminders.Contains(id)) continue;

            var startStr = ev.TryGetProperty("start_time", out var stProp) ? stProp.GetString() : null;
            if (startStr == null) continue;
            DateTime startTime = DateTime.Parse(startStr).ToUniversalTime();
            var diff = startTime - now;
            if (diff > TimeSpan.Zero && diff <= fifteenMin && diff < nearestDiff)
            {
                nearest = ev;
                nearestDiff = diff;
            }
        }

        if (nearest.HasValue)
        {
            var nv = nearest.Value;
            string id = nv.GetProperty("id").GetString()!;
            if (_reminderEventId != id)
            {
                _reminderEventId = id;
                _reminderChannelId = nv.TryGetProperty("channel_id", out var chProp) ? chProp.GetString() : null;
                _reminderStartTime = DateTime.Parse(nv.GetProperty("start_time").GetString()!).ToLocalTime();

                ReminderTitle.Text = nv.TryGetProperty("title", out var tProp) ? tProp.GetString() ?? "" : "";
                ReminderTime.Text = _reminderStartTime.ToString("HH:mm");

                ReminderJoinBtn.Visibility = _reminderChannelId != null
                    ? Visibility.Visible : Visibility.Collapsed;

                StartReminderTick();
                ReminderBorder.Visibility = Visibility.Visible;
            }
        }
        else if (_reminderEventId != null)
        {
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

    // === Settings ===

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
        var user = _api.CurrentUser;
        SettingsDisplayName.Text = user?.DisplayName ?? "";
        SettingsEmail.Text = user?.Email ?? "";
        SettingsCurrentPassword.Password = "";
        SettingsNewPassword.Password = "";
        SettingsStatus.Visibility = Visibility.Collapsed;

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
        FeedView.Visibility = Visibility.Collapsed;
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

    // === Window close ===

    private async void Window_Closing(object sender, System.ComponentModel.CancelEventArgs e)
    {
        _toastTimer?.Stop();
        _reminderPollTimer?.Stop();
        _reminderTickTimer?.Stop();
        foreach (var timer in _typingTimers.Values) timer.Stop();

        if (_chatWs != null)
        {
            try { await _chatWs.DisconnectAsync(); } catch { }
            try { _chatWs.Dispose(); } catch { }
        }
        try { await _notificationWs.DisconnectAsync(); } catch { }
        try { _notificationWs.Dispose(); } catch { }
        _notificationPlayer?.Close();
        _api.Dispose();
    }
}

// Helper classes for data binding
public class ReactionGroup
{
    public string Emoji { get; set; } = "";
    public int Count { get; set; }
}

public class CalendarEventItem
{
    public string Title { get; set; } = "";
    public string TimeRange { get; set; } = "";
    public string? Description { get; set; }
}
