#include "login_window.h"
#include "api_client.h"
#include "translations.h"

struct _AgoraLoginWindow {
    GtkApplicationWindow parent;
    GtkEntry *server_entry;
    GtkEntry *username_entry;
    GtkEntry *password_entry;
    GtkLabel *error_label;
    GtkButton *login_button;
    GtkToggleButton *remember_check;
};

G_DEFINE_TYPE(AgoraLoginWindow, agora_login_window, GTK_TYPE_APPLICATION_WINDOW)

/* Settings file path */
static char *get_settings_path(void)
{
    const char *config = g_get_user_config_dir();
    return g_build_filename(config, "agora", "login_settings.json", NULL);
}

static void load_saved_settings(AgoraLoginWindow *win)
{
    char *path = get_settings_path();
    gchar *contents = NULL;
    gsize length = 0;
    if (!g_file_get_contents(path, &contents, &length, NULL)) {
        g_free(path);
        return;
    }
    g_free(path);

    JsonParser *parser = json_parser_new();
    if (!json_parser_load_from_data(parser, contents, (gssize)length, NULL)) {
        g_free(contents);
        g_object_unref(parser);
        return;
    }
    g_free(contents);

    JsonObject *obj = json_node_get_object(json_parser_get_root(parser));

    if (json_object_has_member(obj, "server_url")) {
        const char *url = json_object_get_string_member(obj, "server_url");
        if (url && url[0]) gtk_entry_set_text(win->server_entry, url);
    }

    gboolean remember = json_object_has_member(obj, "remember") &&
        json_object_get_boolean_member(obj, "remember");
    gtk_toggle_button_set_active(win->remember_check, remember);

    if (remember) {
        if (json_object_has_member(obj, "username")) {
            const char *u = json_object_get_string_member(obj, "username");
            if (u && u[0]) gtk_entry_set_text(win->username_entry, u);
        }
        if (json_object_has_member(obj, "password")) {
            const char *p = json_object_get_string_member(obj, "password");
            if (p && p[0]) gtk_entry_set_text(win->password_entry, p);
        }
    }

    g_object_unref(parser);
}

static void save_settings(AgoraLoginWindow *win, const char *server,
                           const char *username, const char *password)
{
    char *path = get_settings_path();
    char *dir = g_path_get_dirname(path);
    g_mkdir_with_parents(dir, 0700);
    g_free(dir);

    gboolean remember = gtk_toggle_button_get_active(win->remember_check);

    JsonBuilder *b = json_builder_new();
    json_builder_begin_object(b);
    json_builder_set_member_name(b, "server_url");
    json_builder_add_string_value(b, server);
    json_builder_set_member_name(b, "remember");
    json_builder_add_boolean_value(b, remember);
    json_builder_set_member_name(b, "username");
    json_builder_add_string_value(b, remember ? username : "");
    json_builder_set_member_name(b, "password");
    json_builder_add_string_value(b, remember ? password : "");
    json_builder_end_object(b);

    JsonGenerator *gen = json_generator_new();
    json_generator_set_root(gen, json_builder_get_root(b));
    char *json = json_generator_to_data(gen, NULL);

    g_file_set_contents(path, json, -1, NULL);

    g_free(json);
    g_free(path);
    g_object_unref(gen);
    g_object_unref(b);
}

static void on_login_clicked(GtkButton *button, gpointer user_data)
{
    (void)button;
    AgoraLoginWindow *win = AGORA_LOGIN_WINDOW(user_data);
    AgoraApp *app = AGORA_APP(gtk_window_get_application(GTK_WINDOW(win)));

    const char *server = gtk_entry_get_text(win->server_entry);
    const char *username = gtk_entry_get_text(win->username_entry);
    const char *password = gtk_entry_get_text(win->password_entry);

    if (!server[0] || !username[0] || !password[0]) {
        gtk_label_set_text(win->error_label, T("login.fill_fields"));
        gtk_widget_show(GTK_WIDGET(win->error_label));
        return;
    }

    gtk_widget_set_sensitive(GTK_WIDGET(win->login_button), FALSE);
    gtk_button_set_label(win->login_button, T("login.submitting"));
    gtk_widget_hide(GTK_WIDGET(win->error_label));

    GError *error = NULL;
    AgoraApiClient *client = agora_api_client_new(server);
    JsonNode *result = agora_api_client_login(client, username, password, &error);

    if (!result) {
        char *msg = g_strdup_printf("%s: %s",
                                     T("login.error"),
                                     error ? error->message : "Unknown error");
        gtk_label_set_text(win->error_label, msg);
        gtk_widget_show(GTK_WIDGET(win->error_label));
        g_free(msg);
        if (error) g_error_free(error);
        agora_api_client_free(client);
        gtk_widget_set_sensitive(GTK_WIDGET(win->login_button), TRUE);
        gtk_button_set_label(win->login_button, T("login.submit"));
        return;
    }

    /* Save settings */
    save_settings(win, server, username, password);

    /* Extract token and user info */
    JsonObject *obj = json_node_get_object(result);
    const char *token = json_object_get_string_member(obj, "access_token");
    JsonObject *user_obj = json_object_get_object_member(obj, "user");
    const char *user_id = json_object_get_string_member(user_obj, "id");
    const char *display_name = json_object_get_string_member(user_obj, "display_name");
    const char *language = json_object_has_member(user_obj, "language")
        ? json_object_get_string_member(user_obj, "language") : NULL;
    const char *notification_sound_path = (json_object_has_member(user_obj, "notification_sound_path") &&
        !json_object_get_null_member(user_obj, "notification_sound_path"))
        ? json_object_get_string_member(user_obj, "notification_sound_path") : NULL;

    /* Set language from user profile (overrides system language if set) */
    agora_translations_set_lang(language);

    agora_app_set_session(app, server, token, user_id, display_name, language, notification_sound_path);
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
    /* Initialize translations (detects system language) */
    agora_translations_init();

    char *title = g_strdup_printf("Agora - %s", T("login.title"));
    gtk_window_set_title(GTK_WINDOW(win), title);
    g_free(title);
    gtk_window_set_default_size(GTK_WINDOW(win), 380, 480);
    gtk_window_set_resizable(GTK_WINDOW(win), FALSE);
    gtk_window_set_position(GTK_WINDOW(win), GTK_WIN_POS_CENTER);

    /* Main container */
    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 12);
    gtk_container_set_border_width(GTK_CONTAINER(box), 40);
    gtk_container_add(GTK_CONTAINER(win), box);

    /* Title */
    GtkWidget *label_title = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(label_title),
        "<span size='xx-large' weight='bold' color='#6264A7'>Agora</span>");
    gtk_box_pack_start(GTK_BOX(box), label_title, FALSE, FALSE, 0);

    GtkWidget *subtitle = gtk_label_new("Collaboration Platform");
    gtk_box_pack_start(GTK_BOX(box), subtitle, FALSE, FALSE, 0);

    /* Spacer */
    gtk_box_pack_start(GTK_BOX(box), gtk_label_new(""), FALSE, FALSE, 4);

    /* Server URL */
    gtk_box_pack_start(GTK_BOX(box), gtk_label_new(T("login.server_url")), FALSE, FALSE, 0);
    win->server_entry = GTK_ENTRY(gtk_entry_new());
    gtk_entry_set_text(win->server_entry, "https://localhost");
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->server_entry), FALSE, FALSE, 0);

    /* Username */
    gtk_box_pack_start(GTK_BOX(box), gtk_label_new(T("login.username")), FALSE, FALSE, 0);
    win->username_entry = GTK_ENTRY(gtk_entry_new());
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->username_entry), FALSE, FALSE, 0);

    /* Password */
    gtk_box_pack_start(GTK_BOX(box), gtk_label_new(T("login.password")), FALSE, FALSE, 0);
    win->password_entry = GTK_ENTRY(gtk_entry_new());
    gtk_entry_set_visibility(win->password_entry, FALSE);
    gtk_entry_set_input_purpose(win->password_entry, GTK_INPUT_PURPOSE_PASSWORD);
    g_signal_connect(win->password_entry, "activate",
                     G_CALLBACK(on_password_activate), win);
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->password_entry), FALSE, FALSE, 0);

    /* Remember credentials checkbox */
    win->remember_check = GTK_TOGGLE_BUTTON(gtk_check_button_new_with_label(T("login.remember")));
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->remember_check), FALSE, FALSE, 0);

    /* Error label */
    win->error_label = GTK_LABEL(gtk_label_new(""));
    gtk_widget_set_no_show_all(GTK_WIDGET(win->error_label), TRUE);
    gtk_label_set_line_wrap(win->error_label, TRUE);
    GdkRGBA red = {0.8, 0.0, 0.0, 1.0};
    gtk_widget_override_color(GTK_WIDGET(win->error_label),
                              GTK_STATE_FLAG_NORMAL, &red);
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->error_label), FALSE, FALSE, 0);

    /* Login button */
    win->login_button = GTK_BUTTON(gtk_button_new_with_label(T("login.submit")));
    g_signal_connect(win->login_button, "clicked",
                     G_CALLBACK(on_login_clicked), win);
    gtk_box_pack_start(GTK_BOX(box), GTK_WIDGET(win->login_button), FALSE, FALSE, 8);

    /* Apply CSS styling */
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css,
        "button { background: #6264A7; color: white; padding: 8px 16px; border-radius: 4px; }"
        "button:hover { background: #515399; }"
        "entry { padding: 6px; border: 1px solid #e0e0e0; border-radius: 4px; }",
        -1, NULL);
    gtk_style_context_add_provider_for_screen(
        gdk_screen_get_default(),
        GTK_STYLE_PROVIDER(css),
        GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css);

    /* Load saved settings */
    load_saved_settings(win);

    gtk_widget_show_all(box);
}

GtkWidget *agora_login_window_new(AgoraApp *app)
{
    return g_object_new(AGORA_TYPE_LOGIN_WINDOW,
                        "application", app,
                        NULL);
}
