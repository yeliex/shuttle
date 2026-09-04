import Foundation
import Observation

@MainActor @Observable
final class ShareSubmission {
    var isSubmitting = false
    var error: String?
}

enum SharePermission: String, CaseIterable, Codable, Identifiable {
    case read
    case message

    var id: String { rawValue }

    var label: String {
        switch self {
        case .read: "仅查看"
        case .message: "查看和发送消息"
        }
    }
}

struct SharedLocalService: Decodable, Identifiable {
    let localURL: String
    let name: String

    var id: String { "\(name)|\(localURL)" }
}

struct ShareAuthorizationRequest: Decodable, Identifiable {
    let id: String
    let services: [SharedLocalService]
    let title: String
}

struct ShareAuthorizationDecision: Encodable {
    let approved: Bool
    let canPreview: Bool
    let emails: [String]
    let expiresInHours: Int
    let permission: SharePermission
    var singleUse = false
}

struct CompanionEvent: Decodable {
    let error: String?
    let id: String?
    let inviteURL: String?
    let sharedThreadId: String?
    let services: [SharedLocalService]?
    let title: String?
    let type: String
    let query: String?
    let users: [ShareRecipientUser]?

    var authorizationRequest: ShareAuthorizationRequest? {
        guard type == "authorization-request",
              let id,
              let title else {
            return nil
        }
        return ShareAuthorizationRequest(
            id: id,
            services: services ?? [],
            title: title
        )
    }
}

struct CompanionAuthorizationResponse: Encodable {
    let id: String
    let method = "authorization.respond"
    let result: ShareAuthorizationDecision
}
