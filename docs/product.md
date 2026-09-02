# Product guide

Shuttle is a collaboration layer for Codex Desktop. It connects people through explicitly shared Codex tasks without giving them control of the same local Codex window.

## Principles

### Everyone keeps their own workspace

The owner continues working in the original task. A collaborator uses Shuttle tools from a separate Codex task to read the shared context or send feedback. Shuttle does not provide a shared input box, remote desktop control, or concurrent editing of one Codex UI.

### Sharing is explicit

Tasks and localhost services are private by default. An owner must initiate sharing from the task and approve the recipient, permission, expiration, and any included services. The Relay does not provide a directory of unshared Codex tasks or scan local ports.

### Collaboration is live

Task reads, messages, and previews are routed to the owner's online Companion. If the owner or their device is offline, the request fails. Shuttle does not fall back to a stored task snapshot or queue a message for later delivery.

### Content stays out of Relay storage

The Relay stores the control plane required for collaboration: accounts, sessions, devices, task metadata, invitations, grants, and preview configuration. It does not persist Codex task content, collaboration message bodies, or delivery history.

## Roles

- **Owner**: shares a task, manages its collaborators, and optionally attaches local services.
- **Collaborator**: reads or messages a task that has been shared with them and may open its previews.
- **Relay administrator**: manages the deployment and can create, enable, or disable accounts.

A person can be an owner for one task and a collaborator on another.

## Task permissions

Each task share grants one of two permissions:

- `read`: read the complete shared task while its owner is online.
- `message`: includes read access and allows synchronous messages to the owner's task.

Preview access is an additional `canPreview` flag on the task grant. A local service is never shared independently from its parent task.

Owners can revoke a grant or stop sharing the task. Collaborators can leave a task shared with them. Either action removes access to the task and its services.

## Invitations

An owner can invite a specific email address or create an expiring link. Accepting an invitation always requires authentication and never bypasses registration, domain, or task permission policies.

When SMTP is configured, Shuttle can send invitation, one-time sign-in, and email verification messages. Invitation emails contain metadata and an acceptance URL, not Codex task content.

## Codex collaboration

The Shuttle Plugin adds an MCP server and a collaboration Skill to Codex. Common tools include:

- `share_thread`: open the native authorization window for the current task.
- `list_shared_threads`: list task shares available to the signed-in user.
- `read_shared_thread`: read an authorized task from its owner's online Companion.
- `send_shared_message`: send a synchronous message to a shared task.
- `share_local_service`: attach an explicitly named localhost service to an existing task share.

Deep links identify exact resources:

```text
shuttle://shared/<shared-task-id>
shuttle://service/<preview-service-id>
```

They are locators, not credentials. The Relay still checks the signed-in account and current grant on every request.

## Local previews

Owners may attach one or more explicit loopback HTTP or HTTPS services to a shared task. The preview path supports ordinary HTTP, streaming responses, SSE, WebSocket, and common development-server HMR behavior.

Shuttle does not scan for running services or expose LAN and public targets. Browser feedback is sent to the parent task through the same `send_shared_message` permission model.

## Accounts and Relay policy

Relay deployments can enable email sign-in, GitHub OAuth, or both. Email sign-in starts with an address and then uses either a password or a one-time link according to the account state.

Operators can:

- open or close registration;
- restrict sign-in to selected email domains;
- designate administrator accounts;
- configure SMTP for invitations and authentication messages;
- revoke accounts and connected devices.

## Current limitations

- The native client currently supports macOS only.
- The owner must be online for collaboration and previews.
- Docker deployments are single-instance because they use local SQLite and in-process live routing.
- LDAP, organizations, approval workflows, offline task copies, message queues, and shared UI control are not supported.
- Codex Desktop integration is version-sensitive and may require a Shuttle update after a Codex update.
