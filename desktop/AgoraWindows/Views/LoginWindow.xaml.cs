using System;
using System.Windows;
using System.Windows.Input;
using AgoraWindows.Services;

namespace AgoraWindows.Views;

public partial class LoginWindow : Window
{
    public LoginWindow()
    {
        InitializeComponent();
        ApplyTranslations();
        UsernameBox.Focus();
    }

    private void ApplyTranslations()
    {
        Title = $"Agora - {Translations.T("login.title")}";
        ServerUrlLabel.Text = Translations.T("login.server_url");
        UsernameLabel.Text = Translations.T("login.username");
        PasswordLabel.Text = Translations.T("login.password");
        LoginButton.Content = Translations.T("login.submit");
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
}
