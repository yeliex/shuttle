import AppKit
import SwiftUI

private enum ShareRecipient: String {
    case person, link
}

struct ShareAuthorizationView: View {
    let request: ShareAuthorizationRequest
    let recipients: ShareRecipients
    let submission: ShareSubmission
    let onCancel: () -> Void
    let onApprove: (ShareAuthorizationDecision) -> Void

    @State private var emailInput = ""
    @State private var emails: [String] = []
    @State private var expiresInHours = 24
    @State private var permission = SharePermission.read
    @State private var recipient = ShareRecipient.link
    @State private var canPreview = false
    @State private var singleUse = false
    @FocusState private var emailFocused: Bool
    @State private var highlightedEmail: String?
    @State private var suggestionsDismissed = false

    private var suggestedUsers: [ShareRecipientUser] {
        recipients.users.filter { !emails.contains($0.email) }
    }

    private var showSuggestions: Bool {
        emailFocused && !suggestionsDismissed && !emailInput.isEmpty
            && !suggestedUsers.isEmpty
    }

    private func selectEmail(_ email: String) {
        if !emails.contains(email) { emails.append(email) }
        emailInput = ""
        highlightedEmail = nil
        emailFocused = true
    }

    init(
        request: ShareAuthorizationRequest,
        recipients: ShareRecipients = ShareRecipients(),
        submission: ShareSubmission = ShareSubmission(),
        onCancel: @escaping () -> Void,
        onApprove: @escaping (ShareAuthorizationDecision) -> Void
    ) {
        self.request = request
        self.recipients = recipients
        self.submission = submission
        self.onCancel = onCancel
        self.onApprove = onApprove
    }

    private var draftEmails: [String] {
        emailInput.split(whereSeparator: { $0 == "," || $0 == ";" || $0.isWhitespace })
            .map { $0.lowercased() }
    }

    private var validDraft: Bool {
        draftEmails.allSatisfy { $0.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil }
    }

    private var allEmails: [String] { Array(Set(emails + draftEmails)).sorted() }

    private func addDraft() {
        guard validDraft else { return }
        emails = allEmails
        emailInput = ""
    }

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 14) {
                Text("共享任务")
                    .font(.system(size: 22, weight: .bold))
                HStack(spacing: 14) {
                    if let codexURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: CodexRuntimeLocator.bundleIdentifier) {
                        Image(nsImage: NSWorkspace.shared.icon(forFile: codexURL.path))
                            .resizable().scaledToFit().frame(width: 52, height: 52)
                    }
                    Image(systemName: "arrow.right")
                        .font(.callout).foregroundStyle(.tertiary)
                    Image(nsImage: ShuttleIcon.application)
                        .resizable().scaledToFit().frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 13))
                }
                Text("允许 Codex 通过 Shuttle 分享此任务")
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .utilityWindowDragRegion()

            VStack(alignment: .leading, spacing: 10) {
                Label(request.title, systemImage: "bubble.left.and.text.bubble.right")
                    .font(.callout.weight(.semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if !request.services.isEmpty {
                    Divider()
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(request.services) { service in
                                HStack(spacing: 8) {
                                    Image(systemName: "network").foregroundStyle(.secondary)
                                    Text(service.name).lineLimit(1)
                                    Spacer()
                                    Text(URL(string: service.localURL)?.port.map(String.init) ?? service.localURL)
                                        .font(.system(.caption, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                                .help(service.localURL)
                            }
                        }
                    }
                    .frame(height: min(CGFloat(request.services.count) * 26 - 8, 104))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 12))

            VStack(spacing: 12) {
                HStack {
                    Text("提供给")
                    Spacer()
                    ShareSelect(selection: $recipient, options: [
                        (.link, "任何有此链接的人"), (.person, "仅限部分人员"),
                    ])
                }

                if recipient == .person {
                    VStack(alignment: .leading, spacing: 8) {
                        if !emails.isEmpty {
                            ScrollView {
                                VStack(alignment: .leading, spacing: 6) {
                                    ForEach(emails, id: \.self) { email in
                                        HStack {
                                            Text(email).lineLimit(1)
                                            Spacer()
                                            Button { emails.removeAll { $0 == email } } label: {
                                                Image(systemName: "xmark").font(.caption)
                                            }
                                            .buttonStyle(.plain)
                                            .accessibilityLabel("移除 " + email)
                                        }
                                        .padding(.horizontal, 10).padding(.vertical, 6)
                                        .background(.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
                                    }
                                }
                            }
                            .frame(height: min(CGFloat(emails.count) * 32, 96))
                        }
                        HStack {
                            TextField("搜索或输入邮箱，回车添加", text: $emailInput)
                                .textFieldStyle(.plain)
                                .textContentType(.emailAddress)
                                .focused($emailFocused)
                                .onSubmit {
                                    if showSuggestions, let highlightedEmail { selectEmail(highlightedEmail) }
                                    else { addDraft() }
                                }
                                .onKeyPress(.downArrow) {
                                    guard !suggestedUsers.isEmpty else { return .ignored }
                                    suggestionsDismissed = false
                                    let index = suggestedUsers.firstIndex { $0.email == highlightedEmail } ?? -1
                                    highlightedEmail = suggestedUsers[min(index + 1, suggestedUsers.count - 1)].email
                                    return .handled
                                }
                                .onKeyPress(.upArrow) {
                                    guard !suggestedUsers.isEmpty else { return .ignored }
                                    let index = suggestedUsers.firstIndex { $0.email == highlightedEmail } ?? 0
                                    highlightedEmail = suggestedUsers[max(index - 1, 0)].email
                                    return .handled
                                }
                                .onKeyPress(.escape) {
                                    guard showSuggestions else { return .ignored }
                                    suggestionsDismissed = true
                                    return .handled
                                }
                                .onChange(of: emailInput) { _, _ in
                                    suggestionsDismissed = false
                                    highlightedEmail = nil
                                }
                            if recipients.isSearching {
                                ProgressView()
                                    .controlSize(.small)
                                    .accessibilityLabel("搜索邮箱中")
                            } else if !draftEmails.isEmpty && validDraft {
                                Button(action: addDraft) { Image(systemName: "plus") }
                                    .buttonStyle(.plain).accessibilityLabel("添加邮箱")
                            }
                        }
                        .padding(10)
                        .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
                        .overlay { RoundedRectangle(cornerRadius: 8).stroke(.primary.opacity(0.15)).allowsHitTesting(false) }
                        .overlay(alignment: .top) {
                            if showSuggestions {
                                VStack(alignment: .leading, spacing: 2) {
                                    ScrollViewReader { proxy in
                                        ScrollView {
                                            VStack(spacing: 2) {
                                                ForEach(suggestedUsers) { user in
                                                    Button { selectEmail(user.email) } label: {
                                                        HStack {
                                                            VStack(alignment: .leading, spacing: 3) {
                                                                Text(user.email)
                                                                Text(user.name).font(.caption).foregroundStyle(.secondary)
                                                            }
                                                            Spacer()
                                                        }
                                                        .padding(8).contentShape(Rectangle())
                                                        .background(highlightedEmail == user.email ? Color.primary.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                                                    }
                                                    .buttonStyle(.plain)
                                                    .id(user.email)
                                                }
                                            }
                                        }
                                        .frame(height: min(CGFloat(suggestedUsers.count) * 54, 132))
                                        .onChange(of: highlightedEmail) { _, email in
                                            if let email { proxy.scrollTo(email) }
                                        }
                                    }
                                    if validDraft && !draftEmails.isEmpty {
                                        Button { addDraft() } label: {
                                            Label("添加输入的邮箱", systemImage: "plus").frame(maxWidth: .infinity, alignment: .leading).padding(8)
                                        }.buttonStyle(.plain)
                                    }
                                }
                                .font(.callout)
                                .padding(4).frame(maxWidth: .infinity, alignment: .leading)
                                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                                .overlay { RoundedRectangle(cornerRadius: 10).stroke(.primary.opacity(0.15)).allowsHitTesting(false) }
                                .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
                                .offset(y: 44)
                            }
                        }
                        .zIndex(1)
                        if let error = recipients.error {
                            Text(error).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .task(id: emailInput) {
                        recipients.find(emailInput)
                    }
                    .onChange(of: recipients.users.map(\.email)) { _, _ in
                        highlightedEmail = suggestedUsers.first?.email
                    }
                    .zIndex(1)
                } else {
                    Toggle("链接只能被使用一次", isOn: $singleUse)
                        .toggleStyle(ShareCheckboxStyle())
                }

                HStack {
                    Text("权限")
                    Spacer()
                    ShareSelect(selection: $permission, options: SharePermission.allCases.map { ($0, $0.label) })
                }
                HStack {
                    Text("授权有效期")
                    Spacer()
                    ShareSelect(selection: $expiresInHours, options: [(24, "1天"), (168, "7天"), (720, "30天"), (0, "永久")])
                }
                if !request.services.isEmpty {
                    Toggle("同时分享服务", isOn: $canPreview)
                        .toggleStyle(ShareCheckboxStyle())
                }
            }
            .font(.callout)
            .zIndex(1)

            if let error = submission.error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack {
                Button("拒绝", action: onCancel)
                    .buttonStyle(ShareActionStyle(destructive: true))
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button {
                    onApprove(ShareAuthorizationDecision(
                        approved: true, canPreview: canPreview,
                        emails: recipient == .person ? allEmails : [],
                        expiresInHours: expiresInHours, permission: permission,
                        singleUse: recipient == .link && singleUse
                    ))
                } label: {
                    HStack(spacing: 8) {
                        if submission.isSubmitting {
                            ProgressView().controlSize(.small)
                        }
                        Text(submission.isSubmitting ? "正在分享…" : recipient == .link ? "分享" : "发送邀请")
                    }
                    .frame(height: 16)
                }
                .buttonStyle(ShareActionStyle())
                .keyboardShortcut(.defaultAction)
                .disabled(recipient == .person && (!validDraft || allEmails.isEmpty || allEmails.count > 50))
            }
        }
        .authorizationSurface(onClose: onCancel)
        .overlayPreferenceValue(ShareSelectPresentationKey.self) { presentation in
            GeometryReader { geometry in
                if let presentation {
                    let anchor = geometry[presentation.anchor]
                    let width = max(anchor.width, 170)
                    let height = CGFloat(presentation.titles.count) * 32 + 8
                    Color.clear.contentShape(Rectangle())
                        .onTapGesture(perform: presentation.dismiss)
                    ShareSelectMenu(presentation: presentation)
                        .frame(width: width)
                        .offset(
                            x: anchor.maxX - width,
                            y: max(8, min(anchor.minY - CGFloat(presentation.selectedIndex) * 32 - 4, geometry.size.height - height - 8))
                        )
                }
            }
        }
        .disabled(submission.isSubmitting)
    }
}

private struct ShareSelect<Value: Hashable>: View {
    @Binding var selection: Value
    @State private var expanded = false
    let options: [(Value, String)]

    var body: some View {
        Button { expanded.toggle() } label: {
            HStack(spacing: 12) {
                Text(options.first(where: { $0.0 == selection })?.1 ?? "")
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10).padding(.vertical, 8)
            .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).stroke(.primary.opacity(0.15)).allowsHitTesting(false) }
        }
        .buttonStyle(.plain)
        .fixedSize()
        .anchorPreference(key: ShareSelectPresentationKey.self, value: .bounds) { anchor in
            expanded ? ShareSelectPresentation(
                anchor: anchor,
                titles: options.map(\.1),
                selectedIndex: options.firstIndex { $0.0 == selection } ?? 0,
                select: { index in selection = options[index].0; expanded = false },
                dismiss: { expanded = false }
            ) : nil
        }
    }
}

private struct ShareSelectPresentation {
    let anchor: Anchor<CGRect>
    let titles: [String]
    let selectedIndex: Int
    let select: (Int) -> Void
    let dismiss: () -> Void
}

private struct ShareSelectPresentationKey: PreferenceKey {
    static var defaultValue: ShareSelectPresentation? { nil }

    static func reduce(value: inout ShareSelectPresentation?, nextValue: () -> ShareSelectPresentation?) {
        value = nextValue() ?? value
    }
}

private struct ShareSelectMenu: View {
    let presentation: ShareSelectPresentation
    @State private var highlightedIndex: Int?
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ForEach(presentation.titles.indices, id: \.self) { index in
                Button { presentation.select(index) } label: {
                    HStack(spacing: 12) {
                        Text(presentation.titles[index])
                        Spacer(minLength: 0)
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .medium))
                            .opacity(presentation.selectedIndex == index ? 1 : 0)
                    }
                    .padding(.horizontal, 8)
                    .frame(height: 32)
                    .contentShape(Rectangle())
                    .background(
                        Color.primary.opacity((highlightedIndex ?? presentation.selectedIndex) == index ? 0.08 : 0),
                        in: RoundedRectangle(cornerRadius: 5)
                    )
                }
                .buttonStyle(.plain)
                .onHover { if $0 { highlightedIndex = index } }
            }
        }
        .font(.callout)
        .padding(4)
        .background(.thickMaterial, in: RoundedRectangle(cornerRadius: 8))
        .overlay { RoundedRectangle(cornerRadius: 8).stroke(.primary.opacity(0.15)).allowsHitTesting(false) }
        .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
        .focusable()
        .focusEffectDisabled()
        .focused($isFocused)
        .onAppear { isFocused = true }
        .onKeyPress(.escape) { presentation.dismiss(); return .handled }
        .onKeyPress(.downArrow) {
            highlightedIndex = min((highlightedIndex ?? presentation.selectedIndex) + 1, presentation.titles.count - 1)
            return .handled
        }
        .onKeyPress(.upArrow) {
            highlightedIndex = max((highlightedIndex ?? presentation.selectedIndex) - 1, 0)
            return .handled
        }
        .onKeyPress(.return) {
            presentation.select(highlightedIndex ?? presentation.selectedIndex)
            return .handled
        }
    }
}

private struct ShareCheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack {
                configuration.label
                Spacer()
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16))
                    .foregroundStyle(configuration.isOn ? .primary : .secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(configuration.isOn ? "已选中" : "未选中")
    }
}

private struct ShareActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovered = false
    var destructive = false
    var iconOnly = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.medium))
            .padding(.horizontal, iconOnly ? 7 : 14)
            .padding(.vertical, iconOnly ? 7 : 9)
            .foregroundStyle(destructive ? Color.red : Color.primary)
            .background(
                (destructive ? Color.red : Color.primary)
                    .opacity(isEnabled ? (configuration.isPressed ? 0.12 : isHovered ? 0.06 : 0) : 0),
                in: RoundedRectangle(cornerRadius: 8)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(destructive ? Color.red.opacity(0.5) : Color.primary.opacity(0.15))
                    .allowsHitTesting(false)
            }
            .contentShape(RoundedRectangle(cornerRadius: 8))
            .onHover { isHovered = $0 }
            .opacity(isEnabled ? 1 : 0.4)
    }
}

struct ShareAuthorizationResultView: View {
    let error: String?
    let inviteURL: String?
    let sharedThreadId: String?
    let onDone: () -> Void
    @State private var copiedValue: String?

    private var usagePrompt: String? {
        guard let inviteURL, let sharedThreadId else { return nil }
        return """
        Open this Shuttle shared task (sign in with your invited email if needed):
        \(inviteURL)

        Then use the Share Thread ($share-thread) skill in this current Codex task to read:
        shuttle://shared/\(sharedThreadId)

        If Shuttle is not initialized, first read https://shuttle.makesth.fun/Agents.md and follow the setup instructions. To send feedback, use Shuttle's send_shared_message tool for the same shared task.
        """
    }

    private var displayedPrompt: String? {
        // 长链接和工具名允许就地折行；复制与辅助功能始终使用未插入断点的原文。
        usagePrompt?.replacing(#/\S*[/_#]\S*/#) { match in
            match.output.map(String.init).joined(separator: "\u{200B}")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label(
                error == nil ? "分享已就绪" : "分享失败",
                systemImage: error == nil ? "checkmark.circle" : "exclamationmark.triangle"
            )
            .font(.title2.weight(.semibold))
            .foregroundStyle(error == nil ? Color.primary : Color.red)
            .padding(.trailing, 28)
            .utilityWindowDragRegion()

            if let error {
                Text(error).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let inviteURL {
                Text("分享已创建。复制链接或下方提示词，发送给协作者即可。")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 8) {
                    Text("分享链接").font(.subheadline.weight(.medium))
                    HStack(spacing: 8) {
                        Text(verbatim: inviteURL)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(inviteURL, forType: .string)
                            copiedValue = inviteURL
                        } label: {
                            Image(systemName: copiedValue == inviteURL ? "checkmark" : "doc.on.doc")
                                .font(.system(size: 14))
                                .frame(width: 14, height: 14)
                        }
                        .buttonStyle(ShareActionStyle(iconOnly: true))
                        .accessibilityLabel(copiedValue == inviteURL ? "链接已复制" : "复制链接")
                        .help(copiedValue == inviteURL ? "已复制" : "复制链接")
                    }
                    .padding(.leading, 12)
                    .padding(.trailing, 8)
                    .padding(.vertical, 8)
                    .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
                    .overlay { RoundedRectangle(cornerRadius: 10).stroke(.primary.opacity(0.15)).allowsHitTesting(false) }
                }
                if let usagePrompt {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("发送给协作者")
                            .font(.subheadline.weight(.medium))
                        Text(verbatim: displayedPrompt ?? usagePrompt)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(usagePrompt)
                            .textSelection(.disabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .padding(.bottom, 32)
                            .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
                            .overlay { RoundedRectangle(cornerRadius: 10).stroke(.primary.opacity(0.15)).allowsHitTesting(false) }
                            .overlay(alignment: .bottomTrailing) {
                                Button {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(usagePrompt, forType: .string)
                                    copiedValue = usagePrompt
                                } label: {
                                    Image(systemName: copiedValue == usagePrompt ? "checkmark" : "doc.on.doc")
                                        .font(.system(size: 14))
                                        .frame(width: 14, height: 14)
                                }
                                .buttonStyle(ShareActionStyle(iconOnly: true))
                                .accessibilityLabel(copiedValue == usagePrompt ? "提示词已复制" : "复制 prompt")
                                .help(copiedValue == usagePrompt ? "已复制" : "复制 prompt")
                                .padding(8)
                            }
                    }
                }
            }
        }
        .frame(width: 412, alignment: .leading)
        .authorizationSurface(onClose: onDone)
        .task(id: copiedValue) {
            guard copiedValue != nil else { return }
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            copiedValue = nil
        }
    }
}

private extension View {
    func authorizationSurface(onClose: (() -> Void)? = nil) -> some View {
        utilityWindowSurface(width: 460, padding: 24)
            .overlay(alignment: .topTrailing) {
                if let onClose {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(.secondary)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("关闭")
                    .help("关闭")
                    .keyboardShortcut(.cancelAction)
                    .padding(14)
                }
            }
    }
}
