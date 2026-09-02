# Shuttle

Shuttle lets people collaborate across Codex tasks while everyone keeps working in their own local Codex workspace. Share a task explicitly, let a collaborator read it or send feedback from their own task, and optionally expose the local preview attached to that work.

[Download for macOS](https://github.com/yeliex/shuttle/releases/latest) · [Documentation](https://shuttle.makesth.fun/docs/) · [Open Shuttle](https://shuttle.makesth.fun/app/)

> [!IMPORTANT]
> Shuttle is an early release for macOS. Its Codex Desktop integration is version-sensitive, so keep Shuttle and Codex Desktop up to date and review the privacy boundaries before using it with sensitive work.

## What Shuttle does

- Shares only the Codex tasks an owner explicitly approves.
- Lets authorized collaborators read a shared task live or send a synchronous message to it.
- Keeps each participant in their own Codex task instead of sharing control of one desktop UI.
- Can relay an explicitly selected localhost service, including HTTP, SSE, WebSocket, and common HMR traffic.
- Stores accounts, invitations, permissions, devices, and preview configuration in the Relay, but not Codex task content or collaboration messages.
- Supports the hosted Relay at `https://shuttle.makesth.fun` and self-hosted Relay deployments.

The task owner must be online for task reads, message delivery, and local previews. Shuttle does not maintain an offline task cache or message queue.

## How it works

```text
Owner's Codex task
        │
        ▼
Shuttle macOS app + local Companion
        │ authenticated live connection
        ▼
Shuttle Relay ───────────────► Web app
        │
        ▼
Collaborator's Shuttle Plugin in Codex
```

The macOS app manages Relay sign-in, authorization prompts, the local Companion, Plugin setup, and Sparkle updates. The Relay authenticates users and devices, enforces task permissions, and routes live requests. The Codex Plugin exposes the collaboration tools and safety guidance inside each participant's own task.

Read [the product guide](docs/product.md) for the sharing model and [the architecture](docs/architecture.md) for component and data boundaries.

## Get started

1. Download the latest ZIP from [GitHub Releases](https://github.com/yeliex/shuttle/releases/latest), move `Shuttle.app` to Applications, and open it.
2. Connect the menu bar app to the hosted Relay or your own Relay.
3. Let Shuttle install the Codex Plugin, or install it manually:

   ```bash
   codex plugin marketplace add yeliex/shuttle --ref master
   codex plugin add shuttle@shuttle
   ```

4. Open a new Codex task so the Plugin is loaded.
5. Ask Codex to share the current task through Shuttle, then choose the collaborator, permission, expiration, and optional local previews in the native authorization window.

Collaborators receive a prompt containing a precise resource link such as `shuttle://shared/<id>`. The Shuttle Skill uses that link to read the task or send a message without searching for unrelated tasks.

### First launch on macOS

Shuttle is currently distributed without Apple notarization. On first launch, macOS may require you to open System Settings → Privacy & Security and choose **Open Anyway**. Only do this for a build downloaded from this repository's Releases page.

Subsequent in-app updates are verified with Sparkle Ed25519 signatures. Shuttle checks for updates automatically and displays the release notes before installation.

## Self-host a Relay

Cloudflare Workers with D1, Durable Objects, and Static Assets is the primary deployment target. A single-instance Docker image with SQLite is also available for private deployments.

The public [deployment guide](https://shuttle.makesth.fun/docs/#deploy) covers both runtimes and all supported environment variables. Start from [`apps/relay/.env.example`](apps/relay/.env.example); keep credentials in the deployment environment rather than committing them.

## Development

Requirements:

- Node.js 24
- pnpm 11
- Swift 6.1 or later
- macOS 15 or later for the native client
- Codex Desktop for end-to-end collaboration

Install dependencies and run the local services:

```bash
pnpm install
pnpm start
```

Common checks:

```bash
pnpm lint
pnpm test:type
pnpm build
```

Build the native client separately:

```bash
cd apps/client
swift build
```

### Repository layout

- `apps/client`: native Swift menu bar app.
- `apps/companion`: local Node Companion and Codex host adapter.
- `apps/relay`: Hono Relay for Cloudflare Workers and Node.
- `apps/web`: authenticated account, invitation, task, device, and administration UI.
- `apps/site`: statically generated website and documentation.
- `packages/contracts`: shared protocol schemas.
- `packages/ui`: shared frontend components and styles.
- `plugins/shuttle`: packaged Codex Plugin, MCP runtime, and collaboration Skill.

## Security and privacy

Shuttle is designed to fail closed:

- Unshared tasks and local ports are not listed or discovered by the Relay.
- Every task read, message, and preview request is checked against the current authorization.
- Task content and message bodies pass through live connections and are not persisted by Shuttle.
- Revoking a grant, leaving a share, or disconnecting a device removes the corresponding access.
- Content read from another task is treated as untrusted context by the Shuttle Skill.

See the [privacy notice](https://shuttle.makesth.fun/privacy/) for stored data and operator responsibilities.

## License

[MIT](LICENSE)
