import type { SVGProps } from "react"

import { cn } from "@/ui/libs/utils"

function ShuttleMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 128 128"
      fill="none"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        d="M29 68C40 44 55 44 64 64s24 20 35-4"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <circle cx="24" cy="79" r="9.5" stroke="currentColor" strokeWidth="5.5" />
      <circle cx="104" cy="49" r="9.5" stroke="currentColor" strokeWidth="5.5" />
    </svg>
  )
}

function ShuttleLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <ShuttleMark className="size-8" />
      <span className="text-lg font-semibold tracking-tight">Shuttle</span>
    </span>
  )
}

export { ShuttleLogo, ShuttleMark }
