import AppKit
import Foundation
import SwiftUI
import Testing
@testable import Shuttle

@Test
func resolvesNodeInsideCodexBundle() {
    let applicationURL = URL(fileURLWithPath: "/Applications/Codex.app")

    #expect(
        CodexRuntimeLocator.nodeURL(in: applicationURL).path
            == "/Applications/Codex.app/Contents/Resources/cua_node/bin/node"
    )
}

@Test
func resolvesCLIInsideCodexBundle() {
    let applicationURL = URL(fileURLWithPath: "/Applications/Codex.app")

    #expect(
        CodexRuntimeLocator.cliURL(in: applicationURL).path
            == "/Applications/Codex.app/Contents/Resources/codex"
    )
}

@Test
func buildsCodexCLICandidatesFromEnvironmentWithoutDuplicates() {
    let candidates = CodexRuntimeLocator.cliCandidateURLs(environment: [
        "PATH": "/opt/homebrew/bin:/usr/local/bin",
        "SHUTTLE_CODEX_PATH": "/custom/codex",
    ], applicationURL: URL(fileURLWithPath: "/Applications/Codex.app"))

    #expect(candidates.first?.path == "/custom/codex")
    #expect(candidates[1].path == "/Applications/Codex.app/Contents/Resources/codex")
    #expect(candidates.filter { $0.path == "/opt/homebrew/bin/codex" }.count == 1)
}

@Test
func recognizesInstalledShuttlePluginAndMarketplace() throws {
    let plugins = Data(#"{"installed":[{"enabled":true,"installed":true,"name":"shuttle"}]}"#.utf8)
    let marketplaces = Data(#"{"marketplaces":[{"name":"shuttle"}]}"#.utf8)

    #expect(try CodexPluginInstaller.isShuttleReady(in: plugins))
    #expect(try CodexPluginInstaller.hasShuttleMarketplace(in: marketplaces))
}

@Test
func resolvesBundledCompanionScript() {
    let resourceURL = URL(fileURLWithPath: "/Applications/Shuttle.app/Contents/Resources")

    #expect(
        CompanionScriptLocator.bundledURL(in: resourceURL).path
            == "/Applications/Shuttle.app/Contents/Resources/companion/cli.mjs"
    )
}

@Test
func persistsRelayCredentialsWithOwnerOnlyPermissions() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
        .appending(path: "shuttle-credentials-\(UUID().uuidString)")
    let fileURL = temporaryDirectory
        .appending(path: "config", directoryHint: .isDirectory)
        .appending(path: "credentials.json")
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    let relayURL = try #require(URL(string: "https://shuttle.example"))
    let credentials = RelayCredentials(
        relayURL: relayURL,
        deviceToken: "test-device-token"
    )

    try RelayCredentialStore.save(credentials, to: fileURL)

    #expect(RelayCredentialStore.load(from: fileURL) == credentials)
    let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
    let permissions = try #require(attributes[.posixPermissions] as? NSNumber)
    #expect(permissions.intValue & 0o777 == 0o600)
    let directoryAttributes = try FileManager.default.attributesOfItem(
        atPath: fileURL.deletingLastPathComponent().path
    )
    let directoryPermissions = try #require(
        directoryAttributes[.posixPermissions] as? NSNumber
    )
    #expect(directoryPermissions.intValue & 0o777 == 0o700)

    RelayCredentialStore.delete(at: fileURL)
    #expect(!FileManager.default.fileExists(atPath: fileURL.path))
}

@Test
func decodesTaskShareWithLocalServices() throws {
    let data = Data(#"{"id":"authorization-1","resource":"thread","services":[{"localURL":"http://localhost:3000","name":"Web app"}],"title":"Review app","type":"authorization-request"}"#.utf8)

    let request = try #require(JSONDecoder().decode(CompanionEvent.self, from: data).authorizationRequest)

    #expect(request.title == "Review app")
    #expect(request.services.count == 1)
    #expect(request.services[0].name == "Web app")
    #expect(request.services[0].localURL == "http://localhost:3000")
}

@Test
func decodesAuthorizationResultSharedThreadID() throws {
    let data = Data(#"{"id":"authorization-1","inviteURL":"https://shuttle.example/invite","sharedThreadId":"thread-1","type":"authorization-result"}"#.utf8)

    let event = try JSONDecoder().decode(CompanionEvent.self, from: data)

    #expect(event.sharedThreadId == "thread-1")
}

@Test
func encodesMultiRecipientAuthorization() throws {
    let decision = ShareAuthorizationDecision(
        approved: true, canPreview: true,
        emails: ["alex@example.com", "maya@example.com"],
        expiresInHours: 0, permission: .message, singleUse: false
    )
    let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(decision)) as? [String: Any])
    #expect(object["emails"] as? [String] == ["alex@example.com", "maya@example.com"])
    #expect(object["expiresInHours"] as? Int == 0)
    #expect(object["singleUse"] as? Bool == false)
}

@Test @MainActor
func searchesRecipientsAndIgnoresStaleResponses() async throws {
    let recipients = ShareRecipients()
    var searched: [String] = []
    recipients.search = { searched.append($0) }
    recipients.find("al")
    #expect(recipients.isSearching)
    recipients.find("alex")
    for _ in 0..<100 {
        if !searched.isEmpty { break }
        try await Task.sleep(for: .milliseconds(10))
    }
    #expect(searched == ["alex"])
    recipients.receive(query: "al", users: [ShareRecipientUser(email: "wrong@example.com", name: "Wrong")], error: nil)
    #expect(recipients.users.isEmpty)
    #expect(recipients.isSearching)
    recipients.receive(query: "alex", users: [ShareRecipientUser(email: "alex@example.com", name: "Alex")], error: nil)
    #expect(recipients.users.first?.email == "alex@example.com")
    #expect(!recipients.isSearching)
    recipients.find("")
    #expect(recipients.users.isEmpty)
    #expect(!recipients.isSearching)
}

@Test @MainActor
func rendersShareAuthorizationView() throws {
    let request = ShareAuthorizationRequest(
        id: "authorization-preview",
        services: [
            SharedLocalService(
                localURL: "http://localhost:3000",
                name: "Local web app"
            ),
        ],
        title: "Review checkout flow"
    )
    let renderer = ImageRenderer(content: ShareAuthorizationView(
        request: request,
        onCancel: {},
        onApprove: { _ in }
    ))
    renderer.scale = 2
    let image = try #require(renderer.nsImage)
    #expect(image.size.width == 460)
    #expect(image.size.height > 350 && image.size.height < 540)
}

@Test @MainActor
func rendersShareResultAtFixedWidth() throws {
    let renderer = ImageRenderer(content: ShareAuthorizationResultView(
        error: nil,
        inviteURL: "https://shuttle.makesth.fun/app/invite#shuttle_invite_" + String(repeating: "a", count: 43),
        sharedThreadId: "00000000-0000-4000-8000-000000000000",
        onDone: {}
    ))
    let image = try #require(renderer.nsImage)
    #expect(image.size.width == 460)
    #expect(image.size.height > 300 && image.size.height < 600)
}

@Test @MainActor
func keepsShareFormDuringSubmissionAndFailure() throws {
    let submission = ShareSubmission()
    let view = ShareAuthorizationView(
        request: ShareAuthorizationRequest(id: "test", services: [], title: "Retain this task"),
        submission: submission,
        onCancel: {}, onApprove: { _ in }
    )
    let initial = try #require(ImageRenderer(content: view).nsImage)
    submission.isSubmitting = true
    let pending = try #require(ImageRenderer(content: view).nsImage)
    #expect(pending.size == initial.size)
    submission.isSubmitting = false
    submission.error = "发送失败，请重试。"
    let failed = try #require(ImageRenderer(content: view).nsImage)
    #expect(failed.size.width == initial.size.width)
    #expect(failed.size.height > initial.size.height)
}

@Test @MainActor
func rendersOnboardingView() throws {
    let companion = CompanionController(
        nodeURL: nil,
        scriptURL: nil,
        credentials: nil
    )
    let controller = OnboardingController(
        companion: companion,
        relayLogin: RelayLoginController()
    )
    let renderer = ImageRenderer(content: OnboardingView(controller: controller))
    renderer.scale = 2
    let image = try #require(renderer.nsImage)

    #expect(image.size.width == 560)
    #expect(image.size.height >= 300)
}

@Test @MainActor
func startsAndStopsCompanionProcess() async throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
        .appending(path: "shuttle-client-\(UUID().uuidString)")
    let scriptURL = temporaryDirectory.appending(path: "companion.sh")
    try FileManager.default.createDirectory(
        at: temporaryDirectory,
        withIntermediateDirectories: true
    )
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try "#!/bin/sh\nread request\n".write(to: scriptURL, atomically: true, encoding: .utf8)
    let relayURL = try #require(URL(string: "http://localhost:8787"))

    let companion = CompanionController(
        nodeURL: URL(fileURLWithPath: "/bin/sh"),
        scriptURL: scriptURL,
        credentials: RelayCredentials(
            relayURL: relayURL,
            deviceToken: "test-device-token"
        )
    )
    companion.start()
    #expect(companion.isRunning)

    companion.stopImmediately()
    #expect(companion.status == .stopped)
}

@Test @MainActor
func restartsCompanionAfterUnexpectedExit() async throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
        .appending(path: "shuttle-client-restart-\(UUID().uuidString)")
    let scriptURL = temporaryDirectory.appending(path: "companion.sh")
    let markerURL = temporaryDirectory.appending(path: "started-once")
    try FileManager.default.createDirectory(
        at: temporaryDirectory,
        withIntermediateDirectories: true
    )
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try """
    #!/bin/sh
    marker="\(markerURL.path)"
    if [ ! -f "$marker" ]; then
      touch "$marker"
      exit 1
    fi
    read request
    """.write(to: scriptURL, atomically: true, encoding: .utf8)
    let relayURL = try #require(URL(string: "http://localhost:8787"))

    let companion = CompanionController(
        nodeURL: URL(fileURLWithPath: "/bin/sh"),
        scriptURL: scriptURL,
        credentials: RelayCredentials(
            relayURL: relayURL,
            deviceToken: "test-device-token"
        )
    )
    companion.start()
    let initialPID = try #require(runningPID(companion.status))
    defer { companion.stopImmediately() }

    var restartedPID: Int32?
    for _ in 0..<250 {
        if let currentPID = runningPID(companion.status), currentPID != initialPID {
            restartedPID = currentPID
            break
        }
        try await Task.sleep(for: .milliseconds(10))
    }

    #expect(restartedPID != nil)
}

private func runningPID(_ status: CompanionController.Status) -> Int32? {
    guard case let .running(processIdentifier) = status else { return nil }
    return processIdentifier
}

@Test @MainActor
func restartWaitsForOldCompanionAndRequiresReadyEvent() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appending(path: "shuttle-serialized-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let script = directory.appending(path: "companion.sh")
    try "echo '{\"type\":\"ready\"}'\nread request\n".write(to: script, atomically: true, encoding: .utf8)
    let companion = CompanionController(
        nodeURL: URL(fileURLWithPath: "/bin/sh"),
        scriptURL: script,
        credentials: RelayCredentials(
            relayURL: URL(string: "https://shuttle.example")!,
            deviceToken: "test-only"
        )
    )
    companion.start()
    defer { companion.stopImmediately() }
    #expect(!companion.isReady)
    let oldPID = try #require(runningPID(companion.status))
    for _ in 0..<100 {
        if companion.isReady { break }
        try await Task.sleep(for: .milliseconds(10))
    }
    #expect(companion.isReady)
    companion.stopImmediately()
    companion.start()
    #expect(companion.status == .stopped)
    #expect(!companion.isReady)
    for _ in 0..<250 {
        if companion.isReady { break }
        try await Task.sleep(for: .milliseconds(10))
    }
    #expect(companion.isReady)
    #expect(runningPID(companion.status) != oldPID)
    #expect(kill(oldPID, 0) == -1)
}
