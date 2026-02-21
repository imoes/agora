using System;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using AgoraWindows.Services;

namespace AgoraWindows.Views;

public partial class LoginWindow : Window
{
    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Agora", "login_settings.json");

    public LoginWindow()
    {
        InitializeComponent();
        ApplyTranslations();
        LoadSavedSettings();
        UsernameBox.Focus();
    }

    private void ApplyTranslations()
    {
        Title = $"Agora - {Translations.T("login.title")}";
        ServerUrlLabel.Text = Translations.T("login.server_url");
        UsernameLabel.Text = Translations.T("login.username");
        PasswordLabel.Text = Translations.T("login.password");
        RememberCheckBox.Content = Translations.T("login.remember");
        LoginButton.Content = Translations.T("login.submit");
    }

    private void LoadSavedSettings()
    {
        try
        {
            if (!File.Exists(SettingsPath)) return;
            var json = File.ReadAllText(SettingsPath);
            var settings = JsonSerializer.Deserialize<LoginSettings>(json);
            if (settings == null) return;

            if (!string.IsNullOrEmpty(settings.ServerUrl))
                ServerUrlBox.Text = settings.ServerUrl;
            if (!string.IsNullOrEmpty(settings.Username))
                UsernameBox.Text = settings.Username;
            if (!string.IsNullOrEmpty(settings.Password))
                PasswordBox.Password = settings.Password;
            RememberCheckBox.IsChecked = settings.RememberCredentials;
        }
        catch { }
    }

    private void SaveSettings(string serverUrl, string username, string password)
    {
        try
        {
            var dir = Path.GetDirectoryName(SettingsPath)!;
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

            var settings = new LoginSettings
            {
                ServerUrl = serverUrl,
                RememberCredentials = RememberCheckBox.IsChecked == true,
                Username = RememberCheckBox.IsChecked == true ? username : "",
                Password = RememberCheckBox.IsChecked == true ? password : "",
            };
            var json = JsonSerializer.Serialize(settings);
            File.WriteAllText(SettingsPath, json);
        }
        catch { }
    }

    private async void LoginButton_Click(object sender, RoutedEventArgs e)
    {
        await PerformLogin();
    }

    private async void PasswordBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            await PerformLogin();
        }
    }

    private async System.Threading.Tasks.Task PerformLogin()
    {
        var serverUrl = ServerUrlBox.Text.Trim();
        var username = UsernameBox.Text.Trim();
        var password = PasswordBox.Password;

        if (string.IsNullOrEmpty(serverUrl) || string.IsNullOrEmpty(username) ||
            string.IsNullOrEmpty(password))
        {
            ShowError(Translations.T("login.fill_fields"));
            return;
        }

        LoginButton.IsEnabled = false;
        LoginButton.Content = Translations.T("login.submitting");
        HideError();

        try
        {
            var apiClient = new ApiClient(serverUrl);
            var loginResult = await apiClient.LoginAsync(username, password);

            // Save settings (always save URL, credentials only if checkbox checked)
            SaveSettings(serverUrl, username, password);

            // Initialize language from user profile
            Translations.InitFromUser(loginResult.User?.Language);

            var mainWindow = new MainWindow(apiClient);
            mainWindow.Show();
            Close();
        }
        catch (Exception ex)
        {
            ShowError($"{Translations.T("login.error")}: {ex.Message}");
        }
        finally
        {
            LoginButton.IsEnabled = true;
            LoginButton.Content = Translations.T("login.submit");
        }
    }

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        ErrorText.Visibility = Visibility.Visible;
    }

    private void HideError()
    {
        ErrorText.Visibility = Visibility.Collapsed;
    }

    private class LoginSettings
    {
        public string ServerUrl { get; set; } = "";
        public string Username { get; set; } = "";
        public string Password { get; set; } = "";
        public bool RememberCredentials { get; set; }
    }
}
