import AppKit
import AuthenticationServices
import Foundation
import Observation

@MainActor
@Observable
final class RelayLoginController: NSObject, ASWebAuthenticationPresentationContextProviding {
    private(set) var isConnecting = false
    private(set) var errorMessage: String?

    private var authenticationSession: ASWebAuthenticationSession?
    private let presentationWindow = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
        styleMask: [.titled],
        backing: .buffered,
        defer: false
    )

    func connect(
        currentRelayURL: URL?,
        completion: @escaping @MainActor @Sendable (RelayCredentials) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Connect a Shuttle Relay"
        alert.informativeText = "Enter the public URL of the Relay you want this Mac to use."
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        let relayField = NSTextField(
            string: currentRelayURL?.absoluteString
                ?? ProcessInfo.processInfo.environment["SHUTTLE_RELAY_URL"]
                ?? "https://shuttle.makesth.fun"
        )
        relayField.placeholderString = "https://shuttle.example.com"
        relayField.frame = NSRect(x: 0, y: 0, width: 360, height: 24)
        alert.accessoryView = relayField
        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }

        let value = relayField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let relayURL = URL(string: value),
              relayURL.scheme == "http" || relayURL.scheme == "https",
              relayURL.host != nil else {
            errorMessage = "Relay URL must be an HTTP or HTTPS URL"
            return
        }

        var components = URLComponents(
            url: relayURL.appending(path: "app/device-connect"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "callback", value: "shuttle://device-connected"),
            URLQueryItem(name: "name", value: Host.current().localizedName ?? "This Mac"),
        ]
        guard let authorizationURL = components?.url else {
            errorMessage = "Unable to create the Relay authorization URL"
            return
        }

        errorMessage = nil
        isConnecting = true
        // AuthenticationServices completes on Safari's XPC queue, so this closure must not inherit MainActor isolation.
        let session = ASWebAuthenticationSession(
            url: authorizationURL,
            callbackURLScheme: "shuttle"
        ) { @Sendable [weak self] callbackURL, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isConnecting = false
                self.authenticationSession = nil
                if let error {
                    if (error as? ASWebAuthenticationSessionError)?.code
                        != .canceledLogin {
                        self.errorMessage = error.localizedDescription
                    }
                    return
                }
                guard let callbackURL,
                      let callback = URLComponents(
                        url: callbackURL,
                        resolvingAgainstBaseURL: false
                      ),
                      let token = callback.queryItems?.first(
                        where: { $0.name == "token" }
                      )?.value,
                      let returnedRelay = callback.queryItems?.first(
                        where: { $0.name == "relay" }
                      )?.value,
                      let returnedRelayURL = URL(string: returnedRelay),
                      returnedRelayURL.origin == relayURL.origin else {
                    self.errorMessage = "Relay returned an invalid device credential"
                    return
                }
                completion(RelayCredentials(
                    relayURL: returnedRelayURL,
                    deviceToken: token
                ))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session
        if !session.start() {
            isConnecting = false
            authenticationSession = nil
            errorMessage = "Unable to start the system sign-in session"
        }
    }

    func presentationAnchor(
        for session: ASWebAuthenticationSession
    ) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow ?? presentationWindow
    }
}

private extension URL {
    var origin: String? {
        guard let scheme, let host else { return nil }
        if let port {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }
}
