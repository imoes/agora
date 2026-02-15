#ifndef AGORA_APP_H
#define AGORA_APP_H

#include <gtk/gtk.h>

/* AgoraApp - GtkApplication subclass */
#define AGORA_TYPE_APP (agora_app_get_type())
G_DECLARE_FINAL_TYPE(AgoraApp, agora_app, AGORA, APP, GtkApplication)

AgoraApp *agora_app_new(void);

/* Global state accessible from windows */
typedef struct {
    char *base_url;
    char *token;
    char *user_id;
    char *display_name;
} AgoraSession;

AgoraSession *agora_app_get_session(AgoraApp *app);
void agora_app_set_session(AgoraApp *app, const char *base_url,
                           const char *token, const char *user_id,
                           const char *display_name);
void agora_app_show_main_window(AgoraApp *app);

#endif /* AGORA_APP_H */
