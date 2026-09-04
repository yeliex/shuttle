import AppKit
import SwiftUI

@MainActor
final class AuthorizationWindowPresenter {
    private var activeRequestID: String?
    private var recipientEmails: [String] = []
    private var response: ((ShareAuthorizationDecision) -> Void)?
    private let window = UtilityWindowPresenter()
    private var submission = ShareSubmission()
    let recipients = ShareRecipients()

    func present(
        request: ShareAuthorizationRequest,
        isPreview: Bool = false,
        response: @escaping (ShareAuthorizationDecision) -> Void
    ) {
        activeRequestID = request.id
        recipientEmails = []
        self.response = response
        submission = ShareSubmission()
        recipients.find("")
        show(ShareAuthorizationView(
            request: request,
            recipients: recipients,
            submission: submission,
            onCancel: { [weak self] in self?.window.close() },
            onApprove: { [weak self] decision in
                guard let self, !submission.isSubmitting else { return }
                submission.error = nil
                submission.isSubmitting = true
                recipientEmails = decision.emails
                if isPreview {
                    // 仅模拟结果；不触发 Companion，示例链接也不指向真实 Relay。
                    Task { [weak self] in
                        try? await Task.sleep(for: .seconds(1))
                        self?.complete(
                            id: request.id,
                            inviteURL: "https://shuttle.example/app/invite#preview-only",
                            sharedThreadId: "00000000-0000-4000-8000-000000000000",
                            error: nil
                        )
                    }
                    return
                }
                self.response?(decision)
            }
        ))
    }

    func presentPreview() {
        recipients.search = { [weak self] query in
            let users = [
                ShareRecipientUser(email: "alex@example.com", name: "Alex"),
                ShareRecipientUser(email: "maya@example.com", name: "Maya"),
            ].filter { $0.email.contains(query.lowercased()) }
            self?.recipients.receive(query: query, users: users, error: nil)
        }
        present(
            request: ShareAuthorizationRequest(
                id: "authorization-preview-" + UUID().uuidString,
                services: [SharedLocalService(localURL: "http://localhost:3000", name: "Web preview")],
                title: "Review the new onboarding experience"
            ),
            isPreview: true,
            response: { _ in }
        )
    }

    func complete(id: String, inviteURL: String?, sharedThreadId: String?, error: String?) {
        guard activeRequestID == id else { return }
        submission.isSubmitting = false
        if let error {
            submission.error = error
            return
        }
        response = nil
        if error == nil, recipientEmails.isEmpty, let inviteURL {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(inviteURL, forType: .string)
        }
        show(ShareAuthorizationResultView(
            error: error,
            inviteURL: inviteURL,
            sharedThreadId: sharedThreadId,
            onDone: { [weak self] in
                self?.window.close()
            }
        ))
    }

    private func show<Content: View>(_ content: Content) {
        window.present(title: "Shuttle authorization", onClose: { [weak self] in
            guard let self else { return }
            let completion = response
            response = nil
            activeRequestID = nil
            recipientEmails = []
            recipients.find("")
            completion?(ShareAuthorizationDecision(
                approved: false, canPreview: false, emails: [], expiresInHours: 24, permission: .read
            ))
        }) { content }
    }
}
