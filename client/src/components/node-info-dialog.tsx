import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Trash2 } from "lucide-react"
import { removeNode, type ClusterNodeInfo } from "@/lib/api"
import { toast } from "sonner"

interface Props {
  nodeInfo: ClusterNodeInfo
  open: boolean
  onOpenChange: (open: boolean) => void
}

// The seed bootstraps gossip for every other node, so it is not removable.
const isSeed = (name: string) => /(^|[-_])seed([-_]|$)/.test(name)

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className="break-all text-right font-mono text-[11px]">{value}</span>
    </div>
  )
}

export function NodeInfoDialog({ nodeInfo, open, onOpenChange }: Props) {
  const owned = nodeInfo.ownedPartitions ?? []
  // The backend returns members in gossip/map order, which is non-deterministic
  // and reshuffles between polls even when membership is unchanged. Sort by id
  // for a stable render so the list doesn't visibly churn.
  const members = [...nodeInfo.members].sort((a, b) => a.id.localeCompare(b.id))
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const seed = isSeed(nodeInfo.name)

  async function handleRemove() {
    setRemoving(true)
    try {
      await removeNode(nodeInfo.id)
      toast.success(`Removed ${nodeInfo.name}`)
      setConfirmRemove(false)
      onOpenChange(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {nodeInfo.name} · node info
          </DialogTitle>
        </DialogHeader>

        {!nodeInfo.reachable ? (
          <p className="text-muted-foreground text-xs">
            Node is unreachable — no Inspect data available.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Row label="node id" value={nodeInfo.nodeId ?? "—"} />
              <Row label="generation" value={nodeInfo.generation ?? "—"} />
              <Row
                label="partitions (P)"
                value={String(nodeInfo.partitionsTotal ?? "—")}
              />
              <Row label="client addr" value={nodeInfo.clientAddr ?? "—"} />
              <Row label="node addr" value={nodeInfo.nodeAddr ?? "—"} />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">
                Owned partitions ({owned.length})
              </span>
              <div className="flex flex-wrap gap-1">
                {owned.length === 0 ? (
                  <span className="text-muted-foreground text-xs">none</span>
                ) : (
                  owned.map((p) => (
                    <Badge key={p} variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {p}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">
                Members ({members.length})
              </span>
              <ScrollArea className="max-h-48">
                <div className="flex flex-col gap-1 pr-2">
                  {members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 font-mono text-[11px]"
                    >
                      <span className="truncate" title={m.id}>
                        {m.id.slice(0, 8)}… @ {m.addr}
                      </span>
                      {m.dead && (
                        <Badge
                          variant="destructive"
                          className="shrink-0 px-1.5 py-0 text-[10px]"
                        >
                          dead
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        <div className="mt-1 flex items-center justify-between border-t pt-3">
          <span className="text-muted-foreground text-[11px]">
            {seed
              ? "The seed node cannot be removed."
              : "Stops and removes this node's container."}
          </span>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 gap-1 text-xs"
            disabled={seed || removing}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove node
          </Button>
        </div>
      </DialogContent>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {nodeInfo.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops and deletes the container. The cluster will detect the
              node as gone and rebalance its partitions across the remaining
              nodes. This cannot be undone (you can add a fresh node afterward).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleRemove()
              }}
              disabled={removing}
            >
              {removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
