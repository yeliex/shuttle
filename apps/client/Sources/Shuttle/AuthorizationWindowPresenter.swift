import AppKit
import SwiftUI

private final class AuthorizationPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@MainActor
final class AuthorizationWindowPresenter: NSObject, NSWindowDelegate {
    private var activeRequestID: String?
    private var presentationScreen: NSScreen?
    private var recipientEmail: String?
    private var response: ((ShareAuthorizationDecision) -> Void)?
    private var window: NSWindow?

    func present(
        request: ShareAuthorizationRequest,
        response: @escaping (ShareAuthorizationDecision) -> Void
    ) {
        activeRequestID = request.id
        self.response = response
        let pointerLocation = NSEvent.mouseLocation
        presentationScreen = NSScreen.screens.first {
            NSMouseInRect(pointerLocation, $0.frame, false)
        } ?? NSScreen.main
        show(ShareAuthorizationView(
            request: request,
            onCancel: { [weak self] in
                self?.respond(ShareAuthorizationDecision(
                    approved: false,
                    canPreview: false,
                    email: nil,
                    expiresInHours: 24,
                    permission: .read
                ))
                self?.close()
            },
            onApprove: { [weak self] decision in
                self?.recipientEmail = decision.email
                self?.respond(decision)
                self?.show(ShareAuthorizationProgressView(title: request.title))
            }
        ))
    }

    func complete(id: String, inviteURL: String?, sharedThreadId: String?, error: String?) {
        guard activeRequestID == id else { return }
        show(ShareAuthorizationResultView(
            error: error,
            inviteURL: inviteURL,
            sharedThreadId: recipientEmail == nil ? nil : sharedThreadId,
            onDone: { [weak self] in self?.close() }
        ))
    }

    func windowWillClose(_ notification: Notification) {
        guard response != nil else { return }
        respond(ShareAuthorizationDecision(
            approved: false,
            canPreview: false,
            email: nil,
            expiresInHours: 24,
            permission: .read
        ))
        reset()
    }

    private func respond(_ decision: ShareAuthorizationDecision) {
        let currentResponse = response
        response = nil
        currentResponse?(decision)
    }

    private func show<Content: View>(_ content: Content) {
        let hostingController = NSHostingController(rootView: content)
        hostingController.view.layoutSubtreeIfNeeded()
        let contentSize = hostingController.view.fittingSize
        if let window {
            window.contentViewController = hostingController
            window.setContentSize(contentSize)
        } else {
            let window = AuthorizationPanel(
                contentRect: NSRect(origin: .zero, size: contentSize),
                styleMask: [.borderless],
                backing: .buffered,
                defer: false
            )
            window.title = "Shuttle authorization"
            window.contentViewController = hostingController
            window.backgroundColor = .clear
            window.isOpaque = false
            window.hasShadow = true
            window.level = .modalPanel
            window.collectionBehavior = [.moveToActiveSpace, .transient]
            window.isMovableByWindowBackground = true
            window.animationBehavior = .utilityWindow
            window.isReleasedWhenClosed = false
            window.delegate = self
            self.window = window
        }
        if let visibleFrame = presentationScreen?.visibleFrame {
            let frame = window?.frame ?? NSRect(origin: .zero, size: contentSize)
            window?.setFrameOrigin(NSPoint(
                x: visibleFrame.midX - frame.width / 2,
                y: visibleFrame.midY - frame.height / 2
            ))
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    private func close() {
        window?.close()
        reset()
    }

    private func reset() {
        activeRequestID = nil
        presentationScreen = nil
        recipientEmail = nil
        response = nil
        window = nil
    }
}
