import Foundation

struct RelayCredentials: Codable, Equatable, Sendable {
    let relayURL: URL
    let deviceToken: String
}

enum RelayCredentialStore {
    private static let defaultFileURL = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
    )[0]
        .appending(path: "Shuttle", directoryHint: .isDirectory)
        .appending(path: "credentials.json")

    static func load(from fileURL: URL = defaultFileURL) -> RelayCredentials? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(RelayCredentials.self, from: data)
    }

    static func save(
        _ credentials: RelayCredentials,
        to fileURL: URL = defaultFileURL
    ) throws {
        let directoryURL = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: directoryURL.path
        )
        let data = try JSONEncoder().encode(credentials)
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fileURL.path
        )
    }

    static func delete(at fileURL: URL = defaultFileURL) {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
