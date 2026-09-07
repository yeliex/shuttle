import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { SiteShell } from "@/components/site-shell";

export default function Home() {
  return (
    <SiteShell>
      <section className="mx-auto grid w-full max-w-6xl gap-14 px-6 py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:py-28">
        <div className="max-w-3xl">
          <h1 className="text-balance text-5xl font-semibold tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            Bring the why along with the work.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
            Connect product, design, and engineering through the Codex conversations behind your PRD.
            Share the context, send requirement changes to teammates&apos; tasks, and review local work remotely.
            Everyone keeps their own workspace.
          </p>
          <div className="mt-9 flex flex-wrap items-start gap-3">
            <div className="flex flex-col gap-2">
              <a
                href="https://github.com/yeliex/shuttle/releases/latest"
                className="rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download for macOS
              </a>
              <span className="text-xs text-muted-foreground">Apple Silicon · macOS 15 or later</span>
            </div>
            <Link href="/docs/" className="rounded-md border px-5 py-3 text-sm font-medium hover:bg-muted">
              Read the docs
            </Link>
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Set up with Codex</h2>
          <p className="mt-2 leading-7 text-muted-foreground">
            Copy this prompt into a Codex task to install and initialize Shuttle.
          </p>
          <div className="mt-5 [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
            <CodeBlock title="Prompt" copyable>
              Read https://shuttle.makesth.fun/Agents.md and set up Shuttle for this Codex task.
            </CodeBlock>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/35">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            From product decisions to a working preview.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            The PRD and prototype describe what to build. The conversation behind them explains why.
            Give your teammates&apos; agents access to both, so each handoff carries the decisions forward.
          </p>
          <div className="mt-12 divide-y border-y">
            {[
              ["01", "Share the why", "Product adds a shared Codex conversation link to the PRD alongside the prototype. Authorized teammates can ask their agents to read the complete persisted history."],
              ["02", "Build on context", "Designers and engineers continue in their own local Codex tasks, with the product decisions available alongside their own files and tools."],
              ["03", "Send the change", "When requirements change, ask your agent to send the update to teammates’ tasks shared back with message permission. They can read the source conversation for the reasoning."],
              ["04", "Review the result", "Engineering shares an approved local preview. Product and design open the running work remotely and send feedback from their own Codex tasks."],
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
          <h2 className="text-xl font-semibold">Context behind the PRD</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Share a conversation link alongside your documents so teammates can read the constraints,
            alternatives, and decisions behind the requirements. Access covers the whole shared task.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Updates where work happens</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Send changes and feedback directly to an authorized teammate&apos;s task.
            Updates are sent explicitly; successful delivery means the message is queued, with processing to follow.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold">Review without local setup</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Open an engineer&apos;s approved local service in your browser without setting up their development
            environment. The owner chooses who can access it and can revoke access at any time.
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
          Shuttle is an early macOS release for Codex Desktop. The owner&apos;s Companion must be online for reads,
          messages, and previews. Review the compatibility and privacy notes before using it with sensitive work.
        </p>
      </section>
    </SiteShell>
  );
}
