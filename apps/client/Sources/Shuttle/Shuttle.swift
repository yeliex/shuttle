import AppKit
import ServiceManagement
import Sparkle
import SwiftUI

@MainActor
final class ShuttleAppDelegate: NSObject, NSApplicationDelegate {
    static let isAuthorizationPreview = Bundle.main.object(forInfoDictionaryKey: "ShuttleAuthorizationPreview") as? Bool == true
    private var previewPresenter: AuthorizationWindowPresenter?
    var onReopen: (() -> Void)?
    var onTerminate: (() -> Void)?

    func applicationWillTerminate(_ notification: Notification) { onTerminate?() }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if Self.isAuthorizationPreview {
            previewPresenter?.presentPreview()
            return false
        }
        onReopen?()
        return false
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if Self.isAuthorizationPreview {
            // 独立预览包不读取账户、不启动 Companion，也不占用正式应用的 socket。
            NSApp.setActivationPolicy(.accessory)
            NSApp.applicationIconImage = ShuttleIcon.application
            guard ProcessInfo.processInfo.environment["SHUTTLE_LAUNCH_CHECK"] != "1" else { return }
            previewPresenter = AuthorizationWindowPresenter()
            previewPresenter?.presentPreview()
            return
        }
        // Shuttle is intentionally a menu-bar utility; authorization uses a focused auxiliary window.
        NSApp.setActivationPolicy(.accessory)
        NSApp.applicationIconImage = ShuttleIcon.application
    }
}

@main
@MainActor
struct ShuttleApp: App {
    @NSApplicationDelegateAdaptor(ShuttleAppDelegate.self) private var appDelegate
    @State private var companion: CompanionController
    @State private var onboarding: OnboardingController
    private let updater = SPUStandardUpdaterController(
        startingUpdater: ProcessInfo.processInfo.environment["SHUTTLE_LAUNCH_CHECK"] != "1"
            && !ShuttleAppDelegate.isAuthorizationPreview,
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
            if ShuttleAppDelegate.isAuthorizationPreview {
                Button("Quit Preview") { NSApp.terminate(nil) }
            } else {
                ShuttleMenu(
                    companion: companion,
                    onboarding: onboarding,
                    checkForUpdates: { updater.checkForUpdates(nil) }
                )
            }
        } label: {
            ShuttleMenuBarLabel(
                companion: companion,
                onboarding: onboarding,
                appDelegate: appDelegate
            )
        }


    }
}

private struct ShuttleMenuBarLabel: View {

    let companion: CompanionController
    let onboarding: OnboardingController
    let appDelegate: ShuttleAppDelegate

    var body: some View {
        Image(nsImage: ShuttleIcon.menuBar)
            .task {
                // Packaging probes must not read credentials or start a second live Companion.
                guard ProcessInfo.processInfo.environment["SHUTTLE_LAUNCH_CHECK"] != "1",
                      !ShuttleAppDelegate.isAuthorizationPreview else { return }
                if !NSRunningApplication.current.isFinishedLaunching {
                    for await _ in NotificationCenter.default.notifications(
                        named: NSApplication.didFinishLaunchingNotification
                    ) {
                        break
                    }
                }
                companion.loadStoredCredentials()
                appDelegate.onTerminate = { companion.stopImmediately() }
                appDelegate.onReopen = {
                    companion.recoverIfNeeded()
                    onboarding.present()
                    Task { await onboarding.refreshPluginStatus() }
                }
                if await onboarding.checkOnLaunch() {
                    onboarding.present()
                }
            }
    }
}

private struct ShuttleMenu: View {
    @State private var launchAtLoginEnabled = LaunchAtLoginService.isActive

    let companion: CompanionController
    let onboarding: OnboardingController
    let checkForUpdates: () -> Void

    var body: some View {
        Text(companion.statusText)

        Button("Set Up Shuttle…") {
            companion.recoverIfNeeded()
            onboarding.present()
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

        Toggle("Launch at Login", isOn: Binding(
            get: { launchAtLoginEnabled },
            set: { enabled in
                do {
                    try LaunchAtLoginService.setEnabled(enabled)
                } catch {
                    NSSound.beep()
                }
                launchAtLoginEnabled = LaunchAtLoginService.isActive
            }
        ))
        .onAppear {
            launchAtLoginEnabled = LaunchAtLoginService.isActive
        }

        Button("Check for Updates…", action: checkForUpdates)

        Button("Quit Shuttle") {
            companion.stopImmediately()
            NSApplication.shared.terminate(nil)
        }
    }
}

private enum LaunchAtLoginService {
    static var isActive: Bool {
        let status = SMAppService.mainApp.status
        return status == .enabled || status == .requiresApproval
    }

    static func setEnabled(_ enabled: Bool) throws {
        let service = SMAppService.mainApp
        if enabled, !isActive {
            try service.register()
        } else if !enabled, isActive {
            try service.unregister()
        }
    }
}
