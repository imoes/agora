import SwiftUI
import AppKit

// MARK: - App Delegate

class AgoraAppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?
    let appState = AppState()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let contentView = ContentView(appState: appState)

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window?.title = "Agora"
        window?.center()
        window?.contentView = NSHostingView(rootView: contentView)
        window?.makeKeyAndOrderFront(nil)
        window?.setFrameAutosaveName("AgoraMainWindow")

        // Set minimum size
        window?.minSize = NSSize(width: 700, height: 450)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        appState.logout()
    }
}

// MARK: - Root Content View

struct ContentView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        Group {
            if appState.isLoggedIn {
                MainView(appState: appState)
            } else {
                LoginView(appState: appState)
            }
        }
    }
}

// MARK: - App Entry Point

let app = NSApplication.shared
let delegate = AgoraAppDelegate()
app.delegate = delegate

// Set activation policy to regular (show in Dock)
app.setActivationPolicy(.regular)

// Create a basic menu bar
let mainMenu = NSMenu()

// Application menu
let appMenuItem = NSMenuItem()
mainMenu.addItem(appMenuItem)
let appMenu = NSMenu()
appMenuItem.submenu = appMenu
appMenu.addItem(withTitle: "About Agora", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
appMenu.addItem(NSMenuItem.separator())
appMenu.addItem(withTitle: "Quit Agora", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

// Edit menu (for copy/paste support)
let editMenuItem = NSMenuItem()
mainMenu.addItem(editMenuItem)
let editMenu = NSMenu(title: "Edit")
editMenuItem.submenu = editMenu
editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
editMenu.addItem(NSMenuItem.separator())
editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

// Window menu
let windowMenuItem = NSMenuItem()
mainMenu.addItem(windowMenuItem)
let windowMenu = NSMenu(title: "Window")
windowMenuItem.submenu = windowMenu
windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
windowMenu.addItem(NSMenuItem.separator())
windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

app.mainMenu = mainMenu

app.run()
