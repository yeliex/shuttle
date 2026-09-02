export function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-zinc-950 text-zinc-100 shadow-sm">
      {title && <div className="border-b border-white/10 px-4 py-2 text-xs text-zinc-400">{title}</div>}
      <pre className="overflow-x-auto p-4 text-[13px] leading-6"><code>{children}</code></pre>
    </div>
  );
}
