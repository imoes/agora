#ifndef AGORA_LOGIN_WINDOW_H
#define AGORA_LOGIN_WINDOW_H

#include <gtk/gtk.h>
#include "app.h"

#define AGORA_TYPE_LOGIN_WINDOW (agora_login_window_get_type())
G_DECLARE_FINAL_TYPE(AgoraLoginWindow, agora_login_window, AGORA, LOGIN_WINDOW, GtkApplicationWindow)

GtkWidget *agora_login_window_new(AgoraApp *app);

#endif /* AGORA_LOGIN_WINDOW_H */
