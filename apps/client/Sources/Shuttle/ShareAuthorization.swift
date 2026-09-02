import Foundation

enum SharePermission: String, CaseIterable, Codable, Identifiable {
    case read
    case message

    var id: String { rawValue }

    var label: String {
        switch self {
        case .read: "Can read"
        case .message: "Can read and message"
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
    let email: String?
    let expiresInHours: Int
    let permission: SharePermission
}

struct CompanionEvent: Decodable {
    let error: String?
    let id: String?
    let inviteURL: String?
    let sharedThreadId: String?
    let services: [SharedLocalService]?
    let title: String?
    let type: String

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
