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
        case failed(String)
    }

    private(set) var status: Status
    private(set) var isReady = false

    private var credentials: RelayCredentials?
    private let nodeURL: URL?
    private let scriptURL: URL?
    private let authorizationPresenter = AuthorizationWindowPresenter()
    private var inputHandle: FileHandle?
    private var outputBuffer = Data()
    private var outputHandle: FileHandle?
    private var process: Process?
    private var restartTask: Task<Void, Never>?
    private var shouldRun = false

    private var socketPath: String {
        let environment = ProcessInfo.processInfo.environment
        if let path = environment["SHUTTLE_SOCKET_PATH"] { return path }
        let directory = environment["SHUTTLE_DATA_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appending(path: "Shuttle")
        return directory.appending(path: "companion.sock").path
    }

    init(
        nodeURL: URL? = CodexRuntimeLocator.locateNode(),
        scriptURL: URL? = CompanionScriptLocator.locate(),
        credentials: RelayCredentials? = nil
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
        if case .running = status { return true }
        return false
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
            isReady ? "Companion ready (PID \(processIdentifier))" : "Starting Companion…"
        }
    }

    func loadStoredCredentials() {
        guard credentials == nil else { return }
        guard let storedCredentials = RelayCredentialStore.load() else { return }

        credentials = storedCredentials
        if nodeURL == nil {
            status = .unavailable("Codex Node runtime not found")
        } else if scriptURL == nil {
            status = .unavailable("Companion script not found")
        } else {
            status = .stopped
            start()
        }
    }

    func start() {
        shouldRun = true
        restartTask?.cancel()
        restartTask = nil
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
            child.terminationHandler = { [weak self] terminatedProcess in
                let exitCode = terminatedProcess.terminationStatus
                let processIdentifier = terminatedProcess.processIdentifier
                Task { @MainActor [weak self] in
                    self?.didTerminate(processIdentifier: processIdentifier, exitCode: exitCode)
                }
            }
            try child.run()
            let processIdentifier = child.processIdentifier
            process = child
            inputHandle = input.fileHandleForWriting
            outputHandle = output.fileHandleForReading
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                Task { @MainActor [weak self] in
                    guard self?.process?.processIdentifier == processIdentifier else { return }
                    self?.consumeOutput(data)
                }
            }
            status = .running(processIdentifier)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    func stopImmediately() {
        shouldRun = false
        isReady = false
        restartTask?.cancel()
        restartTask = nil
        process?.terminate()
        // Keep the old process until termination; configure/recovery must not start over its socket.
        inputHandle = nil
        outputHandle?.readabilityHandler = nil
        outputHandle = nil
        outputBuffer.removeAll(keepingCapacity: true)
        status = nodeURL == nil || scriptURL == nil
            ? status
            : credentials == nil ? .unavailable("Connect a Relay to start") : .stopped
    }

    func recoverIfNeeded() {
        loadStoredCredentials()
        guard credentials != nil else { return }
        if isRunning && FileManager.default.fileExists(atPath: socketPath) { return }
        stopImmediately()
        start()
    }

    func configure(_ credentials: RelayCredentials) throws {
        try RelayCredentialStore.save(credentials)
        stopImmediately()
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
        isReady = false
        inputHandle = nil
        outputHandle?.readabilityHandler = nil
        outputHandle = nil
        outputBuffer.removeAll(keepingCapacity: true)
        guard shouldRun, nodeURL != nil, scriptURL != nil, credentials != nil else {
            status = .stopped
            return
        }

        status = .failed("Companion exited with code \(exitCode); restarting…")
        restartTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            self?.restartTask = nil
            self?.start()
        }
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
            if event.type == "ready" {
                isReady = true
            } else if event.type == "recipients-result", event.query == authorizationPresenter.recipients.query {
                authorizationPresenter.recipients.receive(query: event.query ?? "", users: event.users ?? [], error: event.error)
            } else if let request = event.authorizationRequest {
                authorizationPresenter.recipients.search = { [weak self] query in
                    guard let data = try? JSONEncoder().encode(["method": "recipients.search", "query": query]) else { return }
                    try? self?.inputHandle?.write(contentsOf: data + Data([0x0A]))
                }
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
        guard let inputHandle else {
            authorizationPresenter.complete(id: id, inviteURL: nil, sharedThreadId: nil, error: "Companion 尚未连接，请稍后重试。")
            return
        }
        do {
            let response = CompanionAuthorizationResponse(id: id, result: decision)
            var data = try JSONEncoder().encode(response)
            data.append(0x0A)
            try inputHandle.write(contentsOf: data)
        } catch {
            authorizationPresenter.complete(
                id: id,
                inviteURL: nil,
                sharedThreadId: nil,
                error: error.localizedDescription
            )
        }
    }
}
