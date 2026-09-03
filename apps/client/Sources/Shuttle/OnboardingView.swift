import SwiftUI

private enum OnboardingSettingState: Equatable {
    case pending
    case active
    case complete
    case failed
}

struct OnboardingView: View {
    @Environment(\.dismissWindow) private var dismissWindow

    let controller: OnboardingController

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 26) {
                HStack(spacing: 18) {
                    Image(nsImage: ShuttleIcon.application)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 72, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .shadow(color: .black.opacity(0.16), radius: 10, y: 4)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Set up Shuttle")
                            .font(.largeTitle.weight(.bold))
                        Text("Connect Codex to the people you work with.")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .overlay {
                    Color.clear
                        .contentShape(Rectangle())
                        .gesture(WindowDragGesture())
                        .allowsWindowActivationEvents()
                }

                VStack(spacing: 0) {
                    OnboardingSettingRow(
                        icon: "puzzlepiece.extension",
                        title: "Install the Codex plugin",
                        detail: pluginDetail,
                        state: pluginState,
                        showsAction: !controller.pluginReady,
                        isActionEnabled: !controller.isCheckingPlugin
                            && !controller.isInstallingPlugin,
                        action: controller.installPlugin
                    )
                    Divider().padding(.leading, 54)
                    OnboardingSettingRow(
                        icon: "network",
                        title: "Relay",
                        detail: controller.selectedRelayURL.absoluteString,
                        state: .pending,
                        showsAction: true,
                        isActionEnabled: !controller.isSigningIn,
                        action: controller.selectRelay
                    )
                    Divider().padding(.leading, 54)
                    OnboardingSettingRow(
                        icon: "person.crop.circle",
                        title: "Sign in to Shuttle",
                        detail: relayDetail,
                        state: relayState,
                        showsAction: true,
                        isActionEnabled: !controller.isSigningIn,
                        action: controller.signIn
                    )
                }
                .background(
                    .quaternary.opacity(0.45),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )

                if let errorMessage = controller.pluginErrorMessage
                    ?? controller.relayErrorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                } else if controller.pluginReady
                    && controller.isSignedInToSelectedRelay {
                    Label(
                        "Shuttle is ready. Open a new Codex task to load the plugin.",
                        systemImage: "checkmark.circle.fill"
                    )
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }

                if controller.pluginErrorMessage != nil
                    || controller.relayErrorMessage != nil
                    || controller.pluginReady && controller.isSignedInToSelectedRelay {
                    HStack {
                        if controller.pluginErrorMessage != nil
                            || controller.relayErrorMessage != nil {
                            Link(
                                "Setup guide",
                                destination: URL(string: "https://shuttle.makesth.fun/Agents.md")!
                            )
                        }

                        Spacer()

                        if controller.pluginReady
                            && controller.isSignedInToSelectedRelay {
                            Button("Done") {
                                dismissWindow(id: ShuttleWindow.onboarding)
                            }
                            .keyboardShortcut(.defaultAction)
                        }
                    }
                }
            }
            .padding(32)
            .frame(width: 560)

            Button {
                dismissWindow(id: ShuttleWindow.onboarding)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)
            .padding(18)
            .zIndex(1)
            .accessibilityLabel("Close setup")
        }
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(.ultraThickMaterial)
                .gesture(WindowDragGesture())
                .allowsWindowActivationEvents()
        }
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.primary.opacity(0.08))
        }
        .task {
            await controller.refreshPluginStatus()
        }
    }

    private var pluginState: OnboardingSettingState {
        if controller.pluginReady { return .complete }
        if controller.isCheckingPlugin || controller.isInstallingPlugin {
            return .active
        }
        if controller.pluginErrorMessage != nil { return .failed }
        return .pending
    }

    private var relayState: OnboardingSettingState {
        if controller.isSignedInToSelectedRelay { return .complete }
        if controller.isSigningIn { return .active }
        if controller.relayErrorMessage != nil { return .failed }
        return .pending
    }

    private var pluginDetail: String {
        if controller.pluginReady { return "Installed and enabled in Codex." }
        if controller.isCheckingPlugin { return "Checking Codex Desktop…" }
        if controller.isInstallingPlugin {
            return "Installing Shuttle tools and collaboration guidance…"
        }
        return "Adds Shuttle tools and collaboration guidance to Codex."
    }

    private var relayDetail: String {
        if controller.isSigningIn { return "Complete sign-in in your browser." }
        if controller.isSignedInToSelectedRelay {
            return "Signed in. Click to authorize this Mac again."
        }
        if controller.companionIsConnected {
            return "Sign in to switch this Mac to the selected Relay."
        }
        return "Sign in to receive and share tasks."
    }
}

private struct OnboardingSettingRow: View {
    let icon: String
    let title: String
    let detail: String
    let state: OnboardingSettingState
    let showsAction: Bool
    let isActionEnabled: Bool
    let action: () -> Void

    @ViewBuilder
    var body: some View {
        if showsAction {
            Button(action: action) {
                rowContent
            }
            .buttonStyle(.plain)
            .disabled(!isActionEnabled)
        } else {
            rowContent
        }
    }

    private var rowContent: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.secondary)
                .frame(width: 22, height: 22)

            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()

            stateIcon
                .frame(width: 18, height: 18)

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
                .frame(width: 8)
                .opacity(showsAction && state != .active ? 1 : 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var stateIcon: some View {
        switch state {
        case .pending:
            EmptyView()
        case .active:
            ProgressView()
                .controlSize(.small)
        case .complete:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(.red)
        }
    }
}
