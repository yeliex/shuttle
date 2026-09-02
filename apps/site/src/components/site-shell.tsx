import type { ReactNode } from "react";
import Link from "next/link";
import { ShuttleLogo } from "@/ui/shuttle-logo";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b bg-background/95">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="Shuttle home">
            <ShuttleLogo />
          </Link>
          <div className="flex items-center gap-5 text-sm font-medium">
            <a
              href="https://github.com/yeliex/shuttle/releases/latest"
              className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Download
            </a>
            <Link href="/docs/" className="text-muted-foreground transition-colors hover:text-foreground">
              Documentation
            </Link>
            <a
              href="https://github.com/yeliex/shuttle"
              className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              GitHub
            </a>
            <a
              href="/app/"
              className="rounded-md bg-primary px-3 py-2 text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open app
            </a>
          </div>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Shuttle is open source under the MIT License.</p>
          <div className="flex gap-5">
            <Link href="/privacy/" className="hover:text-foreground">Privacy</Link>
            <a href="https://github.com/yeliex/shuttle" className="hover:text-foreground">Source</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
