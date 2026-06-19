import { useState, useCallback, useRef } from "react"
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Info } from "lucide-react"
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
import { NodeEntriesCard } from "./node-entries-card"
import { AddKvDialog } from "./add-kv-dialog"
import { EditKvDialog } from "./edit-kv-dialog"
import { NodeInfoDialog } from "./node-info-dialog"
import { setNodeNetwork } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { ClusterNodeInfo, DebugDoc } from "@/lib/api"

export interface KvNodeData extends Record<string, unknown> {
  nodeInfo: ClusterNodeInfo
  allNodes: ClusterNodeInfo[]
  pinnedNodeId: string | null
  onTogglePin: (id: string) => void
  handlePosition: Position
  selectedPartition: number | null
}

export type KvNodeType = Node<KvNodeData, "kvNode">

export function KvNode({ id, data }: NodeProps<KvNodeType>) {
  const {
    nodeInfo,
    pinnedNodeId,
    onTogglePin,
    handlePosition,
    selectedPartition,
  } = data
  const isPinned = pinnedNodeId === id
  const [hovered, setHovered] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [addKvOpen, setAddKvOpen] = useState(false)
  const [editKvDoc, setEditKvDoc] = useState<DebugDoc | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [optimisticAttached, setOptimisticAttached] = useState<boolean | null>(
    null
  )
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Once real data confirms the optimistic guess, defer back to it so later
  // external changes to networkAttached keep showing up live.
  const isAttached =
    optimisticAttached !== null &&
    optimisticAttached !== nodeInfo.networkAttached
      ? optimisticAttached
      : nodeInfo.networkAttached
  const isOpen = isPinned || hovered
  const ownsSelected =
    selectedPartition === null ||
    nodeInfo.ownedPartitions.includes(selectedPartition)

  function startHover() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    setHovered(true)
  }
  function endHover() {
    hoverTimerRef.current = setTimeout(() => setHovered(false), 150)
  }

  const handlePortClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmOpen(true)
  }, [])

  const handleNetworkAction = useCallback(async () => {
    const action = isAttached ? "disconnect" : "connect"
    setOptimisticAttached(!isAttached)
    setConfirmOpen(false)
    try {
      await setNodeNetwork(nodeInfo.name, action)
      toast.success(
        `${nodeInfo.name} ${action === "disconnect" ? "disconnected from" : "reconnected to"} network`
      )
    } catch (err) {
      setOptimisticAttached(null)
      toast.error((err as Error).message)
    }
  }, [isAttached, nodeInfo.name])

  const shortId = nodeInfo.nodeId ? nodeInfo.nodeId.slice(0, 8) : nodeInfo.name

  return (
    <>
      <HoverCard open={isOpen} onOpenChange={() => {}}>
        <HoverCardTrigger asChild>
          <div
            className="cursor-pointer"
            onMouseEnter={startHover}
            onMouseLeave={endHover}
            onClick={() => onTogglePin(id)}
          >
            <Card
              className={cn(
                "w-44 shadow-md transition-shadow select-none",
                isPinned && "ring-2 ring-primary",
                !isAttached && "opacity-60",
                !ownsSelected && "opacity-30 grayscale"
              )}
            >
              <CardHeader className="pt-3 pb-1">
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="truncate font-mono text-xs font-semibold"
                    title={nodeInfo.nodeId ?? nodeInfo.name}
                  >
                    {shortId}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Badge
                      variant={isAttached ? "default" : "secondary"}
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {isAttached ? "up" : "isolated"}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      title="Node info"
                      onClick={(e) => {
                        e.stopPropagation()
                        setInfoOpen(true)
                      }}
                    >
                      <Info className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {nodeInfo.name}
                </p>
                {nodeInfo.generation && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    gen {nodeInfo.generation}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  {nodeInfo.ownedPartitions.length} partition
                  {nodeInfo.ownedPartitions.length !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>
          </div>
        </HoverCardTrigger>

        <HoverCardContent
          side="top"
          align="start"
          className="w-80"
          onMouseEnter={startHover}
          onMouseLeave={endHover}
        >
          <NodeEntriesCard
            nodeId={nodeInfo.id}
            nodeName={shortId}
            isOpen={isOpen}
            reachable={nodeInfo.reachable}
            onAddKv={() => setAddKvOpen(true)}
            onEditKv={(doc) => setEditKvDoc(doc)}
          />
        </HoverCardContent>
      </HoverCard>

      {/* Port handle — faces the ring center, click to toggle network.
          ReactFlow makes non-connectable handles `pointer-events: none`, so we
          force pointer events back on (inline beats the library's non-important
          rule) to keep the click target live. */}
      <Handle
        type="source"
        id="port"
        position={handlePosition}
        isConnectable={false}
        onClick={handlePortClick}
        style={{ pointerEvents: "all" }}
        className={cn(
          "!h-3.5 !w-3.5 cursor-pointer border-2 transition-colors",
          isAttached
            ? "!border-green-500 !bg-green-500 hover:!bg-green-600"
            : "!border-muted-foreground !bg-background hover:!border-destructive"
        )}
        title={
          isAttached
            ? "Click to disconnect from network"
            : "Click to reconnect to network"
        }
      />
      <Handle
        type="target"
        id="port-in"
        position={handlePosition}
        isConnectable={false}
        style={{ opacity: 0, width: 0, height: 0 }}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isAttached ? "Disconnect node?" : "Reconnect node?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isAttached
                ? `This removes ${nodeInfo.name} from the cluster's Docker network. The node keeps running but loses connectivity with its peers.`
                : `This reconnects ${nodeInfo.name} to the cluster's Docker network so it rejoins its peers.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleNetworkAction}>
              {isAttached ? "Disconnect" : "Reconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddKvDialog
        nodeId={nodeInfo.id}
        nodeName={shortId}
        open={addKvOpen}
        onOpenChange={setAddKvOpen}
      />

      <EditKvDialog
        nodeId={nodeInfo.id}
        nodeName={shortId}
        doc={editKvDoc}
        open={editKvDoc !== null}
        onOpenChange={(open) => !open && setEditKvDoc(null)}
      />

      <NodeInfoDialog
        nodeInfo={nodeInfo}
        open={infoOpen}
        onOpenChange={setInfoOpen}
      />
    </>
  )
}
