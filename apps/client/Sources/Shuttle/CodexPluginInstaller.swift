import AppKit
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
    case commandFailed(String)
    case installationIncomplete

    var errorDescription: String? {
        switch self {
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
    private let guideURL = URL(string: "https://shuttle.makesth.fun/Agents.md")!

    func checkOnLaunch() async {
        guard let cliURL = CodexRuntimeLocator.locateCLI() else {
            presentMissingCLI()
            return
        }

        do {
            if try await isPluginReady(cliURL: cliURL) {
                return
            }
        } catch {
            presentCheckFailure(error)
            return
        }

        let alert = NSAlert()
        alert.messageText = "Install the Shuttle Codex plugin?"
        alert.informativeText = "The plugin lets Codex read shared tasks and send messages through Shuttle. A new Codex task is required after installation."
        alert.addButton(withTitle: "Install")
        alert.addButton(withTitle: "Later")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        do {
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
            presentInstalled()
        } catch {
            presentInstallationFailure(error)
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

    private func presentMissingCLI() {
        let alert = NSAlert()
        alert.messageText = "Codex plugin setup is required"
        alert.informativeText = "Shuttle could not find the Codex command-line tool. Open the setup guide to finish installation."
        alert.addButton(withTitle: "Open Setup Guide")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.open(guideURL)
        }
    }

    private func presentCheckFailure(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "Unable to check the Shuttle plugin"
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private func presentInstalled() {
        let alert = NSAlert()
        alert.messageText = "Shuttle plugin installed"
        alert.informativeText = "Start a new Codex task to use Shuttle tools."
        alert.addButton(withTitle: "Done")
        alert.runModal()
    }

    private func presentInstallationFailure(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "Unable to install the Shuttle plugin"
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: "Open Setup Guide")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.open(guideURL)
        }
    }
}
