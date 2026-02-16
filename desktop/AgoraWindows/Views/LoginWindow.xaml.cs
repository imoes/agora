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
        UsernameBox.Focus();
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
            ShowError("Please fill in all fields.");
            return;
        }

        LoginButton.IsEnabled = false;
        LoginButton.Content = "Signing in...";
        HideError();

        try
        {
            var apiClient = new ApiClient(serverUrl);
            await apiClient.LoginAsync(username, password);

            var mainWindow = new MainWindow(apiClient);
            mainWindow.Show();
            Close();
        }
        catch (Exception ex)
        {
            ShowError($"Login failed: {ex.Message}");
        }
        finally
        {
            LoginButton.IsEnabled = true;
            LoginButton.Content = "Sign in";
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
