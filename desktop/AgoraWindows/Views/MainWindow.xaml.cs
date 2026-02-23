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
using System.Windows.Documents;
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
    public static readonly IValueConverter InverseBoolToVisibility = new InverseBoolToVisibilityConverter();
    public static readonly IValueConverter NameToAvatarColor = new NameToAvatarColorConverter();

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

    private class InverseBoolToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value is true ? Visibility.Collapsed : Visibility.Visible;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    private class NameToAvatarColorConverter : IValueConverter
    {
        private static readonly string[] AvatarPalette = {
            "#6264A7", "#C239B3", "#2B88D8", "#00A5AF", "#E74856",
            "#4A154B", "#0078D4", "#498205", "#CA5010", "#8764B8"
        };

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            var name = value as string ?? "";
            var hash = (uint)name.GetHashCode();
            var color = AvatarPalette[hash % AvatarPalette.Length];
            return new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => throw new NotImplementedException();
    }

    // Static helper for avatar colors (used in code-behind)
    private static readonly string[] _avatarPalette = {
        "#6264A7", "#C239B3", "#2B88D8", "#00A5AF", "#E74856",
        "#4A154B", "#0078D4", "#498205", "#CA5010", "#8764B8"
    };

    public static Brush GetAvatarBrush(string name)
    {
        var hash = (uint)(name ?? "").GetHashCode();
        var color = _avatarPalette[hash % _avatarPalette.Length];
        return new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
    }

    public static string GetAvatarInitial(string name)
    {
        if (string.IsNullOrEmpty(name)) return "?";
        return char.ToUpper(name[0]).ToString();
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
    private string? _currentChannelType;
    private List<ChannelMember>? _currentChannelMembers;

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
    private readonly Dictionary<string, string> _userStatuses = new(); // userId -> "online"/"offline"/"away"
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
        MessageList.ItemsSource = _messages;
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
            InitializeWeekGrid();
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
        NewChatBtnLabel.Text = Translations.T("chat.new_channel");
        NewTeamBtnLabel.Text = Translations.T("teams.new_team");
        CalendarNewEventBtn.Text = Translations.T("calendar.new_event");
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
        NewChatBtn.Visibility = Visibility.Collapsed;
        ChannelList.Visibility = Visibility.Collapsed;
        TeamsHeader.Visibility = Visibility.Collapsed;
        TeamTreeList.Visibility = Visibility.Collapsed;

        FeedSidebarInfo.Visibility = Visibility.Visible;
        CalendarList.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Collapsed;
        VideoCallView.Visibility = Visibility.Collapsed;
        CalendarView.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Visible;
        FeedTitle.Text = Translations.T("nav.feed");
        _ = LoadFeedAsync();
    }

    private void NavChat_Click(object sender, RoutedEventArgs e)
    {
        _activeNav = "chat";
        SidebarHeader.Text = Translations.T("chat.chats");
        NewChatBtn.Visibility = Visibility.Visible;
        ChannelList.Visibility = Visibility.Visible;
        TeamsHeader.Visibility = Visibility.Collapsed;
        TeamTreeList.Visibility = Visibility.Collapsed;

        FeedSidebarInfo.Visibility = Visibility.Collapsed;
        CalendarList.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Collapsed;
        CalendarView.Visibility = Visibility.Collapsed;
        VideoCallView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        if (_currentChannelId == null)
        {
            EmptyState.Visibility = Visibility.Visible;
            EmptyStateTitle.Text = Translations.T("welcome.title");
            EmptyStateSubtitle.Text = Translations.T("welcome.subtitle");
        }
        else
        {
            ChatView.Visibility = Visibility.Visible;
        }
    }

    private async void NavTeams_Click(object sender, RoutedEventArgs e)
    {
        _activeNav = "teams";
        SidebarHeader.Text = Translations.T("teams.teams");
        NewChatBtn.Visibility = Visibility.Collapsed;
        ChannelList.Visibility = Visibility.Collapsed;
        TeamsHeader.Visibility = Visibility.Visible;
        TeamTreeList.Visibility = Visibility.Visible;
        FeedSidebarInfo.Visibility = Visibility.Collapsed;
        CalendarList.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Collapsed;
        CalendarView.Visibility = Visibility.Collapsed;
        VideoCallView.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Visible;
        EmptyStateTitle.Text = Translations.T("teams.teams");
        EmptyStateSubtitle.Text = Translations.T("teams.subtitle");
        await LoadTeamsAsync();
    }

    private void NavCalendar_Click(object sender, RoutedEventArgs e)
    {
        _activeNav = "calendar";
        SidebarHeader.Text = Translations.T("nav.calendar");
        NewChatBtn.Visibility = Visibility.Collapsed;
        ChannelList.Visibility = Visibility.Collapsed;
        TeamsHeader.Visibility = Visibility.Collapsed;
        TeamTreeList.Visibility = Visibility.Collapsed;

        FeedSidebarInfo.Visibility = Visibility.Collapsed;
        CalendarList.Visibility = Visibility.Visible;
        ChatView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Collapsed;
        VideoCallView.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Collapsed;
        CalendarView.Visibility = Visibility.Visible;
        WpfCalendar.SelectedDate = DateTime.Today;
        _ = LoadCalendarAsync();
    }

    // === Feed ===

    private bool _feedUnreadOnly = false;
    private int _feedUnreadCount = 0;

    private async System.Threading.Tasks.Task LoadFeedAsync()
    {
        try
        {
            var feed = await _api.GetFeedAsync(limit: 50, unreadOnly: _feedUnreadOnly);
            _feedEvents.Clear();
            if (feed.Events != null)
            {
                var sorted = feed.Events.OrderByDescending(e => e.CreatedAtDateTime);
                foreach (var ev in sorted)
                    _feedEvents.Add(ev);
            }

            // Update sidebar info
            var unread = feed.UnreadCount;
            var total = _feedEvents.Count;
            FeedSidebarCount.Text = $"{total} Eintraege" + (unread > 0 ? $"\n{unread} ungelesen" : "");
            _feedUnreadCount = unread;
            UpdateNavBadges();
        }
        catch { }
    }

    private void FeedRefresh_Click(object sender, RoutedEventArgs e)
    {
        _ = LoadFeedAsync();
    }

    private void FeedFilterAll_Click(object sender, RoutedEventArgs e)
    {
        _feedUnreadOnly = false;
        _ = LoadFeedAsync();
    }

    private void FeedFilterUnread_Click(object sender, RoutedEventArgs e)
    {
        _feedUnreadOnly = true;
        _ = LoadFeedAsync();
    }

    private async void FeedItem_Click(object sender, MouseButtonEventArgs e)
    {
        if (sender is not FrameworkElement fe) return;
        var channelId = fe.Tag?.ToString();
        if (string.IsNullOrEmpty(channelId)) return;

        // Find the channel in existing list, or fetch it
        var channel = _channels.FirstOrDefault(c => c.Id == channelId);
        if (channel == null)
        {
            try
            {
                var channels = await _api.GetChannelsAsync();
                channel = channels.FirstOrDefault(c => c.Id == channelId);
            }
            catch { }
        }

        if (channel != null)
        {
            NavChat.IsChecked = true;
            _activeNav = "chat";
            SidebarHeader.Text = Translations.T("chat.chats");
            ChannelList.Visibility = Visibility.Visible;
            TeamTreeList.Visibility = Visibility.Collapsed;
    
            FeedSidebarInfo.Visibility = Visibility.Collapsed;
            CalendarList.Visibility = Visibility.Collapsed;
            FeedView.Visibility = Visibility.Collapsed;
            await OpenChannelAsync(channel);
        }
    }

    // === Calendar ===

    private List<CalendarEventItem> _allCalendarEvents = new();

    private async System.Threading.Tasks.Task LoadCalendarAsync()
    {
        try
        {
            // Fetch events for the displayed month
            var displayDate = WpfCalendar.DisplayDate;
            var monthStart = new DateTime(displayDate.Year, displayDate.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var monthEnd = monthStart.AddMonths(1);
            var events = await _api.GetCalendarEventsAsync(monthStart.ToString("o"), monthEnd.ToString("o"));

            _allCalendarEvents.Clear();
            _calendarEvents.Clear();

            foreach (var ev in events)
            {
                try
                {
                    var title = ev.GetProperty("title").GetString() ?? "";
                    var startTime = ev.GetProperty("start_time").GetString() ?? "";
                    var endTime = ev.TryGetProperty("end_time", out var et) ? et.GetString() : null;
                    var desc = ev.TryGetProperty("description", out var d) && d.ValueKind != JsonValueKind.Null ? d.GetString() : null;
                    var allDay = ev.TryGetProperty("all_day", out var ad) && ad.ValueKind == JsonValueKind.True && ad.GetBoolean();
                    var location = ev.TryGetProperty("location", out var loc) && loc.ValueKind != JsonValueKind.Null ? loc.GetString() : null;
                    var channelId = ev.TryGetProperty("channel_id", out var ch) && ch.ValueKind != JsonValueKind.Null ? ch.GetString() : null;

                    var start = DateTime.Parse(startTime).ToLocalTime();
                    var timeRange = allDay ? "Ganztaegig" : start.ToString("HH:mm");
                    if (!allDay && endTime != null)
                    {
                        var endDt = DateTime.Parse(endTime).ToLocalTime();
                        timeRange += " - " + endDt.ToString("HH:mm");
                    }

                    var item = new CalendarEventItem
                    {
                        Title = title,
                        TimeRange = timeRange,
                        Description = desc,
                        Location = location,
                        ChannelId = channelId,
                        StartDateTime = start,
                        AllDay = allDay
                    };

                    _allCalendarEvents.Add(item);
                    _calendarEvents.Add(item);
                }
                catch { }
            }

            // Update the day event list for the selected date
            UpdateCalendarDayEvents();
        }
        catch { }
    }

    private void UpdateCalendarDayEvents()
    {
        var selectedDate = WpfCalendar.SelectedDate ?? DateTime.Today;
        CalendarDayLabel.Text = selectedDate.ToString("dddd, dd. MMMM yyyy");

        var dayEvents = _allCalendarEvents
            .Where(e => e.StartDateTime.Date == selectedDate.Date)
            .OrderBy(e => e.AllDay ? 0 : 1)
            .ThenBy(e => e.StartDateTime)
            .ToList();

        CalendarDayEventList.ItemsSource = dayEvents;
        CalendarEmptyDay.Visibility = dayEvents.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void InitializeWeekGrid()
    {
        // Populate week day headers
        var now = DateTime.Now;
        var monday = now.AddDays(-(((int)now.DayOfWeek + 6) % 7));
        var lang = Translations.CurrentLang;
        var culture = lang == "de" ? new CultureInfo("de-DE") : CultureInfo.CurrentCulture;
        string[] shortDays = lang == "de" ? new[] { "Mo", "Di", "Mi", "Do", "Fr" }
                                          : new[] { "Mon", "Tue", "Wed", "Thu", "Fri" };

        TextBlock[] dayHeaders = { WeekDay1, WeekDay2, WeekDay3, WeekDay4, WeekDay5 };
        for (int d = 0; d < 5; d++)
        {
            var day = monday.AddDays(d);
            dayHeaders[d].Text = $"{shortDays[d]} {day.Day}";
            if (day.Date == now.Date)
                dayHeaders[d].Foreground = (Brush)FindResource("PrimaryBrush");
        }

        // Build time rows (07:00 - 19:00)
        for (int hour = 7; hour <= 19; hour++)
        {
            int row = hour - 7;
            WeekTimeGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(48) });

            // Time label
            var timeLbl = new TextBlock
            {
                Text = $"{hour:D2}:00",
                FontSize = 11,
                Foreground = (Brush)FindResource("TextSecondaryBrush"),
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 0, 8, 0)
            };
            Grid.SetColumn(timeLbl, 0);
            Grid.SetRow(timeLbl, row);
            WeekTimeGrid.Children.Add(timeLbl);

            // Day columns
            for (int d = 0; d < 5; d++)
            {
                var cell = new Border
                {
                    BorderBrush = (Brush)FindResource("BorderBrush"),
                    BorderThickness = new Thickness(0, 0, d < 4 ? 1 : 0, 1),
                    Background = Brushes.Transparent
                };
                // Highlight today's column
                var dayDate = monday.AddDays(d);
                if (dayDate.Date == now.Date)
                    cell.Background = new SolidColorBrush(Color.FromArgb(0x15, 0x62, 0x64, 0xA7));

                Grid.SetColumn(cell, d + 1);
                Grid.SetRow(cell, row);
                WeekTimeGrid.Children.Add(cell);
            }
        }
    }

    private void WpfCalendar_SelectedDatesChanged(object? sender, SelectionChangedEventArgs e)
    {
        UpdateCalendarDayEvents();
    }

    private void WpfCalendar_DisplayDateChanged(object? sender, CalendarDateChangedEventArgs e)
    {
        _ = LoadCalendarAsync();
    }

    private void CalendarRefresh_Click(object sender, RoutedEventArgs e)
    {
        _ = LoadCalendarAsync();
    }

    private void CalendarConfig_Click(object sender, RoutedEventArgs e)
    {
        // Navigate to settings view and scroll to calendar integration
        SettingsButton_Click(sender, e);
    }

    private async void CalendarEventJoin_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string channelId && !string.IsNullOrEmpty(channelId))
        {
            try
            {
                await _api.CreateVideoRoomAsync(channelId);
                var baseUrl = _api.BaseUrl.TrimEnd('/').Replace("/api", "");
                var url = $"{baseUrl}/video/{channelId}";
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { }
        }
    }

    // === New Event Creation ===

    private void CalendarNewEvent_Click(object sender, RoutedEventArgs e)
    {
        NewEventTitle.Text = "";
        NewEventDescription.Text = "";
        NewEventLocation.Text = "";
        NewEventAllDay.IsChecked = false;
        var selected = WpfCalendar.SelectedDate ?? DateTime.Today;
        NewEventStartDate.SelectedDate = selected;
        NewEventEndDate.SelectedDate = selected;
        NewEventStartTime.Text = "09:00";
        NewEventEndTime.Text = "10:00";
        NewEventStatus.Visibility = Visibility.Collapsed;
        NewEventOverlay.Visibility = Visibility.Visible;
    }

    private void NewEventCancel_Click(object sender, RoutedEventArgs e)
    {
        NewEventOverlay.Visibility = Visibility.Collapsed;
    }

    private void NewEventAllDay_Changed(object sender, RoutedEventArgs e)
    {
        var isAllDay = NewEventAllDay.IsChecked == true;
        NewEventStartTimePanel.Visibility = isAllDay ? Visibility.Collapsed : Visibility.Visible;
        NewEventEndTimePanel.Visibility = isAllDay ? Visibility.Collapsed : Visibility.Visible;
    }

    private async void NewEventSave_Click(object sender, RoutedEventArgs e)
    {
        var title = NewEventTitle.Text.Trim();
        if (string.IsNullOrEmpty(title))
        {
            NewEventStatus.Text = "Titel ist erforderlich";
            NewEventStatus.Visibility = Visibility.Visible;
            return;
        }

        var startDate = NewEventStartDate.SelectedDate ?? DateTime.Today;
        var endDate = NewEventEndDate.SelectedDate ?? startDate;
        var allDay = NewEventAllDay.IsChecked == true;

        DateTime startDt, endDt;
        if (allDay)
        {
            startDt = startDate.Date;
            endDt = endDate.Date.AddDays(1);
        }
        else
        {
            if (!TimeSpan.TryParse(NewEventStartTime.Text, out var startTimeSpan))
                startTimeSpan = new TimeSpan(9, 0, 0);
            if (!TimeSpan.TryParse(NewEventEndTime.Text, out var endTimeSpan))
                endTimeSpan = startTimeSpan.Add(TimeSpan.FromHours(1));
            startDt = startDate.Date + startTimeSpan;
            endDt = endDate.Date + endTimeSpan;
        }

        try
        {
            await _api.CreateCalendarEventAsync(new
            {
                title,
                description = string.IsNullOrEmpty(NewEventDescription.Text) ? (string?)null : NewEventDescription.Text,
                location = string.IsNullOrEmpty(NewEventLocation.Text) ? (string?)null : NewEventLocation.Text,
                start_time = startDt.ToUniversalTime().ToString("o"),
                end_time = endDt.ToUniversalTime().ToString("o"),
                all_day = allDay
            });

            NewEventOverlay.Visibility = Visibility.Collapsed;
            await LoadCalendarAsync();
        }
        catch (Exception ex)
        {
            NewEventStatus.Text = $"Fehler: {ex.Message}";
            NewEventStatus.Visibility = Visibility.Visible;
        }
    }

    // === Calendar Integration Settings ===

    private void CalendarProvider_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (CalDavSettings == null) return; // Not initialized yet
        var tag = (CalendarProvider.SelectedItem as ComboBoxItem)?.Tag?.ToString();
        CalDavSettings.Visibility = tag == "webdav" ? Visibility.Visible : Visibility.Collapsed;
        OutlookSettings.Visibility = tag == "outlook" ? Visibility.Visible : Visibility.Collapsed;
        GoogleSettings.Visibility = tag == "google" ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void CalendarIntegrationSave_Click(object sender, RoutedEventArgs e)
    {
        var provider = (CalendarProvider.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "internal";
        try
        {
            var body = new Dictionary<string, string?> { ["provider"] = provider };
            if (provider == "webdav")
            {
                body["webdav_url"] = CalDavUrl.Text;
                body["webdav_username"] = CalDavUsername.Text;
                body["webdav_password"] = CalDavPassword.Password;
            }
            else if (provider == "outlook")
            {
                body["outlook_server_url"] = OutlookServerUrl.Text;
                body["outlook_username"] = OutlookUsername.Text;
                body["outlook_password"] = OutlookPassword.Password;
            }

            await _api.SaveCalendarIntegrationAsync(body);
            CalendarIntegrationStatus.Text = "Gespeichert!";
            CalendarIntegrationStatus.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#4CAF50"));
            CalendarIntegrationStatus.Visibility = Visibility.Visible;
        }
        catch (Exception ex)
        {
            CalendarIntegrationStatus.Text = $"Fehler: {ex.Message}";
            CalendarIntegrationStatus.Foreground = new SolidColorBrush(Colors.Red);
            CalendarIntegrationStatus.Visibility = Visibility.Visible;
        }
    }

    private async System.Threading.Tasks.Task LoadCalendarIntegrationAsync()
    {
        try
        {
            var integration = await _api.GetCalendarIntegrationAsync();
            if (integration == null) return;
            var el = integration.Value;

            var provider = el.TryGetProperty("provider", out var p) ? p.GetString() : "internal";
            for (int i = 0; i < CalendarProvider.Items.Count; i++)
            {
                if (CalendarProvider.Items[i] is ComboBoxItem item && (string)item.Tag == provider)
                {
                    CalendarProvider.SelectedIndex = i;
                    break;
                }
            }

            if (el.TryGetProperty("webdav_url", out var wu) && wu.ValueKind == JsonValueKind.String)
                CalDavUrl.Text = wu.GetString() ?? "";
            if (el.TryGetProperty("webdav_username", out var wn) && wn.ValueKind == JsonValueKind.String)
                CalDavUsername.Text = wn.GetString() ?? "";
            if (el.TryGetProperty("outlook_server_url", out var ou) && ou.ValueKind == JsonValueKind.String)
                OutlookServerUrl.Text = ou.GetString() ?? "";
            if (el.TryGetProperty("outlook_username", out var on) && on.ValueKind == JsonValueKind.String)
                OutlookUsername.Text = on.GetString() ?? "";
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
            UpdateNavBadges();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"{Translations.T("chat.error_loading_chats")}: {ex.Message}", Translations.T("common.error"),
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void UpdateNavBadges()
    {
        // Feed badge
        if (_feedUnreadCount > 0)
        {
            NavFeedBadge.Text = _feedUnreadCount > 99 ? "99+" : _feedUnreadCount.ToString();
            NavFeedBadge.Visibility = Visibility.Visible;
        }
        else
        {
            NavFeedBadge.Visibility = Visibility.Collapsed;
        }

        // Chat badge: total unread across all non-team channels
        var chatUnread = _channels.Sum(c => c.UnreadCount);
        if (chatUnread > 0)
        {
            NavChatBadge.Text = chatUnread > 99 ? "99+" : chatUnread.ToString();
            NavChatBadge.Visibility = Visibility.Visible;
        }
        else
        {
            NavChatBadge.Visibility = Visibility.Collapsed;
        }
    }

    private void UpdateChatStatusIndicator()
    {
        if (_currentChannelMembers == null || _currentChannelType != "direct")
        {
            ChatStatusDot.Visibility = Visibility.Collapsed;
            return;
        }

        // For direct chats, show the OTHER user's status
        var otherMember = _currentChannelMembers
            .FirstOrDefault(m => m.User != null && m.User.Id != _api.CurrentUser?.Id);

        if (otherMember?.User == null)
        {
            ChatStatusDot.Visibility = Visibility.Collapsed;
            return;
        }

        var status = _userStatuses.GetValueOrDefault(otherMember.User.Id, otherMember.User.Status);
        ChatStatusDot.Visibility = Visibility.Visible;

        switch (status)
        {
            case "online":
                ChatStatusDot.Fill = new SolidColorBrush(Color.FromRgb(0x6B, 0xB7, 0x00)); // green
                ChatSubtitle.Text = Translations.T("status.online");
                break;
            case "away":
                ChatStatusDot.Fill = new SolidColorBrush(Color.FromRgb(0xFF, 0xAA, 0x44)); // orange
                ChatSubtitle.Text = Translations.T("status.away");
                break;
            default:
                ChatStatusDot.Fill = new SolidColorBrush(Color.FromRgb(0xBD, 0xBD, 0xBD)); // gray
                ChatSubtitle.Text = Translations.T("status.offline");
                break;
        }
    }

    private async System.Threading.Tasks.Task LoadTeamsAsync()
    {
        try
        {
            var teams = await _api.GetTeamsAsync();
            _teams.Clear();
            foreach (var t in teams)
                _teams.Add(t);
            await BuildTeamTreeAsync();
        }
        catch
        {
            // Teams loading is optional
        }
    }

    private async System.Threading.Tasks.Task BuildTeamTreeAsync()
    {
        TeamTreeList.Items.Clear();
        var totalTeamUnread = 0;

        foreach (var team in _teams)
        {
            var expander = new System.Windows.Controls.Expander
            {
                IsExpanded = true,
                Margin = new Thickness(0, 0, 0, 2),
            };

            // Team header
            var header = new DockPanel();
            var avatar = new Border
            {
                Width = 28, Height = 28, CornerRadius = new CornerRadius(4),
                Background = (Brush)FindResource("PrimaryBrush"),
                Margin = new Thickness(0, 0, 8, 0)
            };
            avatar.Child = new TextBlock
            {
                Text = team.Name.Length > 0 ? team.Name.Substring(0, 1).ToUpper() : "?",
                FontSize = 12, FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            header.Children.Add(avatar);

            var nameStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            nameStack.Children.Add(new TextBlock
            {
                Text = team.Name, FontSize = 13,
                Foreground = (Brush)FindResource("TextPrimaryBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis
            });
            nameStack.Children.Add(new TextBlock
            {
                Text = $"{team.MemberCount} {Translations.T("chat.members")}", FontSize = 11,
                Foreground = (Brush)FindResource("TextSecondaryBrush")
            });
            header.Children.Add(nameStack);

            var addChBtn = new Button
            {
                Content = new TextBlock { Text = "\uE710", FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = 10 },
                Background = Brushes.Transparent, BorderThickness = new Thickness(0),
                Padding = new Thickness(4, 2, 4, 2), Cursor = Cursors.Hand,
                ToolTip = Translations.T("teams.new_channel"),
                HorizontalAlignment = HorizontalAlignment.Right,
                Tag = team
            };
            addChBtn.Click += NewTeamChannel_Click;
            DockPanel.SetDock(addChBtn, Dock.Right);
            header.Children.Insert(0, addChBtn);

            expander.Header = header;

            // Channel list content - load immediately
            var channelStack = new StackPanel { Margin = new Thickness(16, 0, 0, 0) };
            try
            {
                var channels = await _api.GetTeamChannelsAsync(team.Id);
                foreach (var ch in channels)
                {
                    totalTeamUnread += ch.UnreadCount;

                    var chRow = new Border
                    {
                        Padding = new Thickness(10, 6, 10, 6),
                        Background = Brushes.Transparent,
                        CornerRadius = new CornerRadius(4),
                        Cursor = Cursors.Hand
                    };
                    var chPanel = new DockPanel();
                    var chNameBlock = new TextBlock { FontSize = 12, Foreground = (Brush)FindResource("TextPrimaryBrush") };
                    chNameBlock.Inlines.Add(new Run("# ") { Foreground = (Brush)FindResource("TextSecondaryBrush") });
                    chNameBlock.Inlines.Add(new Run(ch.Name));
                    chPanel.Children.Add(chNameBlock);

                    if (ch.UnreadCount > 0)
                    {
                        var badge = new TextBlock
                        {
                            Text = ch.UnreadCount.ToString(), FontSize = 10,
                            Foreground = Brushes.White,
                            Background = new SolidColorBrush(Color.FromRgb(0x62, 0x64, 0xA7)),
                            Padding = new Thickness(4, 1, 4, 1),
                            HorizontalAlignment = HorizontalAlignment.Right
                        };
                        DockPanel.SetDock(badge, Dock.Right);
                        chPanel.Children.Insert(0, badge);
                    }
                    chRow.Child = chPanel;

                    var channelCapture = ch;
                    chRow.MouseLeftButtonUp += async (_, _) =>
                    {
                        ChannelList.SelectedIndex = -1;
                        await OpenChannelAsync(channelCapture);
                    };
                    chRow.MouseEnter += (_, _) => chRow.Background = (Brush)FindResource("HoverBrush");
                    chRow.MouseLeave += (_, _) => chRow.Background = Brushes.Transparent;

                    channelStack.Children.Add(chRow);
                }
            }
            catch { }

            expander.Content = channelStack;
            TeamTreeList.Items.Add(expander);
        }

        // Update Teams nav badge
        if (totalTeamUnread > 0)
        {
            NavTeamsBadge.Text = totalTeamUnread > 99 ? "99+" : totalTeamUnread.ToString();
            NavTeamsBadge.Visibility = Visibility.Visible;
        }
        else
        {
            NavTeamsBadge.Visibility = Visibility.Collapsed;
        }
    }

    private async void NewTeamButton_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new System.Windows.Window
        {
            Title = Translations.T("teams.new_team"),
            Width = 360,
            Height = 220,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize
        };

        var stack = new StackPanel { Margin = new Thickness(16) };

        stack.Children.Add(new TextBlock { Text = Translations.T("teams.team_name"), Margin = new Thickness(0, 0, 0, 4) });
        var nameBox = new TextBox { Padding = new Thickness(8, 6, 8, 6) };
        stack.Children.Add(nameBox);

        stack.Children.Add(new TextBlock { Text = Translations.T("teams.description"), Margin = new Thickness(0, 12, 0, 4) });
        var descBox = new TextBox { Padding = new Thickness(8, 6, 8, 6) };
        stack.Children.Add(descBox);

        var btnPanel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
        var createBtn = new Button { Content = Translations.T("chat.create"), Padding = new Thickness(16, 6, 16, 6), IsDefault = true };
        var cancelBtn = new Button { Content = Translations.T("chat.cancel"), Padding = new Thickness(16, 6, 16, 6), Margin = new Thickness(8, 0, 0, 0), IsCancel = true };
        btnPanel.Children.Add(createBtn);
        btnPanel.Children.Add(cancelBtn);
        stack.Children.Add(btnPanel);

        createBtn.Click += (_, _) => { dialog.DialogResult = true; };
        cancelBtn.Click += (_, _) => { dialog.DialogResult = false; };

        dialog.Content = stack;

        if (dialog.ShowDialog() == true && !string.IsNullOrWhiteSpace(nameBox.Text))
        {
            try
            {
                var desc = string.IsNullOrWhiteSpace(descBox.Text) ? null : descBox.Text.Trim();
                await _api.CreateTeamAsync(nameBox.Text.Trim(), desc);
                // Reload teams tree
                await LoadTeamsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"{Translations.T("teams.error_loading")}: {ex.Message}",
                    Translations.T("common.error"), MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }

    private async void NewTeamChannel_Click(object sender, RoutedEventArgs e)
    {
        // Get team from button Tag (set when building the tree)
        if ((sender as FrameworkElement)?.Tag is not Team team) return;

        var dialog = new System.Windows.Window
        {
            Title = Translations.T("teams.new_channel"),
            Width = 360,
            Height = 220,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this,
            ResizeMode = ResizeMode.NoResize
        };

        var stack = new StackPanel { Margin = new Thickness(16) };

        stack.Children.Add(new TextBlock { Text = Translations.T("teams.channel_name"), Margin = new Thickness(0, 0, 0, 4) });
        var nameBox = new TextBox { Padding = new Thickness(8, 6, 8, 6) };
        stack.Children.Add(nameBox);

        stack.Children.Add(new TextBlock { Text = Translations.T("teams.description"), Margin = new Thickness(0, 12, 0, 4) });
        var descBox = new TextBox { Padding = new Thickness(8, 6, 8, 6) };
        stack.Children.Add(descBox);

        var btnPanel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0) };
        var createBtn = new Button { Content = Translations.T("chat.create"), Padding = new Thickness(16, 6, 16, 6), IsDefault = true };
        var cancelBtn = new Button { Content = Translations.T("chat.cancel"), Padding = new Thickness(16, 6, 16, 6), Margin = new Thickness(8, 0, 0, 0), IsCancel = true };
        btnPanel.Children.Add(createBtn);
        btnPanel.Children.Add(cancelBtn);
        stack.Children.Add(btnPanel);

        createBtn.Click += (_, _) => { dialog.DialogResult = true; };
        cancelBtn.Click += (_, _) => { dialog.DialogResult = false; };

        dialog.Content = stack;

        if (dialog.ShowDialog() == true && !string.IsNullOrWhiteSpace(nameBox.Text))
        {
            try
            {
                var desc = string.IsNullOrWhiteSpace(descBox.Text) ? null : descBox.Text.Trim();
                await _api.CreateChannelAsync(nameBox.Text.Trim(), "team", desc, team.Id);
                // Reload teams tree
                await LoadTeamsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"{Translations.T("teams.error_loading")}: {ex.Message}",
                    Translations.T("common.error"), MessageBoxButton.OK, MessageBoxImage.Warning);
            }
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
            else if (type == "status_change")
            {
                var userId = msg.TryGetProperty("user_id", out var uid) ? uid.GetString() : null;
                var status = msg.TryGetProperty("status", out var st) ? st.GetString() : "offline";
                if (userId != null)
                {
                    _userStatuses[userId] = status ?? "offline";
                    UpdateChatStatusIndicator();
                    // Update status dots on existing messages
                    for (int i = 0; i < _messages.Count; i++)
                    {
                        if (_messages[i].SenderId == userId)
                        {
                            _messages[i].SenderStatus = status ?? "offline";
                            var idx = i;
                            var m = _messages[idx];
                            _messages.RemoveAt(idx);
                            _messages.Insert(idx, m);
                        }
                    }
                }
            }
            else if (type == "team_member_added")
            {
                // User was added to a team – reload teams and channels
                _ = LoadTeamsAsync();
                _ = LoadChannelsAsync();
            }
        });
    }

    private async void ChannelList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ChannelList.SelectedItem is not Channel channel) return;
        await OpenChannelAsync(channel);
    }

    // === New Chat / User Search / Add Member / Leave Channel ===

    private async void NewChat_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Window
        {
            Title = Translations.T("chat.new_channel"),
            Width = 420, Height = 400,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this, ResizeMode = ResizeMode.NoResize
        };
        var stack = new StackPanel { Margin = new Thickness(16) };

        // Channel name
        stack.Children.Add(new TextBlock { Text = Translations.T("chat.channel_name"), Margin = new Thickness(0, 0, 0, 4) });
        var nameBox = new TextBox { Margin = new Thickness(0, 0, 0, 12) };
        stack.Children.Add(nameBox);

        stack.Children.Add(new Separator { Margin = new Thickness(0, 0, 0, 12) });

        // User search
        stack.Children.Add(new TextBlock { Text = Translations.T("chat.search_users"), Margin = new Thickness(0, 0, 0, 4) });
        var searchBox = new TextBox { Margin = new Thickness(0, 0, 0, 8) };
        stack.Children.Add(searchBox);

        var resultsList = new ListBox { Height = 150, Margin = new Thickness(0, 0, 0, 12) };
        stack.Children.Add(resultsList);

        var btnPanel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var cancelBtn = new Button { Content = Translations.T("chat.cancel"), Padding = new Thickness(16, 6, 16, 6), Margin = new Thickness(0, 0, 8, 0) };
        var createBtn = new Button { Content = Translations.T("chat.create"), Padding = new Thickness(16, 6, 16, 6),
            Background = (Brush)FindResource("PrimaryBrush"), Foreground = Brushes.White };
        btnPanel.Children.Add(cancelBtn);
        btnPanel.Children.Add(createBtn);
        stack.Children.Add(btnPanel);

        dlg.Content = stack;

        // Search users on text change
        searchBox.TextChanged += async (s, ev) =>
        {
            var query = searchBox.Text;
            if (query.Length < 2) { resultsList.Items.Clear(); return; }
            try
            {
                var users = await _api.SearchUsersAsync(query);
                resultsList.Items.Clear();
                resultsList.DisplayMemberPath = "DisplayLabel";
                foreach (var u in users)
                {
                    resultsList.Items.Add(new { u.Id, DisplayLabel = $"{u.DisplayName ?? u.Username} (@{u.Username})" });
                }
            }
            catch { }
        };

        cancelBtn.Click += (s, ev) => dlg.Close();
        createBtn.Click += async (s, ev) =>
        {
            // If user selected -> create direct chat
            if (resultsList.SelectedItem != null)
            {
                dynamic selected = resultsList.SelectedItem;
                try
                {
                    var ch = await _api.CreateDirectChatAsync(selected.Id);
                    await LoadChannelsAsync();
                    // Select the new channel
                    foreach (var c in _channels)
                    {
                        if (c.Id == ch.Id) { ChannelList.SelectedItem = c; break; }
                    }
                }
                catch (Exception ex) { MessageBox.Show(ex.Message); }
                dlg.Close();
                return;
            }

            // Create group channel
            var name = nameBox.Text.Trim();
            if (!string.IsNullOrEmpty(name))
            {
                try
                {
                    var ch = await _api.CreateChannelAsync(name, "group");
                    await LoadChannelsAsync();
                    foreach (var c in _channels)
                    {
                        if (c.Id == ch.Id) { ChannelList.SelectedItem = c; break; }
                    }
                }
                catch (Exception ex) { MessageBox.Show(ex.Message); }
            }
            dlg.Close();
        };

        dlg.ShowDialog();
    }

    private async void AddMember_Click(object sender, RoutedEventArgs e)
    {
        if (_currentChannelId == null) return;

        var dlg = new Window
        {
            Title = Translations.T("chat.add_member"),
            Width = 380, Height = 350,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this, ResizeMode = ResizeMode.NoResize
        };
        var stack = new StackPanel { Margin = new Thickness(16) };

        var searchBox = new TextBox { Margin = new Thickness(0, 0, 0, 8) };
        searchBox.SetValue(TextBox.TagProperty, Translations.T("chat.search_users"));
        stack.Children.Add(new TextBlock { Text = Translations.T("chat.search_users"), Margin = new Thickness(0, 0, 0, 4) });
        stack.Children.Add(searchBox);

        var resultsList = new ListBox { Height = 200, Margin = new Thickness(0, 0, 0, 8) };
        stack.Children.Add(resultsList);

        var btnPanel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        var addBtn = new Button { Content = Translations.T("chat.add_member_btn"), Padding = new Thickness(16, 6, 16, 6),
            Margin = new Thickness(0, 0, 8, 0), IsEnabled = false,
            Background = new SolidColorBrush(Color.FromRgb(0x9E, 0x9E, 0x9E)), Foreground = Brushes.White,
            BorderThickness = new Thickness(0) };
        var closeBtn = new Button { Content = Translations.T("chat.cancel"), Padding = new Thickness(16, 6, 16, 6),
            Background = new SolidColorBrush(Color.FromRgb(0x9E, 0x9E, 0x9E)), Foreground = Brushes.White,
            BorderThickness = new Thickness(0) };
        btnPanel.Children.Add(addBtn);
        btnPanel.Children.Add(closeBtn);
        stack.Children.Add(btnPanel);

        dlg.Content = stack;

        searchBox.TextChanged += async (s, ev) =>
        {
            var query = searchBox.Text;
            if (query.Length < 2) { resultsList.Items.Clear(); return; }
            try
            {
                var users = await _api.SearchUsersAsync(query);
                resultsList.Items.Clear();
                resultsList.DisplayMemberPath = "DisplayLabel";
                foreach (var u in users)
                    resultsList.Items.Add(new { u.Id, DisplayLabel = $"{u.DisplayName ?? u.Username} (@{u.Username})" });
            }
            catch { }
        };

        resultsList.SelectionChanged += (s, ev) =>
        {
            addBtn.IsEnabled = resultsList.SelectedItem != null;
            addBtn.Background = addBtn.IsEnabled
                ? new SolidColorBrush(Color.FromRgb(0x62, 0x64, 0xA7))
                : new SolidColorBrush(Color.FromRgb(0x9E, 0x9E, 0x9E));
        };

        // Helper to add selected member
        async System.Threading.Tasks.Task AddSelectedMember()
        {
            if (resultsList.SelectedItem == null) return;
            dynamic selected = resultsList.SelectedItem;
            try
            {
                await _api.AddChannelMemberAsync(_currentChannelId!, selected.Id);
                ShowToast(Translations.T("chat.add_member"), $"{selected.DisplayLabel}");
                resultsList.Items.Remove(resultsList.SelectedItem);
                addBtn.IsEnabled = false;
                addBtn.Background = new SolidColorBrush(Color.FromRgb(0x9E, 0x9E, 0x9E));
            }
            catch (HttpRequestException ex)
            {
                MessageBox.Show(
                    $"{Translations.T("chat.add_member")}: {ex.Message}",
                    Translations.T("common.error"),
                    MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        // Click add button
        addBtn.Click += async (s, ev) => await AddSelectedMember();

        // Double-click to add member
        resultsList.MouseDoubleClick += async (s, ev) => await AddSelectedMember();

        closeBtn.Click += (s, ev) => { dlg.Close(); };
        dlg.ShowDialog();
        await LoadChannelsAsync();
    }

    private async void LeaveChannel_Click(object sender, RoutedEventArgs e)
    {
        if (_currentChannelId == null) return;

        var result = MessageBox.Show(
            Translations.T("chat.leave_confirm"),
            Translations.T("chat.leave_channel"),
            MessageBoxButton.YesNo, MessageBoxImage.Question);

        if (result == MessageBoxResult.Yes)
        {
            try
            {
                await _api.LeaveChannelAsync(_currentChannelId);
                _currentChannelId = null;
                _currentChannelName = null;
                ChatView.Visibility = Visibility.Collapsed;
                EmptyState.Visibility = Visibility.Visible;
                await LoadChannelsAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, Translations.T("common.error"));
            }
        }
    }

    private async System.Threading.Tasks.Task OpenChannelAsync(Channel channel)
    {
        _currentChannelId = channel.Id;
        _currentChannelName = channel.Name;
        _currentChannelType = channel.ChannelType;
        ChatTitle.Text = channel.Name;
        ChatSubtitle.Text = $"{channel.MemberCount} {Translations.T("chat.members")}";

        // Load members and show status for direct chats
        try
        {
            _currentChannelMembers = await _api.GetChannelMembersAsync(channel.Id);
            foreach (var m in _currentChannelMembers)
            {
                if (m.User != null)
                    _userStatuses[m.User.Id] = m.User.Status;
            }
            UpdateChatStatusIndicator();
        }
        catch { _currentChannelMembers = null; }
        EmptyState.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        FeedView.Visibility = Visibility.Collapsed;
        CalendarView.Visibility = Visibility.Collapsed;
        VideoCallView.Visibility = Visibility.Collapsed;
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

        // Load messages and read position
        try
        {
            string? lastReadMessageId = null;
            try { lastReadMessageId = await _api.GetReadPositionAsync(channel.Id); } catch { }

            var messages = await _api.GetMessagesAsync(channel.Id);
            _messages.Clear();

            // Set Teams-style properties and add day separators
            var msgList = messages.ToList();
            foreach (var msg in msgList)
                SetMessageBubbleProperties(msg);
            InsertDaySeparators(msgList);
            InsertLastReadMarker(msgList, lastReadMessageId);
            foreach (var msg in msgList)
                _messages.Add(msg);
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

        // Mark channel as read
        try
        {
            if (_messages.Count > 0)
            {
                var lastMsg = _messages.Last();
                await _api.UpdateReadPositionAsync(channel.Id, lastMsg.Id);
            }
            await _api.MarkFeedReadAsync(channelId: channel.Id);

            // Update channel unread count locally
            channel.UnreadCount = 0;

            // Reload channels to update unread badges
            await LoadChannelsAsync();
        }
        catch { }

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
        // Teams-style: all messages left-aligned, transparent background
        msg.BubbleColor = Brushes.Transparent;
        msg.BubbleAlignment = HorizontalAlignment.Left;
        msg.BubbleCornerRadius = new CornerRadius(0);
        msg.BubbleMargin = new Thickness(0, 2, 0, 2);

        // Avatar properties
        msg.AvatarColor = Converters.GetAvatarBrush(msg.SenderName);
        msg.AvatarInitial = Converters.GetAvatarInitial(msg.SenderName);

        // Format time as HH:mm
        if (!string.IsNullOrEmpty(msg.CreatedAt))
        {
            if (DateTime.TryParse(msg.CreatedAt, null, DateTimeStyles.RoundtripKind, out var dt))
                msg.FormattedTime = dt.ToLocalTime().ToString("HH:mm");
        }

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

    private static string FormatDayLabel(DateTime date)
    {
        var now = DateTime.Now.Date;
        var lang = Translations.CurrentLang;

        if (date.Date == now)
            return lang == "de" ? "Heute" : "Today";
        if (date.Date == now.AddDays(-1))
            return lang == "de" ? "Gestern" : "Yesterday";

        return date.ToString("dddd, d. MMMM yyyy",
            lang == "de" ? new CultureInfo("de-DE") : CultureInfo.CurrentCulture);
    }

    private void InsertDaySeparators(List<Message> messages)
    {
        DateTime? lastDate = null;
        var toInsert = new List<(int index, Message separator)>();

        for (int i = 0; i < messages.Count; i++)
        {
            var msg = messages[i];
            if (msg.IsDaySeparator) continue;

            DateTime? msgDate = null;
            if (DateTime.TryParse(msg.CreatedAt, null, DateTimeStyles.RoundtripKind, out var dt))
                msgDate = dt.ToLocalTime().Date;

            if (msgDate.HasValue && msgDate != lastDate)
            {
                toInsert.Add((i, new Message
                {
                    IsDaySeparator = true,
                    DaySeparatorText = FormatDayLabel(msgDate.Value)
                }));
                lastDate = msgDate;
            }
        }

        // Insert in reverse order to maintain indices
        for (int i = toInsert.Count - 1; i >= 0; i--)
        {
            messages.Insert(toInsert[i].index + i, toInsert[i].separator);
        }
    }

    private void InsertLastReadMarker(List<Message> messages, string? lastReadMessageId)
    {
        if (string.IsNullOrEmpty(lastReadMessageId)) return;

        // Find the last-read message position
        int lastReadIndex = -1;
        for (int i = 0; i < messages.Count; i++)
        {
            if (messages[i].Id == lastReadMessageId)
            {
                lastReadIndex = i;
                break;
            }
        }

        // Only insert if there are newer messages after the last-read position
        if (lastReadIndex < 0 || lastReadIndex >= messages.Count - 1) return;

        // Check there's at least one real message after the marker position
        bool hasNewerMessages = false;
        for (int i = lastReadIndex + 1; i < messages.Count; i++)
        {
            if (!messages[i].IsDaySeparator)
            {
                hasNewerMessages = true;
                break;
            }
        }
        if (!hasNewerMessages) return;

        messages.Insert(lastReadIndex + 1, new Message
        {
            IsLastReadMarker = true,
            DaySeparatorText = Translations.T("chat.new_messages")
        });
    }

    private async System.Threading.Tasks.Task LoadSingleMessageImageAsync(Message msg)
    {
        try
        {
            System.Diagnostics.Debug.WriteLine($"[Image] Loading image for FileRef={msg.FileReferenceId}, MsgType={msg.MessageType}, Content={msg.Content?.Substring(0, Math.Min(msg.Content?.Length ?? 0, 80))}");
            var bytes = await _api.DownloadFileAsync(msg.FileReferenceId!);
            System.Diagnostics.Debug.WriteLine($"[Image] Downloaded {bytes.Length} bytes for FileRef={msg.FileReferenceId}");
            if (bytes.Length == 0) return;
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = new MemoryStream(bytes);
            bitmap.DecodePixelWidth = 300;
            bitmap.EndInit();
            bitmap.Freeze();
            msg.ImageSource = bitmap;
            var idx = _messages.IndexOf(msg);
            if (idx >= 0)
            {
                _messages.RemoveAt(idx);
                _messages.Insert(idx, msg);
            }
            System.Diagnostics.Debug.WriteLine($"[Image] Loaded OK for FileRef={msg.FileReferenceId}, HasImage={msg.HasImage}");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Image] ERROR loading FileRef={msg.FileReferenceId}: {ex.Message}");
        }
    }

    private async System.Threading.Tasks.Task LoadMessageImagesAsync()
    {
        var imageMessages = _messages.Where(m => m.IsImageMessage && m.ImageSource == null).ToList();
        System.Diagnostics.Debug.WriteLine($"[Image] Batch loading {imageMessages.Count} images out of {_messages.Count} messages");
        foreach (var msg in imageMessages)
        {
            await LoadSingleMessageImageAsync(msg);
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
                case "member_added":
                case "member_left":
                    HandleMemberChange(msg);
                    break;
                case "status_change":
                    HandleChatStatusChange(msg);
                    break;
                case "user_statuses":
                case "user_joined":
                    HandleUserStatuses(msg);
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

            // Force UI refresh: remove+insert because same-reference replacement
            // does not trigger WPF re-render
            var idx = _messages.IndexOf(existing);
            if (idx >= 0)
            {
                _messages.RemoveAt(idx);
                _messages.Insert(idx, existing);
            }

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

    private void HandleMemberChange(JsonElement msg)
    {
        var memberCount = msg.TryGetProperty("member_count", out var mc) ? mc.GetInt32() : -1;
        var channelId = msg.TryGetProperty("channel_id", out var cid) ? cid.GetString() : _currentChannelId;

        if (memberCount >= 0 && channelId != null)
        {
            var channel = _channels.FirstOrDefault(c => c.Id == channelId);
            if (channel != null)
            {
                channel.MemberCount = memberCount;
                var idx = _channels.IndexOf(channel);
                _channels.RemoveAt(idx);
                _channels.Insert(idx, channel);
            }

            if (channelId == _currentChannelId)
            {
                ChatSubtitle.Text = $"{memberCount} {Translations.T("chat.members")}";
            }
        }

        _ = LoadChannelsAsync();
        _ = LoadTeamsAsync();
    }

    private void HandleChatStatusChange(JsonElement msg)
    {
        var userId = msg.TryGetProperty("user_id", out var uid) ? uid.GetString() : null;
        var status = msg.TryGetProperty("status", out var st) ? st.GetString() : "offline";
        if (userId != null)
        {
            _userStatuses[userId] = status ?? "offline";
            UpdateChatStatusIndicator();
            for (int i = 0; i < _messages.Count; i++)
            {
                if (_messages[i].SenderId == userId)
                {
                    _messages[i].SenderStatus = status ?? "offline";
                    var m = _messages[i];
                    _messages.RemoveAt(i);
                    _messages.Insert(i, m);
                }
            }
        }
    }

    private void HandleUserStatuses(JsonElement msg)
    {
        if (msg.TryGetProperty("user_statuses", out var statuses) &&
            statuses.ValueKind == System.Text.Json.JsonValueKind.Object)
        {
            foreach (var prop in statuses.EnumerateObject())
            {
                var userId = prop.Name;
                var status = prop.Value.GetString() ?? "offline";
                _userStatuses[userId] = status;
                for (int i = 0; i < _messages.Count; i++)
                {
                    if (_messages[i].SenderId == userId)
                    {
                        _messages[i].SenderStatus = status;
                        var m = _messages[i];
                        _messages.RemoveAt(i);
                        _messages.Insert(i, m);
                    }
                }
            }
            UpdateChatStatusIndicator();
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

    private async void CtxForward_Click(object sender, RoutedEventArgs e)
    {
        MessageContextMenu.IsOpen = false;
        var message = _messages.FirstOrDefault(m => m.Id == _contextMessageId);
        if (message == null || _currentChannelId == null) return;

        var channels = await _api.GetChannelsAsync();
        var otherChannels = channels.Where(c => c.Id != _currentChannelId).ToList();

        var win = new Window
        {
            Title = Translations.T("chat.forward_to"),
            Width = 340, Height = 420,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Owner = this
        };
        var sp = new StackPanel { Margin = new Thickness(12) };
        var lb = new ListBox { Height = 320 };
        foreach (var ch in otherChannels)
        {
            var item = new ListBoxItem { Content = ch.Name ?? ch.Id, Tag = ch };
            lb.Items.Add(item);
        }
        sp.Children.Add(lb);

        lb.MouseDoubleClick += async (s, ev) =>
        {
            if (lb.SelectedItem is ListBoxItem sel && sel.Tag is Channel target)
            {
                var senderName = message.SenderName ?? Translations.T("chat.unknown");
                var content = $"[{Translations.T("chat.forwarded_from")} {senderName}]\n{message.Content}";
                var msgType = message.MessageType == "file" ? "file" : "text";
                try
                {
                    await _api.SendMessageAsync(target.Id, content, msgType,
                        fileReferenceId: message.FileReferenceId);
                    MessageBox.Show($"{Translations.T("chat.forwarded_to")} \"{target.Name}\"",
                        "OK", MessageBoxButton.OK, MessageBoxImage.Information);
                    win.Close();
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"{Translations.T("common.error")}: {ex.Message}");
                }
            }
        };

        win.Content = sp;
        win.ShowDialog();
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
            var existing = _messages.FirstOrDefault(m => m.Id == messageId);
            if (existing == null) return;

            existing.Reactions ??= new List<Reaction>();
            var userId = _api.CurrentUser?.Id;
            var displayName = _api.CurrentUser?.DisplayName ?? "?";
            bool isRemoving = existing.Reactions.Any(r => r.Emoji == emoji && r.UserId == userId);

            if (isRemoving)
            {
                await _api.RemoveReactionAsync(_currentChannelId, messageId, emoji);
                // Optimistic local update
                existing.Reactions.RemoveAll(r => r.Emoji == emoji && r.UserId == userId);
            }
            else
            {
                await _api.AddReactionAsync(_currentChannelId, messageId, emoji);
                // Optimistic local update
                if (userId != null)
                    existing.Reactions.Add(new Reaction { Emoji = emoji, UserId = userId, DisplayName = displayName });
            }

            // Refresh reaction groups and UI
            existing.ReactionGroups = existing.Reactions
                .GroupBy(r => r.Emoji)
                .Select(g => new ReactionGroup { Emoji = g.Key, Count = g.Count() })
                .ToList();
            existing.HasReactions = existing.ReactionGroups.Count > 0;

            // Force UI refresh with remove+insert
            var idx = _messages.IndexOf(existing);
            if (idx >= 0)
            {
                _messages.RemoveAt(idx);
                _messages.Insert(idx, existing);
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
    private string? _videoInitScriptId;

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
            var url = $"{baseUrl}/video/{_currentChannelId}";

            await InitializeVideoWebView();

            if (_webViewInitialized)
            {
                VideoCallTitle.Text = $"Video - {ChatTitle.Text}";
                VideoCallLeaveBtn.Content = Services.Translations.T("reminder.dismiss");

                // Inject token + hide web UI via script that runs before Angular boots
                var token = _api.Token?.Replace("\\", "\\\\").Replace("'", "\\'") ?? "";
                var currentUser = JsonSerializer.Serialize(_api.CurrentUser);
                var escapedUser = currentUser.Replace("\\", "\\\\").Replace("'", "\\'");
                // Build robust script: CSS injection via DOMContentLoaded + polling fallback
                var hideJs = new System.Text.StringBuilder();
                hideJs.Append("(function(){");
                // Auth: set token and user
                hideJs.Append("localStorage.setItem('access_token','").Append(token).Append("');");
                hideJs.Append("localStorage.setItem('current_user','").Append(escapedUser).Append("');");
                // CSS to hide layout elements
                hideJs.Append("var css='nav.sidebar{display:none !important}");
                hideJs.Append(".chat-sidebar{display:none !important}");
                hideJs.Append(".top-bar{display:none !important}");
                hideJs.Append(".main-body>.content{flex:1 !important;width:100% !important}';");
                // Function that injects style + sets inline display:none
                hideJs.Append("function hide(){");
                hideJs.Append("if(!document.getElementById(\"_ah\")){");
                hideJs.Append("var s=document.createElement(\"style\");s.id=\"_ah\";s.textContent=css;");
                hideJs.Append("var t=document.head||document.documentElement;");
                hideJs.Append("if(t)t.appendChild(s);}");
                hideJs.Append("var sels=[\"nav.sidebar\",\".chat-sidebar\",\".top-bar\"];");
                hideJs.Append("for(var i=0;i<sels.length;i++){");
                hideJs.Append("var el=document.querySelector(sels[i]);");
                hideJs.Append("if(el)el.style.setProperty(\"display\",\"none\",\"important\");}}");
                // Try immediately (may fail if DOM not ready)
                hideJs.Append("try{hide();}catch(e){}");
                // DOMContentLoaded: inject + setup MutationObserver
                hideJs.Append("document.addEventListener(\"DOMContentLoaded\",function(){");
                hideJs.Append("hide();");
                hideJs.Append("new MutationObserver(function(){hide();})");
                hideJs.Append(".observe(document.body||document.documentElement,");
                hideJs.Append("{childList:true,subtree:true});});");
                // Polling fallback: every 100ms for 30s
                hideJs.Append("var n=0,iv=setInterval(function(){hide();n++;if(n>300)clearInterval(iv);},100);");
                // Detect SPA navigation away from /video/ by patching pushState/replaceState
                hideJs.Append("var _ps=history.pushState,_rs=history.replaceState;");
                hideJs.Append("function _chk(url){");
                hideJs.Append("var s=(url&&url.toString())||location.href;");
                hideJs.Append("if(s.indexOf('/video/')===-1){");
                hideJs.Append("try{window.chrome.webview.postMessage('leaveCall');}catch(e){}}}");
                hideJs.Append("history.pushState=function(){_ps.apply(this,arguments);_chk(arguments[2]);};");
                hideJs.Append("history.replaceState=function(){_rs.apply(this,arguments);_chk(arguments[2]);};");
                hideJs.Append("window.addEventListener('popstate',function(){_chk();});");
                hideJs.Append("})();");
                var initScript = hideJs.ToString();
                // Remove previous injected scripts, then add new one
                await VideoWebView.CoreWebView2.ExecuteScriptAsync("void(0)");
                // Remove previous init script if any
                if (_videoInitScriptId != null)
                    VideoWebView.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(_videoInitScriptId);
                _videoInitScriptId = await VideoWebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(initScript);
                System.Diagnostics.Debug.WriteLine($"[Video] Injected init script (id={_videoInitScriptId}), navigating to {url}");
                VideoWebView.CoreWebView2.Navigate(url);

                // Detect if user navigates away from video page (e.g. leaves call in Angular UI)
                VideoWebView.CoreWebView2.NavigationStarting -= OnVideoNavigationStarting;
                VideoWebView.CoreWebView2.NavigationStarting += OnVideoNavigationStarting;

                // Listen for postMessage from injected pushState hook
                VideoWebView.CoreWebView2.WebMessageReceived -= OnVideoWebMessageReceived;
                VideoWebView.CoreWebView2.WebMessageReceived += OnVideoWebMessageReceived;

                // Hide all content views, show video overlay
                ChatView.Visibility = Visibility.Collapsed;
                EmptyState.Visibility = Visibility.Collapsed;
                FeedView.Visibility = Visibility.Collapsed;
                SettingsView.Visibility = Visibility.Collapsed;
                VideoCallView.Visibility = Visibility.Visible;
            }
            else
            {
                // Fallback: open in browser if WebView2 not available
                var fallbackUrl = $"{url}?token={Uri.EscapeDataString(_api.Token ?? "")}";
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(fallbackUrl) { UseShellExecute = true });
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Video] ERROR: {ex.Message}");
            MessageBox.Show($"{Services.Translations.T("common.error")}: {ex.Message}");
        }
    }

    private void VideoCallLeave_Click(object sender, RoutedEventArgs e)
    {
        LeaveVideoCall();
    }

    private void LeaveVideoCall()
    {
        if (VideoCallView.Visibility != Visibility.Visible) return;
        System.Diagnostics.Debug.WriteLine("[Video] Leaving video call");

        VideoCallView.Visibility = Visibility.Collapsed;
        ChatView.Visibility = Visibility.Visible;
        if (_webViewInitialized && VideoWebView.CoreWebView2 != null)
        {
            // Unhook navigation and message handlers
            VideoWebView.CoreWebView2.NavigationStarting -= OnVideoNavigationStarting;
            VideoWebView.CoreWebView2.WebMessageReceived -= OnVideoWebMessageReceived;

            if (_videoInitScriptId != null)
            {
                VideoWebView.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(_videoInitScriptId);
                _videoInitScriptId = null;
            }
            VideoWebView.CoreWebView2.Navigate("about:blank");
        }

        // Bring window to foreground and focus the message input
        this.Activate();
        this.Focus();
        if (_editorInitialized)
        {
            try { _ = EditorWebView.ExecuteScriptAsync("focusEditor()"); } catch { }
        }
        else
        {
            MessageInput.Focus();
        }
    }

    private void OnVideoNavigationStarting(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationStartingEventArgs e)
    {
        // If the WebView navigates away from the /video/ page (user left call in Angular UI),
        // automatically close the video overlay and return to chat
        var uri = e.Uri;
        System.Diagnostics.Debug.WriteLine($"[Video] Navigation starting: {uri}");
        if (uri != null && !uri.Contains("/video/") && uri != "about:blank")
        {
            System.Diagnostics.Debug.WriteLine("[Video] Detected navigation away from video page, leaving call");
            e.Cancel = true;
            Dispatcher.InvokeAsync(() => LeaveVideoCall());
        }
    }

    private void OnVideoWebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
    {
        var message = e.TryGetWebMessageAsString();
        System.Diagnostics.Debug.WriteLine($"[Video] WebMessage received: {message}");
        if (message == "leaveCall")
        {
            Dispatcher.InvokeAsync(() => LeaveVideoCall());
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

    private bool _notificationSoundLoaded = false;

    private void PlayNotificationSound()
    {
        if (_notificationSoundPath == null || !File.Exists(_notificationSoundPath)) return;

        try
        {
            if (_notificationPlayer == null)
            {
                _notificationPlayer = new MediaPlayer();
                _notificationPlayer.MediaOpened += (_, _) =>
                {
                    _notificationSoundLoaded = true;
                    _notificationPlayer.Play();
                };
                _notificationPlayer.Open(new Uri(_notificationSoundPath));
            }
            else if (_notificationSoundLoaded)
            {
                _notificationPlayer.Stop();
                _notificationPlayer.Position = TimeSpan.Zero;
                _notificationPlayer.Play();
            }
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

    private async void ReminderJoin_Click(object sender, RoutedEventArgs e)
    {
        if (_reminderEventId != null)
            _dismissedReminders.Add(_reminderEventId);
        HideReminder();

        if (_reminderChannelId != null)
        {
            try
            {
                await _api.CreateVideoRoomAsync(_reminderChannelId);
                var baseUrl = _api.BaseUrl.TrimEnd('/').Replace("/api", "");
                var url = $"{baseUrl}/video/{_reminderChannelId}";

                await InitializeVideoWebView();

                if (_webViewInitialized)
                {
                    VideoCallTitle.Text = $"Video - {Translations.T("reminder.event")}";
                    VideoCallLeaveBtn.Content = Translations.T("reminder.dismiss");

                    // Inject auth token
                    var token = _api.Token?.Replace("\\", "\\\\").Replace("'", "\\'") ?? "";
                    var currentUser = JsonSerializer.Serialize(_api.CurrentUser);
                    var escapedUser = currentUser.Replace("\\", "\\\\").Replace("'", "\\'");
                    var hideJs = new System.Text.StringBuilder();
                    hideJs.Append("(function(){");
                    hideJs.Append("localStorage.setItem('access_token','").Append(token).Append("');");
                    hideJs.Append("localStorage.setItem('current_user','").Append(escapedUser).Append("');");
                    hideJs.Append("var css='nav.sidebar{display:none !important}");
                    hideJs.Append(".chat-sidebar{display:none !important}");
                    hideJs.Append(".top-bar{display:none !important}");
                    hideJs.Append(".main-body>.content{flex:1 !important;width:100% !important}';");
                    hideJs.Append("function hide(){");
                    hideJs.Append("if(!document.getElementById(\"_ah\")){");
                    hideJs.Append("var s=document.createElement(\"style\");s.id=\"_ah\";s.textContent=css;");
                    hideJs.Append("var t=document.head||document.documentElement;");
                    hideJs.Append("if(t)t.appendChild(s);}");
                    hideJs.Append("var sels=[\"nav.sidebar\",\".chat-sidebar\",\".top-bar\"];");
                    hideJs.Append("for(var i=0;i<sels.length;i++){");
                    hideJs.Append("var el=document.querySelector(sels[i]);");
                    hideJs.Append("if(el)el.style.setProperty(\"display\",\"none\",\"important\");}}");
                    hideJs.Append("try{hide();}catch(e){}");
                    hideJs.Append("document.addEventListener(\"DOMContentLoaded\",function(){");
                    hideJs.Append("hide();");
                    hideJs.Append("new MutationObserver(function(){hide();})");
                    hideJs.Append(".observe(document.body||document.documentElement,");
                    hideJs.Append("{childList:true,subtree:true});});");
                    hideJs.Append("var n=0,iv=setInterval(function(){hide();n++;if(n>300)clearInterval(iv);},100);");
                    hideJs.Append("})();");

                    if (_videoInitScriptId != null)
                        VideoWebView.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(_videoInitScriptId);
                    _videoInitScriptId = await VideoWebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(hideJs.ToString());
                    VideoWebView.CoreWebView2.Navigate(url);

                    VideoWebView.CoreWebView2.NavigationStarting -= OnVideoNavigationStarting;
                    VideoWebView.CoreWebView2.NavigationStarting += OnVideoNavigationStarting;

                    ChatView.Visibility = Visibility.Collapsed;
                    EmptyState.Visibility = Visibility.Collapsed;
                    FeedView.Visibility = Visibility.Collapsed;
                    SettingsView.Visibility = Visibility.Collapsed;
                    VideoCallView.Visibility = Visibility.Visible;
                }
                else
                {
                    // Fallback: open in browser
                    var fallbackUrl = $"{url}?token={Uri.EscapeDataString(_api.Token ?? "")}";
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(fallbackUrl) { UseShellExecute = true });
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[Video] Reminder join error: {ex.Message}");
            }
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
        LoadSettingsAvatar(user);

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
        CalendarView.Visibility = Visibility.Collapsed;
        VideoCallView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Visible;
        _ = LoadCalendarIntegrationAsync();
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

    private async void AvatarUpload_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Upload Avatar",
            Filter = "Images|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp|All files|*.*"
        };
        if (dialog.ShowDialog() != true) return;

        try
        {
            AvatarUploadBtn.IsEnabled = false;
            AvatarUploadBtn.Content = "Uploading...";
            var user = await _api.UploadAvatarAsync(dialog.FileName);
            LoadSettingsAvatar(user);
            UpdateSidebarAvatar(user);
            ShowSettingsStatus(Translations.T("settings.saved"), false);
        }
        catch (Exception ex)
        {
            ShowSettingsStatus($"{Translations.T("settings.error")}: {ex.Message}", true);
        }
        finally
        {
            AvatarUploadBtn.IsEnabled = true;
            AvatarUploadBtn.Content = "Upload Avatar";
        }
    }

    private void LoadSettingsAvatar(User? user)
    {
        if (user?.AvatarPath != null && !string.IsNullOrEmpty(user.AvatarPath))
        {
            try
            {
                var baseUrl = _api.BaseUrl?.TrimEnd('/') ?? "";
                var uri = new Uri($"{baseUrl}{user.AvatarPath}");
                var bmp = new System.Windows.Media.Imaging.BitmapImage();
                bmp.BeginInit();
                bmp.UriSource = uri;
                bmp.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                bmp.EndInit();
                SettingsAvatarImage.Source = bmp;
                SettingsAvatarImage.Visibility = Visibility.Visible;
                SettingsAvatarInitials.Visibility = Visibility.Collapsed;
            }
            catch
            {
                SettingsAvatarImage.Visibility = Visibility.Collapsed;
                SettingsAvatarInitials.Visibility = Visibility.Visible;
            }
        }
        else
        {
            SettingsAvatarImage.Visibility = Visibility.Collapsed;
            SettingsAvatarInitials.Visibility = Visibility.Visible;
            var initials = !string.IsNullOrEmpty(user?.DisplayName)
                ? user.DisplayName[..1].ToUpper()
                : "U";
            SettingsAvatarInitials.Text = initials;
        }
    }

    private void UpdateSidebarAvatar(User? user)
    {
        if (user != null)
        {
            UserDisplayName.Text = user.DisplayName ?? user.Username;
        }
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
    public string? Location { get; set; }
    public string? ChannelId { get; set; }
    public DateTime StartDateTime { get; set; }
    public bool AllDay { get; set; }
}
