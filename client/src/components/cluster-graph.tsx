import { useEffect, useRef, useState, useCallback } from "react"
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Edge,
  type XYPosition,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useCluster } from "@/hooks/use-cluster"
import { KvNode, type KvNodeType } from "./kv-node"
import { PartitionEdge } from "./partition-edge"
import { PartitionSelector } from "./partition-selector"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { addNode, type ClusterNodeInfo } from "@/lib/api"
import { toast } from "sonner"

const nodeTypes = { kvNode: KvNode }
const edgeTypes = { partitionEdge: PartitionEdge }

const RING_CX = 400
const RING_CY = 280

const EDGE_NEUTRAL = "#64748b"
const EDGE_HIGHLIGHT = "#22c55e"
const EDGE_DIM = "#cbd5e1"

// One directional edge per (source -> co-owner) pair, built from each node's OWN
// partition view. Because views diverge, S->T and T->S are independent edges.
function buildEdges(
  nodes: ClusterNodeInfo[],
  selectedPartition: number | null,
): Edge[] {
  const idByNodeId = new Map(
    nodes.filter((n) => n.nodeId).map((n) => [n.nodeId!, n.id]),
  )

  const pairs = new Map<
    string,
    { source: string; target: string; partitions: Set<number> }
  >()

  for (const node of nodes) {
    if (!node.reachable || !node.nodeId) continue
    for (const pt of node.partitionsTable) {
      for (const owner of pt.owners) {
        if (owner.id === node.nodeId) continue
        const target = idByNodeId.get(owner.id)
        if (!target) continue
        const key = `${node.id}->${target}`
        let entry = pairs.get(key)
        if (!entry) {
          entry = { source: node.id, target, partitions: new Set() }
          pairs.set(key, entry)
        }
        entry.partitions.add(pt.partition)
      }
    }
  }

  return Array.from(pairs.entries()).map(([key, entry]) => {
    const partitions = Array.from(entry.partitions).sort((a, b) => a - b)
    const highlighted =
      selectedPartition !== null && partitions.includes(selectedPartition)
    const dimmed = selectedPartition !== null && !highlighted
    const color = highlighted
      ? EDGE_HIGHLIGHT
      : dimmed
        ? EDGE_DIM
        : EDGE_NEUTRAL
    return {
      id: key,
      source: entry.source,
      target: entry.target,
      sourceHandle: "port",
      targetHandle: "port-in",
      type: "partitionEdge",
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      data: { partitions, selectedPartition, color, highlighted, dimmed },
    }
  })
}

function ringAngle(index: number, total: number): number {
  return (2 * Math.PI * index) / total - Math.PI / 2
}

function ringPosition(index: number, total: number): XYPosition {
  const r = Math.max(180, total * 38)
  const angle = ringAngle(index, total)
  return {
    x: RING_CX + r * Math.cos(angle) - 88, // center 176px-wide node
    y: RING_CY + r * Math.sin(angle) - 48, // center ~96px-tall node
  }
}

// Side of the node card that faces the ring center, given its ring angle.
function inwardPosition(angle: number): Position {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  if (Math.abs(c) >= Math.abs(s)) {
    return c > 0 ? Position.Left : Position.Right
  }
  return s > 0 ? Position.Top : Position.Bottom
}

export function ClusterGraph() {
  const { nodes: clusterNodes, loading, error } = useCluster()
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null)
  const [selectedPartition, setSelectedPartition] = useState<number | null>(null)
  const [addingNode, setAddingNode] = useState(false)
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<KvNodeType>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])
  const initialPositions = useRef(new Map<string, XYPosition>())

  const handleTogglePin = useCallback((id: string) => {
    setPinnedNodeId((prev) => (prev === id ? null : id))
  }, [])

  const handleAddNode = useCallback(async () => {
    setAddingNode(true)
    try {
      const node = await addNode()
      toast.success(`Started ${node.name}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAddingNode(false)
    }
  }, [])

  const partitionsTotal =
    clusterNodes.find((n) => n.partitionsTotal != null)?.partitionsTotal ?? 0

  // Clamp selection if P shrinks below the selected partition.
  useEffect(() => {
    if (selectedPartition !== null && selectedPartition >= partitionsTotal) {
      setSelectedPartition(null)
    }
  }, [partitionsTotal, selectedPartition])

  useEffect(() => {
    if (clusterNodes.length === 0) return

    // Assign initial ring positions to new nodes
    clusterNodes.forEach((n, i) => {
      if (!initialPositions.current.has(n.id)) {
        initialPositions.current.set(n.id, ringPosition(i, clusterNodes.length))
      }
    })

    setRfNodes((prev) => {
      const posMap = new Map(prev.map((n) => [n.id, n.position]))
      return clusterNodes.map((n, i) => {
        const angle = ringAngle(i, clusterNodes.length)
        return {
          id: n.id,
          type: "kvNode" as const,
          position: posMap.get(n.id) ?? initialPositions.current.get(n.id)!,
          data: {
            nodeInfo: n,
            allNodes: clusterNodes,
            pinnedNodeId,
            onTogglePin: handleTogglePin,
            handlePosition: inwardPosition(angle),
            selectedPartition,
          },
        }
      })
    })

    setRfEdges(buildEdges(clusterNodes, selectedPartition))
  }, [
    clusterNodes,
    pinnedNodeId,
    selectedPartition,
    handleTogglePin,
    setRfNodes,
    setRfEdges,
  ])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Connecting to cluster…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-destructive text-sm font-medium">Bridge unreachable</p>
        <p className="text-muted-foreground max-w-xs text-center text-xs">{error}</p>
        <p className="text-muted-foreground text-xs">
          Run <code className="font-mono">pnpm dev</code> in <code className="font-mono">bridge/</code> to start the bridge.
        </p>
      </div>
    )
  }

  if (clusterNodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-muted-foreground text-sm">No convergeKV nodes found.</p>
        <p className="text-muted-foreground text-xs">
          Run <code className="font-mono">docker compose up -d</code> to start the cluster.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Panel position="top-left">
          <PartitionSelector
            total={partitionsTotal}
            value={selectedPartition}
            onChange={setSelectedPartition}
          />
        </Panel>
        <Panel position="top-right">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 text-xs shadow-sm"
            onClick={handleAddNode}
            disabled={addingNode}
          >
            <Plus className="h-3.5 w-3.5" />
            {addingNode ? "Adding…" : "Add node"}
          </Button>
        </Panel>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  )
}
