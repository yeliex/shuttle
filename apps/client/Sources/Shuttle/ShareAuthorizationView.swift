import AppKit
import SwiftUI

private enum ShareRecipient: String, CaseIterable, Identifiable {
    case person
    case link

    var id: String { rawValue }

    var label: String {
        switch self {
        case .person: "Specific person"
        case .link: "Anyone with link"
        }
    }
}

struct ShareAuthorizationView: View {
    let request: ShareAuthorizationRequest
    let onCancel: () -> Void
    let onApprove: (ShareAuthorizationDecision) -> Void

    @State private var email = ""
    @State private var expiresInHours = 24
    @State private var permission = SharePermission.read
    @State private var recipient = ShareRecipient.person
    @State private var canPreview = false

    init(
        request: ShareAuthorizationRequest,
        onCancel: @escaping () -> Void,
        onApprove: @escaping (ShareAuthorizationDecision) -> Void
    ) {
        self.request = request
        self.onCancel = onCancel
        self.onApprove = onApprove
    }

    var body: some View {
        VStack(spacing: 22) {
            Text("Shuttle requests authorization")
                .font(.title2.weight(.bold))

            HStack(spacing: 0) {
                Image(nsImage: ShuttleIcon.application)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 60, height: 60)
                    .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                    .shadow(color: .black.opacity(0.12), radius: 6, y: 2)

                Rectangle()
                    .fill(.tertiary)
                    .frame(width: 88, height: 2)
                    .overlay {
                        Image(systemName: "checkmark")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(.green, in: Circle())
                    }

                if let codexURL = NSWorkspace.shared.urlForApplication(
                    withBundleIdentifier: CodexRuntimeLocator.bundleIdentifier
                ) {
                    Image(nsImage: NSWorkspace.shared.icon(forFile: codexURL.path))
                        .resizable()
                        .scaledToFit()
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                        .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
                } else {
                    Image(systemName: "terminal")
                        .font(.system(size: 28, weight: .medium))
                        .frame(width: 60, height: 60)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 15))
                }
            }

            Text("Allow Shuttle to share this Codex task?")
                .font(.title3.weight(.semibold))

            VStack(alignment: .leading, spacing: 12) {
                Label(request.title, systemImage: "bubble.left.and.text.bubble.right")
                    .font(.headline)
                ForEach(request.services) { service in
                    Divider()
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "macwindow")
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(service.name)
                            Text(service.localURL)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))

            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Share with").font(.subheadline.weight(.medium))
                    Picker("Share with", selection: $recipient) {
                        ForEach(ShareRecipient.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                }

                if recipient == .person {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Email").font(.subheadline.weight(.medium))
                        TextField("teammate@example.com", text: $email)
                            .textContentType(.emailAddress)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Permission").font(.subheadline.weight(.medium))
                    Picker("Permission", selection: $permission) {
                        ForEach(SharePermission.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                }

                if !request.services.isEmpty {
                    Toggle("Allow access to included local services", isOn: $canPreview)
                        .toggleStyle(.checkbox)
                }

                HStack {
                    Text("Invitation expires")
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    Picker("Invitation expires", selection: $expiresInHours) {
                        Text("In 24 hours").tag(24)
                        Text("In 7 days").tag(168)
                        Text("In 30 days").tag(720)
                    }
                    .labelsHidden()
                    .frame(width: 150)
                }
            }

            HStack {
                Button("Deny", role: .cancel, action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Label("Shuttle Relay", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Authorize sharing") {
                    let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
                    onApprove(ShareAuthorizationDecision(
                        approved: true,
                        canPreview: canPreview,
                        email: recipient == .person ? trimmedEmail : nil,
                        expiresInHours: expiresInHours,
                        permission: permission
                    ))
                }
                .keyboardShortcut(.defaultAction)
                .disabled(
                    recipient == .person
                        && email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            }
        }
        .authorizationSurface()
    }
}

struct ShareAuthorizationProgressView: View {
    let title: String

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Creating invitation…").font(.headline)
            Text(title).foregroundStyle(.secondary)
        }
        .frame(minHeight: 190)
        .authorizationSurface()
    }
}

struct ShareAuthorizationResultView: View {
    let error: String?
    let inviteURL: String?
    let sharedThreadId: String?
    let onDone: () -> Void

    private var usagePrompt: String? {
        guard let inviteURL, let sharedThreadId else { return nil }
        return """
        Open and accept this Shuttle task invitation:
        \(inviteURL)

        Then use the Shuttle skill in a new Codex task to read:
        shuttle://shared/\(sharedThreadId)

        If Shuttle is not initialized, first read https://shuttle.makesth.fun/Agents.md and follow the setup instructions. To send feedback, use Shuttle's send_shared_message tool for the same shared task.
        """
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label(
                error == nil ? "Invitation created" : "Unable to share",
                systemImage: error == nil ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
            )
            .font(.title2.weight(.semibold))
            .foregroundStyle(error == nil ? Color.primary : Color.red)

            if let error {
                Text(error).foregroundStyle(.secondary)
            } else if let inviteURL {
                Text("The Relay is ready. Copy this link or return to Codex, where the same result is available.")
                    .foregroundStyle(.secondary)
                HStack {
                    Text(inviteURL)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                    Button("Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(inviteURL, forType: .string)
                    }
                }
                if let usagePrompt {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Message for your collaborator")
                                .font(.subheadline.weight(.medium))
                            Spacer()
                            Button("Copy prompt") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(usagePrompt, forType: .string)
                            }
                        }
                        Text(usagePrompt)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }

            HStack {
                Spacer()
                Button("Done", action: onDone).keyboardShortcut(.defaultAction)
            }
        }
        .frame(minHeight: 190)
        .authorizationSurface()
    }
}

private extension View {
    func authorizationSurface() -> some View {
        padding(28)
            .frame(width: 520)
            .background(.ultraThickMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(.primary.opacity(0.08))
            }
    }
}
