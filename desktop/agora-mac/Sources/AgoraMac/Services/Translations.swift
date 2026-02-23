import Foundation

class Translations {
    static let shared = Translations()

    private var currentLang = "en"
    private let supported = ["bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
                              "ga", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt",
                              "ro", "sk", "sl", "sv"]

    private var translations: [String: [String: String]] = [:]

    private init() {
        setupTranslations()
        detectSystemLanguage()
    }

    func setLanguage(_ code: String) {
        let lang = String(code.prefix(2)).lowercased()
        if supported.contains(lang) {
            currentLang = lang
        }
    }

    func getLanguage() -> String {
        return currentLang
    }

    func t(_ key: String) -> String {
        // Try current language
        if let value = translations[currentLang]?[key] {
            return value
        }
        // Fallback to English
        if currentLang != "en", let value = translations["en"]?[key] {
            return value
        }
        // Return key
        return key
    }

    private func detectSystemLanguage() {
        let preferredLanguages = Locale.preferredLanguages
        for lang in preferredLanguages {
            let code = String(lang.prefix(2)).lowercased()
            if supported.contains(code) {
                currentLang = code
                return
            }
        }
    }

    private func setupTranslations() {
        // English
        translations["en"] = [
            "login.title": "Sign in",
            "login.server_url": "Server URL:",
            "login.username": "Username:",
            "login.password": "Password:",
            "login.submit": "Sign in",
            "login.submitting": "Signing in...",
            "login.error": "Login failed",
            "login.fill_fields": "Please fill in all fields.",
            "welcome.title": "Welcome to Agora",
            "welcome.subtitle": "Select a chat from the list",
            "chat.chats": "Chats",
            "chat.members": "members",
            "chat.send": "Send",
            "chat.input_placeholder": "Type a message...",
            "chat.typing_one": "is typing...",
            "chat.typing_many": "are typing...",
            "chat.edited": "(edited)",
            "chat.file_sent": "File sent",
            "chat.system": "System",
            "chat.file": "File",
            "notify.reacted": "reacted",
            "notify.reaction_body": "on a message",
            "notify.incoming_call": "Incoming call",
            "notify.calling": "is calling...",
            "status.online": "Online",
            "common.error": "Error",
            "common.user": "User",
            "common.you": "You",
            "notify.someone": "Someone",
            "reminder.starts_in": "Starts in",
            "reminder.now": "Now!",
            "reminder.join": "Join",
            "reminder.dismiss": "Dismiss",
            "teams.teams": "Teams",
            "teams.team_settings": "Team Settings",
            "teams.channels": "Channels",
            "teams.members_tab": "Members",
            "teams.files": "Files",
            "teams.add_member": "Add Member",
            "teams.remove_member": "Remove",
            "teams.remove_confirm": "Remove this member?",
            "teams.search_users": "Search users to add...",
            "teams.no_channels": "No channels in this team",
            "teams.no_members": "No members",
            "teams.no_files": "No files in this team",
            "teams.leave_team": "Leave Team",
            "teams.leave_confirm": "Leave this team?",
            "teams.member_added": "Member added",
            "teams.member_removed": "Member removed",
            "chat.cancel": "Cancel",
            "chat.create": "Create"
        ]

        // German
        translations["de"] = [
            "login.title": "Anmelden",
            "login.server_url": "Server-URL:",
            "login.username": "Benutzername:",
            "login.password": "Passwort:",
            "login.submit": "Anmelden",
            "login.submitting": "Anmeldung...",
            "login.error": "Anmeldung fehlgeschlagen",
            "login.fill_fields": "Bitte alle Felder ausfuellen.",
            "welcome.title": "Willkommen bei Agora",
            "welcome.subtitle": "Waehle einen Chat aus der Liste",
            "chat.chats": "Chats",
            "chat.members": "Mitglieder",
            "chat.send": "Senden",
            "chat.input_placeholder": "Nachricht eingeben...",
            "chat.typing_one": "tippt...",
            "chat.typing_many": "tippen...",
            "chat.edited": "(bearbeitet)",
            "chat.file_sent": "Datei gesendet",
            "chat.system": "System",
            "chat.file": "Datei",
            "notify.reacted": "hat reagiert",
            "notify.reaction_body": "auf eine Nachricht",
            "notify.incoming_call": "Eingehender Anruf",
            "notify.calling": "ruft an...",
            "status.online": "Online",
            "common.error": "Fehler",
            "common.user": "Benutzer",
            "common.you": "Du",
            "notify.someone": "Jemand",
            "reminder.starts_in": "Beginnt in",
            "reminder.now": "Jetzt!",
            "reminder.join": "Beitreten",
            "reminder.dismiss": "Schliessen",
            "teams.teams": "Teams",
            "teams.team_settings": "Team-Einstellungen",
            "teams.channels": "Kanaele",
            "teams.members_tab": "Mitglieder",
            "teams.files": "Dateien",
            "teams.add_member": "Mitglied hinzufuegen",
            "teams.remove_member": "Entfernen",
            "teams.remove_confirm": "Dieses Mitglied entfernen?",
            "teams.search_users": "Benutzer suchen...",
            "teams.no_channels": "Keine Kanaele in diesem Team",
            "teams.no_members": "Keine Mitglieder",
            "teams.no_files": "Keine Dateien in diesem Team",
            "teams.leave_team": "Team verlassen",
            "teams.leave_confirm": "Dieses Team verlassen?",
            "teams.member_added": "Mitglied hinzugefuegt",
            "teams.member_removed": "Mitglied entfernt",
            "chat.cancel": "Abbrechen",
            "chat.create": "Erstellen"
        ]

        // French
        translations["fr"] = [
            "login.title": "Se connecter",
            "login.server_url": "URL du serveur :",
            "login.username": "Nom d'utilisateur :",
            "login.password": "Mot de passe :",
            "login.submit": "Se connecter",
            "login.submitting": "Connexion...",
            "login.error": "\u{00C9}chec de la connexion",
            "login.fill_fields": "Veuillez remplir tous les champs.",
            "welcome.title": "Bienvenue sur Agora",
            "welcome.subtitle": "S\u{00E9}lectionnez un chat dans la liste",
            "chat.chats": "Chats",
            "chat.members": "membres",
            "chat.send": "Envoyer",
            "chat.input_placeholder": "\u{00C9}crire un message...",
            "chat.typing_one": "\u{00E9}crit...",
            "chat.typing_many": "\u{00E9}crivent...",
            "chat.edited": "(modifi\u{00E9})",
            "chat.file_sent": "Fichier envoy\u{00E9}",
            "notify.reacted": "a r\u{00E9}agi",
            "notify.reaction_body": "sur un message",
            "status.online": "En ligne",
            "common.error": "Erreur",
            "common.user": "Utilisateur",
            "common.you": "Toi",
            "notify.someone": "Quelqu'un",
            "reminder.starts_in": "Commence dans",
            "reminder.now": "Maintenant !",
            "reminder.join": "Rejoindre",
            "reminder.dismiss": "Fermer"
        ]

        // Spanish
        translations["es"] = [
            "login.title": "Iniciar sesi\u{00F3}n",
            "login.server_url": "URL del servidor:",
            "login.username": "Nombre de usuario:",
            "login.password": "Contrase\u{00F1}a:",
            "login.submit": "Iniciar sesi\u{00F3}n",
            "login.submitting": "Iniciando sesi\u{00F3}n...",
            "login.error": "Error de inicio de sesi\u{00F3}n",
            "welcome.title": "Bienvenido a Agora",
            "welcome.subtitle": "Seleccione un chat de la lista",
            "chat.chats": "Chats",
            "chat.members": "miembros",
            "chat.send": "Enviar",
            "chat.input_placeholder": "Escribe un mensaje...",
            "chat.typing_one": "est\u{00E1} escribiendo...",
            "chat.typing_many": "est\u{00E1}n escribiendo...",
            "chat.edited": "(editado)",
            "notify.reacted": "ha reaccionado",
            "notify.reaction_body": "a un mensaje",
            "status.online": "En l\u{00ED}nea",
            "common.error": "Error",
            "common.user": "Usuario",
            "common.you": "T\u{00FA}",
            "notify.someone": "Alguien",
            "reminder.starts_in": "Empieza en",
            "reminder.now": "\u{00A1}Ahora!",
            "reminder.join": "Unirse",
            "reminder.dismiss": "Cerrar"
        ]

        // Italian
        translations["it"] = [
            "login.title": "Accedi",
            "login.server_url": "URL del server:",
            "login.username": "Nome utente:",
            "login.password": "Password:",
            "login.submit": "Accedi",
            "login.submitting": "Accesso...",
            "login.error": "Accesso fallito",
            "welcome.title": "Benvenuto su Agora",
            "welcome.subtitle": "Seleziona una chat dalla lista",
            "chat.chats": "Chat",
            "chat.members": "membri",
            "chat.send": "Invia",
            "chat.input_placeholder": "Scrivi un messaggio...",
            "chat.typing_one": "sta scrivendo...",
            "chat.typing_many": "stanno scrivendo...",
            "chat.edited": "(modificato)",
            "notify.reacted": "ha reagito",
            "notify.reaction_body": "a un messaggio",
            "status.online": "Online",
            "common.error": "Errore",
            "common.user": "Utente",
            "common.you": "Tu",
            "notify.someone": "Qualcuno"
        ]

        // Dutch
        translations["nl"] = [
            "login.title": "Inloggen",
            "login.username": "Gebruikersnaam:",
            "login.password": "Wachtwoord:",
            "login.submit": "Inloggen",
            "login.submitting": "Inloggen...",
            "login.error": "Inloggen mislukt",
            "welcome.title": "Welkom bij Agora",
            "chat.chats": "Chats",
            "chat.members": "leden",
            "chat.send": "Verzenden",
            "chat.input_placeholder": "Typ een bericht...",
            "chat.typing_one": "is aan het typen...",
            "chat.typing_many": "zijn aan het typen...",
            "chat.edited": "(bewerkt)",
            "notify.reacted": "heeft gereageerd",
            "status.online": "Online",
            "common.error": "Fout",
            "common.user": "Gebruiker",
            "common.you": "Jij",
            "notify.someone": "Iemand"
        ]

        // Polish
        translations["pl"] = [
            "login.title": "Zaloguj si\u{0119}",
            "login.submit": "Zaloguj",
            "login.submitting": "Logowanie...",
            "chat.send": "Wy\u{015B}lij",
            "chat.input_placeholder": "Napisz wiadomo\u{015B}\u{0107}...",
            "chat.typing_one": "pisze...",
            "chat.typing_many": "pisz\u{0105}...",
            "chat.edited": "(edytowano)",
            "common.error": "B\u{0142}\u{0105}d"
        ]

        // Portuguese
        translations["pt"] = [
            "login.title": "Iniciar sess\u{00E3}o",
            "login.submit": "Entrar",
            "login.submitting": "A entrar...",
            "chat.send": "Enviar",
            "chat.input_placeholder": "Escreva uma mensagem...",
            "chat.edited": "(editado)",
            "common.error": "Erro"
        ]

        // Swedish
        translations["sv"] = [
            "login.title": "Logga in",
            "login.username": "Anv\u{00E4}ndarnamn:",
            "login.password": "L\u{00F6}senord:",
            "login.submit": "Logga in",
            "login.submitting": "Loggar in...",
            "chat.send": "Skicka",
            "chat.input_placeholder": "Skriv ett meddelande...",
            "chat.edited": "(redigerad)",
            "common.error": "Fel"
        ]

        // Danish
        translations["da"] = [
            "login.title": "Log ind",
            "login.username": "Brugernavn:",
            "login.password": "Adgangskode:",
            "login.submit": "Log ind",
            "chat.send": "Send",
            "chat.edited": "(redigeret)",
            "common.error": "Fejl"
        ]

        // Finnish
        translations["fi"] = [
            "login.title": "Kirjaudu sis\u{00E4}\u{00E4}n",
            "login.username": "K\u{00E4}ytt\u{00E4}j\u{00E4}nimi:",
            "login.password": "Salasana:",
            "login.submit": "Kirjaudu",
            "chat.send": "L\u{00E4}het\u{00E4}",
            "chat.edited": "(muokattu)",
            "common.error": "Virhe"
        ]

        // Czech
        translations["cs"] = [
            "login.title": "P\u{0159}ihl\u{00E1}\u{0161}en\u{00ED}",
            "login.username": "U\u{017E}ivatelsk\u{00E9} jm\u{00E9}no:",
            "login.password": "Heslo:",
            "login.submit": "P\u{0159}ihl\u{00E1}sit",
            "chat.send": "Odeslat",
            "chat.edited": "(upraveno)",
            "common.error": "Chyba"
        ]

        // Hungarian
        translations["hu"] = [
            "login.title": "Bejelentkez\u{00E9}s",
            "login.username": "Felhaszn\u{00E1}l\u{00F3}n\u{00E9}v:",
            "login.password": "Jelsz\u{00F3}:",
            "login.submit": "Bel\u{00E9}p\u{00E9}s",
            "chat.send": "K\u{00FC}ld\u{00E9}s",
            "chat.edited": "(szerkesztve)",
            "common.error": "Hiba"
        ]

        // Romanian
        translations["ro"] = [
            "login.title": "Conectare",
            "login.username": "Nume de utilizator:",
            "login.password": "Parol\u{0103}:",
            "login.submit": "Conectare",
            "chat.send": "Trimite",
            "chat.edited": "(editat)",
            "common.error": "Eroare"
        ]
    }
}

// Global convenience function
func T(_ key: String) -> String {
    return Translations.shared.t(key)
}
