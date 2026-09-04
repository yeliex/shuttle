import Foundation
import Observation

struct ShareRecipientUser: Decodable, Identifiable {
    let email: String
    let name: String
    var id: String { email }
}

@MainActor
@Observable
final class ShareRecipients {
    var query = ""
    var users: [ShareRecipientUser] = []
    var error: String?
    var isSearching = false
    var search: ((String) -> Void)?
    private var searchTask: Task<Void, Never>?

    func find(_ query: String) {
        searchTask?.cancel()
        self.query = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        users = []
        error = nil
        isSearching = self.query.count >= 2
        guard isSearching else { return }
        let query = self.query
        searchTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
            self?.search?(query)
        }
    }

    func receive(query: String, users: [ShareRecipientUser], error: String?) {
        guard query == self.query else { return }
        self.users = users
        self.error = error
        isSearching = false
    }
}
