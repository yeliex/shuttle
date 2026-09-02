# Shuttle contributor guide

Shuttle is a collaboration layer for Codex Desktop. Each participant works in their own local Codex task; Shuttle only reads, messages, or previews resources that an owner explicitly shares.

Read these files before changing product behavior:

- `README.md` for installation, development, and repository orientation.
- `docs/product.md` for the public sharing model and limitations.
- `docs/architecture.md` for component, storage, and security boundaries.

## Repository map

- `apps/client`: native Swift menu bar app and authorization UI.
- `apps/companion`: local Node Companion and Codex host adapter.
- `apps/relay`: Hono Relay for Cloudflare Workers and Node.
- `apps/web`: authenticated Vite + React application.
- `apps/site`: static Next.js website and documentation.
- `packages/contracts`: shared protocol schemas.
- `packages/ui`: shared frontend components, styles, hooks, and utilities.
- `plugins/shuttle`: packaged Codex Plugin, MCP runtime, and Skill.

Use a more specific `AGENTS.md` when one exists below the file being changed.

## Development guidance

- Keep changes small and tied to an explicit product requirement.
- Read existing callers and helpers before introducing another abstraction.
- Add dependencies with pnpm commands rather than editing dependency fields directly.
- Keep Codex-specific integration inside the Companion host adapter.
- Never persist or log Codex task content, collaboration message bodies, credentials, or preview bodies.
- Keep Cloudflare and Node runtime behavior aligned at the Hono route and repository layers.
- Preserve the fail-closed behavior for missing devices, tasks, permissions, and host capabilities.

## Frontend guidance

- `apps/site` remains statically generated; authenticated functionality belongs in `apps/web`.
- Use SWR for server state in `apps/web`; use stable keys, `null` for disabled queries, and targeted invalidation after mutations.
- Put shared primitives in `packages/ui`; keep page-specific code near the page.
- Import shared UI source through `@/ui/*`. Run the shadcn CLI from `packages/ui`.

## Verification

Choose the smallest checks that cover the change. Before committing a cross-cutting change, run:

```bash
pnpm lint
pnpm test:type
pnpm build
```

For Swift changes, also build or test from `apps/client`. For route or static-asset changes, verify the assembled Relay over real HTTP. Always review the diff and run `git diff --check` before committing.

Use conventional commit messages and keep release credentials outside the repository.
