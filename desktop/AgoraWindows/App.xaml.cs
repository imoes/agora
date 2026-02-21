using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;

namespace AgoraWindows;

public partial class App : Application
{
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Agora", "agora-desktop.log");

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Ensure log directory exists
        Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);

        // Global exception handlers
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;

        Log("Application started");
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log($"UI Exception: {e.Exception}");
        e.Handled = true;

        MessageBox.Show(
            $"An error occurred: {e.Exception.Message}\n\nDetails have been logged to:\n{LogPath}",
            "Agora Error", MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        if (e.ExceptionObject is Exception ex)
            Log($"Unhandled Exception: {ex}");
    }

    private void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        Log($"Task Exception: {e.Exception}");
        e.SetObserved();
    }

    public static void Log(string message)
    {
        try
        {
            var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}\n";
            File.AppendAllText(LogPath, line);
        }
        catch
        {
            // Logging must never throw
        }
    }

    public static string LogFilePath => LogPath;
}
