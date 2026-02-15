#include "app.h"
#include "login_window.h"
#include "main_window.h"

struct _AgoraApp {
    GtkApplication parent;
    AgoraSession session;
};

G_DEFINE_TYPE(AgoraApp, agora_app, GTK_TYPE_APPLICATION)

static void agora_app_activate(GApplication *gapp)
{
    AgoraApp *app = AGORA_APP(gapp);

    /* Show login window on startup */
    GtkWidget *login = agora_login_window_new(app);
    gtk_window_present(GTK_WINDOW(login));
}

static void agora_app_finalize(GObject *obj)
{
    AgoraApp *app = AGORA_APP(obj);
    g_free(app->session.base_url);
    g_free(app->session.token);
    g_free(app->session.user_id);
    g_free(app->session.display_name);
    G_OBJECT_CLASS(agora_app_parent_class)->finalize(obj);
}

static void agora_app_class_init(AgoraAppClass *klass)
{
    G_APPLICATION_CLASS(klass)->activate = agora_app_activate;
    G_OBJECT_CLASS(klass)->finalize = agora_app_finalize;
}

static void agora_app_init(AgoraApp *app)
{
    (void)app;
}

AgoraApp *agora_app_new(void)
{
    return g_object_new(AGORA_TYPE_APP,
                        "application-id", "org.agora.desktop",
                        "flags", G_APPLICATION_DEFAULT_FLAGS,
                        NULL);
}

AgoraSession *agora_app_get_session(AgoraApp *app)
{
    return &app->session;
}

void agora_app_set_session(AgoraApp *app, const char *base_url,
                           const char *token, const char *user_id,
                           const char *display_name)
{
    g_free(app->session.base_url);
    g_free(app->session.token);
    g_free(app->session.user_id);
    g_free(app->session.display_name);
    app->session.base_url = g_strdup(base_url);
    app->session.token = g_strdup(token);
    app->session.user_id = g_strdup(user_id);
    app->session.display_name = g_strdup(display_name);
}

void agora_app_show_main_window(AgoraApp *app)
{
    GtkWidget *win = agora_main_window_new(app);
    gtk_window_present(GTK_WINDOW(win));
}
