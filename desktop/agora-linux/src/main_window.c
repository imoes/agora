#include "main_window.h"
#include "api_client.h"
#include <string.h>

struct _AgoraMainWindow {
    GtkApplicationWindow parent;
    AgoraApiClient *api;

    /* Sidebar */
    GtkListBox *channel_list;
    GtkLabel *user_label;

    /* Chat area */
    GtkStack *content_stack;
    GtkLabel *chat_title;
    GtkTextView *message_view;
    GtkTextBuffer *message_buffer;
    GtkEntry *message_entry;
    GtkWidget *chat_box;

    /* State */
    char *current_channel_id;
};

G_DEFINE_TYPE(AgoraMainWindow, agora_main_window, GTK_TYPE_APPLICATION_WINDOW)

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
        char *members_text = g_strdup_printf("%ld Mitglieder", (long)member_count);
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

        char *line = g_strdup_printf("[%s] %s: %s\n",
                                     created ? created : "",
                                     sender ? sender : "?",
                                     content ? content : "");
        gtk_text_buffer_insert(win->message_buffer, &iter, line, -1);
        g_free(line);
    }

    /* Scroll to bottom */
    GtkTextMark *end_mark = gtk_text_buffer_get_mark(win->message_buffer, "insert");
    gtk_text_view_scroll_to_mark(win->message_view, end_mark, 0.0, FALSE, 0.0, 0.0);

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

    gtk_label_set_text(win->chat_title, channel_name);
    gtk_stack_set_visible_child_name(win->content_stack, "chat");

    load_messages(win, channel_id);
    gtk_widget_grab_focus(GTK_WIDGET(win->message_entry));
}

static void send_message(AgoraMainWindow *win)
{
    const char *text = gtk_entry_get_text(win->message_entry);
    if (!text || !text[0] || !win->current_channel_id) return;

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
                                     session->display_name ? session->display_name : "Ich",
                                     text);
        gtk_text_buffer_insert(win->message_buffer, &iter, line, -1);
        g_free(line);

        json_node_unref(result);
    } else if (error) {
        g_error_free(error);
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

/* --- Widget setup --- */

static void agora_main_window_finalize(GObject *obj)
{
    AgoraMainWindow *win = AGORA_MAIN_WINDOW(obj);
    agora_api_client_free(win->api);
    g_free(win->current_channel_id);
    G_OBJECT_CLASS(agora_main_window_parent_class)->finalize(obj);
}

static void agora_main_window_class_init(AgoraMainWindowClass *klass)
{
    G_OBJECT_CLASS(klass)->finalize = agora_main_window_finalize;
}

static void agora_main_window_init(AgoraMainWindow *win)
{
    gtk_window_set_title(GTK_WINDOW(win), "Agora");
    gtk_window_set_default_size(GTK_WINDOW(win), 960, 600);
    gtk_window_set_position(GTK_WINDOW(win), GTK_WIN_POS_CENTER);

    /* Main horizontal pane */
    GtkWidget *paned = gtk_paned_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_paned_set_position(GTK_PANED(paned), 260);
    gtk_container_add(GTK_CONTAINER(win), paned);

    /* --- Sidebar --- */
    GtkWidget *sidebar = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* User header */
    win->user_label = GTK_LABEL(gtk_label_new(""));
    GtkWidget *user_frame = gtk_frame_new(NULL);
    gtk_container_set_border_width(GTK_CONTAINER(user_frame), 0);
    gtk_container_add(GTK_CONTAINER(user_frame), GTK_WIDGET(win->user_label));
    gtk_widget_set_margin_start(GTK_WIDGET(win->user_label), 12);
    gtk_widget_set_margin_top(GTK_WIDGET(win->user_label), 8);
    gtk_widget_set_margin_bottom(GTK_WIDGET(win->user_label), 8);
    gtk_widget_set_halign(GTK_WIDGET(win->user_label), GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(sidebar), user_frame, FALSE, FALSE, 0);

    /* "Chats" header */
    GtkWidget *chats_label = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(chats_label), "<b>Chats</b>");
    gtk_widget_set_halign(chats_label, GTK_ALIGN_START);
    gtk_widget_set_margin_start(chats_label, 12);
    gtk_widget_set_margin_top(chats_label, 8);
    gtk_widget_set_margin_bottom(chats_label, 4);
    gtk_box_pack_start(GTK_BOX(sidebar), chats_label, FALSE, FALSE, 0);

    /* Channel list */
    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);
    win->channel_list = GTK_LIST_BOX(gtk_list_box_new());
    g_signal_connect(win->channel_list, "row-selected",
                     G_CALLBACK(on_channel_selected), win);
    gtk_container_add(GTK_CONTAINER(scroll), GTK_WIDGET(win->channel_list));
    gtk_box_pack_start(GTK_BOX(sidebar), scroll, TRUE, TRUE, 0);

    gtk_paned_pack1(GTK_PANED(paned), sidebar, FALSE, FALSE);

    /* --- Content area (stack: empty / chat) --- */
    win->content_stack = GTK_STACK(gtk_stack_new());

    /* Empty state */
    GtkWidget *empty_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 8);
    gtk_widget_set_valign(empty_box, GTK_ALIGN_CENTER);
    gtk_widget_set_halign(empty_box, GTK_ALIGN_CENTER);

    GtkWidget *welcome = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(welcome),
        "<span size='x-large' weight='bold'>Willkommen bei Agora</span>");
    gtk_box_pack_start(GTK_BOX(empty_box), welcome, FALSE, FALSE, 0);

    GtkWidget *hint = gtk_label_new("Waehle einen Chat aus der Liste");
    gtk_box_pack_start(GTK_BOX(empty_box), hint, FALSE, FALSE, 0);

    gtk_stack_add_named(win->content_stack, empty_box, "empty");

    /* Chat view */
    win->chat_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    /* Chat header */
    win->chat_title = GTK_LABEL(gtk_label_new(""));
    PangoAttrList *title_attrs = pango_attr_list_new();
    pango_attr_list_insert(title_attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
    pango_attr_list_insert(title_attrs, pango_attr_size_new(15 * PANGO_SCALE));
    gtk_label_set_attributes(win->chat_title, title_attrs);
    pango_attr_list_unref(title_attrs);
    gtk_widget_set_halign(GTK_WIDGET(win->chat_title), GTK_ALIGN_START);
    gtk_widget_set_margin_start(GTK_WIDGET(win->chat_title), 16);
    gtk_widget_set_margin_top(GTK_WIDGET(win->chat_title), 10);
    gtk_widget_set_margin_bottom(GTK_WIDGET(win->chat_title), 10);
    gtk_box_pack_start(GTK_BOX(win->chat_box), GTK_WIDGET(win->chat_title),
                       FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(win->chat_box), gtk_separator_new(GTK_ORIENTATION_HORIZONTAL),
                       FALSE, FALSE, 0);

    /* Message view */
    GtkWidget *msg_scroll = gtk_scrolled_window_new(NULL, NULL);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(msg_scroll),
                                   GTK_POLICY_AUTOMATIC, GTK_POLICY_AUTOMATIC);
    win->message_view = GTK_TEXT_VIEW(gtk_text_view_new());
    win->message_buffer = gtk_text_view_get_buffer(win->message_view);
    gtk_text_view_set_editable(win->message_view, FALSE);
    gtk_text_view_set_cursor_visible(win->message_view, FALSE);
    gtk_text_view_set_wrap_mode(win->message_view, GTK_WRAP_WORD_CHAR);
    gtk_text_view_set_left_margin(win->message_view, 12);
    gtk_text_view_set_right_margin(win->message_view, 12);
    gtk_text_view_set_top_margin(win->message_view, 8);
    gtk_container_add(GTK_CONTAINER(msg_scroll), GTK_WIDGET(win->message_view));
    gtk_box_pack_start(GTK_BOX(win->chat_box), msg_scroll, TRUE, TRUE, 0);

    gtk_box_pack_start(GTK_BOX(win->chat_box), gtk_separator_new(GTK_ORIENTATION_HORIZONTAL),
                       FALSE, FALSE, 0);

    /* Message input */
    GtkWidget *input_box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_container_set_border_width(GTK_CONTAINER(input_box), 8);

    win->message_entry = GTK_ENTRY(gtk_entry_new());
    gtk_entry_set_placeholder_text(win->message_entry, "Nachricht eingeben...");
    g_signal_connect(win->message_entry, "activate",
                     G_CALLBACK(on_entry_activate), win);
    gtk_box_pack_start(GTK_BOX(input_box), GTK_WIDGET(win->message_entry), TRUE, TRUE, 0);

    GtkWidget *send_btn = gtk_button_new_with_label("Senden");
    g_signal_connect(send_btn, "clicked", G_CALLBACK(on_send_clicked), win);
    gtk_box_pack_start(GTK_BOX(input_box), send_btn, FALSE, FALSE, 0);

    gtk_box_pack_start(GTK_BOX(win->chat_box), input_box, FALSE, FALSE, 0);

    gtk_stack_add_named(win->content_stack, win->chat_box, "chat");
    gtk_stack_set_visible_child_name(win->content_stack, "empty");

    gtk_paned_pack2(GTK_PANED(paned), GTK_WIDGET(win->content_stack), TRUE, FALSE);

    gtk_widget_show_all(paned);
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
    gtk_label_set_text(win->user_label, session->display_name ? session->display_name : "Benutzer");

    /* Load channels */
    load_channels(win);

    return GTK_WIDGET(win);
}
