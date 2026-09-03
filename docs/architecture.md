# Architecture

Shuttle separates local Codex access from shared identity and authorization. Codex task operations happen on the owner's Mac; the Relay authenticates users, enforces grants, and routes live requests.

## Components

```text
┌──────────────────────────┐
│ Owner's Codex task       │
└────────────┬─────────────┘
             │ local host adapter
┌────────────▼─────────────┐
│ Shuttle macOS app        │
│ + Node Companion         │
└────────────┬─────────────┘
             │ authenticated live connection
┌────────────▼─────────────┐
│ Shuttle Relay            │
│ auth · ACL · live route  │
└───────┬───────────┬──────┘
        │           │
┌───────▼──────┐ ┌──▼────────────────────┐
│ Web app      │ │ Collaborator's Codex  │
│ + site/docs  │ │ + Shuttle Plugin      │
└──────────────┘ └───────────────────────┘
```

### macOS app

The native Swift menu bar app owns user-facing system integration: Relay sign-in, the authorization window, Companion lifecycle, Plugin setup, local device credentials, deep links, and Sparkle updates. On incomplete setup it presents one setup window with independent Plugin installation, Relay selection, and sign-in controls. The hosted Relay is selected by default, and the same window remains available from the menu bar for Plugin checks, Relay changes, and renewed sign-in.

### Companion

The TypeScript Companion runs locally with the Node runtime available in Codex Desktop. While Relay credentials exist, the app keeps it running and restarts it after an unexpected exit. It maintains the authenticated Relay connection, registers task capabilities supplied by the active Shuttle Plugin, calls the Codex host adapter, and proxies explicitly configured localhost services.

Codex-specific host details remain inside this adapter. Other packages use Shuttle's typed local protocol and do not depend on Codex bundle layout.

### Relay

The Hono Relay provides authentication, task metadata, invitations, grants, device routing, and preview transport. It has two runtime adapters:

- Cloudflare Workers with D1, Durable Objects, and Static Assets.
- Node.js with SQLite and an in-process connection hub for single-instance Docker deployments.

Both runtimes expose the same HTTP routes, authorization semantics, and database model.

### Web and site

The authenticated Vite application handles sign-in, invitations, task shares, devices, account settings, and administration. It deliberately does not display complete Codex task content or send collaboration messages.

The Next.js site is statically generated. Its output and the Vite application are assembled into the Relay's static assets so one deployment serves the website, documentation, Web app, and API.

### Codex Plugin

The packaged Plugin contains the Shuttle MCP runtime and collaboration Skill. It registers the current task with the local Companion and exposes exact tools for sharing, reading, messaging, and preview configuration. If the local Companion is unavailable on macOS, the MCP runtime launches the installed Shuttle app and retries the local connection before failing.

## Task sharing flow

1. The Shuttle Plugin registers the current Codex task with the local Companion.
2. The owner invokes `share_thread` from that task.
3. The macOS app presents an authorization window and collects the owner-approved permission, recipient or link, expiration, and optional services.
4. The Companion creates task metadata, grants, and invitations through the Relay.
5. A collaborator accepts the invitation and receives an exact `shuttle://shared/<id>` reference.
6. A read or message request reaches the Relay, which checks the current session and grant before routing it to the owner's online Companion.
7. The Companion performs the task operation locally and returns the result synchronously.

The Relay has no path for discovering an unshared local task. A nonexistent task is not created by sharing or message delivery.

## Preview flow

A preview service belongs to an existing task share and records its display name, loopback URL, and owner device. Access comes from the parent task's `canPreview` grant.

For HTTP and SSE, the Relay forwards request and response streams over the live device connection. WebSocket traffic remains bidirectional and preserves the subprotocol and close semantics required by development servers. Root-relative HMR requests are associated with the preview that opened the browser session.

Every new request rechecks the task grant. Revoking preview access also closes active preview connections.

## Stored data

The shared data model contains:

- users, linked accounts, sessions, and verification records;
- connected devices and revocation state;
- shared task metadata;
- task grants and invitations;
- preview service configuration.

The Relay does not store:

- Codex task pages or turns;
- collaboration message bodies or delivery records;
- offline task snapshots;
- a queue of messages waiting for an owner;
- preview request or response bodies.

Task reads and messages are correlated only for the lifetime of one live request.

## Authentication and authorization

Relay authentication can use email/password, one-time email links, GitHub OAuth, or a configured combination. Global registration and email-domain policies apply before task grants are considered.

The Relay applies authorization at every boundary:

- account session for Web and collaboration APIs;
- independent device credential for Companion connections;
- task grant for reads and messages;
- `canPreview` on the task grant for local services;
- short-lived signed preview cookie for browser transport.

Device credentials are stored in `~/Library/Application Support/Shuttle/credentials.json` with owner-only file permissions. Deployment secrets come from the runtime environment and are not part of shared protocols or logs.

## Host compatibility boundary

Codex Desktop integration is not a stable cross-platform service contract. Shuttle isolates that dependency behind the local host adapter and fails closed when the active task cannot register or the adapter is unavailable. The Relay cannot call Codex directly and receives no ambient access to tasks on an owner's machine.

This boundary keeps version-sensitive integration details out of the database, Web application, and network protocol while allowing the local adapter to evolve with Codex Desktop.

## Monorepo layout

- `apps/client`: native Swift menu bar application.
- `apps/companion`: local Companion, host adapter, MCP bridge, and preview proxy.
- `apps/relay`: shared Hono application and Cloudflare/Node runtime adapters.
- `apps/web`: authenticated Vite + React application.
- `apps/site`: statically generated Next.js website and documentation.
- `packages/contracts`: shared schemas and transport types.
- `packages/ui`: shared Tailwind and shadcn/ui sources.
- `plugins/shuttle`: distributable Codex Plugin.

## Non-goals

Shuttle does not provide shared control of one Codex UI, remote desktop access, automatic task or port discovery, offline task storage, message queues, LDAP, organization workflows, or multi-instance coordination for the SQLite runtime.
