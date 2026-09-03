import AppKit
import Foundation

enum CodexRuntimeLocator {
    static let bundleIdentifier = "com.openai.codex"

    static func locateNode() -> URL? {
        guard let applicationURL = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: bundleIdentifier
        ) else {
            return nil
        }

        let nodeURL = nodeURL(in: applicationURL)
        return FileManager.default.isExecutableFile(atPath: nodeURL.path) ? nodeURL : nil
    }

    static func nodeURL(in applicationURL: URL) -> URL {
        applicationURL
            .appending(path: "Contents")
            .appending(path: "Resources")
            .appending(path: "cua_node")
            .appending(path: "bin")
            .appending(path: "node")
    }

    static func cliURL(in applicationURL: URL) -> URL {
        applicationURL
            .appending(path: "Contents")
            .appending(path: "Resources")
            .appending(path: "codex")
    }

    static func locateCLI(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL? {
        let applicationURL = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: bundleIdentifier
        )
        for candidate in cliCandidateURLs(
            environment: environment,
            applicationURL: applicationURL
        ) {
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }

    static func cliCandidateURLs(
        environment: [String: String],
        applicationURL: URL? = nil
    ) -> [URL] {
        var paths: [String] = []
        if let configuredPath = environment["SHUTTLE_CODEX_PATH"] {
            paths.append(configuredPath)
        }
        if let applicationURL {
            paths.append(cliURL(in: applicationURL).path)
        }
        if let searchPath = environment["PATH"] {
            paths.append(contentsOf: searchPath.split(separator: ":").map {
                URL(fileURLWithPath: String($0)).appending(path: "codex").path
            })
        }
        paths.append(contentsOf: [
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
            FileManager.default.homeDirectoryForCurrentUser
                .appending(path: ".local/bin/codex").path,
        ])

        var seen = Set<String>()
        return paths.compactMap { path in
            guard seen.insert(path).inserted else { return nil }
            return URL(fileURLWithPath: path)
        }
    }
}
