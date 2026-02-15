#include "login_window.h"
#include "api_client.h"

struct _AgoraLoginWindow {
    GtkApplicationWindow parent;
    GtkEntry *server_entry;
    GtkEntry *username_entry;
    GtkEntry *password_entry;
    GtkLabel *error_label;
    GtkButton *login_button;
};

G_DEFINE_TYPE(AgoraLoginWindow, agora_login_window, GTK_TYPE_APPLICATION_WINDOW)

static void on_login_clicked(GtkButton *button, gpointer user_data)
{
    (void)button;
    AgoraLoginWindow *win = AGORA_LOGIN_WINDOW(user_data);
    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));

    const char *server = gtk_entry_get_text(win->server_entry);
    const char *username = gtk_entry_get_text(win->username_entry);
    const char *password = gtk_entry_get_text(win->password_entry);

    if (!server[0] || !username[0] || !password[0]) {
        gtk_label_set_text(win->error_label, "Bitte alle Felder ausfuellen.");
        gtk_widget_show(GTK_WIDGET(win->error_label));
        return;
    }

    gtk_widget_set_sensitive(GTK_WIDGET(win->login_button), FALSE);
    gtk_button_set_label(win->login_button, "Anmelden...");
    gtk_widget_hide(GTK_WIDGET(win->error_label));

    GError *error = NULL;
    AgoraApiClient *client = agora_api_client_new(server);
    JsonNode *result = agora_api_client_login(client, username, password, &error);

    if (!result) {
        char *msg = g_strdup_printf("Anmeldung fehlgeschlagen: %s",
                                     error ? error->message : "Unbekannter Fehler");
        gtk_label_set_text(win->error_label, msg);
        gtk_widget_show(GTK_WIDGET(win->error_label));
        g_free(msg);
        if (error) g_error_free(error);
        agora_api_client_free(client);
        gtk_widget_set_sensitive(GTK_WIDGET(win->login_button), TRUE);
        gtk_button_set_label(win->login_button, "Anmelden");
        return;
    }

    /* Extract token and user info */
    JsonObject *obj = json_node_get_object(result);
    const char *token = json_object_get_string_member(obj, "access_token");
    JsonObject *user_obj = json_object_get_object_member(obj, "user");
    const char *user_id = json_object_get_string_member(user_obj, "id");
    const char *display_name = json_object_get_string_member(user_obj, "display_name");

    agora_app_set_session(app, server, token, user_id, display_name);
    json_node_unref(result);
    agora_api_client_free(client);

    /* Show main window and close login */
    agora_app_show_main_window(app);
    gtk_widget_destroy(GTK_WIDGET(win));
}

static void on_password_activate(GtkEntry *entry, gpointer user_data)
{
    (void)entry;
    AgoraLoginWindow *win = AGORA_LOGIN_WINDOW(user_data);
    on_login_clicked(win->login_button, win);
}

static void agora_login_window_class_init(AgoraLoginWindowClass *klass)
{
    (void)klass;
}

static void agora_login_window_init(AgoraLoginWindow *win)
{
    gtk_window_set_title(GTK_WINDOW(win), "Agora - Anmeldung");
    gtk_window_set_default_size(GTK_WINDOW(win), 380, 420);
    gtk_window_set_resizable(GTK_WINDOW(win), FALSE);
    gtk_window_set_position(GTK_WINDOW(win), GTK_WIN_POS_CENTER);

    /* Main container */
    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 12);
    gtk_container_set_border_width(GTK_CONTAINER(box), 40);
    gtk_container_add(GTK_CONTAINER(win), box);

    /* Title */
    GtkWidget *title = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(title),
        "<span size='xx-large' weight='bold' color='#1976D2'>Agora</span>");
    gtk_box_pack_start(GTK_BOX(box), title, FALSE, FALSE, 0);

    GtkWidget *subtitle = gtk_label_new("Collaboration Platform");
    GtkStyleContext *ctx = gtk_widget_get_style_context(subtitle);
    (void)ctx;
    gtk_box_pack_start(GTK_BOX(box), subtitle, FALSE, FALSE, 0);

    /* Spacer */
    gtk_box_pack_start(GTK_BOX(box), gtk_label_new(""), FALSE, FALSE, 4);

    /* Server URL */
    gtk_box_pack_start(GTK_BOX(box), gtk_label_new("Server-URL:"), FALSE, FALSE, 0);
    win->server_entry = GTK_ENTRY(gtk_entry_new());
    gtk_entry_set_text(win->server_entry, "https://localhost");
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->server_entry), FALSE, FALSE, 0);

    /* Username */
    gtk_box_pack_start(GTK_BOX(box), gtk_label_new("Benutzername:"), FALSE, FALSE, 0);
    win->username_entry = GTK_ENTRY(gtk_entry_new());
    gtk_entry_set_placeholder_text(win->username_entry, "Benutzername");
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->username_entry), FALSE, FALSE, 0);

    /* Password */
    gtk_box_pack_start(GTK_BOX(box), gtk_label_new("Passwort:"), FALSE, FALSE, 0);
    win->password_entry = GTK_ENTRY(gtk_entry_new());
    gtk_entry_set_visibility(win->password_entry, FALSE);
    gtk_entry_set_input_purpose(win->password_entry, GTK_INPUT_PURPOSE_PASSWORD);
    g_signal_connect(win->password_entry, "activate",
                     G_CALLBACK(on_password_activate), win);
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->password_entry), FALSE, FALSE, 0);

    /* Error label */
    win->error_label = GTK_LABEL(gtk_label_new(""));
    gtk_widget_set_no_show_all(GTK_WIDGET(win->error_label), TRUE);
    gtk_label_set_line_wrap(win->error_label, TRUE);
    GdkRGBA red = {0.8, 0.0, 0.0, 1.0};
    gtk_widget_override_color(GTK_WIDGET(win->error_label),
                              GTK_STATE_FLAG_NORMAL, &red);
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->error_label), FALSE, FALSE, 0);

    /* Login button */
    win->login_button = GTK_BUTTON(gtk_button_new_with_label("Anmelden"));
    g_signal_connect(win->login_button, "clicked",
                     G_CALLBACK(on_login_clicked), win);
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->login_button), FALSE, FALSE, 8);

    /* Apply CSS styling */
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css,
        "button { background: #1976D2; color: white; padding: 8px 16px; border-radius: 4px; }"
        "button:hover { background: #1565C0; }"
        "entry { padding: 6px; border: 1px solid #e0e0e0; border-radius: 4px; }",
        -1, NULL);
    gtk_style_context_add_provider_for_screen(
        gdk_screen_get_default(),
        GTK_STYLE_PROVIDER(css),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css);

    gtk_widget_show_all(box);
}

GtkWidget *agora_login_window_new(AgoraApp *app)
{
    return g_object_new(AGORA_TYPE_LOGIN_WINDOW,
                        "application", app,
                        NULL);
}
