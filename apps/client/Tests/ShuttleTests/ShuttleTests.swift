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
func buildsCodexCLICandidatesFromEnvironmentWithoutDuplicates() {
    let candidates = CodexRuntimeLocator.cliCandidateURLs(environment: [
        "PATH": "/opt/homebrew/bin:/usr/local/bin",
        "SHUTTLE_CODEX_PATH": "/custom/codex",
    ])

    #expect(candidates.first?.path == "/custom/codex")
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
    #expect(image.size.width == 520)
    #expect(image.size.height > 500)
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

    companion.stop()
    for _ in 0..<50 where companion.status != .stopped {
        try await Task.sleep(for: .milliseconds(10))
    }

    #expect(companion.status == .stopped)
}
