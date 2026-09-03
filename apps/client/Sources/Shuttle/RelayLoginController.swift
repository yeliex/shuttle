import AppKit
import AuthenticationServices
import Foundation
import Observation

enum RelayLoginOutcome {
    case connected(RelayCredentials)
    case cancelled
    case failed(String)
}

enum RelaySelectionOutcome {
    case selected(URL)
    case cancelled
    case failed(String)
}

@MainActor
@Observable
final class RelayLoginController: NSObject, ASWebAuthenticationPresentationContextProviding {
    private(set) var isConnecting = false
    private(set) var errorMessage: String?

    private var authenticationSession: ASWebAuthenticationSession?
    @ObservationIgnored
    private lazy var presentationWindow = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
        styleMask: [.titled],
        backing: .buffered,
        defer: false
    )

    func selectRelay(
        currentRelayURL: URL?,
        completion: @escaping @MainActor @Sendable (RelaySelectionOutcome) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Choose a Shuttle Relay"
        alert.informativeText = "Enter the public URL of the Relay you want this Mac to use."
        alert.addButton(withTitle: "Save")
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
            completion(.cancelled)
            return
        }

        let value = relayField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let relayURL = URL(string: value),
              relayURL.scheme == "http" || relayURL.scheme == "https",
              relayURL.host != nil else {
            let message = "Relay URL must be an HTTP or HTTPS URL"
            errorMessage = message
            completion(.failed(message))
            return
        }

        errorMessage = nil
        completion(.selected(relayURL))
    }

    func connect(
        to relayURL: URL,
        completion: @escaping @MainActor @Sendable (RelayLoginOutcome) -> Void
    ) {
        guard relayURL.scheme == "http" || relayURL.scheme == "https",
              relayURL.host != nil else {
            fail("Relay URL must be an HTTP or HTTPS URL", completion: completion)
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
            fail("Unable to create the Relay authorization URL", completion: completion)
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
                        == .canceledLogin {
                        completion(.cancelled)
                    } else {
                        self.fail(error.localizedDescription, completion: completion)
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
                      returnedRelayURL.shuttleOrigin == relayURL.shuttleOrigin else {
                    self.fail(
                        "Relay returned an invalid device credential",
                        completion: completion
                    )
                    return
                }
                completion(.connected(RelayCredentials(
                    relayURL: returnedRelayURL,
                    deviceToken: token
                )))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session
        if !session.start() {
            isConnecting = false
            authenticationSession = nil
            fail("Unable to start the system sign-in session", completion: completion)
        }
    }

    func presentationAnchor(
        for session: ASWebAuthenticationSession
    ) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow ?? presentationWindow
    }
}

extension URL {
    var shuttleOrigin: String? {
        guard let scheme, let host else { return nil }
        if let port {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }
}

private extension RelayLoginController {
    func fail(
        _ message: String,
        completion: @escaping @MainActor @Sendable (RelayLoginOutcome) -> Void
    ) {
        errorMessage = message
        completion(.failed(message))
    }
}
