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
    GtkWidget *team_tree_box;  /* VBox with GtkExpanders for tree structure */
    GtkLabel *user_label;

    /* Chat area */
    GtkStack *content_stack;
    GtkLabel *chat_title;
    GtkLabel *chat_subtitle;
    GtkListBox *message_list;
    GtkWidget *message_scroll;
    GtkEntry *message_entry;
    GtkWidget *chat_box;
    GtkLabel *typing_label;

    /* Chat header buttons */
    GtkWidget *video_btn;
    GtkWidget *attach_header_btn;

    /* Feed */
    GtkListBox *feed_list;
    GtkWidget *feed_scroll;
    GtkWidget *feed_all_btn;
    GtkWidget *feed_unread_btn;
    gboolean feed_unread_only;

    /* Calendar */
    GtkWidget *gtk_calendar;
    GtkListBox *calendar_list;
    GtkWidget *calendar_scroll;
    JsonArray *calendar_events_cache;

    /* Video call overlay */
    GtkWidget *video_overlay;
    GtkWidget *right_overlay;
    WebKitWebView *video_webview;

    /* State */
    char *current_channel_id;
    char *current_channel_name;

    /* WebSocket */
    SoupWebsocketConnection *ws_conn;
    SoupSession *ws_session;

    /* Notification WebSocket */
    SoupWebsocketConnection *notif_ws_conn;
    SoupSession *notif_ws_session;

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

    /* Currently selected team */
    char *current_team_id;
    char *current_team_name;

    /* Team detail view */
    GtkWidget *team_detail_box;
    GtkLabel  *team_detail_title;
    GtkLabel  *team_detail_subtitle;
    GtkNotebook *team_detail_notebook;

    /* Team detail – Channels tab */
    GtkListBox *team_channels_list;

    /* Team detail – Members tab */
    GtkListBox *team_members_list;
    GtkEntry   *team_member_search_entry;
    GtkListBox *team_member_search_results;
    GtkWidget  *team_member_search_box;

    /* Team detail – Files tab */
    GtkListBox *team_files_list;

    /* Reply / Edit state */
    char *reply_to_id;
    char *reply_to_sender;
    char *reply_to_content;
    char *editing_message_id;
    GtkWidget *reply_bar;
    GtkLabel *reply_bar_label;
};

G_DEFINE_TYPE(AgoraMainWindow, agora_main_window, GTK_TYPE_APPLICATION_WINDOW)

/* Forward declarations */
static void connect_channel_ws(AgoraMainWindow *win, const char *channel_id);
static void disconnect_channel_ws(AgoraMainWindow *win);
static void connect_notification_ws(AgoraMainWindow *win);
static void disconnect_notification_ws(AgoraMainWindow *win);
static void play_notification_sound(AgoraMainWindow *win);
static void update_chat_subtitle_status(AgoraMainWindow *win, const char *channel_id);
static void download_notification_sound(AgoraMainWindow *win);
static void show_notification(const char *title, const char *body);
static void set_active_nav(AgoraMainWindow *win, GtkWidget *active_btn);
static void upload_file_to_channel(AgoraMainWindow *win, const char *filepath);
static void inject_video_user_scripts(AgoraMainWindow *win);
static void load_feed(AgoraMainWindow *win);
static void load_calendar_events(AgoraMainWindow *win);
static void populate_calendar_day_events(AgoraMainWindow *win);
static void on_calendar_day_selected(GtkCalendar *calendar, gpointer data);
static void on_calendar_month_changed(GtkCalendar *calendar, gpointer data);
static void load_messages(AgoraMainWindow *win, const char *channel_id);
static void on_feed_show_all_toggled(GtkToggleButton *btn, gpointer data);
static void on_feed_show_unread_toggled(GtkToggleButton *btn, gpointer data);
static void on_calendar_join_clicked(GtkButton *btn, gpointer data);
static void on_calendar_new_event_clicked(GtkButton *btn, gpointer data);
static void on_video_call_clicked(GtkButton *btn, gpointer data);
static void ws_send_json(AgoraMainWindow *win, const char *json_str);
static void show_team_detail(AgoraMainWindow *win, const char *team_id, const char *team_name);
static void load_team_detail_channels(AgoraMainWindow *win);
static void load_team_detail_members(AgoraMainWindow *win);
static void load_team_detail_files(AgoraMainWindow *win);

/* Safely clear all children from a GtkListBox, avoiding dangling
   cursor/selection pointers that cause GTK_IS_WIDGET assertions. */
static void clear_list_box(GtkListBox *list)
{
    GtkSelectionMode mode = gtk_list_box_get_selection_mode(list);
    /* Temporarily switch to NONE so GTK clears its internal row pointers */
    gtk_list_box_set_selection_mode(list, GTK_SELECTION_NONE);
    GList *children = gtk_container_get_children(GTK_CONTAINER(list));
    for (GList *l = children; l; l = l->next)
        gtk_widget_destroy(GTK_WIDGET(l->data));
    g_list_free(children);
    /* Restore original selection mode */
    gtk_list_box_set_selection_mode(list, mode);
}

static void load_channels(AgoraMainWindow *win); /* forward decl */
static GtkWidget *create_avatar_widget(const char *name, int size); /* forward decl */
static char *format_msg_time(const char *iso_str); /* forward decl */
static char *format_relative_time(const char *iso_str); /* forward decl */

/* Idle callback: reload channel list outside of signal handlers so that
   GTK's internal click processing has finished and no row pointers dangle. */
static gboolean reload_channels_idle(gpointer data)
{
    load_channels(AGORA_MAIN_WINDOW(data));
    return G_SOURCE_REMOVE;
}

/* Accept self-signed certificates callback */
static gboolean accept_cert_cb(SoupMessage *msg, GTlsCertificate *cert,
                                GTlsCertificateFlags errors, gpointer data)
{
    (void)msg; (void)cert; (void)errors; (void)data;
    return TRUE;
}

/* Helper: read full body from GInputStream */
static char *read_stream_full(GInputStream *stream, gsize *out_length)
{
    GByteArray *array = g_byte_array_new();
    guint8 buf[4096];
    gssize n;
    while ((n = g_input_stream_read(stream, buf, sizeof(buf), NULL, NULL)) > 0)
        g_byte_array_append(array, buf, (guint)n);
    if (out_length) *out_length = array->len;
    g_byte_array_append(array, (guint8 *)"\0", 1);
    return (char *)g_byte_array_free(array, FALSE);
}

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
    /* Message bubbles */
    ".msg-own { background-color: #E8E5FC; border-radius: 12px 12px 2px 12px; }"
    ".msg-other { background-color: #F0F0F0; border-radius: 12px 12px 12px 2px; }"
    ".msg-reply { background-color: #E0E0E0; border-left: 3px solid #6264a7; "
    "  border-radius: 3px; padding: 4px 8px; margin-bottom: 4px; }"
    /* Reaction badges */
    ".reaction-badge { background-image: none; background-color: #E0E0E0; "
    "  border-radius: 12px; padding: 2px 6px; border: none; box-shadow: none; "
    "  font-size: 12px; min-height: 0; min-width: 0; }"
    ".reaction-badge:hover { background-color: #D0D0D0; }"
    /* Feed filter toggle buttons */
    ".feed-filter-btn { background-image: none; background-color: #f0f0f0; "
    "  border: 1px solid #cccccc; color: #666666; padding: 4px 14px; "
    "  box-shadow: none; font-weight: normal; }"
    ".feed-filter-btn:hover { background-color: #e0e0e0; }"
    ".feed-filter-btn:checked { background-image: none; background-color: #6264a7; "
    "  color: #ffffff; border-color: #6264a7; font-weight: bold; }"
    ".feed-filter-btn:checked label { color: #ffffff; }"
    /* Day separator */
    ".day-sep-box { margin: 12px 16px; }"
    ".day-sep-line { background-color: #e0e0e0; min-height: 1px; }"
    ".day-sep-label { color: #616161; font-size: 12px; padding: 0 12px; }"
    /* Message Teams-style flat layout */
    ".msg-flat { padding: 8px 16px 4px 16px; }"
    ".msg-flat:hover { background-color: #f5f5f5; }"
    /* Calendar week view */
    ".cal-week-header { background-color: #fafafa; border-bottom: 1px solid #e0e0e0; padding: 6px 0; }"
    ".cal-day-col { border-right: 1px solid #f0f0f0; }"
    ".cal-today-col { background-color: #F5F3FF; }"
    ".cal-hour-row { border-bottom: 1px solid #f5f5f5; min-height: 48px; }"
    ".cal-hour-label { color: #888888; padding: 2px 8px; }"
    ".cal-event-pill { background-color: #6264a7; color: #ffffff; border-radius: 4px; "
    "  padding: 2px 6px; margin: 1px 2px; }"
    ".cal-now-line { background-color: #e74856; min-height: 2px; }"
    /* Teams sidebar tree style */
    ".team-tree-row { padding: 4px 8px 4px 16px; }"
    ".team-tree-channel { padding: 3px 8px 3px 32px; }"
    ".team-settings-btn { background-image: none; background-color: transparent; border: none; "
    "  color: #9e9e9e; min-width: 28px; min-height: 28px; padding: 2px 4px; box-shadow: none; }"
    ".team-settings-btn:hover { color: #ffffff; background-color: alpha(white, 0.08); }"
;

/* --- Leave channel --- */

static void on_leave_channel_activate(GtkMenuItem *item, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *channel_id = g_object_get_data(G_OBJECT(item), "channel-id");
    if (!channel_id) return;

    char *path = g_strdup_printf("/api/channels/%s/members/me", channel_id);
    GError *error = NULL;
    agora_api_client_delete(win->api, path, &error);
    g_free(path);

    if (error) {
        g_printerr("[Leave] ERROR leaving channel %s: %s\n", channel_id, error->message);
        g_error_free(error);
        return;
    }

    g_print("[Leave] Left channel %s\n", channel_id);

    /* If we left the currently open channel, clear chat */
    if (win->current_channel_id && g_strcmp0(win->current_channel_id, channel_id) == 0) {
        g_free(win->current_channel_id);
        win->current_channel_id = NULL;
        gtk_label_set_text(win->chat_title, "");
        gtk_stack_set_visible_child_name(win->content_stack, "welcome");
    }

    /* Reload channel list */
    load_channels(win);
}

static gboolean on_channel_row_button_press(GtkWidget *widget, GdkEventButton *event,
                                             gpointer data)
{
    if (event->type != GDK_BUTTON_PRESS || event->button != 3)
        return FALSE; /* Only handle right-click */

    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);

    /* Find the GtkListBoxRow ancestor */
    GtkWidget *row = widget;
    while (row && !GTK_IS_LIST_BOX_ROW(row))
        row = gtk_widget_get_parent(row);
    if (!row) return FALSE;

    const char *channel_id = g_object_get_data(G_OBJECT(row), "channel-id");
    if (!channel_id) return FALSE;

    GtkWidget *menu = gtk_menu_new();
    GtkWidget *leave_item = gtk_menu_item_new_with_label(T("chat.leave_channel"));
    g_object_set_data_full(G_OBJECT(leave_item), "channel-id", g_strdup(channel_id), g_free);
    g_signal_connect(leave_item, "activate", G_CALLBACK(on_leave_channel_activate), win);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), leave_item);
    gtk_widget_show_all(menu);
    gtk_menu_popup_at_pointer(GTK_MENU(menu), (GdkEvent *)event);

    return TRUE;
}

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
    clear_list_box(win->channel_list);

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    for (guint i = 0; i < len; i++) {
        JsonObject *ch = json_array_get_object_element(arr, i);
        const char *id = json_object_get_string_member(ch, "id");
        const char *name = json_object_get_string_member(ch, "name");

        /* Skip team channels - they belong in the Teams view */
        const char *channel_type = json_object_has_member(ch, "channel_type")
            ? json_object_get_string_member(ch, "channel_type") : NULL;
        gboolean has_team_id = json_object_has_member(ch, "team_id") &&
            !json_object_get_null_member(ch, "team_id");
        if (has_team_id || (channel_type && g_strcmp0(channel_type, "team") == 0))
            continue;

        gint64 member_count = json_object_get_int_member(ch, "member_count");
        gint64 unread = 0;
        if (json_object_has_member(ch, "unread_count"))
            unread = json_object_get_int_member(ch, "unread_count");

        /* Last message preview (if available from API) */
        const char *last_msg_preview = json_object_has_member(ch, "last_message_preview") &&
            !json_object_get_null_member(ch, "last_message_preview")
            ? json_object_get_string_member(ch, "last_message_preview") : NULL;
        const char *last_msg_time = json_object_has_member(ch, "last_message_time") &&
            !json_object_get_null_member(ch, "last_message_time")
            ? json_object_get_string_member(ch, "last_message_time") : NULL;

        /* Teams-style row: [Avatar 32px] [Name + preview] [Time + badge] */
        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
        gtk_container_set_border_width(GTK_CONTAINER(row_box), 8);

        /* Avatar circle */
        GtkWidget *ch_avatar = create_avatar_widget(name, 32);
        gtk_widget_set_valign(ch_avatar, GTK_ALIGN_CENTER);
        gtk_box_pack_start(GTK_BOX(row_box), ch_avatar, FALSE, FALSE, 0);

        /* Text column */
        GtkWidget *text_col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);

        /* Channel name + unread */
        GtkWidget *hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
        GtkWidget *name_label = gtk_label_new(name);
        gtk_label_set_ellipsize(GTK_LABEL(name_label), PANGO_ELLIPSIZE_END);
        gtk_widget_set_halign(name_label, GTK_ALIGN_START);
        PangoAttrList *attrs = pango_attr_list_new();
        if (unread > 0)
            pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
        else
            pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
        gtk_label_set_attributes(GTK_LABEL(name_label), attrs);
        pango_attr_list_unref(attrs);
        gtk_box_pack_start(GTK_BOX(hbox), name_label, TRUE, TRUE, 0);

        /* Time on the right of the name row */
        if (last_msg_time) {
            char *rel_time = format_relative_time(last_msg_time);
            GtkWidget *time_label = gtk_label_new(rel_time);
            g_free(rel_time);
            PangoAttrList *time_attrs = pango_attr_list_new();
            pango_attr_list_insert(time_attrs, pango_attr_scale_new(0.8));
            pango_attr_list_insert(time_attrs, pango_attr_foreground_new(0x9900, 0x9900, 0x9900));
            gtk_label_set_attributes(GTK_LABEL(time_label), time_attrs);
            pango_attr_list_unref(time_attrs);
            gtk_box_pack_end(GTK_BOX(hbox), time_label, FALSE, FALSE, 0);
        }
        gtk_box_pack_start(GTK_BOX(text_col), hbox, FALSE, FALSE, 0);

        /* Preview line: last message or member count */
        GtkWidget *preview_hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
        char *preview_display;
        if (last_msg_preview && strlen(last_msg_preview) > 0) {
            preview_display = g_strdup(last_msg_preview);
        } else {
            preview_display = g_strdup_printf("%ld %s", (long)member_count, T("chat.members"));
        }
        GtkWidget *preview_label = gtk_label_new(preview_display);
        g_free(preview_display);
        gtk_label_set_ellipsize(GTK_LABEL(preview_label), PANGO_ELLIPSIZE_END);
        gtk_label_set_max_width_chars(GTK_LABEL(preview_label), 30);
        gtk_widget_set_halign(preview_label, GTK_ALIGN_START);
        PangoAttrList *small_attrs = pango_attr_list_new();
        pango_attr_list_insert(small_attrs, pango_attr_scale_new(0.85));
        pango_attr_list_insert(small_attrs, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
        gtk_label_set_attributes(GTK_LABEL(preview_label), small_attrs);
        pango_attr_list_unref(small_attrs);
        gtk_box_pack_start(GTK_BOX(preview_hbox), preview_label, TRUE, TRUE, 0);

        /* Unread badge */
        if (unread > 0) {
            char *badge = g_strdup_printf(" %ld ", (long)unread);
            GtkWidget *badge_label = gtk_label_new(badge);
            g_free(badge);
            PangoAttrList *badge_attrs = pango_attr_list_new();
            pango_attr_list_insert(badge_attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
            pango_attr_list_insert(badge_attrs, pango_attr_foreground_new(0x6200, 0x6400, 0xa700));
            pango_attr_list_insert(badge_attrs, pango_attr_scale_new(0.8));
            gtk_label_set_attributes(GTK_LABEL(badge_label), badge_attrs);
            pango_attr_list_unref(badge_attrs);
            gtk_box_pack_end(GTK_BOX(preview_hbox), badge_label, FALSE, FALSE, 0);
        }
        gtk_box_pack_start(GTK_BOX(text_col), preview_hbox, FALSE, FALSE, 0);

        gtk_box_pack_start(GTK_BOX(row_box), text_col, TRUE, TRUE, 0);

        GtkWidget *row = gtk_list_box_row_new();
        g_object_set_data_full(G_OBJECT(row), "channel-id", g_strdup(id), g_free);
        g_object_set_data_full(G_OBJECT(row), "channel-name", g_strdup(name), g_free);
        gtk_container_add(GTK_CONTAINER(row), row_box);

        /* Right-click context menu for leaving channel */
        gtk_widget_add_events(row, GDK_BUTTON_PRESS_MASK);
        g_signal_connect(row, "button-press-event",
                         G_CALLBACK(on_channel_row_button_press), win);

        gtk_list_box_insert(win->channel_list, row, -1);
    }

    g_print("[Channels] Loaded %u channels\n", len);
    gtk_widget_show_all(GTK_WIDGET(win->channel_list));
    json_node_unref(result);
}

/* --- Teams loading --- */

static void on_team_tree_channel_clicked(GtkListBox *list, GtkListBoxRow *row, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!row) return;
    const char *channel_id = g_object_get_data(G_OBJECT(row), "channel-id");
    const char *channel_name = g_object_get_data(G_OBJECT(row), "channel-name");
    if (!channel_id) return;

    /* Deselect main channel list */
    gtk_list_box_unselect_all(win->channel_list);

    g_free(win->current_channel_id);
    win->current_channel_id = g_strdup(channel_id);
    g_free(win->current_channel_name);
    win->current_channel_name = g_strdup(channel_name);

    gtk_label_set_text(win->chat_title, channel_name);
    update_chat_subtitle_status(win, channel_id);
    gtk_stack_set_visible_child_name(win->content_stack, "chat");
    load_messages(win, channel_id);
    connect_channel_ws(win, channel_id);
}

static void load_team_channels_into_expander(AgoraMainWindow *win, const char *team_id, GtkWidget *channel_list_box)
{
    g_print("[Teams] Loading channels for team_id=%s\n", team_id);
    char *path = g_strdup_printf("/api/channels/?team_id=%s", team_id);
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &error);
    g_free(path);

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
        gint64 unread = json_object_has_member(ch, "unread_count")
            ? json_object_get_int_member(ch, "unread_count") : 0;

        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
        gtk_widget_set_margin_start(row_box, 16);
        gtk_widget_set_margin_top(row_box, 4);
        gtk_widget_set_margin_bottom(row_box, 4);
        gtk_widget_set_margin_end(row_box, 8);

        char *display = g_strdup_printf("# %s", name);
        GtkWidget *label = gtk_label_new(display);
        g_free(display);
        gtk_widget_set_halign(label, GTK_ALIGN_START);
        gtk_box_pack_start(GTK_BOX(row_box), label, TRUE, TRUE, 0);

        if (unread > 0) {
            char *badge_text = g_strdup_printf("%ld", (long)unread);
            GtkWidget *badge = gtk_label_new(badge_text);
            g_free(badge_text);
            gtk_style_context_add_class(gtk_widget_get_style_context(badge), "unread-badge");
            PangoAttrList *badge_attrs = pango_attr_list_new();
            pango_attr_list_insert(badge_attrs, pango_attr_scale_new(0.8));
            pango_attr_list_insert(badge_attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
            gtk_label_set_attributes(GTK_LABEL(badge), badge_attrs);
            pango_attr_list_unref(badge_attrs);
            gtk_widget_set_halign(badge, GTK_ALIGN_END);
            gtk_widget_set_valign(badge, GTK_ALIGN_CENTER);
            gtk_box_pack_end(GTK_BOX(row_box), badge, FALSE, FALSE, 0);
        }

        GtkWidget *row = gtk_list_box_row_new();
        g_object_set_data_full(G_OBJECT(row), "channel-id", g_strdup(id), g_free);
        g_object_set_data_full(G_OBJECT(row), "channel-name", g_strdup(name), g_free);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(GTK_LIST_BOX(channel_list_box), row, -1);
    }

    gtk_widget_show_all(channel_list_box);
    json_node_unref(result);
}

static void on_team_expander_toggled(GObject *expander, GParamSpec *pspec, gpointer data)
{
    (void)pspec;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!gtk_expander_get_expanded(GTK_EXPANDER(expander)))
        return;

    const char *team_id = g_object_get_data(G_OBJECT(expander), "team-id");
    GtkWidget *channel_list = g_object_get_data(G_OBJECT(expander), "channel-list");
    if (!team_id || !channel_list) return;

    /* Clear and reload channels */
    GList *children = gtk_container_get_children(GTK_CONTAINER(channel_list));
    for (GList *l = children; l; l = l->next)
        gtk_widget_destroy(GTK_WIDGET(l->data));
    g_list_free(children);

    load_team_channels_into_expander(win, team_id, channel_list);
}

static void clear_team_tree(AgoraMainWindow *win)
{
    GList *children = gtk_container_get_children(GTK_CONTAINER(win->team_tree_box));
    for (GList *l = children; l; l = l->next)
        gtk_widget_destroy(GTK_WIDGET(l->data));
    g_list_free(children);
}

static void on_team_settings_clicked(GtkButton *btn, gpointer data)
{
    AgoraMainWindow *w = AGORA_MAIN_WINDOW(data);
    const char *tid = g_object_get_data(G_OBJECT(btn), "team-id");
    const char *tname = g_object_get_data(G_OBJECT(btn), "team-name");
    if (tid) show_team_detail(w, tid, tname ? tname : "");
}

static void create_team_channel_dialog(AgoraMainWindow *win, const char *team_id)
{
    if (!team_id || !team_id[0]) return;

    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        T("teams.new_channel"), GTK_WINDOW(win),
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        T("chat.create"), GTK_RESPONSE_OK,
        T("chat.cancel"), GTK_RESPONSE_CANCEL,
        NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 360, 160);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content), 16);

    GtkWidget *name_label = gtk_label_new(T("teams.channel_name"));
    gtk_widget_set_halign(name_label, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), name_label, FALSE, FALSE, 4);
    GtkWidget *name_entry = gtk_entry_new();
    gtk_box_pack_start(GTK_BOX(content), name_entry, FALSE, FALSE, 4);

    gtk_widget_show_all(dialog);
    int response = gtk_dialog_run(GTK_DIALOG(dialog));

    if (response == GTK_RESPONSE_OK) {
        const char *channel_name = gtk_entry_get_text(GTK_ENTRY(name_entry));
        if (channel_name && channel_name[0]) {
            JsonBuilder *builder = json_builder_new();
            json_builder_begin_object(builder);
            json_builder_set_member_name(builder, "name");
            json_builder_add_string_value(builder, channel_name);
            json_builder_set_member_name(builder, "channel_type");
            json_builder_add_string_value(builder, "team");
            json_builder_set_member_name(builder, "team_id");
            json_builder_add_string_value(builder, team_id);
            json_builder_end_object(builder);
            JsonGenerator *gen = json_generator_new();
            json_generator_set_root(gen, json_builder_get_root(builder));
            char *body = json_generator_to_data(gen, NULL);

            GError *err = NULL;
            JsonNode *res = agora_api_client_post(win->api, "/api/channels/", body, &err);
            g_free(body);
            g_object_unref(gen);
            g_object_unref(builder);
            if (res) json_node_unref(res);
            if (err) g_error_free(err);

            load_teams(win);
            if (win->current_team_id && g_strcmp0(win->current_team_id, team_id) == 0)
                load_team_detail_channels(win);
        }
    }

    gtk_widget_destroy(dialog);
}

static void on_team_row_new_channel_clicked(GtkButton *btn, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *team_id = g_object_get_data(G_OBJECT(btn), "team-id");
    create_team_channel_dialog(win, team_id);
}

static void load_teams(AgoraMainWindow *win)
{
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, "/api/teams/", &error);
    if (!result) {
        g_printerr("[Teams] ERROR loading teams: %s\n", error ? error->message : "null response");
        if (error) g_error_free(error);
        return;
    }

    clear_team_tree(win);

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    for (guint i = 0; i < len; i++) {
        JsonObject *team = json_array_get_object_element(arr, i);
        const char *id = json_object_get_string_member(team, "id");
        const char *name = json_object_get_string_member(team, "name");
        gint64 member_count = json_object_has_member(team, "member_count")
            ? json_object_get_int_member(team, "member_count") : 0;

        /* Row: [Expander with team info + channels] [Settings] */
        GtkWidget *team_row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
        gtk_widget_set_margin_start(team_row, 8);
        gtk_widget_set_margin_end(team_row, 8);
        gtk_widget_set_margin_top(team_row, 2);
        gtk_widget_set_margin_bottom(team_row, 2);

        /* Header: [Avatar 28px] [Team Name + member count] */
        GtkWidget *header_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);

        GtkWidget *team_avatar = create_avatar_widget(name, 28);
        gtk_widget_set_valign(team_avatar, GTK_ALIGN_CENTER);
        gtk_box_pack_start(GTK_BOX(header_box), team_avatar, FALSE, FALSE, 0);

        GtkWidget *text_col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 1);
        GtkWidget *name_label = gtk_label_new(name);
        gtk_label_set_ellipsize(GTK_LABEL(name_label), PANGO_ELLIPSIZE_END);
        gtk_widget_set_halign(name_label, GTK_ALIGN_START);
        PangoAttrList *attrs = pango_attr_list_new();
        pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
        gtk_label_set_attributes(GTK_LABEL(name_label), attrs);
        pango_attr_list_unref(attrs);
        gtk_box_pack_start(GTK_BOX(text_col), name_label, FALSE, FALSE, 0);

        char *members_text = g_strdup_printf("%ld %s", (long)member_count, T("chat.members"));
        GtkWidget *members_label = gtk_label_new(members_text);
        g_free(members_text);
        gtk_widget_set_halign(members_label, GTK_ALIGN_START);
        PangoAttrList *small_attrs = pango_attr_list_new();
        pango_attr_list_insert(small_attrs, pango_attr_scale_new(0.8));
        pango_attr_list_insert(small_attrs, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
        gtk_label_set_attributes(GTK_LABEL(members_label), small_attrs);
        pango_attr_list_unref(small_attrs);
        gtk_box_pack_start(GTK_BOX(text_col), members_label, FALSE, FALSE, 0);

        gtk_box_pack_start(GTK_BOX(header_box), text_col, TRUE, TRUE, 0);

        /* Expander with team header */
        GtkWidget *expander = gtk_expander_new(NULL);
        gtk_expander_set_label_widget(GTK_EXPANDER(expander), header_box);
        gtk_box_pack_start(GTK_BOX(team_row), expander, TRUE, TRUE, 0);

        /* New channel button next to settings */
        GtkWidget *new_channel_btn = gtk_button_new_with_label("+");
        gtk_widget_set_valign(new_channel_btn, GTK_ALIGN_CENTER);
        gtk_widget_set_tooltip_text(new_channel_btn, T("teams.new_channel"));
        gtk_style_context_add_class(gtk_widget_get_style_context(new_channel_btn), "team-settings-btn");
        g_object_set_data_full(G_OBJECT(new_channel_btn), "team-id", g_strdup(id), g_free);
        g_signal_connect(new_channel_btn, "clicked", G_CALLBACK(on_team_row_new_channel_clicked), win);
        gtk_box_pack_end(GTK_BOX(team_row), new_channel_btn, FALSE, FALSE, 0);

        /* Settings button to open team detail view */
        GtkWidget *settings_btn = gtk_button_new_with_label("\xE2\x9A\x99"); /* ⚙ */
        gtk_widget_set_valign(settings_btn, GTK_ALIGN_CENTER);
        gtk_widget_set_tooltip_text(settings_btn, T("teams.team_settings"));
        gtk_style_context_add_class(gtk_widget_get_style_context(settings_btn), "team-settings-btn");
        g_object_set_data_full(G_OBJECT(settings_btn), "team-id", g_strdup(id), g_free);
        g_object_set_data_full(G_OBJECT(settings_btn), "team-name", g_strdup(name), g_free);
        g_signal_connect(settings_btn, "clicked", G_CALLBACK(on_team_settings_clicked), win);
        gtk_box_pack_end(GTK_BOX(team_row), settings_btn, FALSE, FALSE, 0);

        /* Channel list inside the expander */
        GtkWidget *ch_list = gtk_list_box_new();
        gtk_list_box_set_selection_mode(GTK_LIST_BOX(ch_list), GTK_SELECTION_SINGLE);
        g_signal_connect(ch_list, "row-selected", G_CALLBACK(on_team_tree_channel_clicked), win);

        gtk_container_add(GTK_CONTAINER(expander), ch_list);

        g_object_set_data_full(G_OBJECT(expander), "team-id", g_strdup(id), g_free);
        g_object_set_data(G_OBJECT(expander), "channel-list", ch_list);

        /* Load channels immediately and expand */
        load_team_channels_into_expander(win, id, ch_list);
        gtk_expander_set_expanded(GTK_EXPANDER(expander), TRUE);

        g_signal_connect(expander, "notify::expanded", G_CALLBACK(on_team_expander_toggled), win);

        gtk_box_pack_start(GTK_BOX(win->team_tree_box), team_row, FALSE, FALSE, 0);
        g_print("[Teams] Added team: %s (%s)\n", name, id);
    }

    g_print("[Teams] Loaded %u teams\n", len);
    gtk_widget_show_all(win->team_tree_box);
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
    if (!channel_id) return;

    /* Mark feed events for this channel as read */
    {
        char *body = g_strdup_printf("{\"channel_id\":\"%s\"}", channel_id);
        GError *err = NULL;
        JsonNode *res = agora_api_client_post(win->api, "/api/feed/read", body, &err);
        g_free(body);
        if (res) json_node_unref(res);
        if (err) g_error_free(err);
    }

    /* Switch to chat nav */
    gtk_stack_set_visible_child_name(win->sidebar_stack, "chats");
    set_active_nav(win, win->nav_chat_btn);

    /* Open channel (this also marks read position + reloads channels) */
    g_free(win->current_channel_id);
    win->current_channel_id = g_strdup(channel_id);
    g_free(win->current_channel_name);
    win->current_channel_name = g_strdup(channel_name ? channel_name : "");

    gtk_label_set_text(win->chat_title, win->current_channel_name);
    gtk_stack_set_visible_child_name(win->content_stack, "chat");
    gtk_label_set_text(win->typing_label, "");
    gtk_widget_hide(GTK_WIDGET(win->typing_label));
    load_messages(win, channel_id);
    connect_channel_ws(win, channel_id);

    /* Mark channel read position */
    {
        GList *msg_children = gtk_container_get_children(GTK_CONTAINER(win->message_list));
        const char *last_msg_id = NULL;
        for (GList *l = g_list_last(msg_children); l; l = l->prev) {
            const char *mid = g_object_get_data(G_OBJECT(l->data), "message-id");
            if (mid) { last_msg_id = mid; break; }
        }
        g_list_free(msg_children);

        if (last_msg_id) {
            char *read_path = g_strdup_printf("/api/channels/%s/read-position", channel_id);
            char *read_body = g_strdup_printf("{\"last_read_message_id\":\"%s\"}", last_msg_id);
            GError *err = NULL;
            JsonNode *res = agora_api_client_put(win->api, read_path, read_body, &err);
            g_free(read_path);
            g_free(read_body);
            if (res) json_node_unref(res);
            if (err) g_error_free(err);
        }
        g_idle_add(reload_channels_idle, win);
    }

    gtk_widget_grab_focus(GTK_WIDGET(win->message_entry));
}

static void load_feed(AgoraMainWindow *win)
{
    GError *error = NULL;
    char *feed_path = win->feed_unread_only
        ? g_strdup("/api/feed/?limit=50&offset=0&unread_only=true")
        : g_strdup("/api/feed/?limit=50&offset=0");
    g_print("[Feed] Loading feed (unread_only=%s)\n", win->feed_unread_only ? "true" : "false");
    JsonNode *result = agora_api_client_get(win->api, feed_path, &error);
    g_free(feed_path);
    if (!result) {
        if (error) g_error_free(error);
        return;
    }

    /* Clear existing list */
    clear_list_box(win->feed_list);

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
        const char *preview = json_object_has_member(ev, "preview_text") &&
            !json_object_get_null_member(ev, "preview_text")
            ? json_object_get_string_member(ev, "preview_text") : "";
        gboolean is_read = json_object_has_member(ev, "is_read")
            ? json_object_get_boolean_member(ev, "is_read") : TRUE;
        const char *created_at = json_object_has_member(ev, "created_at")
            ? json_object_get_string_member(ev, "created_at") : NULL;

        /* Build row with avatar */
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

        /* Sender avatar instead of icon */
        GtkWidget *feed_avatar = create_avatar_widget(sender_name, 32);
        gtk_widget_set_valign(feed_avatar, GTK_ALIGN_START);
        gtk_box_pack_start(GTK_BOX(row_box), feed_avatar, FALSE, FALSE, 0);

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

/* --- Calendar loading --- */

static void load_calendar_events(AgoraMainWindow *win)
{
    /* Get displayed month from GtkCalendar */
    guint cal_year, cal_month, cal_day;
    gtk_calendar_get_date(GTK_CALENDAR(win->gtk_calendar),
                          &cal_year, &cal_month, &cal_day);
    /* GtkCalendar months are 0-based */
    int year = (int)cal_year;
    int month = (int)cal_month + 1;

    GDateTime *start = g_date_time_new_utc(year, month, 1, 0, 0, 0);
    int end_month = month + 1;
    int end_year = year;
    if (end_month > 12) { end_month -= 12; end_year++; }
    GDateTime *end = g_date_time_new_utc(end_year, end_month, 1, 0, 0, 0);

    char *start_str = g_date_time_format(start, "%Y-%m-%dT%H:%M:%SZ");
    char *end_str = g_date_time_format(end, "%Y-%m-%dT%H:%M:%SZ");
    g_date_time_unref(start);
    g_date_time_unref(end);

    char *path = g_strdup_printf("/api/calendar/events?start=%s&end=%s", start_str, end_str);
    g_print("[calendar] Fetching: %s\n", path);
    g_free(start_str);
    g_free(end_str);

    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &error);
    g_free(path);

    /* Free old cache */
    if (win->calendar_events_cache) {
        json_array_unref(win->calendar_events_cache);
        win->calendar_events_cache = NULL;
    }

    /* Clear day marks */
    gtk_calendar_clear_marks(GTK_CALENDAR(win->gtk_calendar));

    if (!result) {
        g_print("[calendar] API error: %s\n", error ? error->message : "unknown");
        if (error) g_error_free(error);
        populate_calendar_day_events(win);
        return;
    }

    if (!JSON_NODE_HOLDS_ARRAY(result)) {
        g_print("[calendar] Response is not a JSON array\n");
        json_node_unref(result);
        populate_calendar_day_events(win);
        return;
    }

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);
    g_print("[calendar] Got %u events\n", len);

    /* Cache the events array */
    win->calendar_events_cache = json_array_ref(arr);

    /* Mark days that have events */
    for (guint i = 0; i < len; i++) {
        JsonObject *ev = json_array_get_object_element(arr, i);
        const char *st = json_object_has_member(ev, "start_time")
            ? json_object_get_string_member(ev, "start_time") : NULL;
        if (!st) continue;
        GDateTime *dt = g_date_time_new_from_iso8601(st, NULL);
        if (dt) {
            GDateTime *local = g_date_time_to_local(dt);
            int d = g_date_time_get_day_of_month(local);
            int m = g_date_time_get_month(local);
            int y = g_date_time_get_year(local);
            /* Only mark if same month as displayed */
            if (y == year && m == month)
                gtk_calendar_mark_day(GTK_CALENDAR(win->gtk_calendar), (guint)d);
            g_date_time_unref(local);
            g_date_time_unref(dt);
        }
    }

    json_node_unref(result);
    populate_calendar_day_events(win);
}

/* Populate the event list for the currently selected day in GtkCalendar */
static void populate_calendar_day_events(AgoraMainWindow *win)
{
    /* Clear existing list */
    clear_list_box(win->calendar_list);

    guint sel_year, sel_month, sel_day;
    gtk_calendar_get_date(GTK_CALENDAR(win->gtk_calendar),
                          &sel_year, &sel_month, &sel_day);
    int year = (int)sel_year;
    int month = (int)sel_month + 1; /* 0-based → 1-based */
    int day = (int)sel_day;

    if (!win->calendar_events_cache) {
        GtkWidget *lbl = gtk_label_new(T("calendar.empty"));
        gtk_widget_set_margin_top(lbl, 40);
        GtkWidget *row = gtk_list_box_row_new();
        gtk_container_add(GTK_CONTAINER(row), lbl);
        gtk_list_box_insert(win->calendar_list, row, -1);
        gtk_widget_show_all(GTK_WIDGET(win->calendar_list));
        return;
    }

    guint len = json_array_get_length(win->calendar_events_cache);
    int shown = 0;

    for (guint i = 0; i < len; i++) {
        JsonObject *ev = json_array_get_object_element(win->calendar_events_cache, i);
        const char *start_time = json_object_has_member(ev, "start_time")
            ? json_object_get_string_member(ev, "start_time") : NULL;
        if (!start_time) continue;

        /* Check if event falls on the selected day */
        GDateTime *dt = g_date_time_new_from_iso8601(start_time, NULL);
        if (!dt) continue;
        GDateTime *local = g_date_time_to_local(dt);
        gboolean match = (g_date_time_get_year(local) == year &&
                          g_date_time_get_month(local) == month &&
                          g_date_time_get_day_of_month(local) == day);
        g_date_time_unref(local);
        g_date_time_unref(dt);
        if (!match) continue;

        /* Build event row */
        const char *title = json_object_has_member(ev, "title")
            ? json_object_get_string_member(ev, "title") : "";
        const char *description = json_object_has_member(ev, "description") &&
            !json_object_get_null_member(ev, "description")
            ? json_object_get_string_member(ev, "description") : NULL;
        const char *end_time = json_object_has_member(ev, "end_time")
            ? json_object_get_string_member(ev, "end_time") : "";
        gboolean all_day = json_object_has_member(ev, "all_day") &&
            json_object_get_boolean_member(ev, "all_day");
        const char *location = json_object_has_member(ev, "location") &&
            !json_object_get_null_member(ev, "location")
            ? json_object_get_string_member(ev, "location") : NULL;
        const char *channel_id = json_object_has_member(ev, "channel_id") &&
            !json_object_get_null_member(ev, "channel_id")
            ? json_object_get_string_member(ev, "channel_id") : NULL;

        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
        gtk_container_set_border_width(GTK_CONTAINER(row_box), 12);

        /* Title row with icon */
        GtkWidget *title_hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
        GtkWidget *icon_lbl = gtk_label_new(
            all_day ? "\xF0\x9F\x93\x85" : "\xE2\x8F\xB0");  /* 📅 or ⏰ */
        gtk_box_pack_start(GTK_BOX(title_hbox), icon_lbl, FALSE, FALSE, 0);

        GtkWidget *title_lbl = gtk_label_new(NULL);
        char *title_markup = g_strdup_printf("<b>%s</b>", title);
        gtk_label_set_markup(GTK_LABEL(title_lbl), title_markup);
        g_free(title_markup);
        gtk_label_set_ellipsize(GTK_LABEL(title_lbl), PANGO_ELLIPSIZE_END);
        gtk_widget_set_halign(title_lbl, GTK_ALIGN_START);
        gtk_box_pack_start(GTK_BOX(title_hbox), title_lbl, TRUE, TRUE, 0);
        gtk_box_pack_start(GTK_BOX(row_box), title_hbox, FALSE, FALSE, 0);

        /* Time info */
        char *time_text;
        if (all_day) {
            time_text = g_strdup("All day");
        } else {
            GDateTime *dt_start = g_date_time_new_from_iso8601(start_time, NULL);
            GDateTime *dt_end = g_date_time_new_from_iso8601(end_time, NULL);
            if (dt_start && dt_end) {
                GDateTime *local_start = g_date_time_to_local(dt_start);
                GDateTime *local_end = g_date_time_to_local(dt_end);
                char *s = g_date_time_format(local_start, "%H:%M");
                char *e = g_date_time_format(local_end, "%H:%M");
                time_text = g_strdup_printf("%s - %s", s, e);
                g_free(s);
                g_free(e);
                g_date_time_unref(local_start);
                g_date_time_unref(local_end);
            } else {
                time_text = g_strdup("");
            }
            if (dt_start) g_date_time_unref(dt_start);
            if (dt_end) g_date_time_unref(dt_end);
        }

        GtkWidget *time_lbl = gtk_label_new(time_text);
        g_free(time_text);
        gtk_widget_set_halign(time_lbl, GTK_ALIGN_START);
        PangoAttrList *time_attrs = pango_attr_list_new();
        pango_attr_list_insert(time_attrs,
            pango_attr_foreground_new(0x6600, 0x6600, 0x6600));
        pango_attr_list_insert(time_attrs, pango_attr_scale_new(0.9));
        gtk_label_set_attributes(GTK_LABEL(time_lbl), time_attrs);
        pango_attr_list_unref(time_attrs);
        gtk_box_pack_start(GTK_BOX(row_box), time_lbl, FALSE, FALSE, 0);

        /* Location */
        if (location) {
            GtkWidget *loc_lbl = gtk_label_new(NULL);
            char *loc_markup = g_strdup_printf(
                "<span color='#888888'>\xF0\x9F\x93\x8D %s</span>", location);
            gtk_label_set_markup(GTK_LABEL(loc_lbl), loc_markup);
            g_free(loc_markup);
            gtk_widget_set_halign(loc_lbl, GTK_ALIGN_START);
            gtk_label_set_ellipsize(GTK_LABEL(loc_lbl), PANGO_ELLIPSIZE_END);
            gtk_box_pack_start(GTK_BOX(row_box), loc_lbl, FALSE, FALSE, 0);
        }

        /* Description */
        if (description) {
            GtkWidget *desc_lbl = gtk_label_new(description);
            gtk_widget_set_halign(desc_lbl, GTK_ALIGN_START);
            gtk_label_set_ellipsize(GTK_LABEL(desc_lbl), PANGO_ELLIPSIZE_END);
            gtk_label_set_max_width_chars(GTK_LABEL(desc_lbl), 80);
            gtk_label_set_line_wrap(GTK_LABEL(desc_lbl), TRUE);
            gtk_label_set_lines(GTK_LABEL(desc_lbl), 2);
            PangoAttrList *desc_attrs = pango_attr_list_new();
            pango_attr_list_insert(desc_attrs, pango_attr_scale_new(0.9));
            pango_attr_list_insert(desc_attrs,
                pango_attr_foreground_new(0x5500, 0x5500, 0x5500));
            gtk_label_set_attributes(GTK_LABEL(desc_lbl), desc_attrs);
            pango_attr_list_unref(desc_attrs);
            gtk_box_pack_start(GTK_BOX(row_box), desc_lbl, FALSE, FALSE, 0);
        }

        /* Video call join button */
        if (channel_id) {
            GtkWidget *join_btn = gtk_button_new_with_label(
                "\xF0\x9F\x93\xB9 Join Video Call"); /* 📹 */
            gtk_widget_set_halign(join_btn, GTK_ALIGN_START);
            gtk_widget_set_margin_top(join_btn, 4);
            g_object_set_data_full(G_OBJECT(join_btn), "channel-id",
                                   g_strdup(channel_id), g_free);
            g_signal_connect(join_btn, "clicked",
                             G_CALLBACK(on_calendar_join_clicked), win);
            gtk_box_pack_start(GTK_BOX(row_box), join_btn, FALSE, FALSE, 0);
        }

        GtkWidget *row = gtk_list_box_row_new();
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->calendar_list, row, -1);
        shown++;
    }

    /* Empty state for selected day */
    if (shown == 0) {
        GtkWidget *lbl = gtk_label_new(T("calendar.empty"));
        gtk_widget_set_margin_top(lbl, 20);
        GtkWidget *row = gtk_list_box_row_new();
        gtk_container_add(GTK_CONTAINER(row), lbl);
        gtk_list_box_insert(win->calendar_list, row, -1);
    }

    gtk_widget_show_all(GTK_WIDGET(win->calendar_list));
}

static void on_calendar_day_selected(GtkCalendar *calendar, gpointer data)
{
    (void)calendar;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    populate_calendar_day_events(win);
}

static void on_calendar_month_changed(GtkCalendar *calendar, gpointer data)
{
    (void)calendar;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    load_calendar_events(win);
}

/* --- New calendar event creation dialog --- */

static void on_calendar_new_event_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);

    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        "Neuer Termin", GTK_WINDOW(win),
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        "_Abbrechen", GTK_RESPONSE_CANCEL,
        "_Erstellen", GTK_RESPONSE_ACCEPT,
        NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 400, -1);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content), 16);

    /* Title */
    GtkWidget *title_lbl = gtk_label_new("Titel:");
    gtk_widget_set_halign(title_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), title_lbl, FALSE, FALSE, 2);
    GtkWidget *title_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(title_entry), "Titel des Termins");
    gtk_box_pack_start(GTK_BOX(content), title_entry, FALSE, FALSE, 4);

    /* Description */
    GtkWidget *desc_lbl = gtk_label_new("Beschreibung:");
    gtk_widget_set_halign(desc_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), desc_lbl, FALSE, FALSE, 2);
    GtkWidget *desc_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(desc_entry), "Optional");
    gtk_box_pack_start(GTK_BOX(content), desc_entry, FALSE, FALSE, 4);

    /* Location */
    GtkWidget *loc_lbl = gtk_label_new("Ort:");
    gtk_widget_set_halign(loc_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), loc_lbl, FALSE, FALSE, 2);
    GtkWidget *loc_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(loc_entry), "Optional");
    gtk_box_pack_start(GTK_BOX(content), loc_entry, FALSE, FALSE, 4);

    /* All day checkbox */
    GtkWidget *allday_check = gtk_check_button_new_with_label("Ganztaegig");
    gtk_box_pack_start(GTK_BOX(content), allday_check, FALSE, FALSE, 4);

    /* Date */
    GtkWidget *date_lbl = gtk_label_new("Datum (YYYY-MM-DD):");
    gtk_widget_set_halign(date_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), date_lbl, FALSE, FALSE, 2);
    GtkWidget *date_entry = gtk_entry_new();
    /* Pre-fill with selected date from calendar */
    guint sel_y, sel_m, sel_d;
    gtk_calendar_get_date(GTK_CALENDAR(win->gtk_calendar), &sel_y, &sel_m, &sel_d);
    char *date_str = g_strdup_printf("%04u-%02u-%02u", sel_y, sel_m + 1, sel_d);
    gtk_entry_set_text(GTK_ENTRY(date_entry), date_str);
    g_free(date_str);
    gtk_box_pack_start(GTK_BOX(content), date_entry, FALSE, FALSE, 4);

    /* Start time */
    GtkWidget *start_lbl = gtk_label_new("Startzeit (HH:MM):");
    gtk_widget_set_halign(start_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), start_lbl, FALSE, FALSE, 2);
    GtkWidget *start_entry = gtk_entry_new();
    gtk_entry_set_text(GTK_ENTRY(start_entry), "09:00");
    gtk_box_pack_start(GTK_BOX(content), start_entry, FALSE, FALSE, 4);

    /* End time */
    GtkWidget *end_lbl = gtk_label_new("Endzeit (HH:MM):");
    gtk_widget_set_halign(end_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), end_lbl, FALSE, FALSE, 2);
    GtkWidget *end_entry = gtk_entry_new();
    gtk_entry_set_text(GTK_ENTRY(end_entry), "10:00");
    gtk_box_pack_start(GTK_BOX(content), end_entry, FALSE, FALSE, 4);

    gtk_widget_show_all(content);

    int response = gtk_dialog_run(GTK_DIALOG(dialog));
    if (response == GTK_RESPONSE_ACCEPT) {
        const char *title = gtk_entry_get_text(GTK_ENTRY(title_entry));
        const char *desc = gtk_entry_get_text(GTK_ENTRY(desc_entry));
        const char *loc = gtk_entry_get_text(GTK_ENTRY(loc_entry));
        const char *date = gtk_entry_get_text(GTK_ENTRY(date_entry));
        const char *stime = gtk_entry_get_text(GTK_ENTRY(start_entry));
        const char *etime = gtk_entry_get_text(GTK_ENTRY(end_entry));
        gboolean allday = gtk_toggle_button_get_active(GTK_TOGGLE_BUTTON(allday_check));

        if (title && strlen(title) > 0) {
            char *start_iso, *end_iso;
            if (allday) {
                start_iso = g_strdup_printf("%sT00:00:00Z", date);
                end_iso = g_strdup_printf("%sT23:59:59Z", date);
            } else {
                start_iso = g_strdup_printf("%sT%s:00Z", date, stime);
                end_iso = g_strdup_printf("%sT%s:00Z", date, etime);
            }

            /* Build JSON body */
            JsonBuilder *builder = json_builder_new();
            json_builder_begin_object(builder);
            json_builder_set_member_name(builder, "title");
            json_builder_add_string_value(builder, title);
            if (desc && strlen(desc) > 0) {
                json_builder_set_member_name(builder, "description");
                json_builder_add_string_value(builder, desc);
            }
            if (loc && strlen(loc) > 0) {
                json_builder_set_member_name(builder, "location");
                json_builder_add_string_value(builder, loc);
            }
            json_builder_set_member_name(builder, "start_time");
            json_builder_add_string_value(builder, start_iso);
            json_builder_set_member_name(builder, "end_time");
            json_builder_add_string_value(builder, end_iso);
            json_builder_set_member_name(builder, "all_day");
            json_builder_add_boolean_value(builder, allday);
            json_builder_end_object(builder);

            JsonGenerator *gen = json_generator_new();
            json_generator_set_root(gen, json_builder_get_root(builder));
            char *body = json_generator_to_data(gen, NULL);
            g_object_unref(gen);
            g_object_unref(builder);

            GError *err = NULL;
            JsonNode *res = agora_api_client_post(win->api,
                "/api/calendar/events", body, &err);
            g_free(body);
            g_free(start_iso);
            g_free(end_iso);

            if (res) {
                json_node_unref(res);
                /* Reload calendar events */
                load_calendar_events(win);
            } else {
                g_print("[calendar] Create event error: %s\n",
                    err ? err->message : "unknown");
                if (err) g_error_free(err);
            }
        }
    }

    gtk_widget_destroy(dialog);
}

/* --- Calendar integration config dialog --- */

typedef struct {
    GtkWidget *caldav_box;
    GtkWidget *google_box;
    GtkWidget *outlook_box;
    GtkWidget *internal_box;
} CalConfigWidgets;

static void on_cal_provider_changed(GtkComboBox *combo, gpointer user_data)
{
    CalConfigWidgets *w = (CalConfigWidgets *)user_data;
    const char *id = gtk_combo_box_get_active_id(combo);
    gboolean is_webdav = (g_strcmp0(id, "webdav") == 0);
    gboolean is_google = (g_strcmp0(id, "google") == 0);
    gboolean is_outlook = (g_strcmp0(id, "outlook") == 0);
    gboolean is_internal = (g_strcmp0(id, "internal") == 0);

    gtk_widget_set_visible(w->caldav_box, is_webdav);
    gtk_widget_set_visible(w->google_box, is_google);
    gtk_widget_set_visible(w->outlook_box, is_outlook);
    gtk_widget_set_visible(w->internal_box, is_internal);
}

static void on_calendar_config_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);

    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        "Kalender Konfiguration", GTK_WINDOW(win),
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        "_Abbrechen", GTK_RESPONSE_CANCEL,
        "_Speichern", GTK_RESPONSE_ACCEPT,
        NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 400, -1);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content), 16);

    /* Provider selection */
    GtkWidget *prov_lbl = gtk_label_new("Anbieter:");
    gtk_widget_set_halign(prov_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), prov_lbl, FALSE, FALSE, 2);

    GtkWidget *prov_combo = gtk_combo_box_text_new();
    gtk_combo_box_text_append(GTK_COMBO_BOX_TEXT(prov_combo), "internal", "Intern");
    gtk_combo_box_text_append(GTK_COMBO_BOX_TEXT(prov_combo), "webdav", "CalDAV / WebDAV");
    gtk_combo_box_text_append(GTK_COMBO_BOX_TEXT(prov_combo), "google", "Google Calendar");
    gtk_combo_box_text_append(GTK_COMBO_BOX_TEXT(prov_combo), "outlook", "Outlook / Exchange");
    gtk_combo_box_set_active_id(GTK_COMBO_BOX(prov_combo), "internal");
    gtk_box_pack_start(GTK_BOX(content), prov_combo, FALSE, FALSE, 4);

    /* --- Internal info box --- */
    GtkWidget *internal_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_margin_top(internal_box, 8);
    GtkWidget *internal_info = gtk_label_new("Interner Kalender wird verwendet.\nKeine weitere Konfiguration nötig.");
    gtk_widget_set_halign(internal_info, GTK_ALIGN_START);
    gtk_label_set_line_wrap(GTK_LABEL(internal_info), TRUE);
    gtk_box_pack_start(GTK_BOX(internal_box), internal_info, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(content), internal_box, FALSE, FALSE, 0);

    /* --- CalDAV fields box --- */
    GtkWidget *caldav_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
    gtk_widget_set_margin_top(caldav_box, 8);

    GtkWidget *url_lbl = gtk_label_new("CalDAV URL:");
    gtk_widget_set_halign(url_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(caldav_box), url_lbl, FALSE, FALSE, 2);
    GtkWidget *url_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(url_entry), "https://calendar.example.com/dav/");
    gtk_box_pack_start(GTK_BOX(caldav_box), url_entry, FALSE, FALSE, 4);

    GtkWidget *user_lbl = gtk_label_new("Benutzername:");
    gtk_widget_set_halign(user_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(caldav_box), user_lbl, FALSE, FALSE, 2);
    GtkWidget *user_entry = gtk_entry_new();
    gtk_box_pack_start(GTK_BOX(caldav_box), user_entry, FALSE, FALSE, 4);

    GtkWidget *pass_lbl = gtk_label_new("Passwort:");
    gtk_widget_set_halign(pass_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(caldav_box), pass_lbl, FALSE, FALSE, 2);
    GtkWidget *pass_entry = gtk_entry_new();
    gtk_entry_set_visibility(GTK_ENTRY(pass_entry), FALSE);
    gtk_box_pack_start(GTK_BOX(caldav_box), pass_entry, FALSE, FALSE, 4);

    gtk_box_pack_start(GTK_BOX(content), caldav_box, FALSE, FALSE, 0);

    /* --- Google info box --- */
    GtkWidget *google_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_margin_top(google_box, 8);
    GtkWidget *google_info = gtk_label_new(
        "Google Calendar wird über OAuth verbunden.\n"
        "Bitte im Web-Frontend unter Einstellungen verbinden.");
    gtk_widget_set_halign(google_info, GTK_ALIGN_START);
    gtk_label_set_line_wrap(GTK_LABEL(google_info), TRUE);
    gtk_box_pack_start(GTK_BOX(google_box), google_info, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(content), google_box, FALSE, FALSE, 0);

    /* --- Outlook info box --- */
    GtkWidget *outlook_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_margin_top(outlook_box, 8);
    GtkWidget *outlook_info = gtk_label_new(
        "Outlook / Exchange wird über Microsoft 365 verbunden.\n"
        "Bitte im Web-Frontend unter Einstellungen verbinden.");
    gtk_widget_set_halign(outlook_info, GTK_ALIGN_START);
    gtk_label_set_line_wrap(GTK_LABEL(outlook_info), TRUE);
    gtk_box_pack_start(GTK_BOX(outlook_box), outlook_info, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(content), outlook_box, FALSE, FALSE, 0);

    /* Wire up provider change to show/hide sections */
    CalConfigWidgets *ccw = g_new0(CalConfigWidgets, 1);
    ccw->caldav_box = caldav_box;
    ccw->google_box = google_box;
    ccw->outlook_box = outlook_box;
    ccw->internal_box = internal_box;
    g_signal_connect(prov_combo, "changed", G_CALLBACK(on_cal_provider_changed), ccw);

    /* Load current config */
    GError *load_err = NULL;
    JsonNode *cfg = agora_api_client_get(win->api, "/api/calendar/integration", &load_err);
    if (cfg && JSON_NODE_HOLDS_OBJECT(cfg)) {
        JsonObject *obj = json_node_get_object(cfg);
        const char *provider = json_object_has_member(obj, "provider")
            ? json_object_get_string_member(obj, "provider") : "internal";
        gtk_combo_box_set_active_id(GTK_COMBO_BOX(prov_combo), provider);

        if (json_object_has_member(obj, "webdav_url") &&
            !json_object_get_null_member(obj, "webdav_url"))
            gtk_entry_set_text(GTK_ENTRY(url_entry),
                json_object_get_string_member(obj, "webdav_url"));
        if (json_object_has_member(obj, "webdav_username") &&
            !json_object_get_null_member(obj, "webdav_username"))
            gtk_entry_set_text(GTK_ENTRY(user_entry),
                json_object_get_string_member(obj, "webdav_username"));
    }
    if (cfg) json_node_unref(cfg);
    if (load_err) g_error_free(load_err);

    /* Show all widgets first, then trigger provider change to hide irrelevant sections */
    gtk_widget_show_all(content);
    on_cal_provider_changed(GTK_COMBO_BOX(prov_combo), ccw);

    int response = gtk_dialog_run(GTK_DIALOG(dialog));
    if (response == GTK_RESPONSE_ACCEPT) {
        const char *provider = gtk_combo_box_get_active_id(GTK_COMBO_BOX(prov_combo));
        const char *url_val = gtk_entry_get_text(GTK_ENTRY(url_entry));
        const char *user_val = gtk_entry_get_text(GTK_ENTRY(user_entry));
        const char *pass_val = gtk_entry_get_text(GTK_ENTRY(pass_entry));

        JsonBuilder *builder = json_builder_new();
        json_builder_begin_object(builder);
        json_builder_set_member_name(builder, "provider");
        json_builder_add_string_value(builder, provider ? provider : "internal");
        if (g_strcmp0(provider, "webdav") == 0) {
            if (url_val && strlen(url_val) > 0) {
                json_builder_set_member_name(builder, "webdav_url");
                json_builder_add_string_value(builder, url_val);
            }
            if (user_val && strlen(user_val) > 0) {
                json_builder_set_member_name(builder, "webdav_username");
                json_builder_add_string_value(builder, user_val);
            }
            if (pass_val && strlen(pass_val) > 0) {
                json_builder_set_member_name(builder, "webdav_password");
                json_builder_add_string_value(builder, pass_val);
            }
        }
        json_builder_end_object(builder);

        JsonGenerator *gen = json_generator_new();
        json_generator_set_root(gen, json_builder_get_root(builder));
        char *body = json_generator_to_data(gen, NULL);
        g_object_unref(gen);
        g_object_unref(builder);

        GError *err = NULL;
        JsonNode *res = agora_api_client_put(win->api,
            "/api/calendar/integration", body, &err);
        g_free(body);

        if (res) {
            json_node_unref(res);
            g_print("[calendar] Integration saved\n");
        } else {
            g_print("[calendar] Save integration error: %s\n",
                err ? err->message : "unknown");
            if (err) g_error_free(err);
        }
    }

    g_free(ccw);
    gtk_widget_destroy(dialog);
}

/* --- Image loading helper --- */

static GdkPixbuf *download_inline_image(AgoraMainWindow *win, const char *ref_id,
                                          int max_width)
{
    if (!ref_id || !win->api || !win->api->token) return NULL;

    char *url = g_strdup_printf("%s/api/files/inline/%s?token=%s",
                                 win->api->base_url, ref_id, win->api->token);
    SoupSession *session = soup_session_new();
    SoupMessage *msg = soup_message_new("GET", url);
    g_free(url);
    if (!msg) { g_object_unref(session); return NULL; }

    g_signal_connect(msg, "accept-certificate", G_CALLBACK(accept_cert_cb), NULL);
    GInputStream *stream = soup_session_send(session, msg, NULL, NULL);
    if (!stream) {
        g_object_unref(msg);
        g_object_unref(session);
        return NULL;
    }

    guint status = soup_message_get_status(msg);
    if (status != 200) {
        g_object_unref(stream);
        g_object_unref(msg);
        g_object_unref(session);
        return NULL;
    }

    /* Load pixbuf from stream */
    GError *err = NULL;
    GdkPixbuf *pixbuf = gdk_pixbuf_new_from_stream(stream, NULL, &err);
    g_object_unref(stream);
    g_object_unref(msg);
    g_object_unref(session);

    if (!pixbuf) {
        if (err) g_error_free(err);
        return NULL;
    }

    /* Scale if too wide */
    int w = gdk_pixbuf_get_width(pixbuf);
    int h = gdk_pixbuf_get_height(pixbuf);
    if (w > max_width) {
        int new_h = (int)((double)h * max_width / w);
        GdkPixbuf *scaled = gdk_pixbuf_scale_simple(pixbuf, max_width, new_h,
                                                      GDK_INTERP_BILINEAR);
        g_object_unref(pixbuf);
        pixbuf = scaled;
    }

    return pixbuf;
}

/* Check if content indicates an image file */
static gboolean is_image_content(const char *content)
{
    if (!content) return FALSE;
    /* Check for "mime:image/" pattern in content */
    if (g_strstr_len(content, -1, "mime:image/")) return TRUE;
    /* Check common image extensions in Datei: line */
    const char *lower = NULL;
    char *tmp = g_ascii_strdown(content, -1);
    lower = tmp;
    gboolean is_img = (g_strstr_len(lower, -1, ".jpg") ||
                        g_strstr_len(lower, -1, ".jpeg") ||
                        g_strstr_len(lower, -1, ".png") ||
                        g_strstr_len(lower, -1, ".gif") ||
                        g_strstr_len(lower, -1, ".webp") ||
                        g_strstr_len(lower, -1, ".bmp"));
    g_free(tmp);
    return is_img;
}

/* --- Avatar drawing (Teams-style colored circle with initials) --- */

static const double avatar_palette[][3] = {
    {0.384, 0.392, 0.655},  /* #6264a7 - purple */
    {0.761, 0.224, 0.702},  /* #c239b3 - magenta */
    {0.169, 0.533, 0.847},  /* #2b88d8 - blue */
    {0.000, 0.647, 0.686},  /* #00a5af - teal */
    {0.906, 0.282, 0.337},  /* #e74856 - red */
    {0.290, 0.082, 0.294},  /* #4a154b - dark purple */
    {0.000, 0.471, 0.831},  /* #0078d4 - blue */
    {0.286, 0.510, 0.020},  /* #498205 - green */
    {0.792, 0.314, 0.063},  /* #ca5010 - orange */
    {0.529, 0.392, 0.722},  /* #8764b8 - violet */
};

typedef struct {
    char initials[8];
    double r, g, b;
} AvatarDrawData;

static gboolean draw_avatar_cb(GtkWidget *widget, cairo_t *cr, gpointer data)
{
    AvatarDrawData *av = (AvatarDrawData *)data;
    int w = gtk_widget_get_allocated_width(widget);
    int h = gtk_widget_get_allocated_height(widget);
    double radius = MIN(w, h) / 2.0;
    double cx = w / 2.0, cy = h / 2.0;

    /* Draw circle */
    cairo_arc(cr, cx, cy, radius, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, av->r, av->g, av->b);
    cairo_fill(cr);

    /* Draw initials text */
    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_select_font_face(cr, "Sans", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD);
    cairo_set_font_size(cr, radius * 0.9);
    cairo_text_extents_t extents;
    cairo_text_extents(cr, av->initials, &extents);
    cairo_move_to(cr, cx - extents.width / 2.0 - extents.x_bearing,
                      cy - extents.height / 2.0 - extents.y_bearing);
    cairo_show_text(cr, av->initials);

    return FALSE;
}

static GtkWidget *create_avatar_widget(const char *name, int size)
{
    AvatarDrawData *data = g_new0(AvatarDrawData, 1);

    /* Get first initial */
    if (name && name[0]) {
        gunichar first = g_utf8_get_char(name);
        first = g_unichar_toupper(first);
        int len = g_unichar_to_utf8(first, data->initials);
        data->initials[len] = '\0';
    } else {
        data->initials[0] = '?';
        data->initials[1] = '\0';
    }

    /* Pick color from palette based on name hash */
    guint hash = name ? g_str_hash(name) : 0;
    int idx = hash % G_N_ELEMENTS(avatar_palette);
    data->r = avatar_palette[idx][0];
    data->g = avatar_palette[idx][1];
    data->b = avatar_palette[idx][2];

    GtkWidget *da = gtk_drawing_area_new();
    gtk_widget_set_size_request(da, size, size);
    gtk_widget_set_halign(da, GTK_ALIGN_START);
    gtk_widget_set_valign(da, GTK_ALIGN_START);
    g_signal_connect(da, "draw", G_CALLBACK(draw_avatar_cb), data);
    g_object_set_data_full(G_OBJECT(da), "avatar-data", data, g_free);

    return da;
}

/* --- Status dot for message avatars --- */

typedef struct {
    double r, g, b;
} StatusDotData;

static gboolean draw_status_dot_cb(GtkWidget *widget, cairo_t *cr, gpointer data)
{
    StatusDotData *sd = (StatusDotData *)data;
    int w = gtk_widget_get_allocated_width(widget);
    int h = gtk_widget_get_allocated_height(widget);
    double radius = MIN(w, h) / 2.0;
    double cx = w / 2.0, cy = h / 2.0;

    /* White border */
    cairo_arc(cr, cx, cy, radius, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
    cairo_fill(cr);

    /* Colored dot */
    cairo_arc(cr, cx, cy, radius - 1.5, 0, 2 * G_PI);
    cairo_set_source_rgb(cr, sd->r, sd->g, sd->b);
    cairo_fill(cr);

    return FALSE;
}

static GtkWidget *create_status_dot(const char *status)
{
    StatusDotData *data = g_new0(StatusDotData, 1);

    if (status && g_strcmp0(status, "online") == 0) {
        data->r = 0.0; data->g = 0.784; data->b = 0.318;  /* #00c851 */
    } else if (status && (g_strcmp0(status, "busy") == 0 || g_strcmp0(status, "dnd") == 0)) {
        data->r = 0.769; data->g = 0.192; data->b = 0.294; /* #c4314b */
    } else if (status && g_strcmp0(status, "away") == 0) {
        data->r = 0.988; data->g = 0.729; data->b = 0.016; /* #fcba04 */
    } else {
        data->r = 0.576; data->g = 0.576; data->b = 0.561; /* #93938f */
    }

    GtkWidget *da = gtk_drawing_area_new();
    gtk_widget_set_size_request(da, 10, 10);
    gtk_widget_set_halign(da, GTK_ALIGN_END);
    gtk_widget_set_valign(da, GTK_ALIGN_END);
    g_signal_connect(da, "draw", G_CALLBACK(draw_status_dot_cb), data);
    g_object_set_data_full(G_OBJECT(da), "status-dot-data", data, g_free);

    return da;
}

/* --- Day separator (Teams-style centered date label between lines) --- */

static GtkWidget *create_day_separator(const char *date_str)
{
    GtkWidget *outer = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_style_context_add_class(gtk_widget_get_style_context(outer), "day-sep-box");
    gtk_widget_set_margin_top(outer, 8);
    gtk_widget_set_margin_bottom(outer, 4);
    gtk_widget_set_margin_start(outer, 16);
    gtk_widget_set_margin_end(outer, 16);

    /* Left line */
    GtkWidget *line1 = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_widget_set_valign(line1, GTK_ALIGN_CENTER);
    gtk_box_pack_start(GTK_BOX(outer), line1, TRUE, TRUE, 0);

    /* Date label */
    GtkWidget *label = gtk_label_new(date_str);
    gtk_style_context_add_class(gtk_widget_get_style_context(label), "day-sep-label");
    gtk_widget_set_margin_start(label, 12);
    gtk_widget_set_margin_end(label, 12);
    PangoAttrList *attrs = pango_attr_list_new();
    pango_attr_list_insert(attrs, pango_attr_scale_new(0.85));
    pango_attr_list_insert(attrs, pango_attr_foreground_new(0x6100, 0x6100, 0x6100));
    gtk_label_set_attributes(GTK_LABEL(label), attrs);
    pango_attr_list_unref(attrs);
    gtk_box_pack_start(GTK_BOX(outer), label, FALSE, FALSE, 0);

    /* Right line */
    GtkWidget *line2 = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_widget_set_valign(line2, GTK_ALIGN_CENTER);
    gtk_box_pack_start(GTK_BOX(outer), line2, TRUE, TRUE, 0);

    return outer;
}

/* --- Last-read marker (red line with "Neue Nachrichten" label) --- */

static GtkWidget *create_last_read_marker(const char *text)
{
    GtkWidget *outer = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_widget_set_margin_top(outer, 6);
    gtk_widget_set_margin_bottom(outer, 6);
    gtk_widget_set_margin_start(outer, 16);
    gtk_widget_set_margin_end(outer, 16);

    /* Left red line */
    GtkWidget *line1 = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_widget_set_valign(line1, GTK_ALIGN_CENTER);
    GtkCssProvider *css1 = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css1, "separator { background-color: #E74C3C; min-height: 1px; }", -1, NULL);
    gtk_style_context_add_provider(gtk_widget_get_style_context(line1),
        GTK_STYLE_PROVIDER(css1), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css1);
    gtk_box_pack_start(GTK_BOX(outer), line1, TRUE, TRUE, 0);

    /* Label */
    GtkWidget *label = gtk_label_new(text);
    gtk_widget_set_margin_start(label, 12);
    gtk_widget_set_margin_end(label, 12);
    PangoAttrList *attrs = pango_attr_list_new();
    pango_attr_list_insert(attrs, pango_attr_scale_new(0.85));
    pango_attr_list_insert(attrs, pango_attr_foreground_new(0xE700, 0x4C00, 0x3C00));
    pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
    gtk_label_set_attributes(GTK_LABEL(label), attrs);
    pango_attr_list_unref(attrs);
    gtk_box_pack_start(GTK_BOX(outer), label, FALSE, FALSE, 0);

    /* Right red line */
    GtkWidget *line2 = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_widget_set_valign(line2, GTK_ALIGN_CENTER);
    GtkCssProvider *css2 = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css2, "separator { background-color: #E74C3C; min-height: 1px; }", -1, NULL);
    gtk_style_context_add_provider(gtk_widget_get_style_context(line2),
        GTK_STYLE_PROVIDER(css2), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css2);
    gtk_box_pack_start(GTK_BOX(outer), line2, TRUE, TRUE, 0);

    return outer;
}

/* Format a date for the day separator label (e.g. "Montag, 24. Februar 2026") */
static char *format_day_label(const char *iso_str)
{
    if (!iso_str) return g_strdup("");
    GDateTime *dt = g_date_time_new_from_iso8601(iso_str, NULL);
    if (!dt) return g_strdup("");
    GDateTime *local = g_date_time_to_local(dt);
    g_date_time_unref(dt);

    GDateTime *now = g_date_time_new_now_local();
    gint now_y = g_date_time_get_year(now);
    gint now_m = g_date_time_get_month(now);
    gint now_d = g_date_time_get_day_of_month(now);

    gint msg_y = g_date_time_get_year(local);
    gint msg_m = g_date_time_get_month(local);
    gint msg_d = g_date_time_get_day_of_month(local);

    char *result;
    if (now_y == msg_y && now_m == msg_m && now_d == msg_d) {
        const char *lang = agora_translations_get_lang();
        if (g_strcmp0(lang, "de") == 0) result = g_strdup("Heute");
        else if (g_strcmp0(lang, "fr") == 0) result = g_strdup("Aujourd'hui");
        else if (g_strcmp0(lang, "es") == 0) result = g_strdup("Hoy");
        else result = g_strdup("Today");
    } else {
        /* Yesterday check */
        GDateTime *yesterday = g_date_time_add_days(now, -1);
        gint y_y = g_date_time_get_year(yesterday);
        gint y_m = g_date_time_get_month(yesterday);
        gint y_d = g_date_time_get_day_of_month(yesterday);
        g_date_time_unref(yesterday);

        if (y_y == msg_y && y_m == msg_m && y_d == msg_d) {
            const char *lang = agora_translations_get_lang();
            if (g_strcmp0(lang, "de") == 0) result = g_strdup("Gestern");
            else if (g_strcmp0(lang, "fr") == 0) result = g_strdup("Hier");
            else if (g_strcmp0(lang, "es") == 0) result = g_strdup("Ayer");
            else result = g_strdup("Yesterday");
        } else {
            /* Full date: "Montag, 24. Februar 2026" or "Monday, February 24, 2026" */
            result = g_date_time_format(local, "%A, %e. %B %Y");
        }
    }

    g_date_time_unref(local);
    g_date_time_unref(now);
    return result;
}

/* Extract just the date part (year, month, day) from an ISO string for comparison */
static void extract_date_parts(const char *iso_str, int *year, int *month, int *day)
{
    *year = 0; *month = 0; *day = 0;
    if (!iso_str) return;
    GDateTime *dt = g_date_time_new_from_iso8601(iso_str, NULL);
    if (!dt) return;
    GDateTime *local = g_date_time_to_local(dt);
    *year = g_date_time_get_year(local);
    *month = g_date_time_get_month(local);
    *day = g_date_time_get_day_of_month(local);
    g_date_time_unref(local);
    g_date_time_unref(dt);
}

/* Format a time string from ISO to "HH:MM" */
static char *format_msg_time(const char *iso_str)
{
    if (!iso_str) return g_strdup("");
    GDateTime *dt = g_date_time_new_from_iso8601(iso_str, NULL);
    if (!dt) return g_strdup("");
    GDateTime *local = g_date_time_to_local(dt);
    char *result = g_date_time_format(local, "%H:%M");
    g_date_time_unref(local);
    g_date_time_unref(dt);
    return result;
}

/* --- Message loading (Teams-style flat layout) --- */

static void send_reaction(AgoraMainWindow *win, const char *emoji, const char *msg_id)
{
    if (!emoji || !msg_id || !win->current_channel_id) return;

    /* Check if the user already reacted with this emoji -> toggle (remove) */
    gboolean should_remove = FALSE;

    /* Try to get current reactions for this message to check if we already reacted */
    char *get_path = g_strdup_printf("/api/channels/%s/messages/%s/reactions",
                                     win->current_channel_id, msg_id);
    GError *get_err = NULL;
    JsonNode *reactions_node = agora_api_client_get(win->api, get_path, &get_err);
    g_free(get_path);

    if (reactions_node) {
        /* Get current user id */
        AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
        AgoraSession *session = agora_app_get_session(app);
        const char *my_user_id = session ? session->user_id : NULL;

        if (my_user_id && JSON_NODE_HOLDS_ARRAY(reactions_node)) {
            JsonArray *arr = json_node_get_array(reactions_node);
            guint len = json_array_get_length(arr);
            for (guint i = 0; i < len; i++) {
                JsonObject *r = json_array_get_object_element(arr, i);
                const char *r_emoji = json_object_get_string_member(r, "emoji");
                const char *r_uid = json_object_get_string_member(r, "user_id");
                if (r_emoji && r_uid &&
                    g_strcmp0(r_emoji, emoji) == 0 &&
                    g_strcmp0(r_uid, my_user_id) == 0) {
                    should_remove = TRUE;
                    break;
                }
            }
        }
        json_node_unref(reactions_node);
    }
    if (get_err) g_error_free(get_err);

    if (should_remove) {
        /* Remove reaction */
        char *encoded_emoji = g_uri_escape_string(emoji, NULL, TRUE);
        char *path = g_strdup_printf("/api/channels/%s/messages/%s/reactions/%s",
                                     win->current_channel_id, msg_id, encoded_emoji);
        GError *err = NULL;
        JsonNode *res = agora_api_client_delete(win->api, path, &err);
        g_free(path);
        g_free(encoded_emoji);
        if (res) json_node_unref(res);
        if (err) {
            g_print("[Reaction] Remove error: %s\n", err->message);
            g_error_free(err);
        }
    } else {
        /* Add reaction */
        char *path = g_strdup_printf("/api/channels/%s/messages/%s/reactions",
                                     win->current_channel_id, msg_id);
        char *body = g_strdup_printf("{\"emoji\":\"%s\"}", emoji);
        GError *err = NULL;
        JsonNode *res = agora_api_client_post(win->api, path, body, &err);
        g_free(path);
        g_free(body);
        if (res) json_node_unref(res);
        if (err) {
            g_print("[Reaction] Add error: %s\n", err->message);
            g_error_free(err);
        }
    }

    /* Immediately reload messages to reflect the change */
    if (win->current_channel_id)
        load_messages(win, win->current_channel_id);
}

static void on_reaction_btn_clicked(GtkButton *btn, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *emoji = g_object_get_data(G_OBJECT(btn), "emoji");
    const char *msg_id = g_object_get_data(G_OBJECT(btn), "message-id");
    send_reaction(win, emoji, msg_id);
}

static void on_reaction_menu_activate(GtkMenuItem *item, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *emoji = g_object_get_data(G_OBJECT(item), "emoji");
    const char *msg_id = g_object_get_data(G_OBJECT(item), "message-id");
    send_reaction(win, emoji, msg_id);
}

/* --- Reply --- */

static void clear_reply_state(AgoraMainWindow *win)
{
    g_free(win->reply_to_id);
    win->reply_to_id = NULL;
    g_free(win->reply_to_sender);
    win->reply_to_sender = NULL;
    g_free(win->reply_to_content);
    win->reply_to_content = NULL;
    if (win->reply_bar)
        gtk_widget_hide(win->reply_bar);
}

static void clear_edit_state(AgoraMainWindow *win)
{
    g_free(win->editing_message_id);
    win->editing_message_id = NULL;
    if (win->reply_bar)
        gtk_widget_hide(win->reply_bar);
}

static void on_reply_cancel_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    clear_reply_state(win);
    clear_edit_state(win);
    gtk_entry_set_text(win->message_entry, "");
}

static void on_menu_reply_activate(GtkMenuItem *item, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *msg_id = g_object_get_data(G_OBJECT(item), "message-id");
    const char *sender = g_object_get_data(G_OBJECT(item), "sender-name");
    const char *content = g_object_get_data(G_OBJECT(item), "msg-content");

    clear_edit_state(win);
    g_free(win->reply_to_id);
    win->reply_to_id = g_strdup(msg_id);
    g_free(win->reply_to_sender);
    win->reply_to_sender = g_strdup(sender ? sender : "");
    g_free(win->reply_to_content);
    win->reply_to_content = g_strdup(content ? content : "");

    /* Show reply bar */
    char *preview = g_strdup_printf("%s %s: %s", T("chat.reply_to"),
                                    sender ? sender : "?",
                                    content ? content : "");
    gtk_label_set_text(win->reply_bar_label, preview);
    g_free(preview);
    gtk_widget_show(win->reply_bar);
    gtk_widget_grab_focus(GTK_WIDGET(win->message_entry));
}

/* --- Edit --- */

static void on_menu_edit_activate(GtkMenuItem *item, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *msg_id = g_object_get_data(G_OBJECT(item), "message-id");
    const char *content = g_object_get_data(G_OBJECT(item), "msg-content");

    clear_reply_state(win);
    g_free(win->editing_message_id);
    win->editing_message_id = g_strdup(msg_id);

    gtk_entry_set_text(win->message_entry, content ? content : "");
    gtk_editable_set_position(GTK_EDITABLE(win->message_entry), -1);

    char *label = g_strdup_printf("%s", T("chat.editing_message"));
    gtk_label_set_text(win->reply_bar_label, label);
    g_free(label);
    gtk_widget_show(win->reply_bar);
    gtk_widget_grab_focus(GTK_WIDGET(win->message_entry));
}

/* --- Delete --- */

static void on_menu_delete_activate(GtkMenuItem *item, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *msg_id = g_object_get_data(G_OBJECT(item), "message-id");
    if (!msg_id || !win->current_channel_id) return;

    GtkWidget *dialog = gtk_message_dialog_new(
        GTK_WINDOW(win), GTK_DIALOG_MODAL, GTK_MESSAGE_QUESTION,
        GTK_BUTTONS_YES_NO, "%s", T("chat.delete_confirm"));
    int response = gtk_dialog_run(GTK_DIALOG(dialog));
    gtk_widget_destroy(dialog);

    if (response == GTK_RESPONSE_YES) {
        char *path = g_strdup_printf("/api/channels/%s/messages/%s",
                                     win->current_channel_id, msg_id);
        GError *err = NULL;
        agora_api_client_delete(win->api, path, &err);
        g_free(path);
        if (err) g_error_free(err);
        load_messages(win, win->current_channel_id);
    }
}

static void on_forward_channel_row_activated(GtkListBox *box, GtkListBoxRow *row, gpointer data)
{
    (void)box;
    GtkWidget *dialog = GTK_WIDGET(data);
    const char *ch_id = g_object_get_data(G_OBJECT(row), "channel-id");
    if (ch_id) {
        g_object_set_data_full(G_OBJECT(dialog), "selected-channel",
                               g_strdup(ch_id), g_free);
        const char *ch_name = g_object_get_data(G_OBJECT(row), "channel-name");
        if (ch_name) {
            g_object_set_data_full(G_OBJECT(dialog), "selected-name",
                                   g_strdup(ch_name), g_free);
        }
        gtk_dialog_response(GTK_DIALOG(dialog), GTK_RESPONSE_OK);
    }
}

static void on_menu_forward_activate(GtkMenuItem *item, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *sender_name = g_object_get_data(G_OBJECT(item), "sender-name");
    const char *msg_content = g_object_get_data(G_OBJECT(item), "msg-content");
    const char *msg_type = g_object_get_data(G_OBJECT(item), "msg-type");
    const char *file_ref = g_object_get_data(G_OBJECT(item), "file-ref");
    if (!msg_content) return;

    /* Show channel picker dialog */
    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        T("chat.forward_to"),
        GTK_WINDOW(win),
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        T("chat.cancel"), GTK_RESPONSE_CANCEL,
        NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 320, 400);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content), 8);

    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    GtkWidget *list = gtk_list_box_new();
    gtk_container_add(GTK_CONTAINER(scroll), list);
    gtk_box_pack_start(GTK_BOX(content), scroll, TRUE, TRUE, 0);

    /* Load channels */
    GError *err = NULL;
    JsonNode *channels_node = agora_api_client_get(win->api, "/api/channels/", &err);
    if (channels_node && JSON_NODE_HOLDS_ARRAY(channels_node)) {
        JsonArray *arr = json_node_get_array(channels_node);
        guint len = json_array_get_length(arr);
        for (guint i = 0; i < len; i++) {
            JsonObject *ch = json_array_get_object_element(arr, i);
            const char *ch_id = json_object_get_string_member(ch, "id");
            const char *ch_name = json_object_get_string_member(ch, "name");
            /* Skip current channel */
            if (win->current_channel_id && g_strcmp0(ch_id, win->current_channel_id) == 0)
                continue;
            GtkWidget *row = gtk_list_box_row_new();
            GtkWidget *lbl = gtk_label_new(ch_name ? ch_name : ch_id);
            gtk_widget_set_halign(lbl, GTK_ALIGN_START);
            gtk_widget_set_margin_start(lbl, 12);
            gtk_widget_set_margin_top(lbl, 8);
            gtk_widget_set_margin_bottom(lbl, 8);
            gtk_container_add(GTK_CONTAINER(row), lbl);
            g_object_set_data_full(G_OBJECT(row), "channel-id", g_strdup(ch_id), g_free);
            g_object_set_data_full(G_OBJECT(row), "channel-name", g_strdup(ch_name ? ch_name : ""), g_free);
            gtk_list_box_insert(GTK_LIST_BOX(list), row, -1);
        }
    }
    if (channels_node) json_node_unref(channels_node);
    if (err) { g_error_free(err); err = NULL; }

    g_signal_connect(list, "row-activated",
                     G_CALLBACK(on_forward_channel_row_activated), dialog);

    gtk_widget_show_all(dialog);
    int response = gtk_dialog_run(GTK_DIALOG(dialog));

    if (response == GTK_RESPONSE_OK) {
        const char *target_id = g_object_get_data(G_OBJECT(dialog), "selected-channel");
        const char *target_name = g_object_get_data(G_OBJECT(dialog), "selected-name");
        if (target_id) {
            /* Build forwarded message content */
            char *fwd_content = g_strdup_printf("[%s %s]\n%s",
                T("chat.forwarded_from"),
                sender_name ? sender_name : "",
                msg_content);

            /* Use actual message type for file forwarding */
            const char *fwd_type = (msg_type && g_strcmp0(msg_type, "file") == 0) ? "file" : "text";

            JsonBuilder *b = json_builder_new();
            json_builder_begin_object(b);
            json_builder_set_member_name(b, "content");
            json_builder_add_string_value(b, fwd_content);
            json_builder_set_member_name(b, "message_type");
            json_builder_add_string_value(b, fwd_type);
            if (file_ref && file_ref[0]) {
                json_builder_set_member_name(b, "file_reference_id");
                json_builder_add_string_value(b, file_ref);
            }
            json_builder_end_object(b);

            JsonGenerator *gen = json_generator_new();
            json_generator_set_root(gen, json_builder_get_root(b));
            char *body = json_generator_to_data(gen, NULL);
            g_object_unref(gen);
            g_object_unref(b);

            char *path = g_strdup_printf("/api/channels/%s/messages/", target_id);
            GError *send_err = NULL;
            JsonNode *res = agora_api_client_post(win->api, path, body, &send_err);
            if (res) json_node_unref(res);
            if (send_err) g_error_free(send_err);
            g_free(path);
            g_free(body);
            g_free(fwd_content);

            g_print("[Forward] Message forwarded to %s\n", target_name ? target_name : target_id);
        }
    }
    gtk_widget_destroy(dialog);
}

static gboolean on_message_right_click(GtkWidget *widget, GdkEventButton *event,
                                        gpointer data)
{
    if (event->button != 3) return FALSE; /* Only right-click */
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *msg_id = g_object_get_data(G_OBJECT(widget), "message-id");
    const char *sender_name = g_object_get_data(G_OBJECT(widget), "sender-name");
    const char *msg_content = g_object_get_data(G_OBJECT(widget), "msg-content");
    gboolean is_own = GPOINTER_TO_INT(g_object_get_data(G_OBJECT(widget), "is-own"));
    if (!msg_id || !win->current_channel_id) return FALSE;

    GtkWidget *menu = gtk_menu_new();

    /* Reply */
    GtkWidget *reply_item = gtk_menu_item_new_with_label(T("chat.reply"));
    g_object_set_data_full(G_OBJECT(reply_item), "message-id", g_strdup(msg_id), g_free);
    g_object_set_data_full(G_OBJECT(reply_item), "sender-name", g_strdup(sender_name ? sender_name : ""), g_free);
    g_object_set_data_full(G_OBJECT(reply_item), "msg-content", g_strdup(msg_content ? msg_content : ""), g_free);
    g_signal_connect(reply_item, "activate", G_CALLBACK(on_menu_reply_activate), win);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), reply_item);

    /* Forward */
    const char *msg_type = g_object_get_data(G_OBJECT(widget), "msg-type");
    const char *file_ref = g_object_get_data(G_OBJECT(widget), "file-ref");
    GtkWidget *forward_item = gtk_menu_item_new_with_label(T("chat.forward"));
    g_object_set_data_full(G_OBJECT(forward_item), "sender-name", g_strdup(sender_name ? sender_name : ""), g_free);
    g_object_set_data_full(G_OBJECT(forward_item), "msg-content", g_strdup(msg_content ? msg_content : ""), g_free);
    g_object_set_data_full(G_OBJECT(forward_item), "msg-type", g_strdup(msg_type ? msg_type : "text"), g_free);
    g_object_set_data_full(G_OBJECT(forward_item), "file-ref", g_strdup(file_ref ? file_ref : ""), g_free);
    g_signal_connect(forward_item, "activate", G_CALLBACK(on_menu_forward_activate), win);
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), forward_item);

    /* Edit + Delete (only own messages) */
    if (is_own) {
        GtkWidget *edit_item = gtk_menu_item_new_with_label(T("chat.edit"));
        g_object_set_data_full(G_OBJECT(edit_item), "message-id", g_strdup(msg_id), g_free);
        g_object_set_data_full(G_OBJECT(edit_item), "msg-content", g_strdup(msg_content ? msg_content : ""), g_free);
        g_signal_connect(edit_item, "activate", G_CALLBACK(on_menu_edit_activate), win);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), edit_item);

        GtkWidget *delete_item = gtk_menu_item_new_with_label(T("chat.delete"));
        g_object_set_data_full(G_OBJECT(delete_item), "message-id", g_strdup(msg_id), g_free);
        g_signal_connect(delete_item, "activate", G_CALLBACK(on_menu_delete_activate), win);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), delete_item);
    }

    /* Separator */
    gtk_menu_shell_append(GTK_MENU_SHELL(menu), gtk_separator_menu_item_new());

    /* Reactions */
    static const char *emojis[] = {
        "\xF0\x9F\x91\x8D",           /* 👍 */
        "\xE2\x9D\xA4\xEF\xB8\x8F",  /* ❤️ */
        "\xF0\x9F\x98\x82",           /* 😂 */
        "\xF0\x9F\x8E\x89",           /* 🎉 */
        "\xF0\x9F\x98\xAE",           /* 😮 */
        NULL
    };

    for (int i = 0; emojis[i]; i++) {
        GtkWidget *item = gtk_menu_item_new_with_label(emojis[i]);
        g_object_set_data_full(G_OBJECT(item), "emoji",
                               g_strdup(emojis[i]), g_free);
        g_object_set_data_full(G_OBJECT(item), "message-id",
                               g_strdup(msg_id), g_free);
        g_signal_connect(item, "activate",
                         G_CALLBACK(on_reaction_menu_activate), win);
        gtk_menu_shell_append(GTK_MENU_SHELL(menu), item);
    }
    gtk_widget_show_all(menu);
    gtk_menu_popup_at_pointer(GTK_MENU(menu), (GdkEvent *)event);
    return TRUE;
}

static gboolean scroll_message_list_to_bottom(gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!GTK_IS_WIDGET(win->message_scroll)) return G_SOURCE_REMOVE;
    GtkAdjustment *adj = gtk_scrolled_window_get_vadjustment(
        GTK_SCROLLED_WINDOW(win->message_scroll));
    gtk_adjustment_set_value(adj, gtk_adjustment_get_upper(adj));
    return G_SOURCE_REMOVE;
}

static GtkWidget *create_message_bubble(AgoraMainWindow *win, JsonObject *msg,
                                         gboolean is_own)
{
    const char *msg_id = json_object_has_member(msg, "id")
        ? json_object_get_string_member(msg, "id") : NULL;
    const char *sender = json_object_get_string_member(msg, "sender_name");
    const char *content = json_object_get_string_member(msg, "content");
    const char *created = json_object_get_string_member(msg, "created_at");
    const char *msg_type = json_object_get_string_member(msg, "message_type");
    gboolean has_edited = json_object_has_member(msg, "edited_at") &&
                          !json_object_get_null_member(msg, "edited_at");

    const char *file_ref_id = json_object_has_member(msg, "file_reference_id") &&
        !json_object_get_null_member(msg, "file_reference_id")
        ? json_object_get_string_member(msg, "file_reference_id") : NULL;

    const char *sender_status = json_object_has_member(msg, "sender_status") &&
        !json_object_get_null_member(msg, "sender_status")
        ? json_object_get_string_member(msg, "sender_status") : "offline";

    /* Teams-style: [Avatar 36px] [Content area] -- all left-aligned */
    GtkWidget *outer = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
    gtk_style_context_add_class(gtk_widget_get_style_context(outer), "msg-flat");
    gtk_widget_set_margin_start(outer, 16);
    gtk_widget_set_margin_end(outer, 16);
    gtk_widget_set_margin_top(outer, 2);
    gtk_widget_set_margin_bottom(outer, 2);

    /* Avatar circle with status dot overlay */
    GtkWidget *avatar = create_avatar_widget(sender, 36);
    gtk_widget_set_margin_top(avatar, 2);
    GtkWidget *avatar_overlay = gtk_overlay_new();
    gtk_container_add(GTK_CONTAINER(avatar_overlay), avatar);
    GtkWidget *status_dot = create_status_dot(sender_status);
    gtk_overlay_add_overlay(GTK_OVERLAY(avatar_overlay), status_dot);
    gtk_box_pack_start(GTK_BOX(outer), avatar_overlay, FALSE, FALSE, 0);

    /* Right content column */
    GtkWidget *content_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 1);

    /* Reply quote (if replying to a message) */
    if (json_object_has_member(msg, "reply_to_sender") &&
        !json_object_get_null_member(msg, "reply_to_sender")) {
        const char *reply_sender = json_object_get_string_member(msg, "reply_to_sender");
        const char *reply_content = json_object_get_string_member(msg, "reply_to_content");
        char *quote = g_strdup_printf("<small><b>%s</b>  %s</small>",
                                       reply_sender ? reply_sender : "?",
                                       reply_content ? reply_content : "");
        GtkWidget *quote_lbl = gtk_label_new(NULL);
        gtk_label_set_markup(GTK_LABEL(quote_lbl), quote);
        g_free(quote);
        gtk_widget_set_halign(quote_lbl, GTK_ALIGN_START);
        gtk_label_set_line_wrap(GTK_LABEL(quote_lbl), TRUE);
        gtk_label_set_max_width_chars(GTK_LABEL(quote_lbl), 60);
        gtk_style_context_add_class(gtk_widget_get_style_context(quote_lbl), "msg-reply");
        gtk_box_pack_start(GTK_BOX(content_box), quote_lbl, FALSE, FALSE, 0);
    }

    /* Header line: Sender Name    HH:MM */
    GtkWidget *header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);

    char *sender_markup = g_strdup_printf(
        "<b>%s</b>", sender ? sender : "?");
    GtkWidget *sender_lbl = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(sender_lbl), sender_markup);
    g_free(sender_markup);
    gtk_widget_set_halign(sender_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(header), sender_lbl, FALSE, FALSE, 0);

    if (has_edited) {
        GtkWidget *ed_lbl = gtk_label_new(NULL);
        char *ed_markup = g_strdup_printf(
            "<small><i>%s</i></small>", T("chat.edited"));
        gtk_label_set_markup(GTK_LABEL(ed_lbl), ed_markup);
        g_free(ed_markup);
        gtk_box_pack_start(GTK_BOX(header), ed_lbl, FALSE, FALSE, 0);
    }

    /* Absolute time HH:MM */
    char *time_str = format_msg_time(created);
    GtkWidget *time_lbl = gtk_label_new(NULL);
    char *time_markup = g_strdup_printf(
        "<small><span foreground='#999999'>%s</span></small>", time_str);
    gtk_label_set_markup(GTK_LABEL(time_lbl), time_markup);
    g_free(time_markup);
    g_free(time_str);
    gtk_box_pack_start(GTK_BOX(header), time_lbl, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(content_box), header, FALSE, FALSE, 0);

    /* Message content */
    if (msg_type && g_strcmp0(msg_type, "system") == 0) {
        char *sys = g_strdup_printf("<i>%s</i>", content ? content : "");
        GtkWidget *sys_lbl = gtk_label_new(NULL);
        gtk_label_set_markup(GTK_LABEL(sys_lbl), sys);
        g_free(sys);
        gtk_widget_set_halign(sys_lbl, GTK_ALIGN_START);
        gtk_label_set_line_wrap(GTK_LABEL(sys_lbl), TRUE);
        gtk_box_pack_start(GTK_BOX(content_box), sys_lbl, FALSE, FALSE, 0);
    } else if (file_ref_id && msg_type && g_strcmp0(msg_type, "file") == 0 &&
               is_image_content(content)) {
        GdkPixbuf *pixbuf = download_inline_image(win, file_ref_id, 300);
        if (pixbuf) {
            GtkWidget *img = gtk_image_new_from_pixbuf(pixbuf);
            gtk_widget_set_halign(img, GTK_ALIGN_START);
            gtk_box_pack_start(GTK_BOX(content_box), img, FALSE, FALSE, 2);
            g_object_unref(pixbuf);
        }
    } else {
        GtkWidget *content_lbl = gtk_label_new(content ? content : "");
        gtk_widget_set_halign(content_lbl, GTK_ALIGN_START);
        gtk_label_set_line_wrap(GTK_LABEL(content_lbl), TRUE);
        gtk_label_set_max_width_chars(GTK_LABEL(content_lbl), 80);
        gtk_label_set_selectable(GTK_LABEL(content_lbl), TRUE);
        gtk_box_pack_start(GTK_BOX(content_box), content_lbl, FALSE, FALSE, 0);
    }

    /* Reactions display */
    if (json_object_has_member(msg, "reactions") &&
        !json_object_get_null_member(msg, "reactions")) {
        JsonArray *reactions = json_object_get_array_member(msg, "reactions");
        guint rlen = reactions ? json_array_get_length(reactions) : 0;
        if (rlen > 0) {
            GHashTable *counts = g_hash_table_new_full(g_str_hash, g_str_equal, g_free, NULL);
            for (guint r = 0; r < rlen; r++) {
                JsonObject *reaction = json_array_get_object_element(reactions, r);
                const char *emoji = json_object_get_string_member(reaction, "emoji");
                if (!emoji) continue;
                gpointer val = g_hash_table_lookup(counts, emoji);
                int cnt = GPOINTER_TO_INT(val) + 1;
                g_hash_table_replace(counts, g_strdup(emoji), GINT_TO_POINTER(cnt));
            }
            GtkWidget *reaction_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 4);
            gtk_widget_set_margin_top(reaction_box, 2);
            GHashTableIter hiter;
            gpointer key, value;
            g_hash_table_iter_init(&hiter, counts);
            while (g_hash_table_iter_next(&hiter, &key, &value)) {
                char *badge_text = g_strdup_printf("%s %d", (char *)key, GPOINTER_TO_INT(value));
                GtkWidget *badge = gtk_button_new_with_label(badge_text);
                g_free(badge_text);
                gtk_style_context_add_class(gtk_widget_get_style_context(badge), "reaction-badge");
                if (msg_id) {
                    g_object_set_data_full(G_OBJECT(badge), "emoji", g_strdup(key), g_free);
                    g_object_set_data_full(G_OBJECT(badge), "message-id", g_strdup(msg_id), g_free);
                    g_signal_connect(badge, "clicked", G_CALLBACK(on_reaction_btn_clicked), win);
                }
                gtk_box_pack_start(GTK_BOX(reaction_box), badge, FALSE, FALSE, 0);
            }
            gtk_box_pack_start(GTK_BOX(content_box), reaction_box, FALSE, FALSE, 0);
            g_hash_table_destroy(counts);
        }
    }

    gtk_box_pack_start(GTK_BOX(outer), content_box, TRUE, TRUE, 0);

    /* Wrap in GtkEventBox for right-click context menu */
    GtkWidget *evbox = gtk_event_box_new();
    gtk_container_add(GTK_CONTAINER(evbox), outer);
    if (msg_id) {
        g_object_set_data_full(G_OBJECT(evbox), "message-id",
                               g_strdup(msg_id), g_free);
        g_object_set_data_full(G_OBJECT(evbox), "sender-name",
                               g_strdup(sender ? sender : ""), g_free);
        g_object_set_data_full(G_OBJECT(evbox), "msg-content",
                               g_strdup(content ? content : ""), g_free);
        g_object_set_data(G_OBJECT(evbox), "is-own",
                          GINT_TO_POINTER(is_own ? 1 : 0));
        g_object_set_data_full(G_OBJECT(evbox), "msg-type",
                               g_strdup(msg_type ? msg_type : "text"), g_free);
        g_object_set_data_full(G_OBJECT(evbox), "file-ref",
                               g_strdup(file_ref_id ? file_ref_id : ""), g_free);
        g_signal_connect(evbox, "button-press-event",
                         G_CALLBACK(on_message_right_click), win);
    }

    return evbox;
}

static void load_messages(AgoraMainWindow *win, const char *channel_id)
{
    /* Fetch last-read position */
    char *last_read_msg_id = NULL;
    {
        char *rp_path = g_strdup_printf("/api/channels/%s/read-position", channel_id);
        GError *rp_err = NULL;
        JsonNode *rp_result = agora_api_client_get(win->api, rp_path, &rp_err);
        g_free(rp_path);
        if (rp_result) {
            JsonObject *rp_obj = json_node_get_object(rp_result);
            if (rp_obj && json_object_has_member(rp_obj, "last_read_message_id") &&
                !json_object_get_null_member(rp_obj, "last_read_message_id")) {
                const char *val = json_object_get_string_member(rp_obj, "last_read_message_id");
                if (val && val[0]) last_read_msg_id = g_strdup(val);
            }
            json_node_unref(rp_result);
        }
        if (rp_err) g_error_free(rp_err);
    }

    char *path = g_strdup_printf("/api/channels/%s/messages/?limit=50", channel_id);
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &error);
    g_free(path);

    /* Clear existing message rows */
    clear_list_box(win->message_list);

    if (!result) {
        if (error) g_error_free(error);
        g_free(last_read_msg_id);
        return;
    }

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *session = agora_app_get_session(app);

    /* Find the index of the last-read message */
    int last_read_index = -1;
    if (last_read_msg_id) {
        for (guint i = 0; i < len; i++) {
            JsonObject *msg = json_array_get_object_element(arr, i);
            const char *msg_id = json_object_has_member(msg, "id")
                ? json_object_get_string_member(msg, "id") : NULL;
            if (msg_id && g_strcmp0(msg_id, last_read_msg_id) == 0) {
                last_read_index = (int)i;
                break;
            }
        }
    }
    g_free(last_read_msg_id);

    /* Only show marker if there are newer messages after it */
    gboolean show_marker = (last_read_index >= 0 && last_read_index < (int)len - 1);

    int prev_year = 0, prev_month = 0, prev_day = 0;

    for (guint i = 0; i < len; i++) {
        JsonObject *msg = json_array_get_object_element(arr, i);
        const char *sender_id = json_object_has_member(msg, "sender_id")
            ? json_object_get_string_member(msg, "sender_id") : NULL;
        const char *created_at = json_object_has_member(msg, "created_at")
            ? json_object_get_string_member(msg, "created_at") : NULL;
        gboolean is_own = (sender_id && session->user_id &&
                           g_strcmp0(sender_id, session->user_id) == 0);

        /* Insert day separator if date changed */
        int msg_y, msg_m, msg_d;
        extract_date_parts(created_at, &msg_y, &msg_m, &msg_d);
        if (msg_y != prev_year || msg_m != prev_month || msg_d != prev_day) {
            if (i > 0 || (msg_y != 0)) {  /* Skip separator before very first msg if no date */
                char *day_text = format_day_label(created_at);
                GtkWidget *sep_widget = create_day_separator(day_text);
                g_free(day_text);
                GtkWidget *sep_row = gtk_list_box_row_new();
                gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(sep_row), FALSE);
                gtk_list_box_row_set_selectable(GTK_LIST_BOX_ROW(sep_row), FALSE);
                gtk_container_add(GTK_CONTAINER(sep_row), sep_widget);
                gtk_list_box_insert(win->message_list, sep_row, -1);
            }
            prev_year = msg_y; prev_month = msg_m; prev_day = msg_d;
        }

        /* Insert last-read marker after the last-read message */
        if (show_marker && (int)i == last_read_index + 1) {
            GtkWidget *marker = create_last_read_marker(T("chat.new_messages"));
            GtkWidget *marker_row = gtk_list_box_row_new();
            gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(marker_row), FALSE);
            gtk_list_box_row_set_selectable(GTK_LIST_BOX_ROW(marker_row), FALSE);
            gtk_container_add(GTK_CONTAINER(marker_row), marker);
            gtk_list_box_insert(win->message_list, marker_row, -1);
        }

        GtkWidget *bubble = create_message_bubble(win, msg, is_own);
        GtkWidget *row = gtk_list_box_row_new();
        gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(row), FALSE);
        gtk_container_add(GTK_CONTAINER(row), bubble);
        gtk_list_box_insert(win->message_list, row, -1);
    }

    gtk_widget_show_all(GTK_WIDGET(win->message_list));

    /* Scroll to bottom after layout */
    g_idle_add(scroll_message_list_to_bottom, win);

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

        /* Determine if own message */
        AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
        AgoraSession *session = agora_app_get_session(app);
        const char *sender_id = json_object_has_member(msg, "sender_id")
            ? json_object_get_string_member(msg, "sender_id") : NULL;
        gboolean is_own = (sender_id && session->user_id &&
                           g_strcmp0(sender_id, session->user_id) == 0);

        /* Add bubble to message list */
        GtkWidget *bubble = create_message_bubble(win, msg, is_own);
        GtkWidget *row = gtk_list_box_row_new();
        gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(row), FALSE);
        gtk_container_add(GTK_CONTAINER(row), bubble);
        gtk_list_box_insert(win->message_list, row, -1);
        gtk_widget_show_all(row);

        /* Scroll to bottom */
        g_idle_add(scroll_message_list_to_bottom, win);

        /* Clear typing indicator */
        gtk_label_set_text(win->typing_label, "");
        gtk_widget_hide(GTK_WIDGET(win->typing_label));

        /* Play notification sound and show desktop notification for messages from others */
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
        const char *message_sender_id = json_object_has_member(root, "message_sender_id")
            ? json_object_get_string_member(root, "message_sender_id") : NULL;

        /* Reload messages to show updated reactions */
        if (win->current_channel_id)
            load_messages(win, win->current_channel_id);

        /* Show notification only for reactions on own messages */
        AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
        AgoraSession *session = agora_app_get_session(app);
        if (g_strcmp0(action, "add") == 0 && user_id && session->user_id &&
            g_strcmp0(user_id, session->user_id) != 0 &&
            message_sender_id && g_strcmp0(message_sender_id, session->user_id) == 0) {
            char *notif_title = g_strdup_printf("%s %s", display_name, T("notify.reacted"));
            char *notif_body = g_strdup_printf("%s %s", emoji, T("notify.reaction_body"));
            show_notification(notif_title, notif_body);
            g_free(notif_title);
            g_free(notif_body);
        }
    }
    else if (g_strcmp0(msg_type, "member_added") == 0 ||
             g_strcmp0(msg_type, "member_left") == 0) {
        /* Update member count display and reload channel list */
        if (json_object_has_member(root, "member_count") && win->chat_subtitle) {
            gint64 new_count = json_object_get_int_member(root, "member_count");
            char *count_text = g_strdup_printf("%ld %s", (long)new_count, T("chat.members"));
            gtk_label_set_text(win->chat_subtitle, count_text);
            g_free(count_text);
        }
        load_channels(win);
        load_teams(win);
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
    else if (g_strcmp0(msg_type, "status_change") == 0 ||
             g_strcmp0(msg_type, "user_statuses") == 0 ||
             g_strcmp0(msg_type, "user_joined") == 0) {
        /* Reload messages to update status dots */
        if (win->current_channel_id)
            load_messages(win, win->current_channel_id);
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
        win->ws_session = soup_session_new();
    }

    SoupMessage *msg = soup_message_new("GET", ws_url);
    g_free(ws_url);
    if (!msg) return;

    /* Accept self-signed certificates for WebSocket connections */
    g_signal_connect(msg, "accept-certificate",
                     G_CALLBACK(accept_cert_cb), NULL);

    soup_session_websocket_connect_async(win->ws_session, msg,
                                          NULL, NULL, G_PRIORITY_DEFAULT,
                                          NULL, on_ws_connected, win);
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

/* --- Notification WebSocket --- */

static void on_notif_ws_message(SoupWebsocketConnection *conn,
                                 SoupWebsocketDataType type,
                                 GBytes *message,
                                 gpointer user_data)
{
    (void)conn;
    if (type != SOUP_WEBSOCKET_DATA_TEXT) return;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);

    gsize len;
    const char *data = g_bytes_get_data(message, &len);

    JsonParser *parser = json_parser_new();
    if (!json_parser_load_from_data(parser, data, (gssize)len, NULL)) {
        g_object_unref(parser);
        return;
    }

    JsonNode *root_node = json_parser_get_root(parser);
    if (!root_node || !JSON_NODE_HOLDS_OBJECT(root_node)) {
        g_object_unref(parser);
        return;
    }

    JsonObject *root = json_node_get_object(root_node);
    const char *msg_type = json_object_get_string_member(root, "type");

    if (g_strcmp0(msg_type, "team_member_added") == 0) {
        /* User was added to a team – reload teams and channels */
        load_teams(win);
        load_channels(win);
    }
    else if (g_strcmp0(msg_type, "status_change") == 0) {
        /* Reload messages to update status dots */
        if (win->current_channel_id)
            load_messages(win, win->current_channel_id);
    }

    g_object_unref(parser);
}

static gboolean notif_ws_reconnect_cb(gpointer user_data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);
    connect_notification_ws(win);
    /* Reload data that may have been missed while disconnected */
    load_teams(win);
    load_channels(win);
    return G_SOURCE_REMOVE;
}

static void on_notif_ws_closed(SoupWebsocketConnection *conn, gpointer user_data)
{
    (void)conn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);
    if (win->notif_ws_conn) {
        g_object_unref(win->notif_ws_conn);
        win->notif_ws_conn = NULL;
    }
    /* Reconnect after 5 seconds */
    g_timeout_add_seconds(5, notif_ws_reconnect_cb, win);
}

static void on_notif_ws_connected(GObject *source, GAsyncResult *result, gpointer user_data)
{
    (void)source;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(user_data);
    GError *error = NULL;

    win->notif_ws_conn = soup_session_websocket_connect_finish(win->notif_ws_session, result, &error);
    if (!win->notif_ws_conn) {
        if (error) {
            g_warning("Notification WebSocket connection failed: %s", error->message);
            g_error_free(error);
        }
        return;
    }

    g_signal_connect(win->notif_ws_conn, "message", G_CALLBACK(on_notif_ws_message), win);
    g_signal_connect(win->notif_ws_conn, "closed", G_CALLBACK(on_notif_ws_closed), win);
}

static void connect_notification_ws(AgoraMainWindow *win)
{
    disconnect_notification_ws(win);

    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *session = agora_app_get_session(app);

    /* Build WebSocket URL */
    char *ws_url;
    if (g_str_has_prefix(session->base_url, "https://")) {
        ws_url = g_strdup_printf("wss://%s/ws/notifications?token=%s",
            session->base_url + 8, session->token);
    } else if (g_str_has_prefix(session->base_url, "http://")) {
        ws_url = g_strdup_printf("ws://%s/ws/notifications?token=%s",
            session->base_url + 7, session->token);
    } else {
        return;
    }

    if (!win->notif_ws_session) {
        win->notif_ws_session = soup_session_new();
    }

    SoupMessage *msg = soup_message_new("GET", ws_url);
    g_free(ws_url);
    if (!msg) return;

    g_signal_connect(msg, "accept-certificate",
                     G_CALLBACK(accept_cert_cb), NULL);

    soup_session_websocket_connect_async(win->notif_ws_session, msg,
                                          NULL, NULL, G_PRIORITY_DEFAULT,
                                          NULL, on_notif_ws_connected, win);
    g_object_unref(msg);
}

static void disconnect_notification_ws(AgoraMainWindow *win)
{
    if (win->notif_ws_conn) {
        if (soup_websocket_connection_get_state(win->notif_ws_conn) == SOUP_WEBSOCKET_STATE_OPEN) {
            soup_websocket_connection_close(win->notif_ws_conn, SOUP_WEBSOCKET_CLOSE_NORMAL, NULL);
        }
        g_object_unref(win->notif_ws_conn);
        win->notif_ws_conn = NULL;
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
    SoupSession *session = soup_session_new();
    SoupMessage *msg = soup_message_new("GET", sound_url);
    g_free(sound_url);

    if (!msg) {
        g_object_unref(session);
        return;
    }

    g_signal_connect(msg, "accept-certificate", G_CALLBACK(accept_cert_cb), NULL);
    GInputStream *stream = soup_session_send(session, msg, NULL, NULL);
    if (stream) {
        guint status = soup_message_get_status(msg);
        if (status == 200) {
            gsize length = 0;
            char *data = read_stream_full(stream, &length);
            if (data && length > 0) {
                win->notification_sound_path = g_build_filename(
                    g_get_tmp_dir(), "agora-notification.mp3", NULL);
                g_file_set_contents(win->notification_sound_path,
                                    data, (gssize)length, NULL);
            }
            g_free(data);
        }
        g_object_unref(stream);
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

/* --- Status helpers --- */

static void update_chat_subtitle_status(AgoraMainWindow *win, const char *channel_id)
{
    /* Load members to get status for direct chats */
    char *path = g_strdup_printf("/api/channels/%s/members", channel_id);
    GError *error = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &error);
    g_free(path);

    if (!result) {
        gtk_label_set_text(win->chat_subtitle, "");
        if (error) g_error_free(error);
        return;
    }

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *session = agora_app_get_session(app);

    /* For 2-member channels (direct), show the other user's status */
    if (len == 2 && session->user_id) {
        for (guint i = 0; i < len; i++) {
            JsonObject *member = json_array_get_object_element(arr, i);
            if (!json_object_has_member(member, "user")) continue;
            JsonObject *user = json_object_get_object_member(member, "user");
            const char *uid = json_object_get_string_member(user, "id");
            if (g_strcmp0(uid, session->user_id) == 0) continue;

            const char *status = json_object_has_member(user, "status")
                ? json_object_get_string_member(user, "status") : "offline";

            if (g_strcmp0(status, "online") == 0)
                gtk_label_set_text(win->chat_subtitle, T("status.online"));
            else if (g_strcmp0(status, "away") == 0)
                gtk_label_set_text(win->chat_subtitle, T("status.away"));
            else
                gtk_label_set_text(win->chat_subtitle, T("status.offline"));

            /* Color the subtitle green for online */
            PangoAttrList *attrs = pango_attr_list_new();
            pango_attr_list_insert(attrs, pango_attr_scale_new(0.8));
            if (g_strcmp0(status, "online") == 0)
                pango_attr_list_insert(attrs, pango_attr_foreground_new(0x6B00, 0xB700, 0x0000));
            else if (g_strcmp0(status, "away") == 0)
                pango_attr_list_insert(attrs, pango_attr_foreground_new(0xFF00, 0xAA00, 0x4400));
            else
                pango_attr_list_insert(attrs, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
            gtk_label_set_attributes(win->chat_subtitle, attrs);
            pango_attr_list_unref(attrs);
            break;
        }
    } else {
        char *members_text = g_strdup_printf("%u %s", len, T("chat.members"));
        gtk_label_set_text(win->chat_subtitle, members_text);
        g_free(members_text);
    }

    json_node_unref(result);
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
    update_chat_subtitle_status(win, channel_id);
    gtk_stack_set_visible_child_name(win->content_stack, "chat");

    /* Clear typing indicator */
    gtk_label_set_text(win->typing_label, "");
    gtk_widget_hide(GTK_WIDGET(win->typing_label));

    load_messages(win, channel_id);

    /* Connect WebSocket for real-time updates */
    connect_channel_ws(win, channel_id);

    /* Mark channel as read via REST API */
    {
        /* Find last message ID from the loaded messages */
        GList *msg_children = gtk_container_get_children(GTK_CONTAINER(win->message_list));
        const char *last_msg_id = NULL;
        for (GList *l = g_list_last(msg_children); l; l = l->prev) {
            GtkWidget *child = GTK_WIDGET(l->data);
            /* The event box wrapping the bubble stores message-id */
            const char *mid = g_object_get_data(G_OBJECT(child), "message-id");
            if (mid) { last_msg_id = mid; break; }
        }
        g_list_free(msg_children);

        if (last_msg_id) {
            char *read_path = g_strdup_printf("/api/channels/%s/read-position", channel_id);
            char *read_body = g_strdup_printf("{\"last_read_message_id\":\"%s\"}", last_msg_id);
            GError *read_err = NULL;
            JsonNode *read_res = agora_api_client_put(win->api, read_path, read_body, &read_err);
            g_free(read_path);
            g_free(read_body);
            if (read_res) json_node_unref(read_res);
            if (read_err) {
                g_print("[Read] Error marking channel read: %s\n", read_err->message);
                g_error_free(read_err);
            }
        }

        /* Also mark feed events for this channel as read */
        {
            char *feed_body = g_strdup_printf("{\"channel_id\":\"%s\"}", channel_id);
            GError *feed_err = NULL;
            JsonNode *feed_res = agora_api_client_post(win->api, "/api/feed/read", feed_body, &feed_err);
            g_free(feed_body);
            if (feed_res) json_node_unref(feed_res);
            if (feed_err) g_error_free(feed_err);
        }

        /* Reload channel list to update unread badges.
           Deferred to idle so GTK finishes click processing first;
           calling load_channels here would destroy the clicked row
           while GTK still holds a pointer to it. */
        g_idle_add(reload_channels_idle, win);
    }

    gtk_widget_grab_focus(GTK_WIDGET(win->message_entry));
}

/* =====================================================================
 * Team Detail View
 * ===================================================================== */

static void on_team_remove_member_clicked(GtkButton *btn, gpointer data)
{
    AgoraMainWindow *w = AGORA_MAIN_WINDOW(data);
    const char *user_id = g_object_get_data(G_OBJECT(btn), "user-id");
    const char *dname = g_object_get_data(G_OBJECT(btn), "display-name");
    if (!user_id || !w->current_team_id) return;

    char *msg = g_strdup_printf("%s %s?", T("teams.remove_member_confirm"), dname);
    GtkWidget *dlg = gtk_message_dialog_new(GTK_WINDOW(w),
        GTK_DIALOG_MODAL, GTK_MESSAGE_QUESTION, GTK_BUTTONS_YES_NO, "%s", msg);
    g_free(msg);
    int resp = gtk_dialog_run(GTK_DIALOG(dlg));
    gtk_widget_destroy(dlg);
    if (resp != GTK_RESPONSE_YES) return;

    char *p = g_strdup_printf("/api/teams/%s/members/%s", w->current_team_id, user_id);
    GError *e = NULL;
    JsonNode *r = agora_api_client_delete(w->api, p, &e);
    g_free(p);
    if (r) json_node_unref(r);
    if (e) g_error_free(e);
    load_team_detail_members(w);
}

static void on_team_add_member_clicked(GtkButton *btn, gpointer data)
{
    AgoraMainWindow *w = AGORA_MAIN_WINDOW(data);
    const char *user_id = g_object_get_data(G_OBJECT(btn), "user-id");
    if (!user_id || !w->current_team_id) return;

    char *body = g_strdup_printf("{\"user_id\":\"%s\",\"role\":\"member\"}", user_id);
    char *p = g_strdup_printf("/api/teams/%s/members", w->current_team_id);
    GError *e = NULL;
    JsonNode *r = agora_api_client_post(w->api, p, body, &e);
    g_free(body);
    g_free(p);
    if (r) json_node_unref(r);
    if (e) g_error_free(e);

    /* Refresh members and clear search */
    load_team_detail_members(w);
    gtk_entry_set_text(w->team_member_search_entry, "");
    gtk_widget_hide(w->team_member_search_box);
}

static void load_team_detail_channels(AgoraMainWindow *win)
{
    if (!win->current_team_id) return;
    clear_list_box(win->team_channels_list);

    char *path = g_strdup_printf("/api/channels/?team_id=%s", win->current_team_id);
    GError *err = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &err);
    g_free(path);
    if (!result) { if (err) g_error_free(err); return; }

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);
    for (guint i = 0; i < len; i++) {
        JsonObject *ch = json_array_get_object_element(arr, i);
        const char *name = json_object_get_string_member(ch, "name");
        const char *id = json_object_get_string_member(ch, "id");
        gint64 mc = json_object_has_member(ch, "member_count")
            ? json_object_get_int_member(ch, "member_count") : 0;

        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
        gtk_widget_set_margin_start(row_box, 12);
        gtk_widget_set_margin_end(row_box, 12);
        gtk_widget_set_margin_top(row_box, 6);
        gtk_widget_set_margin_bottom(row_box, 6);

        GtkWidget *icon = gtk_label_new("#");
        PangoAttrList *ia = pango_attr_list_new();
        pango_attr_list_insert(ia, pango_attr_foreground_new(0x6600, 0x6400, 0xa700));
        pango_attr_list_insert(ia, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
        gtk_label_set_attributes(GTK_LABEL(icon), ia);
        pango_attr_list_unref(ia);
        gtk_box_pack_start(GTK_BOX(row_box), icon, FALSE, FALSE, 0);

        GtkWidget *text_col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 1);
        GtkWidget *name_lbl = gtk_label_new(name);
        gtk_widget_set_halign(name_lbl, GTK_ALIGN_START);
        PangoAttrList *ba = pango_attr_list_new();
        pango_attr_list_insert(ba, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
        gtk_label_set_attributes(GTK_LABEL(name_lbl), ba);
        pango_attr_list_unref(ba);
        gtk_box_pack_start(GTK_BOX(text_col), name_lbl, FALSE, FALSE, 0);

        char *mc_text = g_strdup_printf("%ld %s", (long)mc, T("chat.members"));
        GtkWidget *mc_lbl = gtk_label_new(mc_text);
        g_free(mc_text);
        gtk_widget_set_halign(mc_lbl, GTK_ALIGN_START);
        PangoAttrList *sa = pango_attr_list_new();
        pango_attr_list_insert(sa, pango_attr_scale_new(0.85));
        pango_attr_list_insert(sa, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
        gtk_label_set_attributes(GTK_LABEL(mc_lbl), sa);
        pango_attr_list_unref(sa);
        gtk_box_pack_start(GTK_BOX(text_col), mc_lbl, FALSE, FALSE, 0);

        gtk_box_pack_start(GTK_BOX(row_box), text_col, TRUE, TRUE, 0);

        GtkWidget *row = gtk_list_box_row_new();
        g_object_set_data_full(G_OBJECT(row), "channel-id", g_strdup(id), g_free);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->team_channels_list, row, -1);
    }
    gtk_widget_show_all(GTK_WIDGET(win->team_channels_list));
    json_node_unref(result);
}

static void on_team_detail_channel_clicked(GtkListBox *list, GtkListBoxRow *row, gpointer data)
{
    (void)list;
    if (!row) return;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *ch_id = g_object_get_data(G_OBJECT(row), "channel-id");
    if (!ch_id) return;

    g_free(win->current_channel_id);
    win->current_channel_id = g_strdup(ch_id);
    load_messages(win, ch_id);
    connect_channel_ws(win, ch_id);
    gtk_stack_set_visible_child_name(win->content_stack, "chat");
}

static void load_team_detail_members(AgoraMainWindow *win)
{
    if (!win->current_team_id) return;
    clear_list_box(win->team_members_list);

    char *path = g_strdup_printf("/api/teams/%s/members", win->current_team_id);
    GError *err = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &err);
    g_free(path);
    if (!result) { if (err) g_error_free(err); return; }

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);
    for (guint i = 0; i < len; i++) {
        JsonObject *m = json_array_get_object_element(arr, i);
        const char *role = json_object_get_string_member(m, "role");
        JsonObject *user = json_object_get_object_member(m, "user");
        const char *display_name = json_object_get_string_member(user, "display_name");
        const char *email = json_object_has_member(user, "email")
            ? json_object_get_string_member(user, "email") : "";
        const char *uid = json_object_get_string_member(user, "id");
        const char *user_status = json_object_has_member(user, "status")
            ? json_object_get_string_member(user, "status") : "offline";

        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
        gtk_widget_set_margin_start(row_box, 12);
        gtk_widget_set_margin_end(row_box, 12);
        gtk_widget_set_margin_top(row_box, 6);
        gtk_widget_set_margin_bottom(row_box, 6);

        /* Avatar */
        GtkWidget *avatar = create_avatar_widget(display_name, 32);
        gtk_box_pack_start(GTK_BOX(row_box), avatar, FALSE, FALSE, 0);

        /* Status dot on avatar */
        (void)user_status; /* status shown in text */

        /* Name + role/email */
        GtkWidget *info_col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 1);
        GtkWidget *name_lbl = gtk_label_new(display_name);
        gtk_widget_set_halign(name_lbl, GTK_ALIGN_START);
        PangoAttrList *ba = pango_attr_list_new();
        pango_attr_list_insert(ba, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
        gtk_label_set_attributes(GTK_LABEL(name_lbl), ba);
        pango_attr_list_unref(ba);
        gtk_box_pack_start(GTK_BOX(info_col), name_lbl, FALSE, FALSE, 0);

        char *sub_text = g_strdup_printf("%s \xC2\xB7 %s", role, email);
        GtkWidget *sub_lbl = gtk_label_new(sub_text);
        g_free(sub_text);
        gtk_widget_set_halign(sub_lbl, GTK_ALIGN_START);
        PangoAttrList *sa = pango_attr_list_new();
        pango_attr_list_insert(sa, pango_attr_scale_new(0.85));
        pango_attr_list_insert(sa, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
        gtk_label_set_attributes(GTK_LABEL(sub_lbl), sa);
        pango_attr_list_unref(sa);
        gtk_box_pack_start(GTK_BOX(info_col), sub_lbl, FALSE, FALSE, 0);

        gtk_box_pack_start(GTK_BOX(row_box), info_col, TRUE, TRUE, 0);

        /* Remove button (only for non-admin members) */
        if (g_strcmp0(role, "admin") != 0) {
            GtkWidget *rm_btn = gtk_button_new_with_label("\xE2\x9C\x95"); /* ✕ */
            gtk_widget_set_tooltip_text(rm_btn, T("teams.remove_member"));
            gtk_widget_set_valign(rm_btn, GTK_ALIGN_CENTER);
            g_object_set_data_full(G_OBJECT(rm_btn), "user-id", g_strdup(uid), g_free);
            g_object_set_data_full(G_OBJECT(rm_btn), "display-name", g_strdup(display_name), g_free);
            g_signal_connect(rm_btn, "clicked", G_CALLBACK(on_team_remove_member_clicked), win);
            gtk_box_pack_end(GTK_BOX(row_box), rm_btn, FALSE, FALSE, 0);
        }

        GtkWidget *row = gtk_list_box_row_new();
        g_object_set_data_full(G_OBJECT(row), "user-id", g_strdup(uid), g_free);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->team_members_list, row, -1);
    }
    gtk_widget_show_all(GTK_WIDGET(win->team_members_list));
    json_node_unref(result);
}

static void on_team_member_search_changed(GtkEntry *entry, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *query = gtk_entry_get_text(entry);

    clear_list_box(win->team_member_search_results);

    if (!query || strlen(query) < 2) {
        gtk_widget_hide(win->team_member_search_box);
        return;
    }

    char *path = g_strdup_printf("/api/users/?search=%s", query);
    GError *err = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &err);
    g_free(path);
    if (!result) { if (err) g_error_free(err); return; }

    /* Collect existing member IDs to filter them out */
    GHashTable *existing = g_hash_table_new(g_str_hash, g_str_equal);
    GList *rows = gtk_container_get_children(GTK_CONTAINER(win->team_members_list));
    for (GList *l = rows; l; l = l->next) {
        const char *uid = g_object_get_data(G_OBJECT(l->data), "user-id");
        if (uid) g_hash_table_add(existing, (gpointer)uid);
    }
    g_list_free(rows);

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);
    guint shown = 0;
    for (guint i = 0; i < len; i++) {
        JsonObject *u = json_array_get_object_element(arr, i);
        const char *uid = json_object_get_string_member(u, "id");
        if (g_hash_table_contains(existing, uid)) continue;

        const char *display_name = json_object_get_string_member(u, "display_name");
        const char *email = json_object_has_member(u, "email")
            ? json_object_get_string_member(u, "email") : "";

        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
        gtk_widget_set_margin_start(row_box, 12);
        gtk_widget_set_margin_end(row_box, 12);
        gtk_widget_set_margin_top(row_box, 4);
        gtk_widget_set_margin_bottom(row_box, 4);

        GtkWidget *avatar = create_avatar_widget(display_name, 28);
        gtk_box_pack_start(GTK_BOX(row_box), avatar, FALSE, FALSE, 0);

        GtkWidget *info_col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 1);
        GtkWidget *name_lbl = gtk_label_new(display_name);
        gtk_widget_set_halign(name_lbl, GTK_ALIGN_START);
        gtk_box_pack_start(GTK_BOX(info_col), name_lbl, FALSE, FALSE, 0);
        GtkWidget *email_lbl = gtk_label_new(email);
        gtk_widget_set_halign(email_lbl, GTK_ALIGN_START);
        PangoAttrList *sa = pango_attr_list_new();
        pango_attr_list_insert(sa, pango_attr_scale_new(0.85));
        pango_attr_list_insert(sa, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
        gtk_label_set_attributes(GTK_LABEL(email_lbl), sa);
        pango_attr_list_unref(sa);
        gtk_box_pack_start(GTK_BOX(info_col), email_lbl, FALSE, FALSE, 0);
        gtk_box_pack_start(GTK_BOX(row_box), info_col, TRUE, TRUE, 0);

        GtkWidget *add_btn = gtk_button_new_with_label(T("chat.add_member_btn"));
        gtk_widget_set_valign(add_btn, GTK_ALIGN_CENTER);
        g_object_set_data_full(G_OBJECT(add_btn), "user-id", g_strdup(uid), g_free);
        g_signal_connect(add_btn, "clicked", G_CALLBACK(on_team_add_member_clicked), win);
        gtk_box_pack_end(GTK_BOX(row_box), add_btn, FALSE, FALSE, 0);

        GtkWidget *row = gtk_list_box_row_new();
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->team_member_search_results, row, -1);
        shown++;
    }

    g_hash_table_destroy(existing);
    json_node_unref(result);

    if (shown > 0) {
        gtk_widget_show_all(win->team_member_search_box);
    } else {
        gtk_widget_hide(win->team_member_search_box);
    }
}

static void load_team_detail_files(AgoraMainWindow *win)
{
    if (!win->current_team_id) return;
    clear_list_box(win->team_files_list);

    char *path = g_strdup_printf("/api/files/team/%s", win->current_team_id);
    GError *err = NULL;
    JsonNode *result = agora_api_client_get(win->api, path, &err);
    g_free(path);
    if (!result) {
        if (err) g_error_free(err);
        /* Show "no files" message */
        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
        gtk_widget_set_margin_top(row_box, 32);
        gtk_widget_set_margin_bottom(row_box, 32);
        GtkWidget *lbl = gtk_label_new(T("teams.no_files"));
        PangoAttrList *sa = pango_attr_list_new();
        pango_attr_list_insert(sa, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
        gtk_label_set_attributes(GTK_LABEL(lbl), sa);
        pango_attr_list_unref(sa);
        gtk_box_pack_start(GTK_BOX(row_box), lbl, FALSE, FALSE, 0);
        GtkWidget *row = gtk_list_box_row_new();
        gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(row), FALSE);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->team_files_list, row, -1);
        gtk_widget_show_all(GTK_WIDGET(win->team_files_list));
        return;
    }

    JsonArray *arr = json_node_get_array(result);
    guint len = json_array_get_length(arr);

    if (len == 0) {
        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
        gtk_widget_set_margin_top(row_box, 32);
        gtk_widget_set_margin_bottom(row_box, 32);
        GtkWidget *lbl = gtk_label_new(T("teams.no_files"));
        PangoAttrList *sa = pango_attr_list_new();
        pango_attr_list_insert(sa, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
        gtk_label_set_attributes(GTK_LABEL(lbl), sa);
        pango_attr_list_unref(sa);
        gtk_box_pack_start(GTK_BOX(row_box), lbl, FALSE, FALSE, 0);
        GtkWidget *row = gtk_list_box_row_new();
        gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(row), FALSE);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->team_files_list, row, -1);
    }

    for (guint i = 0; i < len; i++) {
        JsonObject *f = json_array_get_object_element(arr, i);
        const char *filename = json_object_has_member(f, "original_filename")
            ? json_object_get_string_member(f, "original_filename") : "file";
        const char *created = json_object_has_member(f, "created_at")
            ? json_object_get_string_member(f, "created_at") : "";

        gint64 file_size = 0;
        if (json_object_has_member(f, "file") && !json_object_get_null_member(f, "file")) {
            JsonObject *fobj = json_object_get_object_member(f, "file");
            if (json_object_has_member(fobj, "file_size"))
                file_size = json_object_get_int_member(fobj, "file_size");
        }

        GtkWidget *row_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 10);
        gtk_widget_set_margin_start(row_box, 12);
        gtk_widget_set_margin_end(row_box, 12);
        gtk_widget_set_margin_top(row_box, 6);
        gtk_widget_set_margin_bottom(row_box, 6);

        GtkWidget *icon_lbl = gtk_label_new("\xF0\x9F\x93\x84"); /* 📄 */
        gtk_box_pack_start(GTK_BOX(row_box), icon_lbl, FALSE, FALSE, 0);

        GtkWidget *info_col = gtk_box_new(GTK_ORIENTATION_VERTICAL, 1);
        GtkWidget *fn_lbl = gtk_label_new(filename);
        gtk_widget_set_halign(fn_lbl, GTK_ALIGN_START);
        PangoAttrList *ba = pango_attr_list_new();
        pango_attr_list_insert(ba, pango_attr_weight_new(PANGO_WEIGHT_SEMIBOLD));
        gtk_label_set_attributes(GTK_LABEL(fn_lbl), ba);
        pango_attr_list_unref(ba);
        gtk_label_set_ellipsize(GTK_LABEL(fn_lbl), PANGO_ELLIPSIZE_MIDDLE);
        gtk_box_pack_start(GTK_BOX(info_col), fn_lbl, FALSE, FALSE, 0);

        char *size_str;
        if (file_size < 1024)
            size_str = g_strdup_printf("%ld B", (long)file_size);
        else if (file_size < 1048576)
            size_str = g_strdup_printf("%.1f KB", file_size / 1024.0);
        else
            size_str = g_strdup_printf("%.1f MB", file_size / 1048576.0);

        char *time_str = format_relative_time(created);
        char *meta = g_strdup_printf("%s \xC2\xB7 %s", size_str, time_str);
        g_free(size_str);
        g_free(time_str);
        GtkWidget *meta_lbl = gtk_label_new(meta);
        g_free(meta);
        gtk_widget_set_halign(meta_lbl, GTK_ALIGN_START);
        PangoAttrList *sa = pango_attr_list_new();
        pango_attr_list_insert(sa, pango_attr_scale_new(0.85));
        pango_attr_list_insert(sa, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
        gtk_label_set_attributes(GTK_LABEL(meta_lbl), sa);
        pango_attr_list_unref(sa);
        gtk_box_pack_start(GTK_BOX(info_col), meta_lbl, FALSE, FALSE, 0);

        gtk_box_pack_start(GTK_BOX(row_box), info_col, TRUE, TRUE, 0);

        GtkWidget *row = gtk_list_box_row_new();
        gtk_list_box_row_set_activatable(GTK_LIST_BOX_ROW(row), FALSE);
        gtk_container_add(GTK_CONTAINER(row), row_box);
        gtk_list_box_insert(win->team_files_list, row, -1);
    }

    gtk_widget_show_all(GTK_WIDGET(win->team_files_list));
    json_node_unref(result);
}

static void on_team_leave_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!win->current_team_id) return;

    char *msg = g_strdup_printf("%s \"%s\"?", T("teams.leave_confirm"),
                                win->current_team_name ? win->current_team_name : "");
    GtkWidget *dlg = gtk_message_dialog_new(GTK_WINDOW(win),
        GTK_DIALOG_MODAL, GTK_MESSAGE_QUESTION, GTK_BUTTONS_YES_NO, "%s", msg);
    g_free(msg);
    int resp = gtk_dialog_run(GTK_DIALOG(dlg));
    gtk_widget_destroy(dlg);
    if (resp != GTK_RESPONSE_YES) return;

    char *path = g_strdup_printf("/api/teams/%s/leave", win->current_team_id);
    GError *err = NULL;
    JsonNode *r = agora_api_client_post(win->api, path, "{}", &err);
    g_free(path);
    if (r) json_node_unref(r);
    if (err) g_error_free(err);

    /* Go back to the team list */
    gtk_stack_set_visible_child_name(win->content_stack, "empty");
    g_free(win->current_team_id);
    win->current_team_id = NULL;
    g_free(win->current_team_name);
    win->current_team_name = NULL;
    load_teams(win);
}

static void show_team_detail(AgoraMainWindow *win, const char *team_id, const char *team_name)
{
    g_free(win->current_team_id);
    win->current_team_id = g_strdup(team_id);
    g_free(win->current_team_name);
    win->current_team_name = g_strdup(team_name);

    /* Update header */
    char *title_markup = g_strdup_printf("<span size='x-large' weight='bold'>%s</span>", team_name);
    gtk_label_set_markup(win->team_detail_title, title_markup);
    g_free(title_markup);

    /* Load team detail info for subtitle */
    char *detail_path = g_strdup_printf("/api/teams/%s", team_id);
    GError *err = NULL;
    JsonNode *team_node = agora_api_client_get(win->api, detail_path, &err);
    g_free(detail_path);
    if (team_node) {
        JsonObject *tobj = json_node_get_object(team_node);
        gint64 mc = json_object_has_member(tobj, "member_count")
            ? json_object_get_int_member(tobj, "member_count") : 0;
        const char *desc = json_object_has_member(tobj, "description") &&
            !json_object_get_null_member(tobj, "description")
            ? json_object_get_string_member(tobj, "description") : "";
        char *sub;
        if (desc && *desc)
            sub = g_strdup_printf("%ld %s \xC2\xB7 %s", (long)mc, T("chat.members"), desc);
        else
            sub = g_strdup_printf("%ld %s", (long)mc, T("chat.members"));
        gtk_label_set_text(win->team_detail_subtitle, sub);
        g_free(sub);
        json_node_unref(team_node);
    } else {
        gtk_label_set_text(win->team_detail_subtitle, "");
        if (err) g_error_free(err);
    }

    /* Reset to first tab */
    gtk_notebook_set_current_page(win->team_detail_notebook, 0);

    /* Load all tabs */
    load_team_detail_channels(win);
    load_team_detail_members(win);
    load_team_detail_files(win);

    /* Clear search */
    gtk_entry_set_text(win->team_member_search_entry, "");
    gtk_widget_hide(win->team_member_search_box);

    gtk_stack_set_visible_child_name(win->content_stack, "team_detail");
}

static void on_new_team_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);

    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        T("teams.new_team"), GTK_WINDOW(win),
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        T("chat.create"), GTK_RESPONSE_OK,
        T("chat.cancel"), GTK_RESPONSE_CANCEL,
        NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 360, 200);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content), 16);
    gtk_box_set_spacing(GTK_BOX(content), 6);

    GtkWidget *name_label = gtk_label_new(T("teams.team_name"));
    gtk_widget_set_halign(name_label, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), name_label, FALSE, FALSE, 0);
    GtkWidget *name_entry = gtk_entry_new();
    gtk_box_pack_start(GTK_BOX(content), name_entry, FALSE, FALSE, 0);

    GtkWidget *desc_label = gtk_label_new(T("teams.description"));
    gtk_widget_set_halign(desc_label, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), desc_label, FALSE, FALSE, 0);
    GtkWidget *desc_entry = gtk_entry_new();
    gtk_box_pack_start(GTK_BOX(content), desc_entry, FALSE, FALSE, 0);

    gtk_widget_show_all(dialog);
    int response = gtk_dialog_run(GTK_DIALOG(dialog));

    if (response == GTK_RESPONSE_OK) {
        const char *name = gtk_entry_get_text(GTK_ENTRY(name_entry));
        const char *desc = gtk_entry_get_text(GTK_ENTRY(desc_entry));
        if (name && *name) {
            char *body;
            if (desc && *desc)
                body = g_strdup_printf("{\"name\":\"%s\",\"description\":\"%s\"}", name, desc);
            else
                body = g_strdup_printf("{\"name\":\"%s\"}", name);
            GError *err = NULL;
            JsonNode *res = agora_api_client_post(win->api, "/api/teams/", body, &err);
            g_free(body);
            if (res) json_node_unref(res);
            if (err) g_error_free(err);
            load_teams(win);
        }
    }
    gtk_widget_destroy(dialog);
}

static void on_new_team_channel_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    create_team_channel_dialog(win, win->current_team_id);
}


static void ws_send_json(AgoraMainWindow *win, const char *json_str)
{
    if (win->ws_conn &&
        soup_websocket_connection_get_state(win->ws_conn) == SOUP_WEBSOCKET_STATE_OPEN) {
        soup_websocket_connection_send_text(win->ws_conn, json_str);
    }
}

/* --- User search helper --- */

static void do_user_search(GtkEntry *entry, gpointer data)
{
    GtkListBox *results = GTK_LIST_BOX(data);
    AgoraApiClient *api = g_object_get_data(G_OBJECT(results), "api");
    const char *query = gtk_entry_get_text(entry);

    /* Clear old results */
    clear_list_box(results);

    if (!query || strlen(query) < 2) return;

    char *path = g_strdup_printf("/api/users/?search=%s", query);
    GError *err = NULL;
    JsonNode *res = agora_api_client_get(api, path, &err);
    g_free(path);
    if (!res) { if (err) g_error_free(err); return; }

    JsonArray *arr = json_node_get_array(res);
    guint len = json_array_get_length(arr);
    for (guint i = 0; i < len && i < 20; i++) {
        JsonObject *user = json_array_get_object_element(arr, i);
        const char *uid = json_object_get_string_member(user, "id");
        const char *display = json_object_has_member(user, "display_name")
            ? json_object_get_string_member(user, "display_name") : NULL;
        const char *uname = json_object_get_string_member(user, "username");

        char *label_text = g_strdup_printf("%s (@%s)", display ? display : uname, uname);
        GtkWidget *label = gtk_label_new(label_text);
        g_free(label_text);
        gtk_widget_set_halign(label, GTK_ALIGN_START);
        gtk_widget_set_margin_start(label, 8);
        gtk_widget_set_margin_top(label, 4);
        gtk_widget_set_margin_bottom(label, 4);

        GtkWidget *row = gtk_list_box_row_new();
        g_object_set_data_full(G_OBJECT(row), "user-id", g_strdup(uid), g_free);
        gtk_container_add(GTK_CONTAINER(row), label);
        gtk_list_box_insert(results, row, -1);
    }
    gtk_widget_show_all(GTK_WIDGET(results));
    json_node_unref(res);
}

/* --- Add member row-activated callback --- */

static void on_add_member_row_activated(GtkListBox *list, GtkListBoxRow *row,
                                        gpointer data)
{
    (void)list;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *user_id = g_object_get_data(G_OBJECT(row), "user-id");
    if (!user_id || !win->current_channel_id) return;
    char *path = g_strdup_printf("/api/channels/%s/members/%s",
                                 win->current_channel_id, user_id);
    GError *err = NULL;
    JsonNode *res = agora_api_client_post(win->api, path, "{}", &err);
    g_free(path);
    if (res) json_node_unref(res);
    if (err) g_error_free(err);
    gtk_widget_set_sensitive(GTK_WIDGET(row), FALSE);
}

/* --- Add member selection changed callback --- */

static void on_add_member_selection_changed(GtkListBox *list, GtkListBoxRow *row,
                                            gpointer data)
{
    (void)data;
    GtkWidget *add_btn = g_object_get_data(G_OBJECT(list), "add-btn");
    if (add_btn)
        gtk_widget_set_sensitive(add_btn, row != NULL);
}

/* --- Add member dialog --- */

static void on_add_member_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!win->current_channel_id) return;

    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        T("chat.add_member"), GTK_WINDOW(win),
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        T("chat.add_member_btn"), GTK_RESPONSE_ACCEPT,
        T("chat.cancel"), GTK_RESPONSE_CANCEL,
        NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 380, 300);

    /* Style the Add button and disable it initially */
    GtkWidget *add_btn = gtk_dialog_get_widget_for_response(GTK_DIALOG(dialog), GTK_RESPONSE_ACCEPT);
    gtk_widget_set_sensitive(add_btn, FALSE);
    GtkCssProvider *btn_css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(btn_css,
        "button { background: #6264A7; color: white; border: none; }", -1, NULL);
    gtk_style_context_add_provider(gtk_widget_get_style_context(add_btn),
        GTK_STYLE_PROVIDER(btn_css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(btn_css);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content), 16);

    GtkWidget *search_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(search_entry), T("chat.search_users"));
    gtk_box_pack_start(GTK_BOX(content), search_entry, FALSE, FALSE, 4);

    GtkWidget *results_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(results_scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    gtk_widget_set_size_request(results_scroll, -1, 200);
    GtkListBox *results_list = GTK_LIST_BOX(gtk_list_box_new());
    g_object_set_data(G_OBJECT(results_list), "api", win->api);
    gtk_container_add(GTK_CONTAINER(results_scroll), GTK_WIDGET(results_list));
    gtk_box_pack_start(GTK_BOX(content), results_scroll, TRUE, TRUE, 4);

    g_signal_connect(search_entry, "changed", G_CALLBACK(do_user_search), results_list);
    g_signal_connect(results_list, "row-activated",
                     G_CALLBACK(on_add_member_row_activated), win);

    /* Enable/disable Add button based on selection */
    g_object_set_data(G_OBJECT(results_list), "add-btn", add_btn);
    g_signal_connect(results_list, "row-selected",
        G_CALLBACK(on_add_member_selection_changed), NULL);

    gtk_widget_show_all(dialog);

    /* Run dialog in a loop to allow adding multiple members */
    gint response;
    while ((response = gtk_dialog_run(GTK_DIALOG(dialog))) == GTK_RESPONSE_ACCEPT) {
        GtkListBoxRow *sel = gtk_list_box_get_selected_row(results_list);
        if (sel) {
            on_add_member_row_activated(results_list, sel, win);
            gtk_widget_set_sensitive(add_btn, FALSE);
        }
    }
    gtk_widget_destroy(dialog);
    load_channels(win);
}

/* --- New Chat dialog --- */

static void on_new_chat_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);

    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        T("chat.new_channel"), GTK_WINDOW(win),
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        T("chat.create"), GTK_RESPONSE_OK,
        T("chat.cancel"), GTK_RESPONSE_CANCEL,
        NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 400, 350);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content), 16);

    /* Channel name */
    GtkWidget *name_label = gtk_label_new(T("chat.channel_name"));
    gtk_widget_set_halign(name_label, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), name_label, FALSE, FALSE, 4);
    GtkWidget *name_entry = gtk_entry_new();
    gtk_box_pack_start(GTK_BOX(content), name_entry, FALSE, FALSE, 4);

    /* Separator */
    gtk_box_pack_start(GTK_BOX(content), gtk_separator_new(GTK_ORIENTATION_HORIZONTAL), FALSE, FALSE, 8);

    /* User search for direct chat */
    GtkWidget *search_label = gtk_label_new(T("chat.search_users"));
    gtk_widget_set_halign(search_label, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(content), search_label, FALSE, FALSE, 4);
    GtkWidget *search_entry = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(search_entry), T("chat.search_users"));
    gtk_box_pack_start(GTK_BOX(content), search_entry, FALSE, FALSE, 4);

    /* Results list */
    GtkWidget *results_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(results_scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    gtk_widget_set_size_request(results_scroll, -1, 150);
    GtkListBox *results_list = GTK_LIST_BOX(gtk_list_box_new());
    g_object_set_data(G_OBJECT(results_list), "api", win->api);
    gtk_container_add(GTK_CONTAINER(results_scroll), GTK_WIDGET(results_list));
    gtk_box_pack_start(GTK_BOX(content), results_scroll, TRUE, TRUE, 4);

    g_signal_connect(search_entry, "changed", G_CALLBACK(do_user_search), results_list);

    gtk_widget_show_all(dialog);
    int response = gtk_dialog_run(GTK_DIALOG(dialog));

    if (response == GTK_RESPONSE_OK) {
        const char *channel_name = gtk_entry_get_text(GTK_ENTRY(name_entry));

        /* Check if a user was selected for direct chat */
        GtkListBoxRow *selected = gtk_list_box_get_selected_row(results_list);
        if (selected) {
            const char *user_id = g_object_get_data(G_OBJECT(selected), "user-id");
            if (user_id) {
                char *body = g_strdup_printf("{\"user_id\":\"%s\"}", user_id);
                GError *err = NULL;
                JsonNode *res = agora_api_client_post(win->api, "/api/channels/direct", body, &err);
                g_free(body);
                if (res) {
                    JsonObject *ch = json_node_get_object(res);
                    const char *ch_id = json_object_get_string_member(ch, "id");
                    const char *ch_name = json_object_get_string_member(ch, "name");
                    if (ch_id) {
                        g_free(win->current_channel_id);
                        win->current_channel_id = g_strdup(ch_id);
                        g_free(win->current_channel_name);
                        win->current_channel_name = g_strdup(ch_name ? ch_name : "");
                        gtk_label_set_text(win->chat_title, win->current_channel_name);
                        gtk_stack_set_visible_child_name(win->content_stack, "chat");
                        load_messages(win, ch_id);
                        connect_channel_ws(win, ch_id);
                    }
                    json_node_unref(res);
                }
                if (err) g_error_free(err);
                load_channels(win);
                gtk_widget_destroy(dialog);
                return;
            }
        }

        /* Create group channel */
        if (channel_name && channel_name[0]) {
            JsonBuilder *builder = json_builder_new();
            json_builder_begin_object(builder);
            json_builder_set_member_name(builder, "name");
            json_builder_add_string_value(builder, channel_name);
            json_builder_set_member_name(builder, "channel_type");
            json_builder_add_string_value(builder, "group");
            json_builder_end_object(builder);
            JsonGenerator *gen = json_generator_new();
            json_generator_set_root(gen, json_builder_get_root(builder));
            char *body = json_generator_to_data(gen, NULL);

            GError *err = NULL;
            JsonNode *res = agora_api_client_post(win->api, "/api/channels/", body, &err);
            g_free(body);
            g_object_unref(gen);
            g_object_unref(builder);
            if (res) {
                JsonObject *ch = json_node_get_object(res);
                const char *ch_id = json_object_get_string_member(ch, "id");
                const char *ch_name2 = json_object_get_string_member(ch, "name");
                if (ch_id) {
                    g_free(win->current_channel_id);
                    win->current_channel_id = g_strdup(ch_id);
                    g_free(win->current_channel_name);
                    win->current_channel_name = g_strdup(ch_name2 ? ch_name2 : "");
                    gtk_label_set_text(win->chat_title, win->current_channel_name);
                    gtk_stack_set_visible_child_name(win->content_stack, "chat");
                    load_messages(win, ch_id);
                    connect_channel_ws(win, ch_id);
                }
                json_node_unref(res);
            }
            if (err) g_error_free(err);
            load_channels(win);
        }
    }

    gtk_widget_destroy(dialog);
}

/* --- Settings Dialog --- */

static void on_settings_save_profile(GtkButton *btn, gpointer data)
{
    (void)data;
    GtkEntry *dn_entry = GTK_ENTRY(g_object_get_data(G_OBJECT(btn), "dn-entry"));
    GtkEntry *em_entry = GTK_ENTRY(g_object_get_data(G_OBJECT(btn), "em-entry"));
    GtkLabel *status_lbl = GTK_LABEL(g_object_get_data(G_OBJECT(btn), "status-lbl"));
    AgoraMainWindow *win = g_object_get_data(G_OBJECT(btn), "win");

    const char *dn = gtk_entry_get_text(dn_entry);
    const char *em = gtk_entry_get_text(em_entry);

    JsonBuilder *b = json_builder_new();
    json_builder_begin_object(b);
    json_builder_set_member_name(b, "display_name");
    json_builder_add_string_value(b, dn);
    json_builder_set_member_name(b, "email");
    json_builder_add_string_value(b, em);
    json_builder_end_object(b);

    JsonGenerator *gen = json_generator_new();
    json_generator_set_root(gen, json_builder_get_root(b));
    char *body = json_generator_to_data(gen, NULL);
    g_object_unref(gen);
    g_object_unref(b);

    GError *err = NULL;
    JsonNode *res = agora_api_client_patch(win->api, "/api/auth/me", body, &err);
    g_free(body);

    if (res) {
        gtk_label_set_text(status_lbl, T("settings.saved"));
        /* Update sidebar display name */
        gtk_label_set_text(win->user_label, dn);
        json_node_unref(res);
    } else {
        gtk_label_set_text(status_lbl, T("settings.error"));
        if (err) g_error_free(err);
    }
}

static void on_settings_change_password(GtkButton *btn, gpointer data)
{
    (void)data;
    GtkEntry *cur_pw = GTK_ENTRY(g_object_get_data(G_OBJECT(btn), "cur-pw"));
    GtkEntry *new_pw = GTK_ENTRY(g_object_get_data(G_OBJECT(btn), "new-pw"));
    GtkEntry *confirm_pw = GTK_ENTRY(g_object_get_data(G_OBJECT(btn), "confirm-pw"));
    GtkLabel *pw_status = GTK_LABEL(g_object_get_data(G_OBJECT(btn), "pw-status"));
    AgoraMainWindow *win = g_object_get_data(G_OBJECT(btn), "win");

    const char *cur = gtk_entry_get_text(cur_pw);
    const char *newp = gtk_entry_get_text(new_pw);
    const char *conf = gtk_entry_get_text(confirm_pw);

    if (g_strcmp0(newp, conf) != 0) {
        gtk_label_set_text(pw_status, T("settings.password_mismatch"));
        return;
    }

    JsonBuilder *b = json_builder_new();
    json_builder_begin_object(b);
    json_builder_set_member_name(b, "password");
    json_builder_add_string_value(b, newp);
    json_builder_set_member_name(b, "current_password");
    json_builder_add_string_value(b, cur);
    json_builder_end_object(b);

    JsonGenerator *gen = json_generator_new();
    json_generator_set_root(gen, json_builder_get_root(b));
    char *body = json_generator_to_data(gen, NULL);
    g_object_unref(gen);
    g_object_unref(b);

    GError *err = NULL;
    JsonNode *res = agora_api_client_patch(win->api, "/api/auth/me", body, &err);
    g_free(body);

    if (res) {
        gtk_label_set_text(pw_status, T("settings.password_changed"));
        gtk_entry_set_text(cur_pw, "");
        gtk_entry_set_text(new_pw, "");
        gtk_entry_set_text(confirm_pw, "");
        json_node_unref(res);
    } else {
        gtk_label_set_text(pw_status, T("settings.password_wrong"));
        if (err) g_error_free(err);
    }
}

static void on_settings_lang_selected(GtkFlowBox *flow, GtkFlowBoxChild *child, gpointer data)
{
    (void)flow;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    GtkWidget *lbl = gtk_bin_get_child(GTK_BIN(child));
    const char *code = g_object_get_data(G_OBJECT(lbl), "lang-code");
    if (!code) return;

    /* Update local translations */
    agora_translations_set_lang(code);

    /* Persist to backend */
    JsonBuilder *b = json_builder_new();
    json_builder_begin_object(b);
    json_builder_set_member_name(b, "language");
    json_builder_add_string_value(b, code);
    json_builder_end_object(b);

    JsonGenerator *gen = json_generator_new();
    json_generator_set_root(gen, json_builder_get_root(b));
    char *body = json_generator_to_data(gen, NULL);
    g_object_unref(gen);
    g_object_unref(b);

    GError *err = NULL;
    JsonNode *res = agora_api_client_patch(win->api, "/api/auth/me", body, &err);
    g_free(body);
    if (res) json_node_unref(res);
    if (err) g_error_free(err);
}

static void on_settings_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);

    GtkWidget *dialog = gtk_dialog_new_with_buttons(
        T("settings.title"),
        GTK_WINDOW(win),
        GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT,
        "_OK", GTK_RESPONSE_OK,
        NULL);
    gtk_window_set_default_size(GTK_WINDOW(dialog), 420, 540);

    GtkWidget *content = gtk_dialog_get_content_area(GTK_DIALOG(dialog));
    gtk_container_set_border_width(GTK_CONTAINER(content), 16);
    gtk_box_set_spacing(GTK_BOX(content), 8);

    /* Wrap content in scrolled window */
    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 8);
    gtk_container_set_border_width(GTK_CONTAINER(vbox), 4);
    gtk_container_add(GTK_CONTAINER(scroll), vbox);
    gtk_box_pack_start(GTK_BOX(content), scroll, TRUE, TRUE, 0);

    /* Fetch current user info */
    GError *err = NULL;
    JsonNode *me_node = agora_api_client_get(win->api, "/api/auth/me", &err);
    const char *cur_display = "";
    const char *cur_email = "";
    const char *cur_lang = agora_translations_get_lang();
    if (me_node) {
        JsonObject *me = json_node_get_object(me_node);
        if (json_object_has_member(me, "display_name"))
            cur_display = json_object_get_string_member(me, "display_name");
        if (json_object_has_member(me, "email"))
            cur_email = json_object_get_string_member(me, "email");
        if (json_object_has_member(me, "language"))
            cur_lang = json_object_get_string_member(me, "language");
    }
    if (err) { g_error_free(err); err = NULL; }

    /* --- Profile Section --- */
    GtkWidget *profile_label = gtk_label_new(NULL);
    char *pm = g_strdup_printf("<b>%s</b>", T("settings.profile"));
    gtk_label_set_markup(GTK_LABEL(profile_label), pm);
    g_free(pm);
    gtk_widget_set_halign(profile_label, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), profile_label, FALSE, FALSE, 0);

    /* Display Name */
    GtkWidget *dn_label = gtk_label_new(T("settings.display_name"));
    gtk_widget_set_halign(dn_label, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), dn_label, FALSE, FALSE, 0);
    GtkWidget *dn_entry = gtk_entry_new();
    gtk_entry_set_text(GTK_ENTRY(dn_entry), cur_display ? cur_display : "");
    gtk_box_pack_start(GTK_BOX(vbox), dn_entry, FALSE, FALSE, 0);

    /* Email */
    GtkWidget *em_label = gtk_label_new(T("settings.email"));
    gtk_widget_set_halign(em_label, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), em_label, FALSE, FALSE, 0);
    GtkWidget *em_entry = gtk_entry_new();
    gtk_entry_set_text(GTK_ENTRY(em_entry), cur_email ? cur_email : "");
    gtk_box_pack_start(GTK_BOX(vbox), em_entry, FALSE, FALSE, 0);

    /* Save Profile Button + status label */
    GtkWidget *save_btn = gtk_button_new_with_label(T("settings.save"));
    gtk_widget_set_halign(save_btn, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), save_btn, FALSE, FALSE, 0);

    GtkWidget *status_lbl = gtk_label_new("");
    gtk_widget_set_halign(status_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), status_lbl, FALSE, FALSE, 0);

    g_object_set_data(G_OBJECT(save_btn), "dn-entry", dn_entry);
    g_object_set_data(G_OBJECT(save_btn), "em-entry", em_entry);
    g_object_set_data(G_OBJECT(save_btn), "status-lbl", status_lbl);
    g_object_set_data(G_OBJECT(save_btn), "win", win);
    g_signal_connect(save_btn, "clicked", G_CALLBACK(on_settings_save_profile), NULL);

    /* --- Separator --- */
    gtk_box_pack_start(GTK_BOX(vbox), gtk_separator_new(GTK_ORIENTATION_HORIZONTAL), FALSE, FALSE, 4);

    /* --- Password Section --- */
    GtkWidget *pw_header = gtk_label_new(NULL);
    char *pwm = g_strdup_printf("<b>%s</b>", T("settings.password"));
    gtk_label_set_markup(GTK_LABEL(pw_header), pwm);
    g_free(pwm);
    gtk_widget_set_halign(pw_header, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), pw_header, FALSE, FALSE, 0);

    GtkWidget *cur_pw = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(cur_pw), T("settings.current_password"));
    gtk_entry_set_visibility(GTK_ENTRY(cur_pw), FALSE);
    gtk_box_pack_start(GTK_BOX(vbox), cur_pw, FALSE, FALSE, 0);

    GtkWidget *new_pw = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(new_pw), T("settings.new_password"));
    gtk_entry_set_visibility(GTK_ENTRY(new_pw), FALSE);
    gtk_box_pack_start(GTK_BOX(vbox), new_pw, FALSE, FALSE, 0);

    GtkWidget *confirm_pw = gtk_entry_new();
    gtk_entry_set_placeholder_text(GTK_ENTRY(confirm_pw), T("settings.confirm_password"));
    gtk_entry_set_visibility(GTK_ENTRY(confirm_pw), FALSE);
    gtk_box_pack_start(GTK_BOX(vbox), confirm_pw, FALSE, FALSE, 0);

    GtkWidget *pw_btn = gtk_button_new_with_label(T("settings.change_password"));
    gtk_widget_set_halign(pw_btn, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), pw_btn, FALSE, FALSE, 0);

    GtkWidget *pw_status = gtk_label_new("");
    gtk_widget_set_halign(pw_status, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), pw_status, FALSE, FALSE, 0);

    g_object_set_data(G_OBJECT(pw_btn), "cur-pw", cur_pw);
    g_object_set_data(G_OBJECT(pw_btn), "new-pw", new_pw);
    g_object_set_data(G_OBJECT(pw_btn), "confirm-pw", confirm_pw);
    g_object_set_data(G_OBJECT(pw_btn), "pw-status", pw_status);
    g_object_set_data(G_OBJECT(pw_btn), "win", win);
    g_signal_connect(pw_btn, "clicked", G_CALLBACK(on_settings_change_password), NULL);

    /* --- Separator --- */
    gtk_box_pack_start(GTK_BOX(vbox), gtk_separator_new(GTK_ORIENTATION_HORIZONTAL), FALSE, FALSE, 4);

    /* --- Language Section --- */
    GtkWidget *lang_header = gtk_label_new(NULL);
    char *lm = g_strdup_printf("<b>%s</b>", T("settings.language"));
    gtk_label_set_markup(GTK_LABEL(lang_header), lm);
    g_free(lm);
    gtk_widget_set_halign(lang_header, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), lang_header, FALSE, FALSE, 0);

    static const char *lang_codes[] = {
        "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
        "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt",
        "ro", "sk", "sl", "sv", NULL
    };
    static const char *lang_names[] = {
        "\xd0\x91\xd1\x8a\xd0\xbb\xd0\xb3\xd0\xb0\xd1\x80\xd1\x81\xd0\xba\xd0\xb8",
        "\xc4\x8c""e\xc5\xa1tina",
        "Dansk", "Deutsch",
        "\xce\x95\xce\xbb\xce\xbb\xce\xb7\xce\xbd\xce\xb9\xce\xba\xce\xac",
        "English", "Espa\xc3\xb1ol", "Eesti", "Suomi", "Fran\xc3\xa7""ais",
        "Gaeilge", "Hrvatski", "Magyar", "Italiano",
        "Lietuvi\xc5\xb3", "Latvie\xc5\xa1u", "Malti",
        "Nederlands", "Polski", "Portugu\xc3\xaas",
        "Rom\xc3\xa2n\xc4\x83", "Sloven\xc4\x8dina", "Sloven\xc5\xa1\xc4\x8dina", "Svenska",
        NULL
    };

    GtkWidget *lang_flow = gtk_flow_box_new();
    gtk_flow_box_set_max_children_per_line(GTK_FLOW_BOX(lang_flow), 6);
    gtk_flow_box_set_selection_mode(GTK_FLOW_BOX(lang_flow), GTK_SELECTION_SINGLE);
    gtk_container_set_border_width(GTK_CONTAINER(lang_flow), 4);

    for (int i = 0; lang_codes[i]; i++) {
        GtkWidget *lbl = gtk_label_new(lang_names[i]);
        gtk_widget_set_margin_start(lbl, 6);
        gtk_widget_set_margin_end(lbl, 6);
        gtk_widget_set_margin_top(lbl, 4);
        gtk_widget_set_margin_bottom(lbl, 4);
        g_object_set_data(G_OBJECT(lbl), "lang-code", (gpointer)lang_codes[i]);
        gtk_container_add(GTK_CONTAINER(lang_flow), lbl);
    }
    gtk_box_pack_start(GTK_BOX(vbox), lang_flow, FALSE, FALSE, 0);

    /* Pre-select current language */
    int idx = 0;
    for (int i = 0; lang_codes[i]; i++) {
        if (g_strcmp0(lang_codes[i], cur_lang) == 0) { idx = i; break; }
    }
    GtkFlowBoxChild *sel_child = gtk_flow_box_get_child_at_index(GTK_FLOW_BOX(lang_flow), idx);
    if (sel_child) gtk_flow_box_select_child(GTK_FLOW_BOX(lang_flow), sel_child);

    g_signal_connect(lang_flow, "child-activated", G_CALLBACK(on_settings_lang_selected), win);

    if (me_node) json_node_unref(me_node);

    gtk_widget_show_all(dialog);
    gtk_dialog_run(GTK_DIALOG(dialog));
    gtk_widget_destroy(dialog);
}

/* --- Emoji Picker --- */

static void on_emoji_picked(GtkFlowBoxChild *child, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    GtkWidget *label = gtk_bin_get_child(GTK_BIN(child));
    const char *emoji = gtk_label_get_text(GTK_LABEL(label));
    if (!emoji) return;

    /* Insert emoji at cursor position in message entry */
    gint pos = gtk_editable_get_position(GTK_EDITABLE(win->message_entry));
    gtk_editable_insert_text(GTK_EDITABLE(win->message_entry), emoji, -1, &pos);
    gtk_editable_set_position(GTK_EDITABLE(win->message_entry), pos);
}

static void on_emoji_btn_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);

    static const char *emojis[] = {
        "\xF0\x9F\x91\x8D", "\xF0\x9F\x91\x8E",   /* 👍 👎 */
        "\xE2\x9D\xA4\xEF\xB8\x8F",                 /* ❤️ */
        "\xF0\x9F\x98\x82", "\xF0\x9F\x98\x8A",     /* 😂 😊 */
        "\xF0\x9F\x98\xAE", "\xF0\x9F\xA4\x94",     /* 😮 🤔 */
        "\xF0\x9F\x8E\x89", "\xF0\x9F\x91\x8F",     /* 🎉 👏 */
        "\xF0\x9F\x94\xA5", "\xE2\x9C\x85",         /* 🔥 ✅ */
        "\xE2\x9D\x8C", "\xF0\x9F\x92\xAF",         /* ❌ 💯 */
        "\xF0\x9F\x91\x80", "\xF0\x9F\x99\x8F",     /* 👀 🙏 */
        "\xF0\x9F\x9A\x80", "\xE2\xAD\x90",         /* 🚀 ⭐ */
        "\xF0\x9F\x98\x8D", "\xF0\x9F\x98\xA2",     /* 😍 😢 */
        "\xF0\x9F\x98\xA1", "\xF0\x9F\xA5\xB3",     /* 😡 🥳 */
        "\xF0\x9F\x92\xAA", "\xF0\x9F\x92\x9C",     /* 💪 💜 */
        "\xF0\x9F\x91\x8B", "\xF0\x9F\xA4\x9D",     /* 👋 🤝 */
        NULL
    };

    GtkWidget *popover = gtk_popover_new(GTK_WIDGET(btn));
    gtk_popover_set_position(GTK_POPOVER(popover), GTK_POS_TOP);

    GtkWidget *flow = gtk_flow_box_new();
    gtk_flow_box_set_max_children_per_line(GTK_FLOW_BOX(flow), 6);
    gtk_flow_box_set_selection_mode(GTK_FLOW_BOX(flow), GTK_SELECTION_NONE);
    gtk_container_set_border_width(GTK_CONTAINER(flow), 8);

    for (int i = 0; emojis[i]; i++) {
        GtkWidget *label = gtk_label_new(emojis[i]);
        PangoAttrList *attrs = pango_attr_list_new();
        pango_attr_list_insert(attrs, pango_attr_size_new(18 * PANGO_SCALE));
        gtk_label_set_attributes(GTK_LABEL(label), attrs);
        pango_attr_list_unref(attrs);
        gtk_widget_set_margin_start(label, 4);
        gtk_widget_set_margin_end(label, 4);
        gtk_widget_set_margin_top(label, 2);
        gtk_widget_set_margin_bottom(label, 2);
        gtk_container_add(GTK_CONTAINER(flow), label);
    }

    g_signal_connect(flow, "child-activated", G_CALLBACK(on_emoji_picked), win);
    gtk_container_add(GTK_CONTAINER(popover), flow);
    gtk_widget_show_all(popover);
    gtk_popover_popup(GTK_POPOVER(popover));
}

static void send_message(AgoraMainWindow *win)
{
    const char *text = gtk_entry_get_text(win->message_entry);
    if (!text || !text[0] || !win->current_channel_id) return;

    /* --- Edit mode: PATCH existing message --- */
    if (win->editing_message_id) {
        JsonBuilder *builder = json_builder_new();
        json_builder_begin_object(builder);
        json_builder_set_member_name(builder, "content");
        json_builder_add_string_value(builder, text);
        json_builder_end_object(builder);

        JsonGenerator *gen = json_generator_new();
        json_generator_set_root(gen, json_builder_get_root(builder));
        char *body = json_generator_to_data(gen, NULL);

        char *path = g_strdup_printf("/api/channels/%s/messages/%s",
                                     win->current_channel_id, win->editing_message_id);
        GError *err = NULL;
        JsonNode *res = agora_api_client_patch(win->api, path, body, &err);
        g_free(path);
        g_free(body);
        g_object_unref(gen);
        g_object_unref(builder);
        if (res) json_node_unref(res);
        if (err) g_error_free(err);

        clear_edit_state(win);
        gtk_entry_set_text(win->message_entry, "");
        load_messages(win, win->current_channel_id);
        return;
    }

    /* --- Normal / Reply mode --- */
    /* Try sending via WebSocket first */
    if (win->ws_conn &&
        soup_websocket_connection_get_state(win->ws_conn) == SOUP_WEBSOCKET_STATE_OPEN) {
        JsonBuilder *builder = json_builder_new();
        json_builder_begin_object(builder);
        json_builder_set_member_name(builder, "type");
        json_builder_add_string_value(builder, "message");
        json_builder_set_member_name(builder, "content");
        json_builder_add_string_value(builder, text);
        json_builder_set_member_name(builder, "message_type");
        json_builder_add_string_value(builder, "text");
        if (win->reply_to_id) {
            json_builder_set_member_name(builder, "reply_to_id");
            json_builder_add_string_value(builder, win->reply_to_id);
        }
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
        JsonBuilder *builder = json_builder_new();
        json_builder_begin_object(builder);
        json_builder_set_member_name(builder, "content");
        json_builder_add_string_value(builder, text);
        json_builder_set_member_name(builder, "message_type");
        json_builder_add_string_value(builder, "text");
        if (win->reply_to_id) {
            json_builder_set_member_name(builder, "reply_to_id");
            json_builder_add_string_value(builder, win->reply_to_id);
        }
        json_builder_end_object(builder);

        JsonGenerator *gen = json_generator_new();
        json_generator_set_root(gen, json_builder_get_root(builder));
        char *body = json_generator_to_data(gen, NULL);

        GError *error = NULL;
        JsonNode *result = agora_api_client_post(win->api, path, body, &error);
        g_free(path);
        g_free(body);
        g_object_unref(gen);
        g_object_unref(builder);

        if (result) {
            load_messages(win, win->current_channel_id);
            json_node_unref(result);
        } else if (error) {
            g_error_free(error);
        }
    }

    clear_reply_state(win);
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
        char *video_url = g_strdup_printf("%s/video/%s", base, win->reminder_channel_id);

        if (win->video_webview) {
            /* Inject token + CSS as UserScript, then navigate directly */
            inject_video_user_scripts(win);
            g_print("[Video] Reminder join: navigating to %s\n", video_url);
            webkit_web_view_load_uri(win->video_webview, video_url);
            /* Hide the content_stack so its native X11 windows are unmapped */
            gtk_widget_hide(GTK_WIDGET(win->content_stack));
            /* Show video overlay */
            gtk_widget_set_no_show_all(win->video_overlay, FALSE);
            gtk_widget_show_all(win->video_overlay);
            gtk_widget_set_no_show_all(win->video_overlay, TRUE);
            g_print("[Video] Overlay shown (reminder). overlay visible=%d, content_stack visible=%d\n",
                    gtk_widget_get_visible(win->video_overlay),
                    gtk_widget_get_visible(GTK_WIDGET(win->content_stack)));
        } else {
            char *url_with_token = g_strdup_printf("%s?token=%s", video_url, session->token);
            GError *err = NULL;
            g_app_info_launch_default_for_uri(url_with_token, NULL, &err);
            if (err) g_error_free(err);
            g_free(url_with_token);
        }
        g_free(base);
        g_free(video_url);
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
    load_teams(win);
    gtk_stack_set_visible_child_name(win->sidebar_stack, "teams");
    set_active_nav(win, win->nav_teams_btn);
}

static void on_feed_show_all_toggled(GtkToggleButton *btn, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!gtk_toggle_button_get_active(btn)) return; /* ignore deactivation */
    win->feed_unread_only = FALSE;
    g_signal_handlers_block_by_func(win->feed_unread_btn, on_feed_show_unread_toggled, win);
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(win->feed_unread_btn), FALSE);
    g_signal_handlers_unblock_by_func(win->feed_unread_btn, on_feed_show_unread_toggled, win);
    load_feed(win);
}

static void on_feed_show_unread_toggled(GtkToggleButton *btn, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!gtk_toggle_button_get_active(btn)) return;
    win->feed_unread_only = TRUE;
    g_signal_handlers_block_by_func(win->feed_all_btn, on_feed_show_all_toggled, win);
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(win->feed_all_btn), FALSE);
    g_signal_handlers_unblock_by_func(win->feed_all_btn, on_feed_show_all_toggled, win);
    load_feed(win);
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
    load_calendar_events(win);
    gtk_stack_set_visible_child_name(win->content_stack, "calendar");
    set_active_nav(win, win->nav_calendar_btn);
}

/* Grant camera/microphone permission requests in the video WebView */
static gboolean on_video_permission_request(WebKitWebView *webview,
                                             WebKitPermissionRequest *request,
                                             gpointer user_data)
{
    (void)webview; (void)user_data;
    webkit_permission_request_allow(request);
    return TRUE;
}

static void close_video_overlay(AgoraMainWindow *win)
{
    if (!gtk_widget_get_visible(win->video_overlay))
        return;
    g_print("[Video] Closing overlay. overlay visible=%d, mapped=%d\n",
            gtk_widget_get_visible(win->video_overlay),
            gtk_widget_get_mapped(win->video_overlay));
    if (win->video_webview)
        webkit_web_view_load_uri(win->video_webview, "about:blank");
    gtk_widget_hide(win->video_overlay);
    /* Restore the content_stack */
    gtk_widget_show_all(GTK_WIDGET(win->content_stack));
    g_print("[Video] After close: overlay visible=%d, content_stack visible=%d, page=%s\n",
            gtk_widget_get_visible(win->video_overlay),
            gtk_widget_get_visible(GTK_WIDGET(win->content_stack)),
            gtk_stack_get_visible_child_name(win->content_stack));
}

static void on_video_leave_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    close_video_overlay(AGORA_MAIN_WINDOW(data));
}

/* Called when Angular sends window.webkit.messageHandlers.leaveCall.postMessage() */
static void on_script_leave_call(WebKitUserContentManager *manager,
                                 WebKitJavascriptResult *result,
                                 gpointer data)
{
    (void)manager; (void)result;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    g_print("[Video] Received leaveCall message from WebView\n");
    close_video_overlay(win);
}

static void inject_video_user_scripts(AgoraMainWindow *win)
{
    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *session = agora_app_get_session(app);

    /* Build JS that sets token + hides web app UI via CSS + polling + MutationObserver */
    char *js = g_strdup_printf(
        "(function(){"
        "localStorage.setItem('access_token','%s');"
        "localStorage.setItem('current_user',JSON.stringify({id:'%s',display_name:'%s'}));"
        "var css='nav.sidebar{display:none !important}"
            ".chat-sidebar{display:none !important}"
            ".top-bar{display:none !important}"
            ".main-body>.content{flex:1 !important;width:100%% !important}';"
        "function hide(){"
            "if(!document.getElementById('_ah')){"
                "var s=document.createElement('style');s.id='_ah';s.textContent=css;"
                "var t=document.head||document.documentElement;"
                "if(t)t.appendChild(s);}"
            "var sels=['nav.sidebar','.chat-sidebar','.top-bar'];"
            "for(var i=0;i<sels.length;i++){"
                "var el=document.querySelector(sels[i]);"
                "if(el)el.style.setProperty('display','none','important');}}"
        "try{hide();}catch(e){}"
        "document.addEventListener('DOMContentLoaded',function(){"
            "hide();"
            "new MutationObserver(function(){hide();})"
                ".observe(document.body||document.documentElement,"
                "{childList:true,subtree:true});});"
        "var n=0,iv=setInterval(function(){hide();n++;if(n>300)clearInterval(iv);},100);"
        /* Detect SPA navigation away from /video/ by patching pushState/replaceState */
        "var _ps=history.pushState,_rs=history.replaceState;"
        "function _chk(url){"
            "var s=(url&&url.toString())||location.href;"
            "if(s.indexOf('/video/')===-1){"
                "try{window.webkit.messageHandlers.leaveCall.postMessage('leave');}catch(e){}}"
        "}"
        "history.pushState=function(){_ps.apply(this,arguments);_chk(arguments[2]);};"
        "history.replaceState=function(){_rs.apply(this,arguments);_chk(arguments[2]);};"
        "window.addEventListener('popstate',function(){_chk();});"
        "})();",
        session->token,
        session->user_id ? session->user_id : "",
        session->display_name ? session->display_name : ""
    );

    WebKitUserContentManager *ucm = webkit_web_view_get_user_content_manager(win->video_webview);
    webkit_user_content_manager_remove_all_scripts(ucm);

    WebKitUserScript *script = webkit_user_script_new(
        js,
        WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
        WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
        NULL, NULL
    );
    webkit_user_content_manager_add_script(ucm, script);
    webkit_user_script_unref(script);
    g_free(js);

    g_print("[Video] Injected UserScript with auth token and CSS\n");
}

static void on_calendar_join_clicked(GtkButton *btn, gpointer data)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    const char *channel_id = g_object_get_data(G_OBJECT(btn), "channel-id");
    if (!channel_id) return;

    /* Set current channel so the video call code works */
    g_free(win->current_channel_id);
    win->current_channel_id = g_strdup(channel_id);

    /* Trigger the regular video call flow */
    on_video_call_clicked(btn, data);
}

static void on_video_call_clicked(GtkButton *btn, gpointer data)
{
    (void)btn;
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(data);
    if (!win->current_channel_id) {
        g_printerr("[Video] No channel selected\n");
        return;
    }

    g_print("[Video] Starting video call for channel %s\n", win->current_channel_id);

    /* Create video room via API */
    char *room_path = g_strdup_printf("/api/video/rooms?channel_id=%s",
                                       win->current_channel_id);
    GError *error = NULL;
    JsonNode *room_result = agora_api_client_post(win->api, room_path, NULL, &error);
    g_free(room_path);
    if (room_result) json_node_unref(room_result);
    if (error) {
        g_printerr("[Video] Create room error (may already exist): %s\n", error->message);
        g_error_free(error);
        error = NULL;
    }

    /* Join video room via API */
    char *join_path = g_strdup_printf("/api/video/rooms/%s/join",
                                       win->current_channel_id);
    JsonNode *join_result = agora_api_client_post(win->api, join_path, NULL, &error);
    g_free(join_path);
    if (join_result) json_node_unref(join_result);
    if (error) {
        g_printerr("[Video] Join room error: %s\n", error->message);
        g_error_free(error);
        error = NULL;
    }

    /* Build video URL */
    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));
    AgoraSession *session = agora_app_get_session(app);
    char *base = g_strdup(session->base_url);
    char *api_pos = g_strrstr(base, "/api");
    if (api_pos) *api_pos = '\0';
    char *video_url = g_strdup_printf("%s/video/%s", base, win->current_channel_id);

    if (win->video_webview) {
        /* Inject token + CSS as UserScript that runs before Angular boots */
        inject_video_user_scripts(win);
        g_print("[Video] Navigating to %s\n", video_url);
        webkit_web_view_load_uri(win->video_webview, video_url);
        /* Hide the content_stack so its native X11 windows are unmapped */
        gtk_widget_hide(GTK_WIDGET(win->content_stack));
        /* Show video overlay */
        gtk_widget_set_no_show_all(win->video_overlay, FALSE);
        gtk_widget_show_all(win->video_overlay);
        gtk_widget_set_no_show_all(win->video_overlay, TRUE);
        g_print("[Video] Overlay shown (call). overlay visible=%d mapped=%d, content_stack visible=%d\n",
                gtk_widget_get_visible(win->video_overlay),
                gtk_widget_get_mapped(win->video_overlay),
                gtk_widget_get_visible(GTK_WIDGET(win->content_stack)));
    } else {
        /* Fallback to browser with token in URL */
        char *url_with_token = g_strdup_printf("%s?token=%s", video_url, session->token);
        g_print("[Video] Opening in browser: %s\n", url_with_token);
        GError *launch_err = NULL;
        g_app_info_launch_default_for_uri(url_with_token, NULL, &launch_err);
        if (launch_err) {
            g_printerr("[Video] Launch error: %s\n", launch_err->message);
            g_error_free(launch_err);
        }
        g_free(url_with_token);
    }
    g_free(base);
    g_free(video_url);
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
    GBytes *file_bytes = g_bytes_new_take(contents, length);
    soup_multipart_append_form_file(multipart, "file", basename_str, content_type, file_bytes);
    g_bytes_unref(file_bytes);

    char *url = g_strdup_printf("%s/api/channels/%s/upload",
                                 win->api->base_url, win->current_channel_id);
    SoupMessage *msg = soup_message_new("POST", url);
    g_free(url);

    /* Convert multipart to request body */
    SoupMessageHeaders *req_hdrs = soup_message_get_request_headers(msg);
    GBytes *body_bytes = NULL;
    soup_multipart_to_message(multipart, req_hdrs, &body_bytes);
    soup_multipart_free(multipart);

    if (body_bytes) {
        const char *ct = soup_message_headers_get_content_type(req_hdrs, NULL);
        soup_message_set_request_body_from_bytes(msg, ct, body_bytes);
        g_bytes_unref(body_bytes);
    }

    if (win->api->token) {
        char *auth = g_strdup_printf("Bearer %s", win->api->token);
        soup_message_headers_replace(req_hdrs, "Authorization", auth);
        g_free(auth);
    }

    g_signal_connect(msg, "accept-certificate", G_CALLBACK(accept_cert_cb), NULL);
    SoupSession *session = soup_session_new();
    GInputStream *upload_stream = soup_session_send(session, msg, NULL, NULL);
    if (upload_stream) g_object_unref(upload_stream);

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
    disconnect_notification_ws(win);
    if (win->ws_session) g_object_unref(win->ws_session);
    if (win->notif_ws_session) g_object_unref(win->notif_ws_session);
    agora_api_client_free(win->api);
    g_free(win->current_channel_id);
    g_free(win->current_channel_name);
    g_free(win->current_team_id);
    g_free(win->current_team_name);
    if (win->reminder_poll_timer) g_source_remove(win->reminder_poll_timer);
    if (win->reminder_tick_timer) g_source_remove(win->reminder_tick_timer);
    g_free(win->reminder_event_id);
    g_free(win->reminder_channel_id);
    if (win->reminder_start_time) g_date_time_unref(win->reminder_start_time);
    if (win->dismissed_reminders) g_hash_table_destroy(win->dismissed_reminders);
    if (win->calendar_events_cache) json_array_unref(win->calendar_events_cache);
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

    /* User avatar circle at bottom of nav – opens Settings */
    GtkWidget *avatar_btn = gtk_button_new_with_label("A");
    gtk_style_context_add_class(gtk_widget_get_style_context(avatar_btn), "user-avatar");
    gtk_widget_set_halign(avatar_btn, GTK_ALIGN_CENTER);
    gtk_widget_set_margin_bottom(avatar_btn, 12);
    gtk_widget_set_tooltip_text(avatar_btn, T("settings.title"));
    g_signal_connect(avatar_btn, "clicked", G_CALLBACK(on_settings_clicked), win);
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

    /* Header row: label + new chat button */
    GtkWidget *chats_header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_box_pack_start(GTK_BOX(chats_header), chats_label, TRUE, TRUE, 0);
    GtkWidget *new_chat_btn = gtk_button_new_with_label("+");
    gtk_widget_set_tooltip_text(new_chat_btn, T("chat.new_channel"));
    gtk_style_context_add_class(gtk_widget_get_style_context(new_chat_btn), "input-btn");
    gtk_widget_set_margin_end(new_chat_btn, 8);
    g_signal_connect(new_chat_btn, "clicked", G_CALLBACK(on_new_chat_clicked), win);
    gtk_box_pack_end(GTK_BOX(chats_header), new_chat_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(chats_page), chats_header, FALSE, FALSE, 0);

    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->channel_list = GTK_LIST_BOX(gtk_list_box_new());
    g_signal_connect(win->channel_list, "row-selected",
                     G_CALLBACK(on_channel_selected), win);
    gtk_container_add(GTK_CONTAINER(scroll), GTK_WIDGET(win->channel_list));
    gtk_box_pack_start(GTK_BOX(chats_page), scroll, TRUE, TRUE, 0);

    gtk_stack_add_named(win->sidebar_stack, chats_page, "chats");

    /* --- Teams page (tree structure) --- */
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

    GtkWidget *teams_header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_box_pack_start(GTK_BOX(teams_header), teams_label, TRUE, TRUE, 0);
    GtkWidget *new_team_btn = gtk_button_new_with_label("+");
    gtk_widget_set_tooltip_text(new_team_btn, T("teams.new_team"));
    gtk_style_context_add_class(gtk_widget_get_style_context(new_team_btn), "input-btn");
    gtk_widget_set_margin_end(new_team_btn, 8);
    g_signal_connect(new_team_btn, "clicked", G_CALLBACK(on_new_team_clicked), win);
    gtk_box_pack_end(GTK_BOX(teams_header), new_team_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(teams_page), teams_header, FALSE, FALSE, 0);

    /* Scrollable tree of teams with expanders */
    GtkWidget *team_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(team_scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->team_tree_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(team_scroll), win->team_tree_box);
    gtk_box_pack_start(GTK_BOX(teams_page), team_scroll, TRUE, TRUE, 0);

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

    /* Feed filter: "Show All" and "Show Unread" buttons */
    GtkWidget *feed_filter_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_style_context_add_class(gtk_widget_get_style_context(feed_filter_box), "linked");
    gtk_widget_set_valign(feed_filter_box, GTK_ALIGN_CENTER);
    gtk_widget_set_margin_end(feed_filter_box, 12);

    win->feed_all_btn = gtk_toggle_button_new_with_label(T("feed.show_all"));
    gtk_style_context_add_class(gtk_widget_get_style_context(win->feed_all_btn), "feed-filter-btn");
    g_signal_connect(win->feed_all_btn, "toggled",
                     G_CALLBACK(on_feed_show_all_toggled), win);
    gtk_box_pack_start(GTK_BOX(feed_filter_box), win->feed_all_btn, FALSE, FALSE, 0);

    win->feed_unread_btn = gtk_toggle_button_new_with_label(T("feed.unread_only"));
    gtk_style_context_add_class(gtk_widget_get_style_context(win->feed_unread_btn), "feed-filter-btn");
    gtk_toggle_button_set_active(GTK_TOGGLE_BUTTON(win->feed_unread_btn), TRUE);
    win->feed_unread_only = TRUE;
    g_signal_connect(win->feed_unread_btn, "toggled",
                     G_CALLBACK(on_feed_show_unread_toggled), win);
    gtk_box_pack_start(GTK_BOX(feed_filter_box), win->feed_unread_btn, FALSE, FALSE, 0);

    gtk_box_pack_end(GTK_BOX(feed_header), feed_filter_box, FALSE, FALSE, 0);

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

    /* --- Calendar view (Teams-style with week grid + side panel) --- */
    GtkWidget *calendar_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* Calendar header with week navigation */
    GtkWidget *cal_header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_container_set_border_width(GTK_CONTAINER(cal_header), 0);
    gtk_style_context_add_class(gtk_widget_get_style_context(cal_header), "chat-header");

    GtkWidget *cal_title = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(cal_title),
        "<span weight='bold' size='large'>\xF0\x9F\x93\x85 Calendar</span>");
    gtk_widget_set_margin_start(cal_title, 16);
    gtk_widget_set_margin_top(cal_title, 12);
    gtk_widget_set_margin_bottom(cal_title, 12);
    gtk_box_pack_start(GTK_BOX(cal_header), cal_title, FALSE, FALSE, 0);
    gtk_widget_set_halign(cal_title, GTK_ALIGN_START);

    /* View label "Arbeitswoche" (Work week) */
    GtkWidget *view_label = gtk_label_new(NULL);
    {
        const char *lang = agora_translations_get_lang();
        const char *view_text = (g_strcmp0(lang, "de") == 0) ? "Arbeitswoche" : "Work week";
        char *view_markup = g_strdup_printf(
            "<span foreground='#888888' size='small'>%s</span>", view_text);
        gtk_label_set_markup(GTK_LABEL(view_label), view_markup);
        g_free(view_markup);
    }
    gtk_widget_set_margin_start(view_label, 8);
    gtk_widget_set_valign(view_label, GTK_ALIGN_CENTER);
    gtk_box_pack_start(GTK_BOX(cal_header), view_label, FALSE, FALSE, 0);

    /* Spacer */
    GtkWidget *cal_spacer = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_box_pack_start(GTK_BOX(cal_header), cal_spacer, TRUE, TRUE, 0);

    /* Calendar config button */
    GtkWidget *cal_config_btn = gtk_button_new_with_label("\xE2\x9A\x99");
    gtk_widget_set_tooltip_text(cal_config_btn, "Konfiguration");
    gtk_style_context_add_class(gtk_widget_get_style_context(cal_config_btn), "chat-header-btn");
    gtk_widget_set_margin_end(cal_config_btn, 4);
    gtk_widget_set_valign(cal_config_btn, GTK_ALIGN_CENTER);
    g_signal_connect(cal_config_btn, "clicked",
                     G_CALLBACK(on_calendar_config_clicked), win);
    gtk_box_pack_end(GTK_BOX(cal_header), cal_config_btn, FALSE, FALSE, 0);

    /* New event button */
    GtkWidget *cal_new_btn = gtk_button_new_with_label("+ Neuer Termin");
    gtk_style_context_add_class(gtk_widget_get_style_context(cal_new_btn), "send-btn");
    gtk_widget_set_margin_end(cal_new_btn, 8);
    gtk_widget_set_valign(cal_new_btn, GTK_ALIGN_CENTER);
    g_signal_connect(cal_new_btn, "clicked",
                     G_CALLBACK(on_calendar_new_event_clicked), win);
    gtk_box_pack_end(GTK_BOX(cal_header), cal_new_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(calendar_box), cal_header, FALSE, FALSE, 0);

    /* Split view: [Mini calendar + event list on left] | [Week grid on right] */
    GtkWidget *cal_split = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);

    /* Left panel: mini calendar + day events */
    GtkWidget *cal_left = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_size_request(cal_left, 260, -1);

    /* GtkCalendar mini month picker */
    win->gtk_calendar = gtk_calendar_new();
    gtk_calendar_set_display_options(GTK_CALENDAR(win->gtk_calendar),
        GTK_CALENDAR_SHOW_HEADING | GTK_CALENDAR_SHOW_DAY_NAMES);
    gtk_widget_set_margin_start(win->gtk_calendar, 8);
    gtk_widget_set_margin_end(win->gtk_calendar, 8);
    gtk_widget_set_margin_top(win->gtk_calendar, 8);
    gtk_widget_set_margin_bottom(win->gtk_calendar, 4);
    g_signal_connect(win->gtk_calendar, "day-selected",
                     G_CALLBACK(on_calendar_day_selected), win);
    g_signal_connect(win->gtk_calendar, "month-changed",
                     G_CALLBACK(on_calendar_month_changed), win);
    gtk_box_pack_start(GTK_BOX(cal_left), win->gtk_calendar, FALSE, FALSE, 0);

    /* Separator */
    gtk_box_pack_start(GTK_BOX(cal_left),
                       gtk_separator_new(GTK_ORIENTATION_HORIZONTAL), FALSE, FALSE, 0);

    /* Event list for selected day */
    win->calendar_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(win->calendar_scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->calendar_list = GTK_LIST_BOX(gtk_list_box_new());
    gtk_list_box_set_selection_mode(win->calendar_list, GTK_SELECTION_NONE);
    gtk_container_add(GTK_CONTAINER(win->calendar_scroll), GTK_WIDGET(win->calendar_list));
    gtk_box_pack_start(GTK_BOX(cal_left), win->calendar_scroll, TRUE, TRUE, 0);

    gtk_box_pack_start(GTK_BOX(cal_split), cal_left, FALSE, FALSE, 0);

    /* Vertical separator between left panel and week grid */
    gtk_box_pack_start(GTK_BOX(cal_split),
                       gtk_separator_new(GTK_ORIENTATION_VERTICAL), FALSE, FALSE, 0);

    /* Right panel: Week grid view */
    GtkWidget *week_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(week_scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);

    GtkWidget *week_vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* Week day headers (Mon-Fri) */
    {
        GtkWidget *week_header = gtk_grid_new();
        gtk_style_context_add_class(gtk_widget_get_style_context(week_header), "cal-week-header");
        gtk_grid_set_column_homogeneous(GTK_GRID(week_header), TRUE);

        /* Empty cell for time column */
        GtkWidget *time_spacer = gtk_label_new("");
        gtk_widget_set_size_request(time_spacer, 60, -1);
        gtk_grid_attach(GTK_GRID(week_header), time_spacer, 0, 0, 1, 1);

        GDateTime *now = g_date_time_new_now_local();
        /* Find Monday of current week */
        int dow = g_date_time_get_day_of_week(now); /* 1=Mon ... 7=Sun */
        GDateTime *monday = g_date_time_add_days(now, -(dow - 1));

        const char *day_names_de[] = {"Mo", "Di", "Mi", "Do", "Fr"};
        const char *day_names_en[] = {"Mon", "Tue", "Wed", "Thu", "Fri"};
        const char *lang = agora_translations_get_lang();
        const char **day_names = (g_strcmp0(lang, "de") == 0) ? day_names_de : day_names_en;

        for (int d = 0; d < 5; d++) {
            GDateTime *day_dt = g_date_time_add_days(monday, d);
            int day_num = g_date_time_get_day_of_month(day_dt);
            char *day_text = g_strdup_printf("<b>%s %d</b>", day_names[d], day_num);
            GtkWidget *day_lbl = gtk_label_new(NULL);
            gtk_label_set_markup(GTK_LABEL(day_lbl), day_text);
            g_free(day_text);
            gtk_widget_set_margin_top(day_lbl, 8);
            gtk_widget_set_margin_bottom(day_lbl, 8);

            /* Highlight today */
            if (g_date_time_get_day_of_month(day_dt) == g_date_time_get_day_of_month(now) &&
                g_date_time_get_month(day_dt) == g_date_time_get_month(now) &&
                g_date_time_get_year(day_dt) == g_date_time_get_year(now)) {
                PangoAttrList *today_attrs = pango_attr_list_new();
                pango_attr_list_insert(today_attrs, pango_attr_foreground_new(0x6200, 0x6400, 0xa700));
                gtk_label_set_attributes(GTK_LABEL(day_lbl), today_attrs);
                pango_attr_list_unref(today_attrs);
            }

            gtk_grid_attach(GTK_GRID(week_header), day_lbl, d + 1, 0, 1, 1);
            g_date_time_unref(day_dt);
        }
        g_date_time_unref(monday);
        g_date_time_unref(now);

        gtk_box_pack_start(GTK_BOX(week_vbox), week_header, FALSE, FALSE, 0);
    }

    /* Time grid: hours 07:00 - 19:00 with grid lines */
    {
        GtkWidget *time_grid = gtk_grid_new();
        gtk_grid_set_column_homogeneous(GTK_GRID(time_grid), FALSE);

        for (int hour = 7; hour <= 19; hour++) {
            int row = hour - 7;

            /* Time label */
            char *time_text = g_strdup_printf("%02d:00", hour);
            GtkWidget *time_lbl = gtk_label_new(time_text);
            g_free(time_text);
            gtk_widget_set_size_request(time_lbl, 60, 48);
            gtk_widget_set_valign(time_lbl, GTK_ALIGN_START);
            gtk_widget_set_halign(time_lbl, GTK_ALIGN_END);
            gtk_widget_set_margin_end(time_lbl, 8);
            PangoAttrList *hr_attrs = pango_attr_list_new();
            pango_attr_list_insert(hr_attrs, pango_attr_scale_new(0.8));
            pango_attr_list_insert(hr_attrs, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
            gtk_label_set_attributes(GTK_LABEL(time_lbl), hr_attrs);
            pango_attr_list_unref(hr_attrs);
            gtk_grid_attach(GTK_GRID(time_grid), time_lbl, 0, row, 1, 1);

            /* Day columns (5 days, Mon-Fri) */
            for (int d = 0; d < 5; d++) {
                GtkWidget *cell = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
                gtk_widget_set_size_request(cell, -1, 48);
                gtk_style_context_add_class(gtk_widget_get_style_context(cell), "cal-hour-row");
                /* Use hexpand to distribute columns evenly */
                gtk_widget_set_hexpand(cell, TRUE);
                gtk_grid_attach(GTK_GRID(time_grid), cell, d + 1, row, 1, 1);
            }
        }

        gtk_box_pack_start(GTK_BOX(week_vbox), time_grid, FALSE, FALSE, 0);
    }

    gtk_container_add(GTK_CONTAINER(week_scroll), week_vbox);
    gtk_box_pack_start(GTK_BOX(cal_split), week_scroll, TRUE, TRUE, 0);

    gtk_box_pack_start(GTK_BOX(calendar_box), cal_split, TRUE, TRUE, 0);

    gtk_stack_add_named(win->content_stack, calendar_box, "calendar");

    /* --- Chat view --- */
    win->chat_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* Chat header bar with title + action buttons */
    GtkWidget *chat_header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_style_context_add_class(gtk_widget_get_style_context(chat_header), "chat-header");
    gtk_container_set_border_width(GTK_CONTAINER(chat_header), 0);

    GtkWidget *title_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 1);
    gtk_widget_set_halign(title_box, GTK_ALIGN_START);
    gtk_widget_set_margin_start(title_box, 16);
    gtk_widget_set_margin_top(title_box, 8);
    gtk_widget_set_margin_bottom(title_box, 8);
    gtk_widget_set_valign(title_box, GTK_ALIGN_CENTER);

    win->chat_title = GTK_LABEL(gtk_label_new(""));
    PangoAttrList *title_attrs = pango_attr_list_new();
    pango_attr_list_insert(title_attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
    pango_attr_list_insert(title_attrs, pango_attr_size_new(14 * PANGO_SCALE));
    gtk_label_set_attributes(win->chat_title, title_attrs);
    pango_attr_list_unref(title_attrs);
    gtk_widget_set_halign(GTK_WIDGET(win->chat_title), GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(title_box), GTK_WIDGET(win->chat_title), FALSE, FALSE, 0);

    win->chat_subtitle = GTK_LABEL(gtk_label_new(""));
    PangoAttrList *sub_attrs = pango_attr_list_new();
    pango_attr_list_insert(sub_attrs, pango_attr_scale_new(0.8));
    pango_attr_list_insert(sub_attrs, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
    gtk_label_set_attributes(win->chat_subtitle, sub_attrs);
    pango_attr_list_unref(sub_attrs);
    gtk_widget_set_halign(GTK_WIDGET(win->chat_subtitle), GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(title_box), GTK_WIDGET(win->chat_subtitle), FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(chat_header), title_box, TRUE, TRUE, 0);

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

    /* Add member button (header) */
    GtkWidget *add_member_btn = gtk_button_new_with_label("\xE2\x9E\x95\xF0\x9F\x91\xA4"); /* ➕👤 */
    gtk_style_context_add_class(gtk_widget_get_style_context(add_member_btn), "chat-header-btn");
    gtk_widget_set_tooltip_text(add_member_btn, T("chat.add_member"));
    gtk_widget_set_valign(add_member_btn, GTK_ALIGN_CENTER);
    gtk_widget_set_margin_end(add_member_btn, 8);
    g_signal_connect(add_member_btn, "clicked", G_CALLBACK(on_add_member_clicked), win);
    gtk_box_pack_start(GTK_BOX(chat_header), add_member_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(win->chat_box), chat_header, FALSE, FALSE, 0);

    /* Message list (bubble-style) */
    win->message_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(win->message_scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->message_list = GTK_LIST_BOX(gtk_list_box_new());
    gtk_list_box_set_selection_mode(win->message_list, GTK_SELECTION_NONE);
    gtk_container_add(GTK_CONTAINER(win->message_scroll), GTK_WIDGET(win->message_list));
    gtk_box_pack_start(GTK_BOX(win->chat_box), win->message_scroll, TRUE, TRUE, 0);

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

    /* Reply / Edit bar */
    win->reply_bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
    gtk_style_context_add_class(gtk_widget_get_style_context(win->reply_bar), "msg-reply");
    gtk_container_set_border_width(GTK_CONTAINER(win->reply_bar), 6);
    win->reply_bar_label = GTK_LABEL(gtk_label_new(""));
    gtk_label_set_ellipsize(GTK_LABEL(win->reply_bar_label), PANGO_ELLIPSIZE_END);
    gtk_widget_set_halign(GTK_WIDGET(win->reply_bar_label), GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(win->reply_bar), GTK_WIDGET(win->reply_bar_label), TRUE, TRUE, 0);
    GtkWidget *reply_cancel_btn = gtk_button_new_with_label("\xE2\x9C\x95"); /* ✕ */
    gtk_style_context_add_class(gtk_widget_get_style_context(reply_cancel_btn), "input-btn");
    g_signal_connect(reply_cancel_btn, "clicked", G_CALLBACK(on_reply_cancel_clicked), win);
    gtk_box_pack_end(GTK_BOX(win->reply_bar), reply_cancel_btn, FALSE, FALSE, 0);
    gtk_widget_set_no_show_all(win->reply_bar, TRUE);
    gtk_box_pack_start(GTK_BOX(win->chat_box), win->reply_bar, FALSE, FALSE, 0);

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
    g_signal_connect(emoji_btn, "clicked", G_CALLBACK(on_emoji_btn_clicked), win);

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

    /* ===================== Team detail page ===================== */
    win->team_detail_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* Header bar */
    GtkWidget *td_header = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 12);
    gtk_style_context_add_class(gtk_widget_get_style_context(td_header), "chat-header");
    gtk_widget_set_margin_start(td_header, 16);
    gtk_widget_set_margin_end(td_header, 16);
    gtk_widget_set_margin_top(td_header, 12);
    gtk_widget_set_margin_bottom(td_header, 12);

    GtkWidget *td_info = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
    win->team_detail_title = GTK_LABEL(gtk_label_new(NULL));
    gtk_widget_set_halign(GTK_WIDGET(win->team_detail_title), GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(td_info), GTK_WIDGET(win->team_detail_title), FALSE, FALSE, 0);

    win->team_detail_subtitle = GTK_LABEL(gtk_label_new(NULL));
    gtk_widget_set_halign(GTK_WIDGET(win->team_detail_subtitle), GTK_ALIGN_START);
    PangoAttrList *td_sub_attrs = pango_attr_list_new();
    pango_attr_list_insert(td_sub_attrs, pango_attr_scale_new(0.9));
    pango_attr_list_insert(td_sub_attrs, pango_attr_foreground_new(0x8800, 0x8800, 0x8800));
    gtk_label_set_attributes(win->team_detail_subtitle, td_sub_attrs);
    pango_attr_list_unref(td_sub_attrs);
    gtk_box_pack_start(GTK_BOX(td_info), GTK_WIDGET(win->team_detail_subtitle), FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(td_header), td_info, TRUE, TRUE, 0);

    /* Leave team button */
    GtkWidget *td_leave_btn = gtk_button_new_with_label(T("teams.leave_team"));
    gtk_style_context_add_class(gtk_widget_get_style_context(td_leave_btn), "destructive-action");
    gtk_widget_set_valign(td_leave_btn, GTK_ALIGN_CENTER);
    g_signal_connect(td_leave_btn, "clicked", G_CALLBACK(on_team_leave_clicked), win);
    gtk_box_pack_end(GTK_BOX(td_header), td_leave_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(win->team_detail_box), td_header, FALSE, FALSE, 0);

    /* Separator */
    GtkWidget *td_sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_box_pack_start(GTK_BOX(win->team_detail_box), td_sep, FALSE, FALSE, 0);

    /* Notebook (tabs) */
    win->team_detail_notebook = GTK_NOTEBOOK(gtk_notebook_new());
    gtk_notebook_set_tab_pos(win->team_detail_notebook, GTK_POS_TOP);

    /* --- Tab 1: Channels --- */
    GtkWidget *ch_tab_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* New channel button */
    GtkWidget *ch_btn_bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_widget_set_margin_start(ch_btn_bar, 12);
    gtk_widget_set_margin_top(ch_btn_bar, 8);
    gtk_widget_set_margin_bottom(ch_btn_bar, 4);
    GtkWidget *new_ch_btn = gtk_button_new_with_label(T("teams.new_channel"));
    g_signal_connect(new_ch_btn, "clicked", G_CALLBACK(on_new_team_channel_clicked), win);
    gtk_box_pack_start(GTK_BOX(ch_btn_bar), new_ch_btn, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(ch_tab_box), ch_btn_bar, FALSE, FALSE, 0);

    GtkWidget *ch_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(ch_scroll), GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->team_channels_list = GTK_LIST_BOX(gtk_list_box_new());
    gtk_list_box_set_selection_mode(win->team_channels_list, GTK_SELECTION_SINGLE);
    g_signal_connect(win->team_channels_list, "row-selected", G_CALLBACK(on_team_detail_channel_clicked), win);
    gtk_container_add(GTK_CONTAINER(ch_scroll), GTK_WIDGET(win->team_channels_list));
    gtk_box_pack_start(GTK_BOX(ch_tab_box), ch_scroll, TRUE, TRUE, 0);

    gtk_notebook_append_page(win->team_detail_notebook, ch_tab_box,
        gtk_label_new(T("teams.tab_channels")));

    /* --- Tab 2: Members --- */
    GtkWidget *mem_tab_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* Search bar */
    GtkWidget *mem_search_bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_widget_set_margin_start(mem_search_bar, 12);
    gtk_widget_set_margin_end(mem_search_bar, 12);
    gtk_widget_set_margin_top(mem_search_bar, 8);
    gtk_widget_set_margin_bottom(mem_search_bar, 4);
    win->team_member_search_entry = GTK_ENTRY(gtk_entry_new());
    gtk_entry_set_placeholder_text(win->team_member_search_entry, T("teams.search_add_user"));
    g_signal_connect(win->team_member_search_entry, "changed",
                     G_CALLBACK(on_team_member_search_changed), win);
    gtk_box_pack_start(GTK_BOX(mem_search_bar), GTK_WIDGET(win->team_member_search_entry), TRUE, TRUE, 0);
    gtk_box_pack_start(GTK_BOX(mem_tab_box), mem_search_bar, FALSE, FALSE, 0);

    /* Search results dropdown */
    win->team_member_search_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_margin_start(win->team_member_search_box, 12);
    gtk_widget_set_margin_end(win->team_member_search_box, 12);
    win->team_member_search_results = GTK_LIST_BOX(gtk_list_box_new());
    gtk_list_box_set_selection_mode(win->team_member_search_results, GTK_SELECTION_NONE);
    gtk_container_add(GTK_CONTAINER(win->team_member_search_box),
                      GTK_WIDGET(win->team_member_search_results));
    gtk_box_pack_start(GTK_BOX(mem_tab_box), win->team_member_search_box, FALSE, FALSE, 0);
    gtk_widget_set_no_show_all(win->team_member_search_box, TRUE);

    /* Separator */
    GtkWidget *mem_sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_widget_set_margin_top(mem_sep, 4);
    gtk_box_pack_start(GTK_BOX(mem_tab_box), mem_sep, FALSE, FALSE, 0);

    /* Members list */
    GtkWidget *mem_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(mem_scroll), GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->team_members_list = GTK_LIST_BOX(gtk_list_box_new());
    gtk_list_box_set_selection_mode(win->team_members_list, GTK_SELECTION_NONE);
    gtk_container_add(GTK_CONTAINER(mem_scroll), GTK_WIDGET(win->team_members_list));
    gtk_box_pack_start(GTK_BOX(mem_tab_box), mem_scroll, TRUE, TRUE, 0);

    gtk_notebook_append_page(win->team_detail_notebook, mem_tab_box,
        gtk_label_new(T("teams.tab_members")));

    /* --- Tab 3: Files --- */
    GtkWidget *files_tab_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    GtkWidget *files_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(files_scroll), GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->team_files_list = GTK_LIST_BOX(gtk_list_box_new());
    gtk_list_box_set_selection_mode(win->team_files_list, GTK_SELECTION_NONE);
    gtk_container_add(GTK_CONTAINER(files_scroll), GTK_WIDGET(win->team_files_list));
    gtk_box_pack_start(GTK_BOX(files_tab_box), files_scroll, TRUE, TRUE, 0);

    gtk_notebook_append_page(win->team_detail_notebook, files_tab_box,
        gtk_label_new(T("teams.tab_files")));

    gtk_box_pack_start(GTK_BOX(win->team_detail_box), GTK_WIDGET(win->team_detail_notebook), TRUE, TRUE, 0);

    gtk_stack_add_named(win->content_stack, win->team_detail_box, "team_detail");
    gtk_stack_set_visible_child_name(win->content_stack, "empty");

    /* Wrap content_stack in a GtkOverlay so video can cover it completely */
    win->right_overlay = gtk_overlay_new();
    gtk_container_add(GTK_CONTAINER(win->right_overlay), GTK_WIDGET(win->content_stack));
    gtk_box_pack_start(GTK_BOX(right_vbox), win->right_overlay, TRUE, TRUE, 0);

    /* --- Video call overlay (drawn ON TOP of content_stack via GtkOverlay) ---
     * Use GtkEventBox as the outer container because GtkEventBox has its own
     * GdkWindow and can therefore paint an opaque background.
     * GtkBox does NOT have a GdkWindow, so override_background_color does nothing
     * on it, which lets the content_stack show through. */
    win->video_overlay = gtk_event_box_new();
    GtkWidget *video_vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_add(GTK_CONTAINER(win->video_overlay), video_vbox);

    /* Set opaque dark background on the GtkEventBox (it has a GdkWindow, so this works) */
    GdkRGBA video_overlay_bg = {0.10, 0.10, 0.10, 1.0};
    gtk_widget_override_background_color(win->video_overlay, GTK_STATE_FLAG_NORMAL, &video_overlay_bg);

    /* Video header with leave button */
    GtkWidget *video_header = gtk_event_box_new();
    GtkWidget *video_header_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_container_add(GTK_CONTAINER(video_header), video_header_box);
    GdkRGBA video_header_bg = {0.15, 0.15, 0.15, 1.0};
    gtk_widget_override_background_color(video_header, GTK_STATE_FLAG_NORMAL, &video_header_bg);
    gtk_container_set_border_width(GTK_CONTAINER(video_header_box), 8);

    GtkWidget *video_title = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(video_title),
        "<span color='white' weight='bold'>Video Call</span>");
    gtk_box_pack_start(GTK_BOX(video_header_box), video_title, TRUE, TRUE, 0);
    gtk_widget_set_halign(video_title, GTK_ALIGN_START);

    GtkWidget *leave_btn = gtk_button_new_with_label(T("video.leave"));
    GdkRGBA leave_bg = {0.8, 0.2, 0.2, 1.0};
    GdkRGBA leave_fg = {1.0, 1.0, 1.0, 1.0};
    gtk_widget_override_background_color(leave_btn, GTK_STATE_FLAG_NORMAL, &leave_bg);
    gtk_widget_override_color(leave_btn, GTK_STATE_FLAG_NORMAL, &leave_fg);
    g_signal_connect(leave_btn, "clicked", G_CALLBACK(on_video_leave_clicked), win);
    gtk_box_pack_end(GTK_BOX(video_header_box), leave_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(video_vbox), video_header, FALSE, FALSE, 0);

    /* WebKitWebView for video */
    /* Create WebView for video calls */
    win->video_webview = WEBKIT_WEB_VIEW(webkit_web_view_new());
    WebKitSettings *web_settings = webkit_web_view_get_settings(win->video_webview);
    webkit_settings_set_enable_media_stream(web_settings, TRUE);
    webkit_settings_set_enable_mediasource(web_settings, TRUE);
    webkit_settings_set_enable_webaudio(web_settings, TRUE);
    webkit_settings_set_media_playback_requires_user_gesture(web_settings, FALSE);

    /* Grant camera/microphone permissions automatically */
    g_signal_connect(win->video_webview, "permission-request",
                     G_CALLBACK(on_video_permission_request), win);

    /* Listen for leaveCall message from Angular's endCall() */
    {
        WebKitUserContentManager *ucm =
            webkit_web_view_get_user_content_manager(win->video_webview);
        webkit_user_content_manager_register_script_message_handler(ucm, "leaveCall");
        g_signal_connect(ucm, "script-message-received::leaveCall",
                         G_CALLBACK(on_script_leave_call), win);
    }

    /* Accept self-signed TLS certs */
    WebKitWebContext *wv_ctx = webkit_web_view_get_context(win->video_webview);
    WebKitWebsiteDataManager *wv_data_mgr = webkit_web_context_get_website_data_manager(wv_ctx);
    webkit_website_data_manager_set_tls_errors_policy(wv_data_mgr, WEBKIT_TLS_ERRORS_POLICY_IGNORE);

    gtk_box_pack_start(GTK_BOX(video_vbox), GTK_WIDGET(win->video_webview), TRUE, TRUE, 0);

    /* Make video overlay fill the entire GtkOverlay area */
    gtk_widget_set_halign(win->video_overlay, GTK_ALIGN_FILL);
    gtk_widget_set_valign(win->video_overlay, GTK_ALIGN_FILL);
    gtk_widget_set_hexpand(win->video_overlay, TRUE);
    gtk_widget_set_vexpand(win->video_overlay, TRUE);

    /* Add video overlay ON TOP of content_stack in the GtkOverlay */
    gtk_overlay_add_overlay(GTK_OVERLAY(win->right_overlay), win->video_overlay);

    /* Initially hide the video overlay */
    gtk_widget_set_no_show_all(win->video_overlay, TRUE);
    g_print("[Video] Video overlay initialized (GtkEventBox + GtkOverlay approach)\n");

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

    /* Connect notification WebSocket for real-time updates */
    connect_notification_ws(win);

    /* Load channels, teams, and feed */
    load_channels(win);
    load_teams(win);
    load_feed(win);

    /* Start event reminder polling (every 60 seconds) */
    check_event_reminders(win);
    win->reminder_poll_timer = g_timeout_add_seconds(60, check_event_reminders, win);

    return GTK_WIDGET(win);
}
