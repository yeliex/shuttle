import AppKit
import SwiftUI

private final class UtilityPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// 窗口层只负责系统行为；Setup 和分享的布局、状态与拖拽仍由 SwiftUI 提供。
@MainActor
final class UtilityWindowPresenter: NSObject, NSWindowDelegate {
    private var panel: NSPanel?
    private var onClose: (() -> Void)?
    private var isReplacingContent = false
    private var contentID = UUID()

    func present<Content: View>(title: String, onClose: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.onClose = onClose
        isReplacingContent = true
        let contentID = UUID()
        self.contentID = contentID
        let isNew = panel == nil
        let panel = self.panel ?? UtilityPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        let previousTopLeft = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        self.panel = panel
        panel.title = title
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.isMovable = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .canJoinAllApplications, .transient]
        let host = NSHostingController(rootView: content()
            .fixedSize()
            .onGeometryChange(for: CGSize.self, of: { $0.size }) { [weak self] size in
                guard let self, self.contentID == contentID, !isReplacingContent else { return }
                resize(to: size)
            })
        // 窗口尺寸由这里统一维护，避免宿主的自动尺寸约束在切页时移动窗口。
        host.sizingOptions = []
        panel.contentViewController = host
        host.view.layoutSubtreeIfNeeded()
        let size = host.sizeThatFits(in: NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
        panel.setFrame(NSRect(
            x: previousTopLeft.x, y: previousTopLeft.y - size.height,
            width: size.width, height: size.height
        ), display: true)
        if isNew {
            let pointer = NSEvent.mouseLocation
            if let screen = NSScreen.screens.first(where: { NSMouseInRect(pointer, $0.frame, false) }) ?? NSScreen.main {
                panel.setFrameOrigin(NSPoint(
                    x: screen.visibleFrame.midX - panel.frame.width / 2,
                    y: screen.visibleFrame.midY - panel.frame.height / 2
                ))
            }
        }
        isReplacingContent = false
        // 不激活整个 App，避免 macOS 将用户从全屏 Space 切回桌面。
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
    }

    private func resize(to size: CGSize) {
        guard let panel, size.width > 0, size.height > 0, panel.frame.size != size else { return }
        let origin = NSPoint(x: panel.frame.minX, y: panel.frame.maxY - size.height)
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
    }

    func close() { panel?.close() }

    func windowWillClose(_ notification: Notification) {
        let completion = onClose
        onClose = nil
        panel = nil
        completion?()
    }
}

extension View {
    func utilityWindowSurface(width: CGFloat, padding: CGFloat) -> some View {
        self.padding(padding)
            .frame(width: width)
            .background {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(.regularMaterial)
                    .gesture(WindowDragGesture())
                    .allowsWindowActivationEvents()
            }
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(.primary.opacity(0.08))
                    .allowsHitTesting(false)
            }
    }

    func utilityWindowDragRegion() -> some View {
        overlay {
            Color.clear.contentShape(Rectangle())
                .gesture(WindowDragGesture())
                .allowsWindowActivationEvents()
        }
    }
}
