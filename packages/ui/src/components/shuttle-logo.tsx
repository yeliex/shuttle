import type { SVGProps } from "react"

import { cn } from "@/ui/libs/utils"

function ShuttleMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="149 149 418 418"
      fill="none"
      className={cn("shrink-0", className)}
      {...props}
    >
      <style>{`
        .shuttle-arrow-seed {
          animation: shuttle-arrow-to-source 5s cubic-bezier(.65, 0, .35, 1) infinite;
          transform-box: fill-box;
          transform-origin: center;
        }
        .shuttle-connection { animation: shuttle-connection-center 5s cubic-bezier(.65, 0, .35, 1) infinite; }
        .shuttle-wave-base { animation: shuttle-wave-state 5s ease-in-out infinite; }
        .shuttle-source-node, .shuttle-target-node {
          animation: shuttle-node 5s cubic-bezier(.34, 1.56, .64, 1) infinite;
          opacity: 0;
          transform-box: fill-box;
          transform-origin: center;
        }
        .shuttle-signal {
          animation: shuttle-signal-flow 5s cubic-bezier(.65, 0, .35, 1) infinite;
          opacity: 0;
          stroke-dasharray: 1;
          stroke-dashoffset: 1;
        }
        @keyframes shuttle-arrow-to-source {
          0%, 10%, 90%, 100% { opacity: 1; transform: translate(0, 0) scale(1); }
          23%, 77% { opacity: .72; transform: translate(20px, 49px) scale(.16); }
          25%, 75% { opacity: 0; transform: translate(20px, 49px) scale(.16); }
        }
        @keyframes shuttle-connection-center {
          0%, 10%, 90%, 100% { transform: translateX(0); }
          25%, 75% { transform: translateX(-51px); }
        }
        @keyframes shuttle-wave-state {
          0%, 10%, 90%, 100% { stroke: currentColor; }
          25%, 75% { stroke: #a1a1aa; }
        }
        @keyframes shuttle-node {
          0%, 12%, 88%, 100% { opacity: 0; transform: scale(.18); }
          25%, 75% { opacity: 1; transform: scale(1); }
        }
        @keyframes shuttle-signal-flow {
          0%, 28% { opacity: 0; stroke-dashoffset: 1; }
          32% { opacity: 1; stroke-dashoffset: 1; }
          55%, 68% { opacity: 1; stroke-dashoffset: 0; }
          72%, 100% { opacity: 0; stroke-dashoffset: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .shuttle-arrow-seed, .shuttle-signal { display: none; }
          .shuttle-connection { animation: none; transform: translateX(-51px); }
          .shuttle-wave-base { animation: none; stroke: currentColor; }
          .shuttle-source-node, .shuttle-target-node { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
      <path
        d="M248 248c11-38 46-66 87-66 25 0 47 10 63 26 8-2 16-3 24-3 49 0 88 40 88 89 0 8-1 16-3 24 16 16 26 38 26 63 0 41-28 76-65 87-11 37-46 65-87 65-25 0-47-10-63-26-8 2-16 3-24 3-49 0-88-39-88-88 0-8 1-16 3-24-16-16-26-38-26-63 0-41 28-76 65-87Z"
        stroke="currentColor"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="shuttle-arrow-seed"
        d="M277 309 303.4 357.7c1.2 2.1 1.1 4-.1 6.1L277 410"
        stroke="currentColor"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="shuttle-connection">
        <path
          className="shuttle-wave-base"
          d="M376 409c15-11 45 11 60 0"
          stroke="currentColor"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          className="shuttle-signal"
          d="M376 409c15-11 45 11 60 0"
          pathLength="1"
          stroke="#5b7cff"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <circle className="shuttle-source-node" cx="361" cy="409" r="11" fill="white" stroke="currentColor" strokeWidth="8.5" />
        <circle className="shuttle-target-node" cx="451" cy="409" r="11" fill="white" stroke="currentColor" strokeWidth="8.5" />
      </g>
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
