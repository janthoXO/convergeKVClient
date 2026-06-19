import { Toaster } from "@/components/ui/sonner"
import { ClusterGraph } from "@/components/cluster-graph"

export default function App() {
  return (
    <div className="flex h-svh flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">
          convergeKV · cluster debug
        </h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded-full bg-slate-500" />
            shares partition (own view)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded-full bg-green-500" />
            selected partition
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-green-500 bg-green-500" />
            port: click to isolate
          </span>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <ClusterGraph />
      </main>
      <Toaster />
    </div>
  )
}
