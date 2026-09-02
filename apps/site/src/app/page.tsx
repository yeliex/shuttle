import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { SiteShell } from "@/components/site-shell";

export default function Home() {
  return (
    <SiteShell>
      <section className="mx-auto grid w-full max-w-6xl gap-14 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-28">
        <div className="max-w-3xl">
          <h1 className="text-balance text-5xl font-semibold tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            Share the task. Keep your workspace.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
            Shuttle connects collaborators through explicitly shared Codex tasks. Read context,
            send feedback, or open an approved local preview while everyone stays in their own task.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href="https://github.com/yeliex/shuttle/releases/latest"
              className="rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download for macOS
            </a>
            <Link href="/docs/" className="rounded-md border px-5 py-3 text-sm font-medium hover:bg-muted">
              Read the docs
            </Link>
          </div>
        </div>
        <CodeBlock title="From your own Codex task">
          {'Read shuttle://shared/7d5d… and tell the owner:\n“Please check the empty state on mobile.”'}
        </CodeBlock>
      </section>

      <section className="border-y bg-muted/35">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Private by default. Live when shared.
          </h2>
          <div className="mt-12 divide-y border-y">
            {[
              ["01", "Authorize", "The owner chooses an existing task, a recipient or link, and the exact permission."],
              ["02", "Collaborate", "The collaborator reads live context or sends a synchronous message from their own Codex task."],
              ["03", "Revoke", "The owner can remove access at any time without sharing control of their desktop UI."],
            ].map(([number, title, description]) => (
              <div key={number} className="grid gap-3 py-7 sm:grid-cols-[4rem_10rem_1fr] sm:items-baseline">
                <span className="font-mono text-sm text-muted-foreground">{number}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="max-w-2xl leading-7 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 lg:grid-cols-3">
        <div>
          <h2 className="text-xl font-semibold">Shared tasks</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Read an authorized task directly from its owner&apos;s online Companion. Shuttle keeps no task snapshot.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Synchronous feedback</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            A successful send means the owner&apos;s Codex task accepted the message. There is no Relay message queue.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Local previews</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Attach an explicit localhost service with HTTP, SSE, WebSocket, and common HMR support to the task share.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="grid gap-10 rounded-2xl bg-zinc-950 px-7 py-10 text-white sm:px-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Use the hosted Relay or run your own.</h2>
            <p className="mt-3 max-w-2xl leading-7 text-zinc-400">
              Deploy on Cloudflare Workers with D1 and Durable Objects, or run the single-instance Docker and SQLite build on your own infrastructure.
            </p>
          </div>
          <Link href="/docs/#deploy" className="w-fit rounded-md bg-white px-5 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200">
            Deployment guide
          </Link>
        </div>
        <p className="mt-6 text-sm leading-6 text-muted-foreground">
          Shuttle is an early macOS release and its Codex Desktop integration is version-sensitive. Review the compatibility and privacy notes before using it with sensitive work.
        </p>
      </section>
    </SiteShell>
  );
}
