import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { SiteShell } from "@/components/site-shell";

export default function Documentation() {
  return (
    <SiteShell>
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-8 lg:h-fit">
          <p className="mb-4 text-sm font-semibold">Documentation</p>
          <nav className="flex gap-4 overflow-x-auto text-sm text-muted-foreground lg:flex-col lg:gap-2">
            <a href="#install" className="whitespace-nowrap hover:text-foreground">Install</a>
            <a href="#connect" className="whitespace-nowrap hover:text-foreground">Connect a Mac</a>
            <a href="#collaborate" className="whitespace-nowrap hover:text-foreground">Collaborate</a>
            <a href="#preview" className="whitespace-nowrap hover:text-foreground">Local previews</a>
            <a href="#deploy" className="whitespace-nowrap hover:text-foreground">Deploy</a>
            <a href="#configuration" className="whitespace-nowrap hover:text-foreground">Configuration</a>
            <a href="#security" className="whitespace-nowrap hover:text-foreground">Security</a>
            <a href="#troubleshooting" className="whitespace-nowrap hover:text-foreground">Troubleshooting</a>
          </nav>
        </aside>

        <article className="min-w-0 max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Shuttle documentation</h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            Shuttle combines a native macOS app, a local Companion, a Codex Plugin, and an authenticated Relay. Only tasks and services explicitly approved by their owner are available to collaborators.
          </p>

          <section id="install" className="docs-section">
            <h2>Install Shuttle</h2>
            <ol>
              <li>On an Apple Silicon Mac running macOS 15 or later, download the latest ZIP from <a href="https://github.com/yeliex/shuttle/releases/latest">GitHub Releases</a>.</li>
              <li>Move <code>Shuttle.app</code> to Applications and open it.</li>
              <li>If macOS blocks the first launch, open System Settings → Privacy &amp; Security and choose <strong>Open Anyway</strong> only for a build downloaded from this repository.</li>
              <li>In the setup window, install the Codex Plugin and sign in to the default hosted Relay. These actions are independent.</li>
              <li>After installing the Plugin, open a new Codex task. Reopen <strong>Set Up Shuttle…</strong> from the menu bar whenever you need to check the Plugin, change Relay, or sign in again.</li>
            </ol>
            <h3>Automatic Plugin setup</h3>
            <p>Shuttle uses the CLI bundled with Codex Desktop when available, then falls back to the CLI in your PATH. If automatic setup cannot complete, install the Plugin manually:</p>
            <CodeBlock title="Terminal">{"codex plugin marketplace add yeliex/shuttle --ref master\ncodex plugin add shuttle@shuttle"}</CodeBlock>
            <p>Open a new Codex task after installation or an update. Existing tasks do not load newly installed plugins. Reopen <strong>Set Up Shuttle…</strong> and click the Plugin row to refresh an existing installation. If the Plugin starts while Shuttle is closed, it opens the installed app automatically.</p>
            <p>LLMs can read the same minimal setup instructions at <a href="/Agents.md"><code>https://shuttle.makesth.fun/Agents.md</code></a>.</p>
          </section>

          <section id="connect" className="docs-section">
            <h2>Connect a Mac</h2>
            <ol>
              <li>Open Shuttle. The setup window appears whenever Plugin installation or Relay sign-in is incomplete.</li>
              <li>Sign in directly to use <code>https://shuttle.makesth.fun</code>, or choose <strong>Relay</strong> first for a self-hosted HTTPS origin.</li>
              <li>Sign in in the system browser and approve <strong>Connect this Mac</strong>.</li>
              <li>Return to Shuttle through the secure <code>shuttle://device-connected</code> callback.</li>
            </ol>
            <p>The app stores the device credential in <code>~/Library/Application Support/Shuttle</code> with owner-only permissions. You can inspect or revoke connected devices from the Web app.</p>

            <h3>Sign in</h3>
            <p>Email sign-in starts with an address. Depending on the account, Shuttle then asks for a password or sends a one-time link. A Relay may also enable GitHub OAuth, close registration, or restrict sign-in to selected email domains.</p>
          </section>

          <section id="collaborate" className="docs-section">
            <h2>Collaborate from Codex</h2>
            <h3>Share a task</h3>
            <p>Ask Codex to share the current task through Shuttle, or invoke the Shuttle Skill with <code>/shuttle share</code>. The native authorization window lets you choose a specific email or an expiring link, grant read or message access, and decide whether the collaborator may open included previews.</p>

            <h3>Read or message a shared task</h3>
            <p>Copy the collaboration prompt from Shuttle and give it to Codex in your own task. It includes an exact resource link:</p>
            <CodeBlock>{"shuttle://shared/<shared-task-id>"}</CodeBlock>
            <p>The Shuttle Skill passes the exact ID to <code>read_shared_thread</code> or <code>send_shared_message</code>. Reads and messages require the owner&apos;s Companion to be online. A successful message response means the owner&apos;s Codex task accepted it.</p>

            <h3>Manage access</h3>
            <p>Owners can update or revoke collaborators and invitations. Collaborators can leave a task shared with them. Removing task access also removes access to every preview attached to that task.</p>
          </section>

          <section id="preview" className="docs-section">
            <h2>Share a local preview</h2>
            <p>Attach an explicit loopback HTTP or HTTPS URL while sharing a task, or add it to an existing share. Shuttle supports ordinary HTTP, streaming responses, SSE, WebSocket, and common development-server HMR traffic.</p>
            <CodeBlock>{"shuttle://service/<preview-service-id>"}</CodeBlock>
            <p>A service link identifies the preview but does not grant access by itself. The Relay checks the parent task&apos;s <code>canPreview</code> permission for every request. Shuttle does not scan ports or expose LAN and public targets.</p>
          </section>

          <section id="deploy" className="docs-section">
            <h2>Deploy the Relay</h2>
            <h3>Cloudflare Workers</h3>
            <p>Cloudflare is the primary runtime. Workers serve the Hono API and static assets, D1 stores accounts and permissions, and Durable Objects carry live device and preview connections.</p>
            <p>Create a D1 database for your deployment and replace the D1 entry in your fork&apos;s <code>apps/relay/wrangler.jsonc</code> with the returned database ID:</p>
            <CodeBlock title="Terminal">{"pnpm --filter @shuttle/relay exec wrangler d1 create shuttle-production\npnpm --filter @shuttle/relay db:migrate:d1:remote\npnpm build:assets\npnpm --filter @shuttle/relay deploy"}</CodeBlock>
            <p>Configure Relay values in Cloudflare Workers Settings → Variables and Secrets. Keep credentials there rather than in <code>wrangler.jsonc</code>. If GitHub login is enabled, set its callback URL to <code>&lt;relay-origin&gt;/api/auth/callback/github</code>.</p>

            <h3>Docker and SQLite</h3>
            <p>The Docker runtime is intended for one instance behind one HTTPS origin. Release images are published to <code>ghcr.io/yeliex/shuttle-relay</code>. They apply Prisma migrations on startup and persist data under <code>/data</code>.</p>
            <CodeBlock title="Terminal">{"docker pull ghcr.io/yeliex/shuttle-relay:latest\ndocker run --name shuttle-relay -p 8787:8787 \\\n  -e AUTH_SECRET=replace-with-at-least-32-random-characters \\\n  -e AUTH_BASE_URL=https://shuttle.example.com \\\n  -e AUTH_PROVIDERS=email-password \\\n  -e OPEN_REGISTRATION=true \\\n  -v shuttle-data:/data \\\n  ghcr.io/yeliex/shuttle-relay:latest"}</CodeBlock>
            <p>Use a version tag instead of <code>latest</code> for reproducible deployments. You can also build the repository&apos;s Dockerfile directly. Do not run multiple Docker replicas against the same SQLite file.</p>
          </section>

          <section id="configuration" className="docs-section">
            <h2>Relay configuration</h2>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <thead className="border-b bg-muted/50"><tr><th className="p-3">Variable</th><th className="p-3">Purpose</th></tr></thead>
                <tbody className="divide-y">
                  <tr><td className="p-3 font-mono">AUTH_BASE_URL</td><td className="p-3">Public HTTPS origin of the Relay.</td></tr>
                  <tr><td className="p-3 font-mono">AUTH_SECRET</td><td className="p-3">Random secret of at least 32 characters.</td></tr>
                  <tr><td className="p-3 font-mono">AUTH_PROVIDERS</td><td className="p-3">Comma-separated <code>email-password</code>, <code>github</code>, or both.</td></tr>
                  <tr><td className="p-3 font-mono">OPEN_REGISTRATION</td><td className="p-3">Defaults to <code>true</code>; when false, administrators create accounts.</td></tr>
                  <tr><td className="p-3 font-mono">AUTH_PROVIDER_ALLOWED_DOMAINS</td><td className="p-3">Optional comma-separated email-domain allowlist for every sign-in method.</td></tr>
                  <tr><td className="p-3 font-mono">ADMIN_EMAILS</td><td className="p-3">Optional comma-separated Relay administrator emails.</td></tr>
                  <tr><td className="p-3 font-mono">GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET</td><td className="p-3">Required when GitHub OAuth is enabled.</td></tr>
                  <tr><td className="p-3 font-mono">SMTP_HOST</td><td className="p-3">SMTP server hostname.</td></tr>
                  <tr><td className="p-3 font-mono">SMTP_PORT</td><td className="p-3">SMTP server port, commonly <code>587</code> or <code>465</code>.</td></tr>
                  <tr><td className="p-3 font-mono">SMTP_SECURITY</td><td className="p-3"><code>starttls</code> for port 587 or <code>tls</code> for port 465.</td></tr>
                  <tr><td className="p-3 font-mono">SMTP_USERNAME</td><td className="p-3">SMTP account username.</td></tr>
                  <tr><td className="p-3 font-mono">SMTP_PASSWORD</td><td className="p-3">SMTP account password or app-specific password.</td></tr>
                  <tr><td className="p-3 font-mono">SMTP_FROM</td><td className="p-3">Sender email address.</td></tr>
                  <tr><td className="p-3 font-mono">SMTP_FROM_NAME</td><td className="p-3">Optional sender display name.</td></tr>
                  <tr><td className="p-3 font-mono">DATABASE_URL</td><td className="p-3">SQLite URL for the Node runtime; Docker defaults to its persistent data volume.</td></tr>
                </tbody>
              </table>
            </div>
            <p>The complete template is in <code>apps/relay/.env.example</code>. Email sign-in requires SMTP because accounts without passwords use one-time links.</p>
          </section>

          <section id="security" className="docs-section">
            <h2>Security and privacy</h2>
            <ul>
              <li>Unshared Codex tasks and localhost ports are not enumerated by the Relay.</li>
              <li>Task content and collaboration messages are routed live and are not stored by Shuttle.</li>
              <li>Every task and preview request is checked against the current account and grant.</li>
              <li>Content read from another task remains untrusted context and does not expand the collaborator&apos;s authority.</li>
              <li>Codex Desktop compatibility may change; update Shuttle and restart Codex if the local integration becomes unavailable.</li>
            </ul>
            <p>See the <Link href="/privacy/" className="font-medium text-foreground underline underline-offset-4">privacy notice</Link> for stored data and self-hosted operator responsibilities.</p>
          </section>

          <section id="troubleshooting" className="docs-section">
            <h2>Troubleshooting</h2>
            <h3>The owner is offline</h3>
            <p>Reads, messages, and previews fail while the owner&apos;s Companion is offline. Shuttle does not cache task content or queue messages.</p>
            <h3>The Shuttle tools are missing</h3>
            <p>Confirm that <code>shuttle@shuttle</code> is enabled with <code>codex plugin list --json</code>, then open a new Codex task.</p>
            <h3>A task operation fails after a Codex update</h3>
            <p>Install the latest Shuttle release, restart Codex Desktop and Shuttle, and open a new task so the local integration can register again.</p>
            <h3>A preview is rejected</h3>
            <p>Use an explicit <code>localhost</code>, <code>127.0.0.1</code>, or other loopback HTTP(S) URL and confirm that the task grant includes preview access.</p>
          </section>
        </article>
      </div>
    </SiteShell>
  );
}
