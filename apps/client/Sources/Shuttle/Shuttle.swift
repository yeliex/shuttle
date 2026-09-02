import AppKit
import Sparkle
import SwiftUI

@MainActor
final class ShuttleAppDelegate: NSObject, NSApplicationDelegate {
    private let pluginInstaller = CodexPluginInstaller()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Shuttle is intentionally a menu-bar utility; authorization uses a focused auxiliary window.
        NSApp.setActivationPolicy(.accessory)
        NSApp.applicationIconImage = ShuttleIcon.application
        Task {
            await pluginInstaller.checkOnLaunch()
        }
    }
}

@main
@MainActor
struct ShuttleApp: App {
    @NSApplicationDelegateAdaptor(ShuttleAppDelegate.self) private var appDelegate
    @State private var companion: CompanionController
    @State private var relayLogin = RelayLoginController()
    private let updater = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: nil,
        userDriverDelegate: nil
    )

    init() {
        let companion = CompanionController()
        _companion = State(initialValue: companion)
        companion.start()
    }

    var body: some Scene {
        MenuBarExtra {
            Text(companion.statusText)

            if companion.isConnected {
                if let relayURL = companion.relayURL {
                    Button("Open Shuttle Dashboard") {
                        NSWorkspace.shared.open(relayURL.appending(path: "app"))
                    }
                }

                if companion.isRunning {
                    Button("Stop Companion") {
                        companion.stop()
                    }
                } else {
                    Button("Start Companion") {
                        companion.start()
                    }
                    .disabled(!companion.canStart)
                }

                Button("Disconnect Relay…", role: .destructive) {
                    companion.disconnectRelay()
                }
            } else {
                Button("Connect Relay…") {
                    relayLogin.connect(currentRelayURL: companion.relayURL) { credentials in
                        do {
                            try companion.configure(credentials)
                        } catch {
                            let alert = NSAlert(error: error)
                            alert.runModal()
                        }
                    }
                }
                .disabled(relayLogin.isConnecting)
            }

            if let errorMessage = relayLogin.errorMessage {
                Text(errorMessage)
            }

            Divider()

            Button("Check for Updates…") {
                updater.checkForUpdates(nil)
            }

            Button("Quit Shuttle") {
                companion.stopImmediately()
                NSApplication.shared.terminate(nil)
            }
        } label: {
            Image(nsImage: ShuttleIcon.menuBar)
        }
    }
}
