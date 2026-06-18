import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react"

interface PartitionEdgeData extends Record<string, unknown> {
  partitions: number[]
  selectedPartition: number | null
  color: string
  highlighted: boolean
  dimmed: boolean
}

export function PartitionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const d = data as PartitionEdgeData | undefined
  const color = d?.color ?? "#64748b"
  const highlighted = d?.highlighted ?? false
  const dimmed = d?.dimmed ?? false

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: color,
        strokeWidth: highlighted ? 2.5 : 1.5,
        opacity: dimmed ? 0.25 : 0.85,
      }}
    />
  )
}
