import { SiteShell } from "@/components/site-shell";

export default function Privacy() {
  return (
    <SiteShell>
      <article className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Privacy notice</h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated September 2, 2026</p>
        <div className="mt-12 space-y-10 text-base leading-8 text-muted-foreground">
          <section>
            <h2 className="text-2xl font-semibold text-foreground">Scope</h2>
            <p className="mt-3">Shuttle can be used with the hosted Relay or a self-hosted Relay. The operator of the Relay controls its database, infrastructure logs, email provider, access policy, backups, and retention. Review the operator&apos;s terms before signing in or accepting an invitation.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-foreground">Data stored by a Relay</h2>
            <p className="mt-3">A Relay stores account and session data, linked login identities, device metadata, task titles and identifiers, grants, invitations, and the localhost service configuration attached to a shared task. Administrators can view accounts and enable or disable non-administrator users.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-foreground">Live collaboration data</h2>
            <p className="mt-3">Authorized task content, collaboration messages, and preview traffic pass through live Shuttle connections so they can reach the requester or owner. Shuttle application code does not persist task content, message bodies, delivery records, preview request bodies, or preview response bodies.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-foreground">Local data</h2>
            <p className="mt-3">The macOS app stores its Relay device credential in Keychain. The local Companion keeps only the runtime state required to connect the active Shuttle Plugin, route live task operations, and proxy services that the owner explicitly configured.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-foreground">Sharing and deletion</h2>
            <p className="mt-3">Owners can revoke task grants, invitations, devices, and previews. Collaborators can leave a task shared with them. Removing a share deletes its Relay metadata and permissions according to the operator&apos;s database and backup-retention policy; it does not delete either participant&apos;s local Codex task.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-foreground">Security boundaries</h2>
            <p className="mt-3">Unshared tasks and ports are not listed by the Relay. Deep links identify resources but do not replace authentication or authorization. Every live operation is checked against the current account, device, and task grant.</p>
          </section>
          <section>
            <h2 className="text-2xl font-semibold text-foreground">Compatibility</h2>
            <p className="mt-3">Shuttle&apos;s Codex Desktop integration is version-sensitive. If the integration is unavailable, Shuttle fails the task operation instead of discovering or reading unrelated local tasks. Review release notes before updating Shuttle or Codex Desktop in a sensitive environment.</p>
          </section>
        </div>
      </article>
    </SiteShell>
  );
}
