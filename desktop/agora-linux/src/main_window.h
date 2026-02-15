#ifndef AGORA_MAIN_WINDOW_H
#define AGORA_MAIN_WINDOW_H

#include <gtk/gtk.h>
#include "app.h"

#define AGORA_TYPE_MAIN_WINDOW (agora_main_window_get_type())
G_DECLARE_FINAL_TYPE(AgoraMainWindow, agora_main_window, AGORA, MAIN_WINDOW, GtkApplicationWindow)

GtkWidget *agora_main_window_new(AgoraApp *app);

#endif /* AGORA_MAIN_WINDOW_H */
