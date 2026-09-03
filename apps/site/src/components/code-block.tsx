"use client";

import { useState } from "react";

export function CodeBlock({
  children,
  copyable = false,
  title,
}: {
  children: string;
  copyable?: boolean;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-zinc-950 text-zinc-100 shadow-sm">
      {(title || copyable) && (
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-zinc-400">
          <span>{title}</span>
          {copyable && (
            <button type="button" onClick={copy} className="font-medium text-zinc-200 hover:text-white">
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-[13px] leading-6"><code>{children}</code></pre>
    </div>
  );
}
