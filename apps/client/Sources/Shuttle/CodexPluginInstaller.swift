import Foundation

private actor CodexPluginCommandRunner {
    func run(executableURL: URL, arguments: [String]) throws -> Data {
        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        process.executableURL = executableURL
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = errors

        try process.run()
        process.waitUntilExit()

        let outputData = output.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else {
            let errorData = errors.fileHandleForReading.readDataToEndOfFile()
            let message = String(data: errorData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let failureMessage = message?.isEmpty == false
                ? message ?? ""
                : "Codex exited with code \(process.terminationStatus)"
            throw CodexPluginInstallerError.commandFailed(
                failureMessage
            )
        }
        return outputData
    }
}

private enum CodexPluginInstallerError: LocalizedError {
    case cliUnavailable
    case commandFailed(String)
    case installationIncomplete

    var errorDescription: String? {
        switch self {
        case .cliUnavailable: "Codex Desktop is required to install the Shuttle plugin."
        case let .commandFailed(message): message
        case .installationIncomplete: "Codex did not report the Shuttle plugin as installed and enabled."
        }
    }
}

private struct CodexPluginList: Decodable {
    struct Plugin: Decodable {
        let enabled: Bool
        let installed: Bool
        let name: String
    }

    let installed: [Plugin]
}

private struct CodexMarketplaceList: Decodable {
    struct Marketplace: Decodable {
        let name: String
    }

    let marketplaces: [Marketplace]
}

@MainActor
final class CodexPluginInstaller {
    private let commandRunner = CodexPluginCommandRunner()

    func isReady() async throws -> Bool {
        try await isPluginReady(cliURL: try locateCLI())
    }

    func install() async throws {
        let cliURL = try locateCLI()
        let marketplaces = try await commandRunner.run(
            executableURL: cliURL,
            arguments: ["plugin", "marketplace", "list", "--json"]
        )
        if try !Self.hasShuttleMarketplace(in: marketplaces) {
            _ = try await commandRunner.run(
                executableURL: cliURL,
                arguments: [
                    "plugin", "marketplace", "add", "yeliex/shuttle",
                    "--ref", "master", "--json",
                ]
            )
        }
        _ = try await commandRunner.run(
            executableURL: cliURL,
            arguments: ["plugin", "add", "shuttle@shuttle", "--json"]
        )
        guard try await isPluginReady(cliURL: cliURL) else {
            throw CodexPluginInstallerError.installationIncomplete
        }
    }

    nonisolated static func isShuttleReady(in data: Data) throws -> Bool {
        let list = try JSONDecoder().decode(CodexPluginList.self, from: data)
        return list.installed.contains {
            $0.name == "shuttle" && $0.installed && $0.enabled
        }
    }

    nonisolated static func hasShuttleMarketplace(in data: Data) throws -> Bool {
        let list = try JSONDecoder().decode(CodexMarketplaceList.self, from: data)
        return list.marketplaces.contains { $0.name == "shuttle" }
    }

    private func isPluginReady(cliURL: URL) async throws -> Bool {
        let data = try await commandRunner.run(
            executableURL: cliURL,
            arguments: ["plugin", "list", "--json"]
        )
        return try Self.isShuttleReady(in: data)
    }

    private func locateCLI() throws -> URL {
        guard let cliURL = CodexRuntimeLocator.locateCLI() else {
            throw CodexPluginInstallerError.cliUnavailable
        }
        return cliURL
    }
}
