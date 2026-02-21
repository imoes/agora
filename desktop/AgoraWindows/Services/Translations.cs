using System.Collections.Generic;
using System.Globalization;

namespace AgoraWindows.Services;

/// <summary>
/// Translation service with automatic system language detection.
/// Uses user preference from backend, falls back to system language, then English.
/// </summary>
public static class Translations
{
    private static string _currentLang = "en";

    private static readonly HashSet<string> SupportedLanguages = new()
    {
        "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
        "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt",
        "ro", "sk", "sl", "sv"
    };

    private static readonly Dictionary<string, Dictionary<string, string>> Dict = new()
    {
        ["en"] = new()
        {
            ["login.title"] = "Sign in",
            ["login.server_url"] = "Server URL:",
            ["login.username"] = "Username:",
            ["login.password"] = "Password:",
            ["login.submit"] = "Sign in",
            ["login.submitting"] = "Signing in...",
            ["login.error"] = "Login failed",
            ["login.fill_fields"] = "Please fill in all fields.",
            ["welcome.title"] = "Welcome to Agora",
            ["welcome.subtitle"] = "Select a chat from the list",
            ["chat.chats"] = "Chats",
            ["chat.members"] = "members",
            ["chat.send"] = "Send",
            ["chat.input_placeholder"] = "Type a message...",
            ["chat.typing_one"] = "is typing...",
            ["chat.typing_many"] = "are typing...",
            ["chat.edited"] = "(edited)",
            ["chat.file_sent"] = "File sent",
            ["chat.error_loading_chats"] = "Error loading chats",
            ["chat.error_loading_messages"] = "Error loading messages",
            ["chat.error_sending"] = "Error sending",
            ["notify.new_message"] = "New message",
            ["notify.reacted"] = "reacted",
            ["notify.reaction_body"] = "on a message",
            ["notify.incoming_call"] = "Incoming call",
            ["notify.calling"] = "is calling...",
            ["status.online"] = "Online",
            ["common.error"] = "Error",
            ["common.user"] = "User",
            ["common.you"] = "You",
            ["notify.someone"] = "Someone",
            ["reminder.starts_in"] = "Starts in",
            ["reminder.now"] = "Now!",
            ["reminder.join"] = "Join",
            ["reminder.dismiss"] = "Dismiss",
            ["teams.teams"] = "Teams",
            ["teams.error_loading"] = "Error loading teams",
            ["settings.title"] = "Settings",
            ["settings.display_name"] = "Display Name",
            ["settings.email"] = "Email",
            ["settings.language"] = "Language",
            ["settings.change_password"] = "Change Password",
            ["settings.current_password"] = "Current Password",
            ["settings.new_password"] = "New Password",
            ["settings.save"] = "Save",
            ["settings.cancel"] = "Cancel",
            ["settings.saved"] = "Settings saved successfully.",
            ["settings.error"] = "Error saving settings",
            ["settings.current_password_required"] = "Please enter your current password.",
        },
        ["de"] = new()
        {
            ["login.title"] = "Anmelden",
            ["login.server_url"] = "Server-URL:",
            ["login.username"] = "Benutzername:",
            ["login.password"] = "Passwort:",
            ["login.submit"] = "Anmelden",
            ["login.submitting"] = "Anmeldung...",
            ["login.error"] = "Anmeldung fehlgeschlagen",
            ["login.fill_fields"] = "Bitte alle Felder ausfuellen.",
            ["welcome.title"] = "Willkommen bei Agora",
            ["welcome.subtitle"] = "Waehle einen Chat aus der Liste",
            ["chat.chats"] = "Chats",
            ["chat.members"] = "Mitglieder",
            ["chat.send"] = "Senden",
            ["chat.input_placeholder"] = "Nachricht eingeben...",
            ["chat.typing_one"] = "tippt...",
            ["chat.typing_many"] = "tippen...",
            ["chat.edited"] = "(bearbeitet)",
            ["chat.file_sent"] = "Datei gesendet",
            ["chat.error_loading_chats"] = "Fehler beim Laden der Chats",
            ["chat.error_loading_messages"] = "Fehler beim Laden der Nachrichten",
            ["chat.error_sending"] = "Fehler beim Senden",
            ["notify.new_message"] = "Neue Nachricht",
            ["notify.reacted"] = "hat reagiert",
            ["notify.reaction_body"] = "auf eine Nachricht",
            ["notify.incoming_call"] = "Eingehender Anruf",
            ["notify.calling"] = "ruft an...",
            ["status.online"] = "Online",
            ["common.error"] = "Fehler",
            ["common.user"] = "Benutzer",
            ["common.you"] = "Du",
            ["notify.someone"] = "Jemand",
            ["reminder.starts_in"] = "Beginnt in",
            ["reminder.now"] = "Jetzt!",
            ["reminder.join"] = "Beitreten",
            ["reminder.dismiss"] = "Schliessen",
            ["teams.teams"] = "Teams",
            ["teams.error_loading"] = "Fehler beim Laden der Teams",
            ["settings.title"] = "Einstellungen",
            ["settings.display_name"] = "Anzeigename",
            ["settings.email"] = "E-Mail",
            ["settings.language"] = "Sprache",
            ["settings.change_password"] = "Passwort aendern",
            ["settings.current_password"] = "Aktuelles Passwort",
            ["settings.new_password"] = "Neues Passwort",
            ["settings.save"] = "Speichern",
            ["settings.cancel"] = "Abbrechen",
            ["settings.saved"] = "Einstellungen gespeichert.",
            ["settings.error"] = "Fehler beim Speichern",
            ["settings.current_password_required"] = "Bitte aktuelles Passwort eingeben.",
        },
        ["fr"] = new()
        {
            ["login.title"] = "Se connecter",
            ["login.server_url"] = "URL du serveur :",
            ["login.username"] = "Nom d'utilisateur :",
            ["login.password"] = "Mot de passe :",
            ["login.submit"] = "Se connecter",
            ["login.submitting"] = "Connexion...",
            ["login.error"] = "\u00C9chec de la connexion",
            ["login.fill_fields"] = "Veuillez remplir tous les champs.",
            ["welcome.title"] = "Bienvenue sur Agora",
            ["welcome.subtitle"] = "S\u00E9lectionnez un chat dans la liste",
            ["chat.chats"] = "Chats",
            ["chat.members"] = "membres",
            ["chat.send"] = "Envoyer",
            ["chat.input_placeholder"] = "\u00C9crire un message...",
            ["chat.typing_one"] = "\u00E9crit...",
            ["chat.typing_many"] = "\u00E9crivent...",
            ["chat.edited"] = "(modifi\u00E9)",
            ["chat.file_sent"] = "Fichier envoy\u00E9",
            ["chat.error_loading_chats"] = "Erreur lors du chargement des chats",
            ["chat.error_loading_messages"] = "Erreur lors du chargement des messages",
            ["chat.error_sending"] = "Erreur lors de l'envoi",
            ["notify.new_message"] = "Nouveau message",
            ["notify.reacted"] = "a r\u00E9agi",
            ["notify.reaction_body"] = "sur un message",
            ["notify.incoming_call"] = "Appel entrant",
            ["notify.calling"] = "appelle...",
            ["status.online"] = "En ligne",
            ["common.error"] = "Erreur",
            ["common.user"] = "Utilisateur",
            ["common.you"] = "Toi",
            ["notify.someone"] = "Quelqu'un",
            ["reminder.starts_in"] = "Commence dans",
            ["reminder.now"] = "Maintenant !",
            ["reminder.join"] = "Rejoindre",
            ["reminder.dismiss"] = "Fermer",
        },
        ["es"] = new()
        {
            ["login.title"] = "Iniciar sesi\u00F3n",
            ["login.server_url"] = "URL del servidor:",
            ["login.username"] = "Nombre de usuario:",
            ["login.password"] = "Contrase\u00F1a:",
            ["login.submit"] = "Iniciar sesi\u00F3n",
            ["login.submitting"] = "Iniciando sesi\u00F3n...",
            ["login.error"] = "Error de inicio de sesi\u00F3n",
            ["login.fill_fields"] = "Por favor complete todos los campos.",
            ["welcome.title"] = "Bienvenido a Agora",
            ["welcome.subtitle"] = "Seleccione un chat de la lista",
            ["chat.chats"] = "Chats",
            ["chat.members"] = "miembros",
            ["chat.send"] = "Enviar",
            ["chat.input_placeholder"] = "Escribe un mensaje...",
            ["chat.typing_one"] = "est\u00E1 escribiendo...",
            ["chat.typing_many"] = "est\u00E1n escribiendo...",
            ["chat.edited"] = "(editado)",
            ["chat.file_sent"] = "Archivo enviado",
            ["chat.error_loading_chats"] = "Error al cargar los chats",
            ["chat.error_loading_messages"] = "Error al cargar los mensajes",
            ["chat.error_sending"] = "Error al enviar",
            ["notify.new_message"] = "Mensaje nuevo",
            ["notify.reacted"] = "ha reaccionado",
            ["notify.reaction_body"] = "a un mensaje",
            ["notify.incoming_call"] = "Llamada entrante",
            ["notify.calling"] = "est\u00E1 llamando...",
            ["status.online"] = "En l\u00EDnea",
            ["common.error"] = "Error",
            ["common.user"] = "Usuario",
            ["common.you"] = "T\u00FA",
            ["notify.someone"] = "Alguien",
            ["reminder.starts_in"] = "Empieza en",
            ["reminder.now"] = "\u00A1Ahora!",
            ["reminder.join"] = "Unirse",
            ["reminder.dismiss"] = "Cerrar",
        },
        ["it"] = new()
        {
            ["login.title"] = "Accedi",
            ["login.server_url"] = "URL del server:",
            ["login.username"] = "Nome utente:",
            ["login.password"] = "Password:",
            ["login.submit"] = "Accedi",
            ["login.submitting"] = "Accesso...",
            ["login.error"] = "Accesso fallito",
            ["login.fill_fields"] = "Compila tutti i campi.",
            ["welcome.title"] = "Benvenuto su Agora",
            ["welcome.subtitle"] = "Seleziona una chat dalla lista",
            ["chat.chats"] = "Chat",
            ["chat.members"] = "membri",
            ["chat.send"] = "Invia",
            ["chat.input_placeholder"] = "Scrivi un messaggio...",
            ["chat.typing_one"] = "sta scrivendo...",
            ["chat.typing_many"] = "stanno scrivendo...",
            ["chat.edited"] = "(modificato)",
            ["chat.file_sent"] = "File inviato",
            ["chat.error_loading_chats"] = "Errore durante il caricamento delle chat",
            ["chat.error_loading_messages"] = "Errore durante il caricamento dei messaggi",
            ["chat.error_sending"] = "Errore durante l'invio",
            ["notify.new_message"] = "Nuovo messaggio",
            ["notify.reacted"] = "ha reagito",
            ["notify.reaction_body"] = "a un messaggio",
            ["notify.incoming_call"] = "Chiamata in arrivo",
            ["notify.calling"] = "sta chiamando...",
            ["status.online"] = "Online",
            ["common.error"] = "Errore",
            ["common.user"] = "Utente",
            ["common.you"] = "Tu",
            ["notify.someone"] = "Qualcuno",
        },
        ["nl"] = new()
        {
            ["login.title"] = "Inloggen",
            ["login.server_url"] = "Server-URL:",
            ["login.username"] = "Gebruikersnaam:",
            ["login.password"] = "Wachtwoord:",
            ["login.submit"] = "Inloggen",
            ["login.submitting"] = "Inloggen...",
            ["login.error"] = "Inloggen mislukt",
            ["login.fill_fields"] = "Vul alle velden in.",
            ["welcome.title"] = "Welkom bij Agora",
            ["welcome.subtitle"] = "Selecteer een chat uit de lijst",
            ["chat.chats"] = "Chats",
            ["chat.members"] = "leden",
            ["chat.send"] = "Verzenden",
            ["chat.input_placeholder"] = "Typ een bericht...",
            ["chat.typing_one"] = "is aan het typen...",
            ["chat.typing_many"] = "zijn aan het typen...",
            ["chat.edited"] = "(bewerkt)",
            ["chat.file_sent"] = "Bestand verzonden",
            ["notify.new_message"] = "Nieuw bericht",
            ["notify.reacted"] = "heeft gereageerd",
            ["notify.reaction_body"] = "op een bericht",
            ["status.online"] = "Online",
            ["common.error"] = "Fout",
            ["common.user"] = "Gebruiker",
            ["common.you"] = "Jij",
            ["notify.someone"] = "Iemand",
        },
        ["pl"] = new()
        {
            ["login.title"] = "Zaloguj si\u0119",
            ["login.server_url"] = "URL serwera:",
            ["login.username"] = "Nazwa u\u017Cytkownika:",
            ["login.password"] = "Has\u0142o:",
            ["login.submit"] = "Zaloguj",
            ["login.submitting"] = "Logowanie...",
            ["login.error"] = "Logowanie nie powiod\u0142o si\u0119",
            ["login.fill_fields"] = "Prosz\u0119 wype\u0142ni\u0107 wszystkie pola.",
            ["welcome.title"] = "Witamy w Agora",
            ["welcome.subtitle"] = "Wybierz czat z listy",
            ["chat.chats"] = "Czaty",
            ["chat.members"] = "cz\u0142onk\u00F3w",
            ["chat.send"] = "Wy\u015Blij",
            ["chat.input_placeholder"] = "Napisz wiadomo\u015B\u0107...",
            ["chat.typing_one"] = "pisze...",
            ["chat.typing_many"] = "pisz\u0105...",
            ["chat.edited"] = "(edytowano)",
            ["notify.new_message"] = "Nowa wiadomo\u015B\u0107",
            ["notify.reacted"] = "zareagowa\u0142/a",
            ["notify.reaction_body"] = "na wiadomo\u015B\u0107",
            ["status.online"] = "Online",
            ["common.error"] = "B\u0142\u0105d",
            ["common.user"] = "U\u017Cytkownik",
        },
        ["pt"] = new()
        {
            ["login.title"] = "Iniciar sess\u00E3o",
            ["login.server_url"] = "URL do servidor:",
            ["login.username"] = "Nome de utilizador:",
            ["login.password"] = "Palavra-passe:",
            ["login.submit"] = "Entrar",
            ["login.submitting"] = "A entrar...",
            ["login.error"] = "Falha no login",
            ["login.fill_fields"] = "Por favor preencha todos os campos.",
            ["welcome.title"] = "Bem-vindo ao Agora",
            ["welcome.subtitle"] = "Selecione um chat da lista",
            ["chat.chats"] = "Chats",
            ["chat.members"] = "membros",
            ["chat.send"] = "Enviar",
            ["chat.input_placeholder"] = "Escreva uma mensagem...",
            ["chat.typing_one"] = "est\u00E1 a escrever...",
            ["chat.typing_many"] = "est\u00E3o a escrever...",
            ["chat.edited"] = "(editado)",
            ["notify.new_message"] = "Nova mensagem",
            ["notify.reacted"] = "reagiu",
            ["notify.reaction_body"] = "a uma mensagem",
            ["status.online"] = "Online",
            ["common.error"] = "Erro",
            ["common.user"] = "Utilizador",
        },
        ["sv"] = new()
        {
            ["login.title"] = "Logga in",
            ["login.username"] = "Anv\u00E4ndarnamn:",
            ["login.password"] = "L\u00F6senord:",
            ["login.submit"] = "Logga in",
            ["login.submitting"] = "Loggar in...",
            ["chat.send"] = "Skicka",
            ["chat.input_placeholder"] = "Skriv ett meddelande...",
            ["chat.edited"] = "(redigerad)",
            ["notify.new_message"] = "Nytt meddelande",
            ["common.error"] = "Fel",
        },
        ["da"] = new()
        {
            ["login.title"] = "Log ind",
            ["login.username"] = "Brugernavn:",
            ["login.password"] = "Adgangskode:",
            ["login.submit"] = "Log ind",
            ["chat.send"] = "Send",
            ["chat.edited"] = "(redigeret)",
            ["notify.new_message"] = "Ny besked",
            ["common.error"] = "Fejl",
        },
        ["fi"] = new()
        {
            ["login.title"] = "Kirjaudu sis\u00E4\u00E4n",
            ["login.username"] = "K\u00E4ytt\u00E4j\u00E4nimi:",
            ["login.password"] = "Salasana:",
            ["login.submit"] = "Kirjaudu",
            ["chat.send"] = "L\u00E4het\u00E4",
            ["chat.edited"] = "(muokattu)",
            ["notify.new_message"] = "Uusi viesti",
            ["common.error"] = "Virhe",
        },
        ["cs"] = new()
        {
            ["login.title"] = "P\u0159ihl\u00E1\u0161en\u00ED",
            ["login.username"] = "U\u017Eivatelsk\u00E9 jm\u00E9no:",
            ["login.password"] = "Heslo:",
            ["login.submit"] = "P\u0159ihl\u00E1sit",
            ["chat.send"] = "Odeslat",
            ["chat.edited"] = "(upraveno)",
            ["notify.new_message"] = "Nov\u00E1 zpr\u00E1va",
            ["common.error"] = "Chyba",
        },
        ["hu"] = new()
        {
            ["login.title"] = "Bejelentkez\u00E9s",
            ["login.username"] = "Felhaszn\u00E1l\u00F3n\u00E9v:",
            ["login.password"] = "Jelsz\u00F3:",
            ["login.submit"] = "Bel\u00E9p\u00E9s",
            ["chat.send"] = "K\u00FCld\u00E9s",
            ["chat.edited"] = "(szerkesztve)",
            ["notify.new_message"] = "\u00DAj \u00FCzenet",
            ["common.error"] = "Hiba",
        },
        ["ro"] = new()
        {
            ["login.title"] = "Conectare",
            ["login.username"] = "Nume de utilizator:",
            ["login.password"] = "Parol\u0103:",
            ["login.submit"] = "Conectare",
            ["chat.send"] = "Trimite",
            ["chat.edited"] = "(editat)",
            ["notify.new_message"] = "Mesaj nou",
            ["common.error"] = "Eroare",
        },
        ["bg"] = new()
        {
            ["login.title"] = "\u0412\u0445\u043E\u0434",
            ["login.username"] = "\u041F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043B\u0441\u043A\u043E \u0438\u043C\u0435:",
            ["login.password"] = "\u041F\u0430\u0440\u043E\u043B\u0430:",
            ["login.submit"] = "\u0412\u0445\u043E\u0434",
            ["chat.send"] = "\u0418\u0437\u043F\u0440\u0430\u0449\u0430\u043D\u0435",
            ["notify.new_message"] = "\u041D\u043E\u0432\u043E \u0441\u044A\u043E\u0431\u0449\u0435\u043D\u0438\u0435",
            ["common.error"] = "\u0413\u0440\u0435\u0448\u043A\u0430",
        },
        ["el"] = new()
        {
            ["login.title"] = "\u03A3\u03CD\u03BD\u03B4\u03B5\u03C3\u03B7",
            ["login.username"] = "\u038C\u03BD\u03BF\u03BC\u03B1 \u03C7\u03C1\u03AE\u03C3\u03C4\u03B7:",
            ["login.password"] = "\u039A\u03C9\u03B4\u03B9\u03BA\u03CC\u03C2:",
            ["login.submit"] = "\u03A3\u03CD\u03BD\u03B4\u03B5\u03C3\u03B7",
            ["chat.send"] = "\u0391\u03C0\u03BF\u03C3\u03C4\u03BF\u03BB\u03AE",
            ["notify.new_message"] = "\u039D\u03AD\u03BF \u03BC\u03AE\u03BD\u03C5\u03BC\u03B1",
            ["common.error"] = "\u03A3\u03C6\u03AC\u03BB\u03BC\u03B1",
        },
    };

    public static string CurrentLang => _currentLang;

    /// <summary>
    /// Initialize language: detect system language, use as default.
    /// </summary>
    static Translations()
    {
        DetectSystemLanguage();
    }

    private static void DetectSystemLanguage()
    {
        var sysLang = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName.ToLowerInvariant();
        if (SupportedLanguages.Contains(sysLang))
        {
            _currentLang = sysLang;
        }
    }

    /// <summary>
    /// Set language from user profile (called after login).
    /// Empty or null means keep system language.
    /// </summary>
    public static void InitFromUser(string? userLang)
    {
        if (!string.IsNullOrEmpty(userLang) && SupportedLanguages.Contains(userLang))
        {
            _currentLang = userLang;
        }
    }

    /// <summary>
    /// Translate a key. Falls back to English, then returns the key itself.
    /// </summary>
    public static string T(string key)
    {
        if (Dict.TryGetValue(_currentLang, out var langDict) && langDict.TryGetValue(key, out var val))
            return val;
        if (Dict.TryGetValue("en", out var enDict) && enDict.TryGetValue(key, out var enVal))
            return enVal;
        return key;
    }
}
