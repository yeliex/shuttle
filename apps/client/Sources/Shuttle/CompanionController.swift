import Foundation
import Observation

enum CompanionScriptLocator {
    static func locate() -> URL? {
        if let configuredPath = ProcessInfo.processInfo.environment["SHUTTLE_COMPANION_PATH"] {
            let configuredURL = URL(fileURLWithPath: configuredPath)
            if FileManager.default.isReadableFile(atPath: configuredURL.path) {
                return configuredURL
            }
        }

        guard let resourceURL = Bundle.main.resourceURL else {
            return nil
        }

        let bundledURL = bundledURL(in: resourceURL)
        return FileManager.default.isReadableFile(atPath: bundledURL.path) ? bundledURL : nil
    }

    static func bundledURL(in resourceURL: URL) -> URL {
        resourceURL
            .appending(path: "companion")
            .appending(path: "cli.mjs")
    }
}

@MainActor
@Observable
final class CompanionController {
    enum Status: Equatable {
        case unavailable(String)
        case stopped
        case running(Int32)
        case stopping
        case failed(String)
    }

    private(set) var status: Status

    private var credentials: RelayCredentials?
    private let nodeURL: URL?
    private let scriptURL: URL?
    private let authorizationPresenter = AuthorizationWindowPresenter()
    private var inputHandle: FileHandle?
    private var outputBuffer = Data()
    private var outputHandle: FileHandle?
    private var process: Process?

    init(
        nodeURL: URL? = CodexRuntimeLocator.locateNode(),
        scriptURL: URL? = CompanionScriptLocator.locate(),
        credentials: RelayCredentials? = RelayCredentialStore.load()
    ) {
        self.nodeURL = nodeURL
        self.scriptURL = scriptURL
        self.credentials = credentials

        if nodeURL == nil {
            status = .unavailable("Codex Node runtime not found")
        } else if scriptURL == nil {
            status = .unavailable("Companion script not found")
        } else if credentials == nil {
            status = .unavailable("Connect a Relay to start")
        } else {
            status = .stopped
        }
    }

    var isRunning: Bool {
        switch status {
        case .running, .stopping:
            true
        default:
            false
        }
    }

    var canStart: Bool {
        nodeURL != nil && scriptURL != nil && credentials != nil && !isRunning
    }

    var relayURL: URL? {
        credentials?.relayURL
    }

    var isConnected: Bool {
        credentials != nil
    }

    var statusText: String {
        switch status {
        case let .unavailable(message), let .failed(message):
            message
        case .stopped:
            "Companion stopped"
        case let .running(processIdentifier):
            "Companion running (PID \(processIdentifier))"
        case .stopping:
            "Companion stopping…"
        }
    }

    func start() {
        guard process == nil,
              let nodeURL,
              let scriptURL,
              let credentials else {
            return
        }

        let child = Process()
        let input = Pipe()
        let output = Pipe()
        child.executableURL = nodeURL
        child.arguments = [scriptURL.path, "serve"]
        var environment = ProcessInfo.processInfo.environment
        environment["SHUTTLE_RELAY_URL"] = credentials.relayURL.absoluteString
        environment["SHUTTLE_DEVICE_TOKEN"] = credentials.deviceToken
        child.environment = environment
        child.standardInput = input
        child.standardOutput = output
        child.standardError = FileHandle.nullDevice

        do {
            try child.run()
            let processIdentifier = child.processIdentifier
            child.terminationHandler = { [weak self] terminatedProcess in
                let exitCode = terminatedProcess.terminationStatus
                Task { @MainActor [weak self] in
                    self?.didTerminate(processIdentifier: processIdentifier, exitCode: exitCode)
                }
            }
            process = child
            inputHandle = input.fileHandleForWriting
            outputHandle = output.fileHandleForReading
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                Task { @MainActor [weak self] in
                    self?.consumeOutput(data)
                }
            }
            status = .running(processIdentifier)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    func stop() {
        guard inputHandle != nil else {
            return
        }

        status = .stopping
        do {
            try writeControl(["id": "client-stop", "method": "shutdown"])
        } catch {
            process?.terminate()
        }
    }

    func stopImmediately() {
        process?.terminate()
        process = nil
        inputHandle = nil
        outputHandle?.readabilityHandler = nil
        outputHandle = nil
        outputBuffer.removeAll(keepingCapacity: true)
        status = nodeURL == nil || scriptURL == nil
            ? status
            : credentials == nil ? .unavailable("Connect a Relay to start") : .stopped
    }

    func configure(_ credentials: RelayCredentials) throws {
        try RelayCredentialStore.save(credentials)
        self.credentials = credentials
        status = .stopped
        start()
    }

    func disconnectRelay() {
        stopImmediately()
        RelayCredentialStore.delete()
        credentials = nil
        status = .unavailable("Connect a Relay to start")
    }

    private func didTerminate(processIdentifier: Int32, exitCode: Int32) {
        guard process?.processIdentifier == processIdentifier else {
            return
        }

        process = nil
        inputHandle = nil
        outputHandle?.readabilityHandler = nil
        outputHandle = nil
        outputBuffer.removeAll(keepingCapacity: true)
        status = exitCode == 0 ? .stopped : .failed("Companion exited with code \(exitCode)")
    }

    private func consumeOutput(_ data: Data) {
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 0x0A) {
            let line = outputBuffer[..<newline]
            outputBuffer.removeSubrange(...newline)
            guard !line.isEmpty,
                  let event = try? JSONDecoder().decode(CompanionEvent.self, from: Data(line)) else {
                continue
            }
            if let request = event.authorizationRequest {
                authorizationPresenter.present(request: request) { [weak self] decision in
                    self?.respond(to: request.id, decision: decision)
                }
            } else if event.type == "authorization-result", let id = event.id {
                authorizationPresenter.complete(
                    id: id,
                    inviteURL: event.inviteURL,
                    sharedThreadId: event.sharedThreadId,
                    error: event.error
                )
            }
        }
    }

    private func respond(to id: String, decision: ShareAuthorizationDecision) {
        do {
            let response = CompanionAuthorizationResponse(id: id, result: decision)
            var data = try JSONEncoder().encode(response)
            data.append(0x0A)
            try inputHandle?.write(contentsOf: data)
        } catch {
            authorizationPresenter.complete(
                id: id,
                inviteURL: nil,
                sharedThreadId: nil,
                error: error.localizedDescription
            )
        }
    }

    private func writeControl(_ object: [String: String]) throws {
        var data = try JSONSerialization.data(withJSONObject: object)
        data.append(0x0A)
        try inputHandle?.write(contentsOf: data)
    }
}
