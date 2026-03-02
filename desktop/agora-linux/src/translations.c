#include "translations.h"
#include <glib.h>
#include <string.h>
#include <stdlib.h>

static char current_lang[8] = "en";

/* Supported languages */
static const char *supported[] = {
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
    "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt",
    "ro", "sk", "sl", "sv", NULL
};

static gboolean is_supported(const char *code)
{
    for (int i = 0; supported[i]; i++) {
        if (g_strcmp0(supported[i], code) == 0) return TRUE;
    }
    return FALSE;
}

/* Translation entry */
typedef struct {
    const char *key;
    const char *value;
} TransEntry;

/* --- English --- */
static const TransEntry en_entries[] = {
    {"login.title", "Sign in"},
    {"login.server_url", "Server URL:"},
    {"login.username", "Username:"},
    {"login.password", "Password:"},
    {"login.submit", "Sign in"},
    {"login.submitting", "Signing in..."},
    {"login.error", "Login failed"},
    {"login.fill_fields", "Please fill in all fields."},
    {"login.remember", "Remember credentials"},
    {"welcome.title", "Welcome to Agora"},
    {"welcome.subtitle", "Select a chat from the list"},
    {"chat.chats", "Chats"},
    {"chat.members", "members"},
    {"chat.send", "Send"},
    {"chat.input_placeholder", "Type a message..."},
    {"chat.typing_one", "is typing..."},
    {"chat.typing_many", "are typing..."},
    {"chat.edited", "(edited)"},
    {"chat.new_messages", "New Messages"},
    {"chat.file_sent", "File sent"},
    {"chat.download_file", "Download file"},
    {"chat.system", "System"},
    {"chat.file", "File"},
    {"notify.reacted", "reacted"},
    {"notify.reaction_body", "on a message"},
    {"notify.incoming_call", "Incoming call"},
    {"notify.calling", "is calling..."},
    {"status.online", "Online"},
    {"common.error", "Error"},
    {"common.user", "User"},
    {"common.you", "You"},
    {"file.save", "Save file"},
    {"notify.someone", "Someone"},
    {"reminder.starts_in", "Starts in"},
    {"reminder.now", "Now!"},
    {"reminder.join", "Join"},
    {"reminder.dismiss", "Dismiss"},
    {"teams.teams", "Teams"},
    {"teams.error_loading", "Error loading teams"},
    {"teams.new_team", "New Team"},
    {"teams.team_name", "Team Name"},
    {"teams.description", "Description"},
    {"teams.new_channel", "New Channel"},
    {"teams.channel_name", "Channel name:"},
    {"teams.tab_channels", "Channels"},
    {"teams.tab_members", "Members"},
    {"teams.tab_files", "Files"},
    {"teams.leave_team", "Leave Team"},
    {"teams.leave_confirm", "Do you really want to leave the team"},
    {"teams.subscribe", "Subscribe"},
    {"teams.unsubscribe", "Unsubscribe"},
    {"teams.team_settings", "Team Settings"},
    {"teams.search_add_user", "Search and add users..."},
    {"teams.remove_member", "Remove"},
    {"teams.remove_member_confirm", "Remove from team:"},
    {"teams.no_files", "No files in this team"},
    {"nav.feed", "Feed"},
    {"nav.chat", "Chat"},
    {"nav.teams", "Teams"},
    {"nav.calendar", "Calendar"},
    {"chat.video_call", "Video Call"},
    {"chat.attach_file", "Attach File"},
    {"chat.emoji", "Emoji"},
    {"feed.title", "Activity Feed"},
    {"feed.empty", "No new activity"},
    {"feed.show_all", "Show All"},
    {"feed.unread_only", "Unread Only"},
    {"calendar.empty", "No upcoming events"},
    {"video.leave", "Leave Call"},
    {"chat.leave_channel", "Leave Channel"},
    {"chat.error_loading_messages", "Error loading messages"},
    {"chat.reply", "Reply"},
    {"chat.edit", "Edit"},
    {"chat.delete", "Delete"},
    {"chat.reply_to", "Reply to"},
    {"chat.editing_message", "Editing message..."},
    {"chat.delete_confirm", "Delete this message?"},
    {"chat.cancel", "Cancel"},
    {"chat.new_channel", "New Chat"},
    {"chat.channel_name", "Chat name:"},
    {"chat.create", "Create"},
    {"chat.search_users", "Search users..."},
    {"chat.add_member", "Add Member"},
    {"chat.add_member_btn", "Add"},
    {"chat.direct_chat", "Direct Chat"},
    {"chat.forward", "Forward"},
    {"chat.forward_to", "Forward to..."},
    {"chat.forwarded_from", "Forwarded from"},
    {"chat.forwarded_to", "Forwarded to"},
    {"settings.title", "Settings"},
    {"settings.profile", "Profile"},
    {"settings.display_name", "Display Name"},
    {"settings.email", "Email"},
    {"settings.save", "Save"},
    {"settings.password", "Change Password"},
    {"settings.current_password", "Current Password"},
    {"settings.new_password", "New Password"},
    {"settings.confirm_password", "Confirm Password"},
    {"settings.change_password", "Change Password"},
    {"settings.language", "Language"},
    {"settings.saved", "Settings saved."},
    {"settings.password_changed", "Password changed."},
    {"settings.password_mismatch", "Passwords do not match."},
    {"settings.password_wrong", "Current password is incorrect."},
    {"settings.error", "Error saving settings."},
    {NULL, NULL}
};

/* --- German --- */
static const TransEntry de_entries[] = {
    {"login.title", "Anmelden"},
    {"login.server_url", "Server-URL:"},
    {"login.username", "Benutzername:"},
    {"login.password", "Passwort:"},
    {"login.submit", "Anmelden"},
    {"login.submitting", "Anmeldung..."},
    {"login.error", "Anmeldung fehlgeschlagen"},
    {"login.fill_fields", "Bitte alle Felder ausfuellen."},
    {"login.remember", "Anmeldedaten speichern"},
    {"welcome.title", "Willkommen bei Agora"},
    {"welcome.subtitle", "Waehle einen Chat aus der Liste"},
    {"chat.chats", "Chats"},
    {"chat.members", "Mitglieder"},
    {"chat.send", "Senden"},
    {"chat.input_placeholder", "Nachricht eingeben..."},
    {"chat.typing_one", "tippt..."},
    {"chat.typing_many", "tippen..."},
    {"chat.edited", "(bearbeitet)"},
    {"chat.new_messages", "Neue Nachrichten"},
    {"chat.file_sent", "Datei gesendet"},
    {"chat.download_file", "Datei herunterladen"},
    {"chat.system", "System"},
    {"chat.file", "Datei"},
    {"notify.reacted", "hat reagiert"},
    {"notify.reaction_body", "auf eine Nachricht"},
    {"notify.incoming_call", "Eingehender Anruf"},
    {"notify.calling", "ruft an..."},
    {"status.online", "Online"},
    {"common.error", "Fehler"},
    {"common.user", "Benutzer"},
    {"common.you", "Du"},
    {"file.save", "Datei speichern"},
    {"notify.someone", "Jemand"},
    {"reminder.starts_in", "Beginnt in"},
    {"reminder.now", "Jetzt!"},
    {"reminder.join", "Beitreten"},
    {"reminder.dismiss", "Schliessen"},
    {"teams.teams", "Teams"},
    {"teams.error_loading", "Fehler beim Laden der Teams"},
    {"teams.new_team", "Neues Team"},
    {"teams.team_name", "Teamname"},
    {"teams.description", "Beschreibung"},
    {"teams.new_channel", "Neuer Kanal"},
    {"teams.channel_name", "Kanalname:"},
    {"teams.tab_channels", "Kan\xc3\xa4le"},
    {"teams.tab_members", "Mitglieder"},
    {"teams.tab_files", "Dateien"},
    {"teams.leave_team", "Team verlassen"},
    {"teams.leave_confirm", "M\xc3\xb6" "chtest du das Team wirklich verlassen"},
    {"teams.subscribe", "Abonnieren"},
    {"teams.unsubscribe", "Abo beenden"},
    {"teams.team_settings", "Team Einstellungen"},
    {"teams.search_add_user", "Benutzer suchen und hinzuf\xc3\xbcgen..."},
    {"teams.remove_member", "Entfernen"},
    {"teams.remove_member_confirm", "Aus Team entfernen:"},
    {"teams.no_files", "Keine Dateien in diesem Team"},
    {"nav.feed", "Feed"},
    {"nav.chat", "Chat"},
    {"nav.teams", "Teams"},
    {"nav.calendar", "Kalender"},
    {"chat.video_call", "Videoanruf"},
    {"chat.attach_file", "Datei anh\xc3\xa4ngen"},
    {"chat.emoji", "Emoji"},
    {"feed.title", "Aktivit\xc3\xa4ten"},
    {"feed.empty", "Keine neuen Aktivit\xc3\xa4ten"},
    {"feed.show_all", "Alle anzeigen"},
    {"feed.unread_only", "Nur ungelesene"},
    {"calendar.empty", "Keine anstehenden Termine"},
    {"video.leave", "Anruf verlassen"},
    {"chat.leave_channel", "Kanal verlassen"},
    {"chat.error_loading_messages", "Fehler beim Laden der Nachrichten"},
    {"chat.reply", "Antworten"},
    {"chat.edit", "Bearbeiten"},
    {"chat.delete", "L\xc3\xb6schen"},
    {"chat.reply_to", "Antwort an"},
    {"chat.editing_message", "Nachricht bearbeiten..."},
    {"chat.delete_confirm", "Diese Nachricht l\xc3\xb6schen?"},
    {"chat.cancel", "Abbrechen"},
    {"chat.new_channel", "Neuer Chat"},
    {"chat.channel_name", "Chat-Name:"},
    {"chat.create", "Erstellen"},
    {"chat.search_users", "Benutzer suchen..."},
    {"chat.add_member", "Mitglied hinzuf\xc3\xbcgen"},
    {"chat.add_member_btn", "Hinzuf\xc3\xbcgen"},
    {"chat.direct_chat", "Direktnachricht"},
    {"chat.forward", "Weiterleiten"},
    {"chat.forward_to", "Weiterleiten an..."},
    {"chat.forwarded_from", "Weitergeleitet von"},
    {"chat.forwarded_to", "Weitergeleitet an"},
    {"settings.title", "Einstellungen"},
    {"settings.profile", "Profil"},
    {"settings.display_name", "Anzeigename"},
    {"settings.email", "E-Mail"},
    {"settings.save", "Speichern"},
    {"settings.password", "Passwort \xc3\xa4ndern"},
    {"settings.current_password", "Aktuelles Passwort"},
    {"settings.new_password", "Neues Passwort"},
    {"settings.confirm_password", "Passwort best\xc3\xa4tigen"},
    {"settings.change_password", "Passwort \xc3\xa4ndern"},
    {"settings.language", "Sprache"},
    {"settings.saved", "Einstellungen gespeichert."},
    {"settings.password_changed", "Passwort ge\xc3\xa4ndert."},
    {"settings.password_mismatch", "Passw\xc3\xb6rter stimmen nicht \xc3\xbcberein."},
    {"settings.password_wrong", "Aktuelles Passwort ist falsch."},
    {"settings.error", "Fehler beim Speichern."},
    {NULL, NULL}
};

/* --- French --- */
static const TransEntry fr_entries[] = {
    {"login.title", "Se connecter"},
    {"login.server_url", "URL du serveur :"},
    {"login.username", "Nom d'utilisateur :"},
    {"login.password", "Mot de passe :"},
    {"login.submit", "Se connecter"},
    {"login.submitting", "Connexion..."},
    {"login.error", "\xc3\x89" "chec de la connexion"},
    {"login.fill_fields", "Veuillez remplir tous les champs."},
    {"welcome.title", "Bienvenue sur Agora"},
    {"welcome.subtitle", "S\xc3\xa9lectionnez un chat dans la liste"},
    {"chat.chats", "Chats"},
    {"chat.members", "membres"},
    {"chat.send", "Envoyer"},
    {"chat.input_placeholder", "\xc3\x89" "crire un message..."},
    {"chat.typing_one", "\xc3\xa9" "crit..."},
    {"chat.typing_many", "\xc3\xa9" "crivent..."},
    {"chat.edited", "(modifi\xc3\xa9)"},
    {"chat.file_sent", "Fichier envoy\xc3\xa9"},
    {"notify.reacted", "a r\xc3\xa9" "agi"},
    {"notify.reaction_body", "sur un message"},
    {"status.online", "En ligne"},
    {"common.error", "Erreur"},
    {"common.user", "Utilisateur"},
    {"common.you", "Toi"},
    {"notify.someone", "Quelqu'un"},
    {"reminder.starts_in", "Commence dans"},
    {"reminder.now", "Maintenant !"},
    {"reminder.join", "Rejoindre"},
    {"reminder.dismiss", "Fermer"},
    {NULL, NULL}
};

/* --- Spanish --- */
static const TransEntry es_entries[] = {
    {"login.title", "Iniciar sesi\xc3\xb3n"},
    {"login.server_url", "URL del servidor:"},
    {"login.username", "Nombre de usuario:"},
    {"login.password", "Contrase\xc3\xb1" "a:"},
    {"login.submit", "Iniciar sesi\xc3\xb3n"},
    {"login.submitting", "Iniciando sesi\xc3\xb3n..."},
    {"login.error", "Error de inicio de sesi\xc3\xb3n"},
    {"welcome.title", "Bienvenido a Agora"},
    {"welcome.subtitle", "Seleccione un chat de la lista"},
    {"chat.chats", "Chats"},
    {"chat.members", "miembros"},
    {"chat.send", "Enviar"},
    {"chat.input_placeholder", "Escribe un mensaje..."},
    {"chat.typing_one", "est\xc3\xa1 escribiendo..."},
    {"chat.typing_many", "est\xc3\xa1n escribiendo..."},
    {"chat.edited", "(editado)"},
    {"notify.reacted", "ha reaccionado"},
    {"notify.reaction_body", "a un mensaje"},
    {"status.online", "En l\xc3\xadnea"},
    {"common.error", "Error"},
    {"common.user", "Usuario"},
    {"common.you", "T\xc3\xba"},
    {"notify.someone", "Alguien"},
    {"reminder.starts_in", "Empieza en"},
    {"reminder.now", "\xc2\xa1" "Ahora!"},
    {"reminder.join", "Unirse"},
    {"reminder.dismiss", "Cerrar"},
    {NULL, NULL}
};

/* --- Italian --- */
static const TransEntry it_entries[] = {
    {"login.title", "Accedi"},
    {"login.server_url", "URL del server:"},
    {"login.username", "Nome utente:"},
    {"login.password", "Password:"},
    {"login.submit", "Accedi"},
    {"login.submitting", "Accesso..."},
    {"login.error", "Accesso fallito"},
    {"welcome.title", "Benvenuto su Agora"},
    {"welcome.subtitle", "Seleziona una chat dalla lista"},
    {"chat.chats", "Chat"},
    {"chat.members", "membri"},
    {"chat.send", "Invia"},
    {"chat.input_placeholder", "Scrivi un messaggio..."},
    {"chat.typing_one", "sta scrivendo..."},
    {"chat.typing_many", "stanno scrivendo..."},
    {"chat.edited", "(modificato)"},
    {"notify.reacted", "ha reagito"},
    {"notify.reaction_body", "a un messaggio"},
    {"status.online", "Online"},
    {"common.error", "Errore"},
    {"common.user", "Utente"},
    {"common.you", "Tu"},
    {"notify.someone", "Qualcuno"},
    {NULL, NULL}
};

/* --- Dutch --- */
static const TransEntry nl_entries[] = {
    {"login.title", "Inloggen"},
    {"login.username", "Gebruikersnaam:"},
    {"login.password", "Wachtwoord:"},
    {"login.submit", "Inloggen"},
    {"login.submitting", "Inloggen..."},
    {"login.error", "Inloggen mislukt"},
    {"welcome.title", "Welkom bij Agora"},
    {"chat.chats", "Chats"},
    {"chat.members", "leden"},
    {"chat.send", "Verzenden"},
    {"chat.input_placeholder", "Typ een bericht..."},
    {"chat.typing_one", "is aan het typen..."},
    {"chat.typing_many", "zijn aan het typen..."},
    {"chat.edited", "(bewerkt)"},
    {"notify.reacted", "heeft gereageerd"},
    {"status.online", "Online"},
    {"common.error", "Fout"},
    {"common.user", "Gebruiker"},
    {"common.you", "Jij"},
    {"notify.someone", "Iemand"},
    {NULL, NULL}
};

/* --- Polish --- */
static const TransEntry pl_entries[] = {
    {"login.title", "Zaloguj si\xc4\x99"},
    {"login.submit", "Zaloguj"},
    {"login.submitting", "Logowanie..."},
    {"chat.send", "Wy\xc5\x9blij"},
    {"chat.input_placeholder", "Napisz wiadomo\xc5\x9b\xc4\x87..."},
    {"chat.typing_one", "pisze..."},
    {"chat.typing_many", "pisz\xc4\x85..."},
    {"chat.edited", "(edytowano)"},
    {"common.error", "B\xc5\x82\xc4\x85" "d"},
    {NULL, NULL}
};

/* --- Portuguese --- */
static const TransEntry pt_entries[] = {
    {"login.title", "Iniciar sess\xc3\xa3o"},
    {"login.submit", "Entrar"},
    {"login.submitting", "A entrar..."},
    {"chat.send", "Enviar"},
    {"chat.input_placeholder", "Escreva uma mensagem..."},
    {"chat.edited", "(editado)"},
    {"common.error", "Erro"},
    {NULL, NULL}
};

/* --- Swedish --- */
static const TransEntry sv_entries[] = {
    {"login.title", "Logga in"},
    {"login.username", "Anv\xc3\xa4ndarnamn:"},
    {"login.password", "L\xc3\xb6senord:"},
    {"login.submit", "Logga in"},
    {"login.submitting", "Loggar in..."},
    {"chat.send", "Skicka"},
    {"chat.input_placeholder", "Skriv ett meddelande..."},
    {"chat.edited", "(redigerad)"},
    {"common.error", "Fel"},
    {NULL, NULL}
};

/* --- Danish --- */
static const TransEntry da_entries[] = {
    {"login.title", "Log ind"},
    {"login.username", "Brugernavn:"},
    {"login.password", "Adgangskode:"},
    {"login.submit", "Log ind"},
    {"chat.send", "Send"},
    {"chat.edited", "(redigeret)"},
    {"common.error", "Fejl"},
    {NULL, NULL}
};

/* --- Finnish --- */
static const TransEntry fi_entries[] = {
    {"login.title", "Kirjaudu sis\xc3\xa4\xc3\xa4n"},
    {"login.username", "K\xc3\xa4ytt\xc3\xa4j\xc3\xa4nimi:"},
    {"login.password", "Salasana:"},
    {"login.submit", "Kirjaudu"},
    {"chat.send", "L\xc3\xa4het\xc3\xa4"},
    {"chat.edited", "(muokattu)"},
    {"common.error", "Virhe"},
    {NULL, NULL}
};

/* --- Czech --- */
static const TransEntry cs_entries[] = {
    {"login.title", "P\xc5\x99ihl\xc3\xa1\xc5\xa1en\xc3\xad"},
    {"login.username", "U\xc5\xbeivatelsk\xc3\xa9 jm\xc3\xa9no:"},
    {"login.password", "Heslo:"},
    {"login.submit", "P\xc5\x99ihl\xc3\xa1sit"},
    {"chat.send", "Odeslat"},
    {"chat.edited", "(upraveno)"},
    {"common.error", "Chyba"},
    {NULL, NULL}
};

/* --- Hungarian --- */
static const TransEntry hu_entries[] = {
    {"login.title", "Bejelentkez\xc3\xa9s"},
    {"login.username", "Felhaszn\xc3\xa1l\xc3\xb3n\xc3\xa9v:"},
    {"login.password", "Jelsz\xc3\xb3:"},
    {"login.submit", "Bel\xc3\xa9p\xc3\xa9s"},
    {"chat.send", "K\xc3\xbcld\xc3\xa9s"},
    {"chat.edited", "(szerkesztve)"},
    {"common.error", "Hiba"},
    {NULL, NULL}
};

/* --- Romanian --- */
static const TransEntry ro_entries[] = {
    {"login.title", "Conectare"},
    {"login.username", "Nume de utilizator:"},
    {"login.password", "Parol\xc4\x83:"},
    {"login.submit", "Conectare"},
    {"chat.send", "Trimite"},
    {"chat.edited", "(editat)"},
    {"common.error", "Eroare"},
    {NULL, NULL}
};

/* Language → entries mapping */
typedef struct {
    const char *code;
    const TransEntry *entries;
} LangMap;

static const LangMap languages[] = {
    {"en", en_entries},
    {"de", de_entries},
    {"fr", fr_entries},
    {"es", es_entries},
    {"it", it_entries},
    {"nl", nl_entries},
    {"pl", pl_entries},
    {"pt", pt_entries},
    {"sv", sv_entries},
    {"da", da_entries},
    {"fi", fi_entries},
    {"cs", cs_entries},
    {"hu", hu_entries},
    {"ro", ro_entries},
    {NULL, NULL}
};

static const TransEntry *find_entries(const char *lang)
{
    for (int i = 0; languages[i].code; i++) {
        if (g_strcmp0(languages[i].code, lang) == 0)
            return languages[i].entries;
    }
    return NULL;
}

static const char *lookup(const TransEntry *entries, const char *key)
{
    if (!entries) return NULL;
    for (int i = 0; entries[i].key; i++) {
        if (g_strcmp0(entries[i].key, key) == 0)
            return entries[i].value;
    }
    return NULL;
}

void agora_translations_init(void)
{
    /* Detect system language from environment */
    const gchar *const *sys_langs = g_get_language_names();
    if (sys_langs) {
        for (int i = 0; sys_langs[i]; i++) {
            /* Extract 2-letter code */
            char code[3] = {0};
            strncpy(code, sys_langs[i], 2);
            code[2] = '\0';
            /* Convert to lowercase */
            for (int j = 0; j < 2; j++) {
                if (code[j] >= 'A' && code[j] <= 'Z')
                    code[j] += 32;
            }
            if (is_supported(code)) {
                strncpy(current_lang, code, sizeof(current_lang) - 1);
                break;
            }
        }
    }
}

void agora_translations_set_lang(const char *lang_code)
{
    if (!lang_code || !lang_code[0]) return;
    char code[3] = {0};
    strncpy(code, lang_code, 2);
    code[2] = '\0';
    if (is_supported(code)) {
        strncpy(current_lang, code, sizeof(current_lang) - 1);
    }
}

const char *agora_translations_get_lang(void)
{
    return current_lang;
}

const char *T(const char *key)
{
    /* Try current language */
    const TransEntry *entries = find_entries(current_lang);
    const char *val = lookup(entries, key);
    if (val) return val;

    /* Fallback to English */
    if (g_strcmp0(current_lang, "en") != 0) {
        val = lookup(en_entries, key);
        if (val) return val;
    }

    /* Return key itself */
    return key;
}
