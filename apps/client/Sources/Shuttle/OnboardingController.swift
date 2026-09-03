import Foundation
import Observation

@MainActor
@Observable
final class OnboardingController {
    private(set) var isCheckingPlugin = false
    private(set) var isInstallingPlugin = false
    private(set) var isSigningIn = false
    private(set) var pluginErrorMessage: String?
    private(set) var relayErrorMessage: String?
    private(set) var pluginReady = false
    private(set) var selectedRelayURL: URL

    private let companion: CompanionController
    private let pluginInstaller: CodexPluginInstaller
    private let relayLogin: RelayLoginController
    private var didCheckOnLaunch = false

    init(
        companion: CompanionController,
        pluginInstaller: CodexPluginInstaller = CodexPluginInstaller(),
        relayLogin: RelayLoginController
    ) {
        self.companion = companion
        self.pluginInstaller = pluginInstaller
        self.relayLogin = relayLogin
        selectedRelayURL = companion.relayURL
            ?? URL(string: "https://shuttle.makesth.fun")!
    }

    var isSignedInToSelectedRelay: Bool {
        companion.relayURL?.shuttleOrigin == selectedRelayURL.shuttleOrigin
    }

    var companionIsConnected: Bool {
        companion.isConnected
    }

    func checkOnLaunch() async -> Bool {
        guard !didCheckOnLaunch else { return false }
        didCheckOnLaunch = true
        prepareForPresentation()
        await refreshPluginStatus()

        return !pluginReady || !companion.isConnected
    }

    func prepareForPresentation() {
        if let relayURL = companion.relayURL {
            selectedRelayURL = relayURL
        }
        pluginErrorMessage = nil
        relayErrorMessage = nil
    }

    func refreshPluginStatus() async {
        guard !isCheckingPlugin, !isInstallingPlugin else { return }
        isCheckingPlugin = true
        pluginErrorMessage = nil
        defer { isCheckingPlugin = false }
        do {
            pluginReady = try await pluginInstaller.isReady()
        } catch {
            pluginReady = false
            pluginErrorMessage = error.localizedDescription
        }
    }

    func installPlugin() {
        guard !isCheckingPlugin, !isInstallingPlugin else { return }
        pluginErrorMessage = nil
        Task {
            do {
                isInstallingPlugin = true
                defer { isInstallingPlugin = false }
                try await pluginInstaller.install()
                pluginReady = true
            } catch {
                pluginErrorMessage = error.localizedDescription
            }
        }
    }

    func selectRelay() {
        guard !isSigningIn else { return }
        relayErrorMessage = nil
        relayLogin.selectRelay(currentRelayURL: selectedRelayURL) { [weak self] outcome in
            guard let self else { return }
            switch outcome {
            case let .selected(relayURL):
                selectedRelayURL = relayURL
            case .cancelled:
                break
            case let .failed(message):
                relayErrorMessage = message
            }
        }
    }

    func signIn() {
        guard !isSigningIn else { return }
        relayErrorMessage = nil
        isSigningIn = true
        relayLogin.connect(to: selectedRelayURL, completion: handleLogin)
    }

    func relayDidDisconnect() {
        selectedRelayURL = URL(string: "https://shuttle.makesth.fun")!
        relayErrorMessage = nil
    }

    private func handleLogin(_ outcome: RelayLoginOutcome) {
        switch outcome {
        case let .connected(credentials):
            do {
                try companion.configure(credentials)
                selectedRelayURL = credentials.relayURL
            } catch {
                relayErrorMessage = error.localizedDescription
            }
        case .cancelled:
            break
        case let .failed(message):
            relayErrorMessage = message
        }
        isSigningIn = false
    }
}
