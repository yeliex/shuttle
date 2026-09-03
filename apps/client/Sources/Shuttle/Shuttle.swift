import AppKit
import Sparkle
import SwiftUI

@MainActor
final class ShuttleAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Shuttle is intentionally a menu-bar utility; authorization uses a focused auxiliary window.
        NSApp.setActivationPolicy(.accessory)
        NSApp.applicationIconImage = ShuttleIcon.application
    }
}

enum ShuttleWindow {
    static let onboarding = "onboarding"
}

@main
@MainActor
struct ShuttleApp: App {
    @NSApplicationDelegateAdaptor(ShuttleAppDelegate.self) private var appDelegate
    @State private var companion: CompanionController
    @State private var onboarding: OnboardingController
    private let updater = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: nil,
        userDriverDelegate: nil
    )

    init() {
        let companion = CompanionController()
        let onboarding = OnboardingController(
            companion: companion,
            relayLogin: RelayLoginController()
        )
        _companion = State(initialValue: companion)
        _onboarding = State(initialValue: onboarding)
    }

    var body: some Scene {
        MenuBarExtra {
            ShuttleMenu(
                companion: companion,
                onboarding: onboarding,
                checkForUpdates: { updater.checkForUpdates(nil) }
            )
        } label: {
            ShuttleMenuBarLabel(
                companion: companion,
                onboarding: onboarding
            )
        }

        Window("Set up Shuttle", id: ShuttleWindow.onboarding) {
            OnboardingView(controller: onboarding)
        }
        .windowStyle(.plain)
        .windowLevel(.floating)
        .windowResizability(.contentSize)
        .defaultWindowPlacement { content, _ in
            WindowPlacement(size: content.sizeThatFits(.unspecified))
        }
        .defaultLaunchBehavior(.suppressed)
        .restorationBehavior(.disabled)
    }
}

private struct ShuttleMenuBarLabel: View {
    @Environment(\.openWindow) private var openWindow

    let companion: CompanionController
    let onboarding: OnboardingController

    var body: some View {
        Image(nsImage: ShuttleIcon.menuBar)
            .task {
                if !NSRunningApplication.current.isFinishedLaunching {
                    for await _ in NotificationCenter.default.notifications(
                        named: NSApplication.didFinishLaunchingNotification
                    ) {
                        break
                    }
                }
                companion.loadStoredCredentials()
                if await onboarding.checkOnLaunch() {
                    openWindow(id: ShuttleWindow.onboarding)
                }
            }
    }
}

private struct ShuttleMenu: View {
    @Environment(\.openWindow) private var openWindow

    let companion: CompanionController
    let onboarding: OnboardingController
    let checkForUpdates: () -> Void

    var body: some View {
        Text(companion.statusText)

        Button("Set Up Shuttle…") {
            onboarding.prepareForPresentation()
            openWindow(id: ShuttleWindow.onboarding)
            Task {
                await onboarding.refreshPluginStatus()
            }
        }

        if companion.isConnected {
            if let relayURL = companion.relayURL {
                Button("Open Shuttle Dashboard") {
                    NSWorkspace.shared.open(relayURL.appending(path: "app"))
                }
            }

            Button("Disconnect Relay…", role: .destructive) {
                companion.disconnectRelay()
                onboarding.relayDidDisconnect()
            }
        }

        Divider()

        Button("Check for Updates…", action: checkForUpdates)

        Button("Quit Shuttle") {
            companion.stopImmediately()
            NSApplication.shared.terminate(nil)
        }
    }
}
