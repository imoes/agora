#include "main_window.h"
#include "api_client.h"
#include "translations.h"
#include <libnotify/notify.h>
#include <string.h>
#include <gst/gst.h>
#include <webkit2/webkit2.h>

struct _AgoraMainWindow {
    GtkApplicationWindow parent;
    AgoraApiClient *api;

    /* Navigation sidebar */
    GtkWidget *nav_sidebar;
    GtkWidget *nav_feed_btn;
    GtkWidget *nav_chat_btn;
    GtkWidget *nav_teams_btn;
    GtkWidget *nav_calendar_btn;

    /* Channel sidebar */
    GtkStack *sidebar_stack;
    GtkListBox *channel_list;
    GtkListBox *team_list;
    GtkListBox *team_channel_list;
    GtkWidget *team_channels_box;
    GtkLabel *team_channels_header;
    GtkLabel *user_label;

    /* Chat area */
    GtkStack *content_stack;
    GtkLabel *chat_title;
    GtkLabel *chat_subtitle;
    GtkTextView *message_view;
    GtkTextBuffer *message_buffer;
    GtkEntry *message_entry;
    GtkWidget *chat_box;
    GtkLabel *typing_label;

    /* Chat header buttons */
    GtkWidget *video_btn;
    GtkWidget *attach_header_btn;

    /* Feed */
    GtkListBox *feed_list;
    GtkWidget *feed_scroll;

    /* Video call overlay */
    GtkWidget *video_overlay;
    WebKitWebView *video_webview;

    /* State */
    char *current_channel_id;
    char *current_channel_name;

    /* WebSocket */
    SoupWebsocketConnection *ws_conn;
    SoupSession *ws_session;

    /* Event reminder */
    GtkWidget *reminder_bar;
    GtkLabel *reminder_title_label;
    GtkLabel *reminder_countdown_label;
    GtkWidget *reminder_join_btn;
    char *reminder_event_id;
    char *reminder_channel_id;
    GDateTime *reminder_start_time;
    guint reminder_poll_timer;
    guint reminder_tick_timer;
    GHashTable *dismissed_reminders;  /* set of dismissed event IDs */

    /* Notification sound */
    char *notification_sound_path;
};

G_DEFINE_TYPE(AgoraMainWindow, agora_main_window, GTK_TYPE_APPLICATION_WINDOW)

/* Forward declarations */
static void connect_channel_ws(AgoraMainWindow *win, const char *channel_id);
static void disconnect_channel_ws(AgoraMainWindow *win);
static void play_notification_sound(AgoraMainWindow *win);
static void download_notification_sound(AgoraMainWindow *win);
static void show_notification(const char *title, const char *body);
static void set_active_nav(AgoraMainWindow *win, GtkWidget *active_btn);
static void upload_file_to_channel(AgoraMainWindow *win, const char *filepath);
static void load_feed(AgoraMainWindow *win);
static void load_messages(AgoraMainWindow *win, const char *channel_id);

/* Application CSS */
static const char *app_css =
    /* Navigation sidebar */
    ".nav-sidebar { background-color: #292929; }"
    ".nav-btn { background-image: none; background-color: transparent; border: none; "
    "  border-left: 3px solid transparent; border-radius: 0; color: #b3b3b3; "
    "  padding: 10px 2px; box-shadow: none; min-width: 52px; }"
    ".nav-btn:hover { color: #ffffff; background-color: alpha(white, 0.06); }"
    ".nav-btn label { color: inherit; }"
    ".nav-active { color: #ffffff; border-left: 3px solid #6264a7; "
    "  background-color: alpha(white, 0.10); }"
    ".nav-active label { color: #ffffff; }"
    /* Channel sidebar */
    ".channel-sidebar { background-color: #2d2c2c; }"
    ".channel-sidebar list { background-color: transparent; }"
    ".channel-sidebar list row { padding: 2px 0; }"
    ".channel-sidebar list row:selected { background-color: #6264a7; }"
    ".channel-sidebar label { color: #e0e0e0; }"
    ".channel-sidebar list row:selected label { color: #ffffff; }"
    ".sidebar-header { color: #ffffff; font-weight: bold; }"
    ".sidebar-section { color: #999999; }"
    /* Chat header */
    ".chat-header { background-color: #ffffff; border-bottom: 1px solid #e0e0e0; }"
    ".chat-header-btn { background-image: none; background-color: transparent; border: none; "
    "  color: #666666; padding: 4px 8px; border-radius: 4px; box-shadow: none; }"
    ".chat-header-btn:hover { background-color: #f0f0f0; color: #333333; }"
    /* Input area */
    ".input-area { background-color: #ffffff; border-top: 1px solid #e0e0e0; }"
    ".send-btn { background-image: none; background-color: #6264a7; color: #ffffff; "
    "  border-radius: 4px; padding: 6px 16px; border: none; box-shadow: none; }"
    ".send-btn:hover { background-color: #515399; }"
    ".input-btn { background-image: none; background-color: transparent; color: #666666; "
    "  border: none; padding: 4px 6px; border-radius: 4px; box-shadow: none; }"
    ".input-btn:hover { background-color: #f0f0f0; }"
    "entry.message-entry { border-radius: 20px; padding: 8px 12px; }"
    /* Reminder bar */
    ".reminder-bar { background-color: #FFF3E0; border-bottom: 2px solid #E65100; padding: 10px 16px; }"
    ".reminder-title { font-weight: bold; }"
    ".reminder-countdown { font-weight: bold; color: #6264a7; }"
    /* User avatar */
    ".user-avatar { background-image: none; background-color: #6264a7; border-radius: 18px; "
    "  color: #ffffff; font-weight: bold; min-width: 36px; min-height: 36px; "
    "  padding: 0; border: none; box-shadow: none; }"
    /* Welcome */
    ".welcome-title { color: #6264a7; }"
;

/* --- Channel loading --- */

static void load_channels(AgoraMainWindow *win)
{
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, "/api/channels/", &error);
    if (!result) {
        if (error) g_error_free(error);
        return;
    }

    /* Clear existing list */
    GList *children = gtk_container_get_children(GTK_CONTAINER(win->channel_list));
    for (GList *l = children; l; l = l->next) {
        gtk_widget_destroy(GTK_WIDGET(l->data));
    }
    g_list_free(children);

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    for (guint i = 0; i < len; i++) {
        JsonObject *ch = json_array_get_object_element(arr, i);
        const char *id = json_object_get_string_member(ch, "id");
        const char *name = json_object_get_string_member(ch, "name");
        gint64 member_count = json_object_get_int_member(ch, "member_count");
        gint64 unread = 0;
        if (json_object_has_member(ch, "unread_count"))
            unread = json_object_get_int_member(ch, "unread_count");

        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
        gtk_container_set_border_width(GTK_CONTAINER(row_box), 8);

        /* Channel name + unread */
        GtkWidget *hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
        GtkWidget *name_label = gtk_label_new(name);
        gtk_label_set_ellipsize(GTK_LABEL(name_label), PANGO_ELLIPSIZE_END);
        gtk_widget_set_halign(name_label, GTK_ALIGN_START);
        PangoAttrList *attrs = pango_attr_list_new();
        pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
        gtk_label_set_attributes(GTK_LABEL(name_label), attrs);
        pango_attr_list_unref(attrs);
        gtk_box_pack_start(GTK_BOX(hbox), name_label, TRUE, TRUE, 0);

        if (unread > 0) {
            char *badge = g_strdup_printf("  %ld  ", (long)unread);
            GtkWidget *badge_label = gtk_label_new(badge);
            g_free(badge);
            gtk_box_pack_end(GTK_BOX(hbox), badge_label, FALSE, FALSE, 0);
        }
        gtk_box_pack_start(GTK_BOX(row_box), hbox, FALSE, FALSE, 0);

        /* Member count */
        char *members_text = g_strdup_printf("%ld %s", (long)member_count, T("chat.members"));
        GtkWidget *members_label = gtk_label_new(members_text);
        g_free(members_text);
        gtk_widget_set_halign(members_label, GTK_ALIGN_START);
        PangoAttrList *small_attrs = pango_attr_list_new();
        pango_attr_list_insert(small_attrs, pango_attr_scale_new(0.85));
        gtk_label_set_attributes(GTK_LABEL(members_label), small_attrs);
        pango_attr_list_unref(small_attrs);
        gtk_box_pack_start(GTK_BOX(row_box), members_label, FALSE, FALSE, 0);

        GtkWidget *row = gtk_list_box_row_new();
        g_object_set_data_full(G_OBJECT(row), "channel-id", g_strdup(id), g_free);
        g_object_set_data_full(G_OBJECT(row), "channel-name", g_strdup(name), g_free);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->channel_list, row, -1);
    }

    gtk_widget_show_all(GTK_WIDGET(win->channel_list));
    json_node_unref(result);
}

/* --- Teams loading --- */

static void load_teams(AgoraMainWindow *win)
{
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, "/api/teams/", &error);
    if (!result) {
        if (error) g_error_free(error);
        return;
    }

    /* Clear existing list */
    GList *children = gtk_container_get_children(GTK_CONTAINER(win->team_list));
    for (GList *l = children; l; l = l->next) {
        gtk_widget_destroy(GTK_WIDGET(l->data));
    }
    g_list_free(children);

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    for (guint i = 0; i < len; i++) {
        JsonObject *team = json_array_get_object_element(arr, i);
        const char *id = json_object_get_string_member(team, "id");
        const char *name = json_object_get_string_member(team, "name");
        gint64 member_count = json_object_has_member(team, "member_count")
            ? json_object_get_int_member(team, "member_count") : 0;

        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
        gtk_container_set_border_width(GTK_CONTAINER(row_box), 8);

        GtkWidget *name_label = gtk_label_new(name);
        gtk_label_set_ellipsize(GTK_LABEL(name_label), PANGO_ELLIPSIZE_END);
        gtk_widget_set_halign(name_label, GTK_ALIGN_START);
        PangoAttrList *attrs = pango_attr_list_new();
        pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
        gtk_label_set_attributes(GTK_LABEL(name_label), attrs);
        pango_attr_list_unref(attrs);
        gtk_box_pack_start(GTK_BOX(row_box), name_label, FALSE, FALSE, 0);

        char *members_text = g_strdup_printf("%ld %s", (long)member_count, T("chat.members"));
        GtkWidget *members_label = gtk_label_new(members_text);
        g_free(members_text);
        gtk_widget_set_halign(members_label, GTK_ALIGN_START);
        PangoAttrList *small_attrs = pango_attr_list_new();
        pango_attr_list_insert(small_attrs, pango_attr_scale_new(0.85));
        gtk_label_set_attributes(GTK_LABEL(members_label), small_attrs);
        pango_attr_list_unref(small_attrs);
        gtk_box_pack_start(GTK_BOX(row_box), members_label, FALSE, FALSE, 0);

        GtkWidget *row = gtk_list_box_row_new();
        g_object_set_data_full(G_OBJECT(row), "team-id", g_strdup(id), g_free);
        g_object_set_data_full(G_OBJECT(row), "team-name", g_strdup(name), g_free);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->team_list, row, -1);
    }

    gtk_widget_show_all(GTK_WIDGET(win->team_list));
    json_node_unref(result);
}

static void load_team_channels(AgoraMainWindow *win, const char *team_id)
{
    char *path = g_strdup_printf("/api/channels/?team_id=%s", team_id);
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &error);
    g_free(path);

    /* Clear existing list */
    GList *children = gtk_container_get_children(GTK_CONTAINER(win->team_channel_list));
    for (GList *l = children; l; l = l->next) {
        gtk_widget_destroy(GTK_WIDGET(l->data));
    }
    g_list_free(children);

    if (!result) {
        if (error) g_error_free(error);
        return;
    }

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    for (guint i = 0; i < len; i++) {
        JsonObject *ch = json_array_get_object_element(arr, i);
        const char *id = json_object_get_string_member(ch, "id");
        const char *name = json_object_get_string_member(ch, "name");

        char *display = g_strdup_printf("# %s", name);
        GtkWidget *label = gtk_label_new(display);
        g_free(display);
        gtk_widget_set_halign(label, GTK_ALIGN_START);
        gtk_widget_set_margin_start(label, 8);
        gtk_widget_set_margin_top(label, 4);
        gtk_widget_set_margin_bottom(label, 4);

        GtkWidget *row = gtk_list_box_row_new();
        g_object_set_data_full(G_OBJECT(row), "channel-id", g_strdup(id), g_free);
        g_object_set_data_full(G_OBJECT(row), "channel-name", g_strdup(name), g_free);
        gtk_container_add(GTK_CONTAINER(row), label);
        gtk_list_box_insert(win->team_channel_list, row, -1);
    }

    gtk_widget_show_all(GTK_WIDGET(win->team_channel_list));
    json_node_unref(result);
}

/* --- Feed loading --- */

static char *format_relative_time(const char *iso_str)
{
    if (!iso_str) return g_strdup("");
    GDateTime *dt = g_date_time_new_from_iso8601(iso_str, NULL);
    if (!dt) return g_strdup("");
    GDateTime *now = g_date_time_new_now_utc();
    GTimeSpan diff = g_date_time_difference(now, dt);
    g_date_time_unref(dt);
    g_date_time_unref(now);

    gint64 seconds = diff / G_TIME_SPAN_SECOND;
    if (seconds < 60) return g_strdup_printf("%lds", (long)seconds);
    if (seconds < 3600) return g_strdup_printf("%ldm", (long)(seconds / 60));
    if (seconds < 86400) return g_strdup_printf("%ldh", (long)(seconds / 3600));
    return g_strdup_printf("%ldd", (long)(seconds / 86400));
}

static void on_feed_row_activated(GtkListBox *list_box, GtkListBoxRow *row, gpointer data)
{
    (void)list_box;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!row) return;

    const char *channel_id = g_object_get_data(G_OBJECT(row), "channel-id");
    const char *channel_name = g_object_get_data(G_OBJECT(row), "channel-name");
    const char *event_id = g_object_get_data(G_OBJECT(row), "event-id");
    if (!channel_id) return;

    /* Mark as read */
    if (event_id) {
        char *body = g_strdup_printf("{\"event_ids\":[\"%s\"]}", event_id);
        GError *err = NULL;
        JsonNode *res = agora_api_client_post(win->api, "/api/feed/read", body, &err);
        g_free(body);
        if (res) json_node_unref(res);
        if (err) g_error_free(err);
    }

    /* Switch to chat nav */
    gtk_stack_set_visible_child_name(win->sidebar_stack, "chats");
    set_active_nav(win, win->nav_chat_btn);

    /* Open channel */
    g_free(win->current_channel_id);
    win->current_channel_id = g_strdup(channel_id);
    g_free(win->current_channel_name);
    win->current_channel_name = g_strdup(channel_name ? channel_name : "");

    gtk_label_set_text(win->chat_title, win->current_channel_name);
    gtk_stack_set_visible_child_name(win->content_stack, "chat");
    load_messages(win, channel_id);
    connect_channel_ws(win, channel_id);
    gtk_widget_grab_focus(GTK_WIDGET(win->message_entry));
}

static void load_feed(AgoraMainWindow *win)
{
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, "/api/feed/?limit=50&offset=0", &error);
    if (!result) {
        if (error) g_error_free(error);
        return;
    }

    /* Clear existing list */
    GList *children = gtk_container_get_children(GTK_CONTAINER(win->feed_list));
    for (GList *l = children; l; l = l->next)
        gtk_widget_destroy(GTK_WIDGET(l->data));
    g_list_free(children);

    JsonObject *root = json_node_get_object(result);
    if (!json_object_has_member(root, "events")) {
        json_node_unref(result);
        return;
    }

    JsonArray *events = json_object_get_array_member(root, "events");
    guint len = json_array_get_length(events);

    for (guint i = 0; i < len; i++) {
        JsonObject *ev = json_array_get_object_element(events, i);
        const char *id = json_object_get_string_member(ev, "id");
        const char *sender_name = json_object_has_member(ev, "sender_name")
            ? json_object_get_string_member(ev, "sender_name") : "";
        const char *channel_name = json_object_has_member(ev, "channel_name")
            ? json_object_get_string_member(ev, "channel_name") : "";
        const char *channel_id = json_object_has_member(ev, "channel_id")
            ? json_object_get_string_member(ev, "channel_id") : NULL;
        const char *event_type = json_object_has_member(ev, "event_type")
            ? json_object_get_string_member(ev, "event_type") : "message";
        const char *preview = json_object_has_member(ev, "preview_text") &&
            !json_object_get_null_member(ev, "preview_text")
            ? json_object_get_string_member(ev, "preview_text") : "";
        gboolean is_read = json_object_has_member(ev, "is_read")
            ? json_object_get_boolean_member(ev, "is_read") : TRUE;
        const char *created_at = json_object_has_member(ev, "created_at")
            ? json_object_get_string_member(ev, "created_at") : NULL;

        /* Build row */
        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
        gtk_container_set_border_width(GTK_CONTAINER(row_box), 10);

        /* Unread indicator */
        if (!is_read) {
            GtkWidget *dot = gtk_label_new("\xE2\x97\x8F"); /* ● */
            PangoAttrList *dot_attrs = pango_attr_list_new();
            pango_attr_list_insert(dot_attrs, pango_attr_foreground_new(0x6200, 0x6400, 0xa700));
            gtk_label_set_attributes(GTK_LABEL(dot), dot_attrs);
            pango_attr_list_unref(dot_attrs);
            gtk_box_pack_start(GTK_BOX(row_box), dot, FALSE, FALSE, 0);
        }

        /* Icon based on event type */
        const char *icon = "\xF0\x9F\x92\xAC"; /* 💬 message */
        if (g_strcmp0(event_type, "call") == 0) icon = "\xF0\x9F\x93\xB9"; /* 📹 */
        else if (g_strcmp0(event_type, "reaction") == 0) icon = "\xF0\x9F\x91\x8D"; /* 👍 */
        else if (g_strcmp0(event_type, "mention") == 0) icon = "@";

        GtkWidget *icon_lbl = gtk_label_new(icon);
        gtk_box_pack_start(GTK_BOX(row_box), icon_lbl, FALSE, FALSE, 0);

        /* Text content */
        GtkWidget *text_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);

        /* Sender + channel */
        char *header = g_strdup_printf("<b>%s</b>  <span color='#888888'>in %s</span>",
                                        sender_name, channel_name);
        GtkWidget *header_lbl = gtk_label_new(NULL);
        gtk_label_set_markup(GTK_LABEL(header_lbl), header);
        g_free(header);
        gtk_label_set_ellipsize(GTK_LABEL(header_lbl), PANGO_ELLIPSIZE_END);
        gtk_widget_set_halign(header_lbl, GTK_ALIGN_START);
        gtk_box_pack_start(GTK_BOX(text_box), header_lbl, FALSE, FALSE, 0);

        /* Preview text */
        GtkWidget *preview_lbl = gtk_label_new(preview);
        gtk_label_set_ellipsize(GTK_LABEL(preview_lbl), PANGO_ELLIPSIZE_END);
        gtk_label_set_max_width_chars(GTK_LABEL(preview_lbl), 60);
        gtk_widget_set_halign(preview_lbl, GTK_ALIGN_START);
        PangoAttrList *prev_attrs = pango_attr_list_new();
        pango_attr_list_insert(prev_attrs, pango_attr_scale_new(0.9));
        pango_attr_list_insert(prev_attrs, pango_attr_foreground_new(0x6600, 0x6600, 0x6600));
        gtk_label_set_attributes(GTK_LABEL(preview_lbl), prev_attrs);
        pango_attr_list_unref(prev_attrs);
        gtk_box_pack_start(GTK_BOX(text_box), preview_lbl, FALSE, FALSE, 0);

        gtk_box_pack_start(GTK_BOX(row_box), text_box, TRUE, TRUE, 0);

        /* Time */
        char *time_str = format_relative_time(created_at);
        GtkWidget *time_lbl = gtk_label_new(time_str);
        g_free(time_str);
        PangoAttrList *time_attrs = pango_attr_list_new();
        pango_attr_list_insert(time_attrs, pango_attr_scale_new(0.85));
        pango_attr_list_insert(time_attrs, pango_attr_foreground_new(0x9900, 0x9900, 0x9900));
        gtk_label_set_attributes(GTK_LABEL(time_lbl), time_attrs);
        pango_attr_list_unref(time_attrs);
        gtk_widget_set_valign(time_lbl, GTK_ALIGN_START);
        gtk_box_pack_end(GTK_BOX(row_box), time_lbl, FALSE, FALSE, 0);

        GtkWidget *row = gtk_list_box_row_new();
        if (channel_id)
            g_object_set_data_full(G_OBJECT(row), "channel-id", g_strdup(channel_id), g_free);
        if (channel_name)
            g_object_set_data_full(G_OBJECT(row), "channel-name", g_strdup(channel_name), g_free);
        if (id)
            g_object_set_data_full(G_OBJECT(row), "event-id", g_strdup(id), g_free);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->feed_list, row, -1);
    }

    gtk_widget_show_all(GTK_WIDGET(win->feed_list));
    json_node_unref(result);
}

/* --- Message loading --- */

static void load_messages(AgoraMainWindow *win, const char *channel_id)
{
    char *path = g_strdup_printf("/api/channels/%s/messages/?limit=50", channel_id);
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &error);
    g_free(path);

    gtk_text_buffer_set_text(win->message_buffer, "", 0);

    if (!result) {
        if (error) g_error_free(error);
        return;
    }

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    GtkTextIter iter;
    gtk_text_buffer_get_end_iter(win->message_buffer, &iter);

    for (guint i = 0; i < len; i++) {
        JsonObject *msg = json_array_get_object_element(arr, i);
        const char *sender = json_object_get_string_member(msg, "sender_name");
        const char *content = json_object_get_string_member(msg, "content");
        const char *created = json_object_get_string_member(msg, "created_at");
        const char *msg_type = json_object_get_string_member(msg, "message_type");
        gboolean has_edited = json_object_has_member(msg, "edited_at") &&
                              !json_object_get_null_member(msg, "edited_at");

        /* Reply quote */
        if (json_object_has_member(msg, "reply_to_sender") &&
            !json_object_get_null_member(msg, "reply_to_sender")) {
            const char *reply_sender = json_object_get_string_member(msg, "reply_to_sender");
            const char *reply_content = json_object_get_string_member(msg, "reply_to_content");
            char *reply_line = g_strdup_printf("  > %s: %s\n",
                                               reply_sender ? reply_sender : "?",
                                               reply_content ? reply_content : "");
            gtk_text_buffer_insert(win->message_buffer, &iter, reply_line, -1);
            g_free(reply_line);
        }

        /* Message content */
        const char *edited_tag = has_edited ? T("chat.edited") : "";
        char sys_prefix[64] = "";
        char file_prefix[64] = "";
        const char *type_prefix = "";
        if (msg_type && g_strcmp0(msg_type, "system") == 0) {
            g_snprintf(sys_prefix, sizeof(sys_prefix), "[%s] ", T("chat.system"));
            type_prefix = sys_prefix;
        } else if (msg_type && g_strcmp0(msg_type, "file") == 0) {
            g_snprintf(file_prefix, sizeof(file_prefix), "[%s] ", T("chat.file"));
            type_prefix = file_prefix;
        }

        char *line = g_strdup_printf("[%s] %s%s: %s%s\n",
                                     created ? created : "",
                                     type_prefix,
                                     sender ? sender : "?",
                                     content ? content : "",
                                     edited_tag);
        gtk_text_buffer_insert(win->message_buffer, &iter, line, -1);
        g_free(line);

        /* Reactions (backend sends as array of {emoji, user_id, display_name}) */
        if (json_object_has_member(msg, "reactions") &&
            !json_object_get_null_member(msg, "reactions")) {
            JsonArray *reactions = json_object_get_array_member(msg, "reactions");
            guint rlen = reactions ? json_array_get_length(reactions) : 0;
            if (rlen > 0) {
                /* Count reactions grouped by emoji */
                GHashTable *counts = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);
                for (guint r = 0; r < rlen; r++) {
                    JsonObject *reaction = json_array_get_object_element(reactions, r);
                    const char *emoji = json_object_get_string_member(reaction, "emoji");
                    if (!emoji) continue;
                    gpointer val = g_hash_table_lookup(counts, emoji);
                    int count = GPOINTER_TO_INT(val) + 1;
                    g_hash_table_replace(counts, g_strdup(emoji), GINT_TO_POINTER(count));
                }
                GString *reaction_str = g_string_new("  ");
                GHashTableIter hiter;
                gpointer key, value;
                g_hash_table_iter_init(&hiter, counts);
                while (g_hash_table_iter_next(&hiter, &key, &value)) {
                    g_string_append_printf(reaction_str, "%s %d  ", (char *)key, GPOINTER_TO_INT(value));
                }
                g_string_append_c(reaction_str, '\n');
                gtk_text_buffer_insert(win->message_buffer, &iter, reaction_str->str, -1);
                g_string_free(reaction_str, TRUE);
                g_hash_table_destroy(counts);
            }
        }
    }

    /* Scroll to bottom */
    GtkTextMark *end_mark = gtk_text_buffer_get_mark(win->message_buffer, "insert");
    gtk_text_view_scroll_to_mark(win->message_view, end_mark, 0.0, FALSE, 0.0, 0.0);

    json_node_unref(result);
}

/* --- WebSocket handling --- */

static void on_ws_message(SoupWebsocketConnection *conn, gint type,
                          GBytes *message, gpointer user_data)
{
    (void)conn;
    (void)type;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);

    gsize size;
    const char *data = g_bytes_get_data(message, &size);

    JsonParser *parser = json_parser_new();
    if (!json_parser_load_from_data(parser, data, (gssize)size, NULL)) {
        g_object_unref(parser);
        return;
    }

    JsonObject *root = json_node_get_object(json_parser_get_root(parser));
    const char *msg_type = json_object_get_string_member(root, "type");

    if (g_strcmp0(msg_type, "new_message") == 0 &&
        json_object_has_member(root, "message")) {
        JsonObject *msg = json_object_get_object_member(root, "message");
        const char *sender = json_object_get_string_member(msg, "sender_name");
        const char *content = json_object_get_string_member(msg, "content");
        const char *m_type = json_object_get_string_member(msg, "message_type");

        /* Append to message view */
        GtkTextIter iter;
        gtk_text_buffer_get_end_iter(win->message_buffer, &iter);

        char ws_sys_prefix[64] = "";
        char ws_file_prefix[64] = "";
        const char *type_prefix = "";
        if (m_type && g_strcmp0(m_type, "system") == 0) {
            g_snprintf(ws_sys_prefix, sizeof(ws_sys_prefix), "[%s] ", T("chat.system"));
            type_prefix = ws_sys_prefix;
        } else if (m_type && g_strcmp0(m_type, "file") == 0) {
            g_snprintf(ws_file_prefix, sizeof(ws_file_prefix), "[%s] ", T("chat.file"));
            type_prefix = ws_file_prefix;
        }

        char *line = g_strdup_printf("%s%s: %s\n",
                                     type_prefix,
                                     sender ? sender : "?",
                                     content ? content : "");
        gtk_text_buffer_insert(win->message_buffer, &iter, line, -1);
        g_free(line);

        /* Scroll to bottom */
        GtkTextMark *end_mark = gtk_text_buffer_get_mark(win->message_buffer, "insert");
        gtk_text_view_scroll_to_mark(win->message_view, end_mark, 0.0, FALSE, 0.0, 0.0);

        /* Clear typing indicator */
        gtk_label_set_text(win->typing_label, "");
        gtk_widget_hide(GTK_WIDGET(win->typing_label));

        /* Play notification sound and show desktop notification for messages from others */
        AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
        AgoraSession *session = agora_app_get_session(app);
        const char *sender_id = json_object_has_member(msg, "sender_id")
            ? json_object_get_string_member(msg, "sender_id") : NULL;

        if (sender_id && session->user_id &&
            g_strcmp0(sender_id, session->user_id) != 0) {
            play_notification_sound(win);
        }

        if (sender_id && session->user_id &&
            g_strcmp0(sender_id, session->user_id) != 0 &&
            !gtk_window_is_active(GTK_WINDOW(win))) {
            char *notif_title = g_strdup_printf("%s in %s",
                sender ? sender : T("notify.someone"),
                win->current_channel_name ? win->current_channel_name : "Chat");
            const char *notif_body = (m_type && g_strcmp0(m_type, "file") == 0)
                ? T("chat.file_sent")
                : (content ? content : "");
            show_notification(notif_title, notif_body);
            g_free(notif_title);
        }
    }
    else if (g_strcmp0(msg_type, "message_edited") == 0) {
        /* Reload messages to reflect edits */
        if (win->current_channel_id)
            load_messages(win, win->current_channel_id);
    }
    else if (g_strcmp0(msg_type, "message_deleted") == 0) {
        /* Reload messages to reflect deletion */
        if (win->current_channel_id)
            load_messages(win, win->current_channel_id);
    }
    else if (g_strcmp0(msg_type, "reaction_update") == 0) {
        const char *display_name = json_object_has_member(root, "display_name")
            ? json_object_get_string_member(root, "display_name") : T("notify.someone");
        const char *emoji = json_object_has_member(root, "emoji")
            ? json_object_get_string_member(root, "emoji") : "";
        const char *action = json_object_has_member(root, "action")
            ? json_object_get_string_member(root, "action") : "";
        const char *user_id = json_object_has_member(root, "user_id")
            ? json_object_get_string_member(root, "user_id") : NULL;

        /* Reload messages to show updated reactions */
        if (win->current_channel_id)
            load_messages(win, win->current_channel_id);

        /* Show notification for reactions from others */
        AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
        AgoraSession *session = agora_app_get_session(app);
        if (g_strcmp0(action, "add") == 0 && user_id && session->user_id &&
            g_strcmp0(user_id, session->user_id) != 0) {
            char *notif_title = g_strdup_printf("%s %s", display_name, T("notify.reacted"));
            char *notif_body = g_strdup_printf("%s %s", emoji, T("notify.reaction_body"));
            show_notification(notif_title, notif_body);
            g_free(notif_title);
            g_free(notif_body);
        }
    }
    else if (g_strcmp0(msg_type, "typing") == 0) {
        const char *display_name = json_object_has_member(root, "display_name")
            ? json_object_get_string_member(root, "display_name") : NULL;
        if (display_name) {
            char *typing_text = g_strdup_printf("%s %s", display_name, T("chat.typing_one"));
            gtk_label_set_text(win->typing_label, typing_text);
            gtk_widget_show(GTK_WIDGET(win->typing_label));
            g_free(typing_text);
        }
    }

    g_object_unref(parser);
}

static void on_ws_closed(SoupWebsocketConnection *conn, gpointer user_data)
{
    (void)conn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);
    if (win->ws_conn) {
        g_object_unref(win->ws_conn);
        win->ws_conn = NULL;
    }
}

static void on_ws_connected(GObject *source, GAsyncResult *result, gpointer user_data)
{
    (void)source;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);
    GError *error = NULL;

    win->ws_conn = soup_session_websocket_connect_finish(win->ws_session, result, &error);
    if (!win->ws_conn) {
        if (error) {
            g_warning("WebSocket connection failed: %s", error->message);
            g_error_free(error);
        }
        return;
    }

    g_signal_connect(win->ws_conn, "message", G_CALLBACK(on_ws_message), win);
    g_signal_connect(win->ws_conn, "closed", G_CALLBACK(on_ws_closed), win);
}

static void connect_channel_ws(AgoraMainWindow *win, const char *channel_id)
{
    disconnect_channel_ws(win);

    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *session = agora_app_get_session(app);

    /* Build WebSocket URL */
    char *ws_url;
    if (g_str_has_prefix(session->base_url, "https://")) {
        ws_url = g_strdup_printf("wss://%s/ws/%s?token=%s",
            session->base_url + 8, channel_id, session->token);
    } else if (g_str_has_prefix(session->base_url, "http://")) {
        ws_url = g_strdup_printf("ws://%s/ws/%s?token=%s",
            session->base_url + 7, channel_id, session->token);
    } else {
        return;
    }

    if (!win->ws_session) {
        win->ws_session = soup_session_new_with_options(
            SOUP_SESSION_SSL_STRICT, FALSE,
            NULL);
    }

    SoupMessage *msg = soup_message_new("GET", ws_url);
    g_free(ws_url);
    if (!msg) return;

    soup_session_websocket_connect_async(win->ws_session, msg,
                                          NULL, NULL, NULL,
                                          on_ws_connected, win);
    g_object_unref(msg);
}

static void disconnect_channel_ws(AgoraMainWindow *win)
{
    if (win->ws_conn) {
        if (soup_websocket_connection_get_state(win->ws_conn) == SOUP_WEBSOCKET_STATE_OPEN) {
            soup_websocket_connection_close(win->ws_conn, SOUP_WEBSOCKET_CLOSE_NORMAL, NULL);
        }
        g_object_unref(win->ws_conn);
        win->ws_conn = NULL;
    }
}

/* --- Notification sound --- */

static void on_gst_bus_message(GstBus *bus, GstMessage *msg, gpointer data)
{
    (void)bus;
    GstElement *pipeline = GST_ELEMENT(data);
    if (GST_MESSAGE_TYPE(msg) == GST_MESSAGE_EOS ||
        GST_MESSAGE_TYPE(msg) == GST_MESSAGE_ERROR) {
        gst_element_set_state(pipeline, GST_STATE_NULL);
        gst_object_unref(pipeline);
    }
}

static void play_notification_sound(AgoraMainWindow *win)
{
    if (!win->notification_sound_path) return;
    if (!g_file_test(win->notification_sound_path, G_FILE_TEST_EXISTS)) return;

    char *uri = g_strdup_printf("file://%s", win->notification_sound_path);
    GstElement *pipeline = gst_element_factory_make("playbin", "notification");
    if (!pipeline) {
        g_free(uri);
        return;
    }

    g_object_set(pipeline, "uri", uri, NULL);
    g_free(uri);

    GstBus *bus = gst_element_get_bus(pipeline);
    gst_bus_add_signal_watch(bus);
    g_signal_connect(bus, "message", G_CALLBACK(on_gst_bus_message), pipeline);
    gst_object_unref(bus);

    gst_element_set_state(pipeline, GST_STATE_PLAYING);
}

static void download_notification_sound(AgoraMainWindow *win)
{
    if (!win->api || !win->api->base_url) return;

    /* Construct sound URL: use custom sound if set, otherwise default */
    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *sess = agora_app_get_session(app);

    char *base = g_strdup(win->api->base_url);
    char *api_pos = g_strrstr(base, "/api");
    if (api_pos) *api_pos = '\0';

    char *sound_url;
    if (sess->notification_sound_path)
        sound_url = g_strdup_printf("%s%s", base, sess->notification_sound_path);
    else
        sound_url = g_strdup_printf("%s/assets/sounds/star-trek-communicator.mp3", base);
    g_free(base);

    /* Download using a simple SoupSession */
    SoupSession *session = soup_session_new_with_options(
        SOUP_SESSION_SSL_STRICT, FALSE, NULL);
    SoupMessage *msg = soup_message_new("GET", sound_url);
    g_free(sound_url);

    if (!msg) {
        g_object_unref(session);
        return;
    }

    guint status = soup_session_send_message(session, msg);
    if (status == 200 && msg->response_body->length > 0) {
        win->notification_sound_path = g_build_filename(
            g_get_tmp_dir(), "agora-notification.mp3", NULL);
        g_file_set_contents(win->notification_sound_path,
                            msg->response_body->data,
                            (gssize)msg->response_body->length,
                            NULL);
    }

    g_object_unref(msg);
    g_object_unref(session);
}

/* --- Notification (3 seconds) --- */

static void show_notification(const char *title, const char *body)
{
    NotifyNotification *notif = notify_notification_new(title, body, "dialog-information");
    notify_notification_set_timeout(notif, 3000);  /* 3 seconds */
    notify_notification_set_urgency(notif, NOTIFY_URGENCY_NORMAL);
    notify_notification_show(notif, NULL);
    g_object_unref(notif);
}

/* --- Event handlers --- */

static void on_channel_selected(GtkListBox *list_box, GtkListBoxRow *row,
                                gpointer user_data)
{
    (void)list_box;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);
    if (!row) return;

    const char *channel_id = g_object_get_data(G_OBJECT(row), "channel-id");
    const char *channel_name = g_object_get_data(G_OBJECT(row), "channel-name");

    g_free(win->current_channel_id);
    win->current_channel_id = g_strdup(channel_id);
    g_free(win->current_channel_name);
    win->current_channel_name = g_strdup(channel_name);

    gtk_label_set_text(win->chat_title, channel_name);
    gtk_stack_set_visible_child_name(win->content_stack, "chat");

    /* Clear typing indicator */
    gtk_label_set_text(win->typing_label, "");
    gtk_widget_hide(GTK_WIDGET(win->typing_label));

    load_messages(win, channel_id);

    /* Connect WebSocket for real-time updates */
    connect_channel_ws(win, channel_id);

    gtk_widget_grab_focus(GTK_WIDGET(win->message_entry));
}

static void on_team_selected(GtkListBox *list_box, GtkListBoxRow *row,
                              gpointer user_data)
{
    (void)list_box;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);
    if (!row) return;

    const char *team_id = g_object_get_data(G_OBJECT(row), "team-id");
    const char *team_name = g_object_get_data(G_OBJECT(row), "team-name");

    gtk_label_set_text(win->team_channels_header, team_name);
    load_team_channels(win, team_id);
    gtk_widget_show_all(win->team_channels_box);
}

static void on_team_channel_selected(GtkListBox *list_box, GtkListBoxRow *row,
                                      gpointer user_data)
{
    (void)list_box;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);
    if (!row) return;

    const char *channel_id = g_object_get_data(G_OBJECT(row), "channel-id");
    const char *channel_name = g_object_get_data(G_OBJECT(row), "channel-name");

    /* Deselect main channel list */
    gtk_list_box_unselect_all(win->channel_list);

    g_free(win->current_channel_id);
    win->current_channel_id = g_strdup(channel_id);
    g_free(win->current_channel_name);
    win->current_channel_name = g_strdup(channel_name);

    gtk_label_set_text(win->chat_title, channel_name);
    gtk_stack_set_visible_child_name(win->content_stack, "chat");

    gtk_label_set_text(win->typing_label, "");
    gtk_widget_hide(GTK_WIDGET(win->typing_label));

    load_messages(win, channel_id);
    connect_channel_ws(win, channel_id);
    gtk_widget_grab_focus(GTK_WIDGET(win->message_entry));
}

static void ws_send_json(AgoraMainWindow *win, const char *json_str)
{
    if (win->ws_conn &&
        soup_websocket_connection_get_state(win->ws_conn) == SOUP_WEBSOCKET_STATE_OPEN) {
        soup_websocket_connection_send_text(win->ws_conn, json_str);
    }
}

static void send_message(AgoraMainWindow *win)
{
    const char *text = gtk_entry_get_text(win->message_entry);
    if (!text || !text[0] || !win->current_channel_id) return;

    /* Try sending via WebSocket first */
    if (win->ws_conn &&
        soup_websocket_connection_get_state(win->ws_conn) == SOUP_WEBSOCKET_STATE_OPEN) {
        /* Escape text for JSON */
        JsonBuilder *builder = json_builder_new();
        json_builder_begin_object(builder);
        json_builder_set_member_name(builder, "type");
        json_builder_add_string_value(builder, "message");
        json_builder_set_member_name(builder, "content");
        json_builder_add_string_value(builder, text);
        json_builder_set_member_name(builder, "message_type");
        json_builder_add_string_value(builder, "text");
        json_builder_end_object(builder);

        JsonGenerator *gen = json_generator_new();
        json_generator_set_root(gen, json_builder_get_root(builder));
        char *body = json_generator_to_data(gen, NULL);
        ws_send_json(win, body);
        g_free(body);
        g_object_unref(gen);
        g_object_unref(builder);
    } else {
        /* Fallback to REST */
        char *path = g_strdup_printf("/api/channels/%s/messages/",
                                     win->current_channel_id);
        char *body = g_strdup_printf("{\"content\":\"%s\",\"message_type\":\"text\"}", text);

        GError *error = NULL;
        JsonNode *result = agora_api_client_post(win->api, path, body, &error);
        g_free(path);
        g_free(body);

        if (result) {
            /* Append message to view */
            GtkTextIter iter;
            gtk_text_buffer_get_end_iter(win->message_buffer, &iter);

            AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
            AgoraSession *session = agora_app_get_session(app);

            char *line = g_strdup_printf("%s: %s\n",
                                         session->display_name ? session->display_name : T("common.you"),
                                         text);
            gtk_text_buffer_insert(win->message_buffer, &iter, line, -1);
            g_free(line);

            json_node_unref(result);
        } else if (error) {
            g_error_free(error);
        }
    }

    gtk_entry_set_text(win->message_entry, "");
}

static void on_send_clicked(GtkButton *button, gpointer user_data)
{
    (void)button;
    send_message(AGORA_MAIN_WINDOW(user_data));
}

static void on_entry_activate(GtkEntry *entry, gpointer user_data)
{
    (void)entry;
    send_message(AGORA_MAIN_WINDOW(user_data));
}

static void on_entry_changed(GtkEditable *editable, gpointer user_data)
{
    (void)editable;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);

    /* Send typing indicator via WebSocket */
    if (win->ws_conn &&
        soup_websocket_connection_get_state(win->ws_conn) == SOUP_WEBSOCKET_STATE_OPEN) {
        ws_send_json(win, "{\"type\":\"typing\"}");
    }
}

/* --- Event Reminder --- */

static gboolean update_reminder_countdown(gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!win->reminder_start_time) return G_SOURCE_REMOVE;

    GDateTime *now = g_date_time_new_now_local();
    GTimeSpan diff = g_date_time_difference(win->reminder_start_time, now);
    g_date_time_unref(now);

    if (diff <= 0) {
        char *text = g_strdup_printf("%s %s", T("reminder.starts_in"), T("reminder.now"));
        gtk_label_set_text(win->reminder_countdown_label, text);
        g_free(text);
        win->reminder_tick_timer = 0;
        /* Auto-dismiss after 60 seconds */
        return G_SOURCE_REMOVE;
    }

    int total_sec = (int)(diff / G_TIME_SPAN_SECOND);
    int min = total_sec / 60;
    int sec = total_sec % 60;
    char *text = g_strdup_printf("%s %d:%02d", T("reminder.starts_in"), min, sec);
    gtk_label_set_text(win->reminder_countdown_label, text);
    g_free(text);
    return G_SOURCE_CONTINUE;
}

static void show_reminder(AgoraMainWindow *win, const char *event_id,
                           const char *title, const char *channel_id,
                           GDateTime *start_time)
{
    g_free(win->reminder_event_id);
    win->reminder_event_id = g_strdup(event_id);
    g_free(win->reminder_channel_id);
    win->reminder_channel_id = channel_id ? g_strdup(channel_id) : NULL;
    if (win->reminder_start_time) g_date_time_unref(win->reminder_start_time);
    win->reminder_start_time = g_date_time_ref(start_time);

    gtk_label_set_text(win->reminder_title_label, title);

    /* Show/hide join button based on channel_id */
    if (channel_id)
        gtk_widget_show(win->reminder_join_btn);
    else
        gtk_widget_hide(win->reminder_join_btn);

    /* Start countdown tick */
    if (win->reminder_tick_timer) g_source_remove(win->reminder_tick_timer);
    update_reminder_countdown(win);
    win->reminder_tick_timer = g_timeout_add(1000, update_reminder_countdown, win);

    gtk_widget_show(win->reminder_bar);
}

static void hide_reminder(AgoraMainWindow *win)
{
    gtk_widget_hide(win->reminder_bar);
    if (win->reminder_tick_timer) {
        g_source_remove(win->reminder_tick_timer);
        win->reminder_tick_timer = 0;
    }
    g_free(win->reminder_event_id);
    win->reminder_event_id = NULL;
    g_free(win->reminder_channel_id);
    win->reminder_channel_id = NULL;
    if (win->reminder_start_time) {
        g_date_time_unref(win->reminder_start_time);
        win->reminder_start_time = NULL;
    }
}

static void on_reminder_join_clicked(GtkButton *btn, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (win->reminder_event_id)
        g_hash_table_add(win->dismissed_reminders, g_strdup(win->reminder_event_id));

    if (win->reminder_channel_id) {
        /* Open video room in embedded WebView */
        AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
        AgoraSession *session = agora_app_get_session(app);
        char *base = g_strdup(session->base_url);
        char *api_pos = g_strrstr(base, "/api");
        if (api_pos) *api_pos = '\0';
        char *url = g_strdup_printf("%s/video/%s?token=%s", base, win->reminder_channel_id, session->token);
        g_free(base);

        if (win->video_webview) {
            webkit_web_view_load_uri(win->video_webview, url);
            gtk_widget_show_all(win->video_overlay);
        } else {
            GError *err = NULL;
            g_app_info_launch_default_for_uri(url, NULL, &err);
            if (err) g_error_free(err);
        }
        g_free(url);
    }
    hide_reminder(win);
}

static void on_reminder_dismiss_clicked(GtkButton *btn, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (win->reminder_event_id)
        g_hash_table_add(win->dismissed_reminders, g_strdup(win->reminder_event_id));
    hide_reminder(win);
}

static gboolean check_event_reminders(gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!win->api || !win->api->token) return G_SOURCE_CONTINUE;

    GDateTime *now = g_date_time_new_now_utc();
    GDateTime *end = g_date_time_add_minutes(now, 16);
    char *now_str = g_date_time_format_iso8601(now);
    char *end_str = g_date_time_format_iso8601(end);

    char *path = g_strdup_printf("/api/calendar/events?start=%s&end=%s", now_str, end_str);
    g_free(now_str);
    g_free(end_str);

    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &error);
    g_free(path);

    if (result && JSON_NODE_HOLDS_ARRAY(result)) {
        JsonArray *arr = json_node_get_array(result);
        guint len = json_array_get_length(arr);

        const char *nearest_id = NULL;
        const char *nearest_title = NULL;
        const char *nearest_channel = NULL;
        GDateTime *nearest_start = NULL;
        GTimeSpan nearest_diff = G_MAXINT64;

        for (guint i = 0; i < len; i++) {
            JsonObject *ev = json_array_get_object_element(arr, i);
            gboolean all_day = json_object_has_member(ev, "all_day") &&
                               json_object_get_boolean_member(ev, "all_day");
            if (all_day) continue;

            const char *id = json_object_get_string_member(ev, "id");
            if (!id || g_hash_table_contains(win->dismissed_reminders, id)) continue;

            const char *start_str = json_object_get_string_member(ev, "start_time");
            if (!start_str) continue;

            GDateTime *start = g_date_time_new_from_iso8601(start_str, NULL);
            if (!start) continue;

            GTimeSpan diff = g_date_time_difference(start, now);
            GTimeSpan fifteen_min = 15 * 60 * G_TIME_SPAN_SECOND;

            if (diff > 0 && diff <= fifteen_min && diff < nearest_diff) {
                if (nearest_start) g_date_time_unref(nearest_start);
                nearest_id = id;
                nearest_title = json_object_has_member(ev, "title")
                    ? json_object_get_string_member(ev, "title") : "";
                nearest_channel = json_object_has_member(ev, "channel_id") &&
                    !json_object_get_null_member(ev, "channel_id")
                    ? json_object_get_string_member(ev, "channel_id") : NULL;
                nearest_start = start;
                nearest_diff = diff;
            } else {
                g_date_time_unref(start);
            }
        }

        if (nearest_id && (!win->reminder_event_id ||
            g_strcmp0(win->reminder_event_id, nearest_id) != 0)) {
            show_reminder(win, nearest_id, nearest_title, nearest_channel, nearest_start);
        }
        if (nearest_start) g_date_time_unref(nearest_start);
    }

    if (result) json_node_unref(result);
    if (error) g_error_free(error);

    g_date_time_unref(now);
    g_date_time_unref(end);

    return G_SOURCE_CONTINUE;
}

/* --- Navigation & action handlers --- */

static GtkWidget *make_nav_btn(const char *emoji_utf8, const char *label_text)
{
    GtkWidget *btn = gtk_button_new();
    GtkWidget *lbl = gtk_label_new(NULL);
    char *markup = g_strdup_printf(
        "<span size='16000'>%s</span>\n<span size='7500'>%s</span>",
        emoji_utf8, label_text);
    gtk_label_set_markup(GTK_LABEL(lbl), markup);
    gtk_label_set_justify(GTK_LABEL(lbl), GTK_JUSTIFY_CENTER);
    g_free(markup);
    gtk_container_add(GTK_CONTAINER(btn), lbl);
    GtkStyleContext *ctx = gtk_widget_get_style_context(btn);
    gtk_style_context_add_class(ctx, "nav-btn");
    return btn;
}

static void set_active_nav(AgoraMainWindow *win, GtkWidget *active_btn)
{
    gtk_style_context_remove_class(gtk_widget_get_style_context(win->nav_feed_btn), "nav-active");
    gtk_style_context_remove_class(gtk_widget_get_style_context(win->nav_chat_btn), "nav-active");
    gtk_style_context_remove_class(gtk_widget_get_style_context(win->nav_teams_btn), "nav-active");
    gtk_style_context_remove_class(gtk_widget_get_style_context(win->nav_calendar_btn), "nav-active");
    if (active_btn)
        gtk_style_context_add_class(gtk_widget_get_style_context(active_btn), "nav-active");
}

static void on_nav_chat_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    gtk_stack_set_visible_child_name(win->sidebar_stack, "chats");
    set_active_nav(win, win->nav_chat_btn);
}

static void on_nav_teams_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    gtk_stack_set_visible_child_name(win->sidebar_stack, "teams");
    set_active_nav(win, win->nav_teams_btn);
}

static void on_nav_feed_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    load_feed(win);
    gtk_stack_set_visible_child_name(win->content_stack, "feed");
    set_active_nav(win, win->nav_feed_btn);
}

static void on_nav_calendar_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *session = agora_app_get_session(app);
    char *url = g_strdup_printf("%s/calendar", session->base_url);
    g_app_info_launch_default_for_uri(url, NULL, NULL);
    g_free(url);
    set_active_nav(win, win->nav_calendar_btn);
}

static void on_video_leave_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (win->video_webview)
        webkit_web_view_load_uri(win->video_webview, "about:blank");
    gtk_widget_hide(win->video_overlay);
}

static void on_video_call_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!win->current_channel_id) return;

    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *session = agora_app_get_session(app);
    char *base = g_strdup(session->base_url);
    char *api_pos = g_strrstr(base, "/api");
    if (api_pos) *api_pos = '\0';
    char *url = g_strdup_printf("%s/video/%s?token=%s", base, win->current_channel_id, session->token);
    g_free(base);

    if (win->video_webview) {
        webkit_web_view_load_uri(win->video_webview, url);
        gtk_widget_show_all(win->video_overlay);
    } else {
        /* Fallback to browser */
        g_app_info_launch_default_for_uri(url, NULL, NULL);
    }
    g_free(url);
}

static void upload_file_to_channel(AgoraMainWindow *win, const char *filepath)
{
    if (!win->current_channel_id || !win->api) return;

    gchar *contents = NULL;
    gsize length = 0;
    GError *err = NULL;
    if (!g_file_get_contents(filepath, &contents, &length, &err)) {
        if (err) g_error_free(err);
        return;
    }

    char *basename_str = g_path_get_basename(filepath);

    const char *content_type = "application/octet-stream";
    const char *ext = strrchr(basename_str, '.');
    if (ext) {
        if (g_ascii_strcasecmp(ext, ".png") == 0) content_type = "image/png";
        else if (g_ascii_strcasecmp(ext, ".jpg") == 0 || g_ascii_strcasecmp(ext, ".jpeg") == 0) content_type = "image/jpeg";
        else if (g_ascii_strcasecmp(ext, ".gif") == 0) content_type = "image/gif";
        else if (g_ascii_strcasecmp(ext, ".pdf") == 0) content_type = "application/pdf";
        else if (g_ascii_strcasecmp(ext, ".txt") == 0) content_type = "text/plain";
    }

    SoupMultipart *multipart = soup_multipart_new("multipart/form-data");
    SoupBuffer *buffer = soup_buffer_new(SOUP_MEMORY_COPY, contents, length);
    soup_multipart_append_form_file(multipart, "file", basename_str, content_type, buffer);
    soup_buffer_free(buffer);
    g_free(contents);

    char *url = g_strdup_printf("%s/api/channels/%s/upload",
                                 win->api->base_url, win->current_channel_id);
    SoupMessage *msg = soup_form_request_new_from_multipart(url, multipart);
    g_free(url);
    soup_multipart_free(multipart);

    if (win->api->token) {
        char *auth = g_strdup_printf("Bearer %s", win->api->token);
        soup_message_headers_replace(msg->request_headers, "Authorization", auth);
        g_free(auth);
    }

    SoupSession *session = soup_session_new_with_options(SOUP_SESSION_SSL_STRICT, FALSE, NULL);
    soup_session_send_message(session, msg);

    g_object_unref(msg);
    g_object_unref(session);
    g_free(basename_str);
}

static void on_attach_file_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!win->current_channel_id) return;

    GtkWidget *dialog = gtk_file_chooser_dialog_new(
        T("chat.attach_file"),
        GTK_WINDOW(win),
        GTK_FILE_CHOOSER_ACTION_OPEN,
        "_Cancel", GTK_RESPONSE_CANCEL,
        "_Open", GTK_RESPONSE_ACCEPT,
        NULL);

    if (gtk_dialog_run(GTK_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
        char *filename = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
        if (filename) {
            upload_file_to_channel(win, filename);
            g_free(filename);
        }
    }

    gtk_widget_destroy(dialog);
}

/* --- Widget setup --- */

static void agora_main_window_finalize(GObject *obj)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(obj);
    disconnect_channel_ws(win);
    if (win->ws_session) g_object_unref(win->ws_session);
    agora_api_client_free(win->api);
    g_free(win->current_channel_id);
    g_free(win->current_channel_name);
    if (win->reminder_poll_timer) g_source_remove(win->reminder_poll_timer);
    if (win->reminder_tick_timer) g_source_remove(win->reminder_tick_timer);
    g_free(win->reminder_event_id);
    g_free(win->reminder_channel_id);
    if (win->reminder_start_time) g_date_time_unref(win->reminder_start_time);
    if (win->dismissed_reminders) g_hash_table_destroy(win->dismissed_reminders);
    g_free(win->notification_sound_path);
    G_OBJECT_CLASS(agora_main_window_parent_class)->finalize(obj);
}

static void agora_main_window_class_init(AgoraMainWindowClass *klass)
{
    G_OBJECT_CLASS(klass)->finalize = agora_main_window_finalize;
}

static void agora_main_window_init(AgoraMainWindow *win)
{
    /* Initialize libnotify */
    if (!notify_is_initted())
        notify_init("Agora");

    /* Initialize GStreamer for notification sounds */
    if (!gst_is_initialized())
        gst_init(NULL, NULL);

    win->ws_conn = NULL;
    win->ws_session = NULL;
    win->current_channel_name = NULL;
    win->reminder_event_id = NULL;
    win->reminder_channel_id = NULL;
    win->reminder_start_time = NULL;
    win->reminder_poll_timer = 0;
    win->reminder_tick_timer = 0;
    win->notification_sound_path = NULL;
    win->dismissed_reminders = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);

    gtk_window_set_title(GTK_WINDOW(win), "Agora");
    gtk_window_set_default_size(GTK_WINDOW(win), 1100, 650);
    gtk_window_set_position(GTK_WINDOW(win), GTK_WIN_POS_CENTER);

    /* --- Apply comprehensive CSS theme --- */
    GtkCssProvider *css_provider = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css_provider, app_css, -1, NULL);
    gtk_style_context_add_provider_for_screen(gdk_screen_get_default(),
        GTK_STYLE_PROVIDER(css_provider), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION + 1);
    g_object_unref(css_provider);

    /* ========================================================
     * 3-column layout: [nav 52px] | [sidebar 260px] | [content]
     * ======================================================== */
    GtkWidget *main_hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_container_add(GTK_CONTAINER(win), main_hbox);

    /* ===================== Column 1: Navigation sidebar ===================== */
    win->nav_sidebar = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_size_request(win->nav_sidebar, 52, -1);
    gtk_style_context_add_class(gtk_widget_get_style_context(win->nav_sidebar), "nav-sidebar");

    /* Nav buttons */
    win->nav_feed_btn = make_nav_btn("\xF0\x9F\x93\xB0", T("nav.feed"));       /* 📰 */
    win->nav_chat_btn = make_nav_btn("\xF0\x9F\x92\xAC", T("nav.chat"));       /* 💬 */
    win->nav_teams_btn = make_nav_btn("\xF0\x9F\x91\xA5", T("nav.teams"));     /* 👥 */
    win->nav_calendar_btn = make_nav_btn("\xF0\x9F\x93\x85", T("nav.calendar")); /* 📅 */

    g_signal_connect(win->nav_feed_btn, "clicked", G_CALLBACK(on_nav_feed_clicked), win);
    g_signal_connect(win->nav_chat_btn, "clicked", G_CALLBACK(on_nav_chat_clicked), win);
    g_signal_connect(win->nav_teams_btn, "clicked", G_CALLBACK(on_nav_teams_clicked), win);
    g_signal_connect(win->nav_calendar_btn, "clicked", G_CALLBACK(on_nav_calendar_clicked), win);

    gtk_box_pack_start(GTK_BOX(win->nav_sidebar), win->nav_feed_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(win->nav_sidebar), win->nav_chat_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(win->nav_sidebar), win->nav_teams_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(win->nav_sidebar), win->nav_calendar_btn, FALSE, FALSE, 0);

    /* Spacer pushes avatar to bottom */
    GtkWidget *nav_spacer = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_box_pack_start(GTK_BOX(win->nav_sidebar), nav_spacer, TRUE, TRUE, 0);

    /* User avatar circle at bottom of nav */
    GtkWidget *avatar_btn = gtk_button_new_with_label("A");
    gtk_style_context_add_class(gtk_widget_get_style_context(avatar_btn), "user-avatar");
    gtk_widget_set_halign(avatar_btn, GTK_ALIGN_CENTER);
    gtk_widget_set_margin_bottom(avatar_btn, 12);
    gtk_box_pack_start(GTK_BOX(win->nav_sidebar), avatar_btn, FALSE, FALSE, 0);

    /* Set Chat as active by default */
    set_active_nav(win, win->nav_chat_btn);

    gtk_box_pack_start(GTK_BOX(main_hbox), win->nav_sidebar, FALSE, FALSE, 0);

    /* ===================== Column 2: Channel/Team sidebar ===================== */
    GtkWidget *channel_sidebar = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_size_request(channel_sidebar, 260, -1);
    gtk_style_context_add_class(gtk_widget_get_style_context(channel_sidebar), "channel-sidebar");

    /* User header in sidebar */
    win->user_label = GTK_LABEL(gtk_label_new(""));
    gtk_style_context_add_class(gtk_widget_get_style_context(GTK_WIDGET(win->user_label)), "sidebar-header");
    gtk_widget_set_halign(GTK_WIDGET(win->user_label), GTK_ALIGN_START);
    gtk_widget_set_margin_start(GTK_WIDGET(win->user_label), 16);
    gtk_widget_set_margin_top(GTK_WIDGET(win->user_label), 14);
    gtk_widget_set_margin_bottom(GTK_WIDGET(win->user_label), 10);
    gtk_box_pack_start(GTK_BOX(channel_sidebar), GTK_WIDGET(win->user_label), FALSE, FALSE, 0);

    /* Sidebar stack (switches between Chats and Teams views) */
    win->sidebar_stack = GTK_STACK(gtk_stack_new());
    gtk_stack_set_transition_type(win->sidebar_stack, GTK_STACK_TRANSITION_TYPE_CROSSFADE);
    gtk_stack_set_transition_duration(win->sidebar_stack, 150);

    /* --- Chats page --- */
    GtkWidget *chats_page = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    GtkWidget *chats_label = gtk_label_new(NULL);
    char *chats_markup = g_strdup_printf("<b>%s</b>", T("chat.chats"));
    gtk_label_set_markup(GTK_LABEL(chats_label), chats_markup);
    g_free(chats_markup);
    gtk_style_context_add_class(gtk_widget_get_style_context(chats_label), "sidebar-section");
    gtk_widget_set_halign(chats_label, GTK_ALIGN_START);
    gtk_widget_set_margin_start(chats_label, 16);
    gtk_widget_set_margin_top(chats_label, 4);
    gtk_widget_set_margin_bottom(chats_label, 4);
    gtk_box_pack_start(GTK_BOX(chats_page), chats_label, FALSE, FALSE, 0);

    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->channel_list = GTK_LIST_BOX(gtk_list_box_new());
    g_signal_connect(win->channel_list, "row-selected",
                     G_CALLBACK(on_channel_selected), win);
    gtk_container_add(GTK_CONTAINER(scroll), GTK_WIDGET(win->channel_list));
    gtk_box_pack_start(GTK_BOX(chats_page), scroll, TRUE, TRUE, 0);

    gtk_stack_add_named(win->sidebar_stack, chats_page, "chats");

    /* --- Teams page --- */
    GtkWidget *teams_page = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    GtkWidget *teams_label = gtk_label_new(NULL);
    char *teams_markup = g_strdup_printf("<b>%s</b>", T("teams.teams"));
    gtk_label_set_markup(GTK_LABEL(teams_label), teams_markup);
    g_free(teams_markup);
    gtk_style_context_add_class(gtk_widget_get_style_context(teams_label), "sidebar-section");
    gtk_widget_set_halign(teams_label, GTK_ALIGN_START);
    gtk_widget_set_margin_start(teams_label, 16);
    gtk_widget_set_margin_top(teams_label, 4);
    gtk_widget_set_margin_bottom(teams_label, 4);
    gtk_box_pack_start(GTK_BOX(teams_page), teams_label, FALSE, FALSE, 0);

    GtkWidget *team_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(team_scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->team_list = GTK_LIST_BOX(gtk_list_box_new());
    g_signal_connect(win->team_list, "row-selected",
                     G_CALLBACK(on_team_selected), win);
    gtk_container_add(GTK_CONTAINER(team_scroll), GTK_WIDGET(win->team_list));
    gtk_box_pack_start(GTK_BOX(teams_page), team_scroll, TRUE, TRUE, 0);

    /* Team channels (hidden until a team is selected) */
    win->team_channels_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_no_show_all(win->team_channels_box, TRUE);

    win->team_channels_header = GTK_LABEL(gtk_label_new(""));
    PangoAttrList *tch_attrs = pango_attr_list_new();
    pango_attr_list_insert(tch_attrs, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
    gtk_label_set_attributes(win->team_channels_header, tch_attrs);
    pango_attr_list_unref(tch_attrs);
    gtk_widget_set_halign(GTK_WIDGET(win->team_channels_header), GTK_ALIGN_START);
    gtk_widget_set_margin_start(GTK_WIDGET(win->team_channels_header), 16);
    gtk_widget_set_margin_top(GTK_WIDGET(win->team_channels_header), 8);
    gtk_box_pack_start(GTK_BOX(win->team_channels_box), GTK_WIDGET(win->team_channels_header), FALSE, FALSE, 0);

    win->team_channel_list = GTK_LIST_BOX(gtk_list_box_new());
    g_signal_connect(win->team_channel_list, "row-selected",
                     G_CALLBACK(on_team_channel_selected), win);
    gtk_box_pack_start(GTK_BOX(win->team_channels_box), GTK_WIDGET(win->team_channel_list), FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(teams_page), win->team_channels_box, FALSE, FALSE, 0);

    gtk_stack_add_named(win->sidebar_stack, teams_page, "teams");

    /* Show chats by default */
    gtk_stack_set_visible_child_name(win->sidebar_stack, "chats");

    gtk_box_pack_start(GTK_BOX(channel_sidebar), GTK_WIDGET(win->sidebar_stack), TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(main_hbox), channel_sidebar, FALSE, FALSE, 0);

    /* ===================== Column 3: Content area ===================== */
    GtkWidget *right_vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* --- Event Reminder Bar (above content stack) --- */
    win->reminder_bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 12);
    GtkStyleContext *ctx = gtk_widget_get_style_context(win->reminder_bar);
    gtk_style_context_add_class(ctx, "reminder-bar");
    gtk_container_set_border_width(GTK_CONTAINER(win->reminder_bar), 0);

    GtkWidget *bell_label = gtk_label_new("\xF0\x9F\x94\x94");  /* 🔔 */
    gtk_box_pack_start(GTK_BOX(win->reminder_bar), bell_label, FALSE, FALSE, 0);

    GtkWidget *reminder_info = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
    win->reminder_title_label = GTK_LABEL(gtk_label_new(""));
    ctx = gtk_widget_get_style_context(GTK_WIDGET(win->reminder_title_label));
    gtk_style_context_add_class(ctx, "reminder-title");
    gtk_widget_set_halign(GTK_WIDGET(win->reminder_title_label), GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(reminder_info), GTK_WIDGET(win->reminder_title_label), FALSE, FALSE, 0);

    win->reminder_countdown_label = GTK_LABEL(gtk_label_new(""));
    ctx = gtk_widget_get_style_context(GTK_WIDGET(win->reminder_countdown_label));
    gtk_style_context_add_class(ctx, "reminder-countdown");
    gtk_widget_set_halign(GTK_WIDGET(win->reminder_countdown_label), GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(reminder_info), GTK_WIDGET(win->reminder_countdown_label), FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(win->reminder_bar), reminder_info, TRUE, TRUE, 0);

    win->reminder_join_btn = gtk_button_new_with_label(T("reminder.join"));
    g_signal_connect(win->reminder_join_btn, "clicked", G_CALLBACK(on_reminder_join_clicked), win);
    gtk_box_pack_start(GTK_BOX(win->reminder_bar), win->reminder_join_btn, FALSE, FALSE, 0);

    GtkWidget *dismiss_btn = gtk_button_new_with_label(T("reminder.dismiss"));
    g_signal_connect(dismiss_btn, "clicked", G_CALLBACK(on_reminder_dismiss_clicked), win);
    gtk_box_pack_start(GTK_BOX(win->reminder_bar), dismiss_btn, FALSE, FALSE, 0);

    gtk_widget_set_no_show_all(win->reminder_bar, TRUE);
    gtk_box_pack_start(GTK_BOX(right_vbox), win->reminder_bar, FALSE, FALSE, 0);

    /* --- Content stack --- */
    win->content_stack = GTK_STACK(gtk_stack_new());

    /* Empty / welcome state */
    GtkWidget *empty_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 8);
    gtk_widget_set_valign(empty_box, GTK_ALIGN_CENTER);
    gtk_widget_set_halign(empty_box, GTK_ALIGN_CENTER);

    GtkWidget *welcome = gtk_label_new(NULL);
    char *welcome_markup = g_strdup_printf(
        "<span size='x-large' weight='bold' color='#6264a7'>%s</span>", T("welcome.title"));
    gtk_label_set_markup(GTK_LABEL(welcome), welcome_markup);
    g_free(welcome_markup);
    gtk_style_context_add_class(gtk_widget_get_style_context(welcome), "welcome-title");
    gtk_box_pack_start(GTK_BOX(empty_box), welcome, FALSE, FALSE, 0);

    GtkWidget *hint = gtk_label_new(T("welcome.subtitle"));
    gtk_box_pack_start(GTK_BOX(empty_box), hint, FALSE, FALSE, 0);

    gtk_stack_add_named(win->content_stack, empty_box, "empty");

    /* Feed view with scrollable list */
    GtkWidget *feed_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* Feed header */
    GtkWidget *feed_header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_container_set_border_width(GTK_CONTAINER(feed_header), 0);
    gtk_style_context_add_class(gtk_widget_get_style_context(feed_header), "chat-header");

    GtkWidget *feed_title = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(feed_title),
        "<span weight='bold' size='large'>Activity Feed</span>");
    gtk_widget_set_margin_start(feed_title, 16);
    gtk_widget_set_margin_top(feed_title, 12);
    gtk_widget_set_margin_bottom(feed_title, 12);
    gtk_box_pack_start(GTK_BOX(feed_header), feed_title, TRUE, TRUE, 0);
    gtk_widget_set_halign(feed_title, GTK_ALIGN_START);

    gtk_box_pack_start(GTK_BOX(feed_box), feed_header, FALSE, FALSE, 0);

    /* Scrollable feed list */
    win->feed_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(win->feed_scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->feed_list = GTK_LIST_BOX(gtk_list_box_new());
    g_signal_connect(win->feed_list, "row-activated",
                     G_CALLBACK(on_feed_row_activated), win);
    gtk_container_add(GTK_CONTAINER(win->feed_scroll), GTK_WIDGET(win->feed_list));
    gtk_box_pack_start(GTK_BOX(feed_box), win->feed_scroll, TRUE, TRUE, 0);

    gtk_stack_add_named(win->content_stack, feed_box, "feed");

    /* --- Chat view --- */
    win->chat_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* Chat header bar with title + action buttons */
    GtkWidget *chat_header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_style_context_add_class(gtk_widget_get_style_context(chat_header), "chat-header");
    gtk_container_set_border_width(GTK_CONTAINER(chat_header), 0);

    win->chat_title = GTK_LABEL(gtk_label_new(""));
    PangoAttrList *title_attrs = pango_attr_list_new();
    pango_attr_list_insert(title_attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
    pango_attr_list_insert(title_attrs, pango_attr_size_new(14 * PANGO_SCALE));
    gtk_label_set_attributes(win->chat_title, title_attrs);
    pango_attr_list_unref(title_attrs);
    gtk_widget_set_halign(GTK_WIDGET(win->chat_title), GTK_ALIGN_START);
    gtk_widget_set_margin_start(GTK_WIDGET(win->chat_title), 16);
    gtk_widget_set_margin_top(GTK_WIDGET(win->chat_title), 12);
    gtk_widget_set_margin_bottom(GTK_WIDGET(win->chat_title), 12);
    gtk_box_pack_start(GTK_BOX(chat_header), GTK_WIDGET(win->chat_title), TRUE, TRUE, 0);

    /* Video call button */
    win->video_btn = gtk_button_new_with_label("\xF0\x9F\x93\xB9");  /* 📹 */
    gtk_style_context_add_class(gtk_widget_get_style_context(win->video_btn), "chat-header-btn");
    gtk_widget_set_tooltip_text(win->video_btn, T("chat.video_call"));
    gtk_widget_set_valign(win->video_btn, GTK_ALIGN_CENTER);
    g_signal_connect(win->video_btn, "clicked", G_CALLBACK(on_video_call_clicked), win);
    gtk_box_pack_start(GTK_BOX(chat_header), win->video_btn, FALSE, FALSE, 0);

    /* Attach file button (header) */
    win->attach_header_btn = gtk_button_new_with_label("\xF0\x9F\x93\x8E");  /* 📎 */
    gtk_style_context_add_class(gtk_widget_get_style_context(win->attach_header_btn), "chat-header-btn");
    gtk_widget_set_tooltip_text(win->attach_header_btn, T("chat.attach_file"));
    gtk_widget_set_valign(win->attach_header_btn, GTK_ALIGN_CENTER);
    gtk_widget_set_margin_end(win->attach_header_btn, 8);
    g_signal_connect(win->attach_header_btn, "clicked", G_CALLBACK(on_attach_file_clicked), win);
    gtk_box_pack_start(GTK_BOX(chat_header), win->attach_header_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(win->chat_box), chat_header, FALSE, FALSE, 0);

    /* Message view */
    GtkWidget *msg_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(msg_scroll),
                                   GTK_POLICY_AUTOMATIC, GTK_POLICY_AUTOMATIC);
    win->message_view = GTK_TEXT_VIEW(gtk_text_view_new());
    win->message_buffer = gtk_text_view_get_buffer(win->message_view);
    gtk_text_view_set_editable(win->message_view, FALSE);
    gtk_text_view_set_cursor_visible(win->message_view, FALSE);
    gtk_text_view_set_wrap_mode(win->message_view, GTK_WRAP_WORD_CHAR);
    gtk_text_view_set_left_margin(win->message_view, 16);
    gtk_text_view_set_right_margin(win->message_view, 16);
    gtk_text_view_set_top_margin(win->message_view, 12);
    gtk_text_view_set_bottom_margin(win->message_view, 8);
    gtk_container_add(GTK_CONTAINER(msg_scroll), GTK_WIDGET(win->message_view));
    gtk_box_pack_start(GTK_BOX(win->chat_box), msg_scroll, TRUE, TRUE, 0);

    /* Typing indicator */
    win->typing_label = GTK_LABEL(gtk_label_new(""));
    gtk_widget_set_halign(GTK_WIDGET(win->typing_label), GTK_ALIGN_START);
    gtk_widget_set_margin_start(GTK_WIDGET(win->typing_label), 16);
    gtk_widget_set_margin_top(GTK_WIDGET(win->typing_label), 2);
    gtk_widget_set_margin_bottom(GTK_WIDGET(win->typing_label), 2);
    PangoAttrList *typing_attrs = pango_attr_list_new();
    pango_attr_list_insert(typing_attrs, pango_attr_scale_new(0.85));
    pango_attr_list_insert(typing_attrs, pango_attr_style_new(PANGO_STYLE_ITALIC));
    gtk_label_set_attributes(win->typing_label, typing_attrs);
    pango_attr_list_unref(typing_attrs);
    gtk_widget_set_no_show_all(GTK_WIDGET(win->typing_label), TRUE);
    gtk_box_pack_start(GTK_BOX(win->chat_box), GTK_WIDGET(win->typing_label),
                       FALSE, FALSE, 0);

    /* Input area with buttons */
    GtkWidget *input_area = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
    gtk_style_context_add_class(gtk_widget_get_style_context(input_area), "input-area");
    gtk_container_set_border_width(GTK_CONTAINER(input_area), 8);

    /* Attach file button (input) */
    GtkWidget *attach_input_btn = gtk_button_new_with_label("\xF0\x9F\x93\x8E");  /* 📎 */
    gtk_style_context_add_class(gtk_widget_get_style_context(attach_input_btn), "input-btn");
    gtk_widget_set_tooltip_text(attach_input_btn, T("chat.attach_file"));
    g_signal_connect(attach_input_btn, "clicked", G_CALLBACK(on_attach_file_clicked), win);
    gtk_box_pack_start(GTK_BOX(input_area), attach_input_btn, FALSE, FALSE, 0);

    /* Emoji button */
    GtkWidget *emoji_btn = gtk_button_new_with_label("\xF0\x9F\x98\x8A");  /* 😊 */
    gtk_style_context_add_class(gtk_widget_get_style_context(emoji_btn), "input-btn");
    gtk_widget_set_tooltip_text(emoji_btn, "Emoji");
    gtk_box_pack_start(GTK_BOX(input_area), emoji_btn, FALSE, FALSE, 0);

    /* Message entry */
    win->message_entry = GTK_ENTRY(gtk_entry_new());
    gtk_style_context_add_class(gtk_widget_get_style_context(GTK_WIDGET(win->message_entry)), "message-entry");
    gtk_entry_set_placeholder_text(win->message_entry, T("chat.input_placeholder"));
    g_signal_connect(win->message_entry, "activate",
                     G_CALLBACK(on_entry_activate), win);
    g_signal_connect(win->message_entry, "changed",
                     G_CALLBACK(on_entry_changed), win);
    gtk_box_pack_start(GTK_BOX(input_area), GTK_WIDGET(win->message_entry), TRUE, TRUE, 0);

    /* Send button */
    GtkWidget *send_btn = gtk_button_new_with_label(T("chat.send"));
    gtk_style_context_add_class(gtk_widget_get_style_context(send_btn), "send-btn");
    g_signal_connect(send_btn, "clicked", G_CALLBACK(on_send_clicked), win);
    gtk_box_pack_start(GTK_BOX(input_area), send_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(win->chat_box), input_area, FALSE, FALSE, 0);

    gtk_stack_add_named(win->content_stack, win->chat_box, "chat");
    gtk_stack_set_visible_child_name(win->content_stack, "empty");

    gtk_box_pack_start(GTK_BOX(right_vbox), GTK_WIDGET(win->content_stack), TRUE, TRUE, 0);

    /* --- Video call overlay (hidden by default) --- */
    win->video_overlay = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_no_show_all(win->video_overlay, TRUE);

    /* Video header with leave button */
    GtkWidget *video_header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    GdkRGBA video_header_bg = {0.15, 0.15, 0.15, 1.0};
    gtk_widget_override_background_color(video_header, GTK_STATE_FLAG_NORMAL, &video_header_bg);
    gtk_container_set_border_width(GTK_CONTAINER(video_header), 8);

    GtkWidget *video_title = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(video_title),
        "<span color='white' weight='bold'>Video Call</span>");
    gtk_box_pack_start(GTK_BOX(video_header), video_title, TRUE, TRUE, 0);
    gtk_widget_set_halign(video_title, GTK_ALIGN_START);

    GtkWidget *leave_btn = gtk_button_new_with_label(T("video.leave"));
    GdkRGBA leave_bg = {0.8, 0.2, 0.2, 1.0};
    GdkRGBA leave_fg = {1.0, 1.0, 1.0, 1.0};
    gtk_widget_override_background_color(leave_btn, GTK_STATE_FLAG_NORMAL, &leave_bg);
    gtk_widget_override_color(leave_btn, GTK_STATE_FLAG_NORMAL, &leave_fg);
    g_signal_connect(leave_btn, "clicked", G_CALLBACK(on_video_leave_clicked), win);
    gtk_box_pack_end(GTK_BOX(video_header), leave_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(win->video_overlay), video_header, FALSE, FALSE, 0);

    /* WebKitWebView for video */
    /* Create WebView for video calls */
    win->video_webview = WEBKIT_WEB_VIEW(webkit_web_view_new());
    WebKitSettings *web_settings = webkit_web_view_get_settings(win->video_webview);
    webkit_settings_set_enable_media_stream(web_settings, TRUE);
    webkit_settings_set_enable_mediasource(web_settings, TRUE);
    webkit_settings_set_enable_webaudio(web_settings, TRUE);
    webkit_settings_set_media_playback_requires_user_gesture(web_settings, FALSE);

    /* Accept self-signed TLS certs */
    WebKitWebContext *wv_ctx = webkit_web_view_get_context(win->video_webview);
    WebKitWebsiteDataManager *wv_data_mgr = webkit_web_context_get_website_data_manager(wv_ctx);
    webkit_website_data_manager_set_tls_errors_policy(wv_data_mgr, WEBKIT_TLS_ERRORS_POLICY_IGNORE);

    gtk_box_pack_start(GTK_BOX(win->video_overlay), GTK_WIDGET(win->video_webview), TRUE, TRUE, 0);

    gtk_box_pack_start(GTK_BOX(right_vbox), win->video_overlay, TRUE, TRUE, 0);

    gtk_box_pack_start(GTK_BOX(main_hbox), right_vbox, TRUE, TRUE, 0);

    gtk_widget_show_all(main_hbox);
}

GtkWidget *agora_main_window_new(AgoraApp *app)
{
    AgoraMainWindow *win = g_object_new(AGORA_TYPE_MAIN_WINDOW,
                                         "application", app,
                                         NULL);

    /* Initialize API client */
    AgoraSession *session = agora_app_get_session(app);
    win->api = agora_api_client_new(session->base_url);
    agora_api_client_set_token(win->api, session->token);

    /* Set user info */
    gtk_label_set_text(win->user_label, session->display_name ? session->display_name : T("common.user"));

    /* Download notification sound */
    download_notification_sound(win);

    /* Load channels, teams, and feed */
    load_channels(win);
    load_teams(win);
    load_feed(win);

    /* Start event reminder polling (every 60 seconds) */
    check_event_reminders(win);
    win->reminder_poll_timer = g_timeout_add_seconds(60, check_event_reminders, win);

    return GTK_WIDGET(win);
}
