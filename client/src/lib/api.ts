// Re-exports generated SDK functions under the names used throughout the app.
// All types come from the generated types.gen.ts so they stay in sync with
// contracts/openapi.yaml.
export type {
  ClusterNodeInfo,
  DebugDoc,
  DebugField,
  Member,
  Owner,
  PartitionOwners,
  MutationResult,
} from "../gen/types.gen"

import {
  getCluster,
  getNodeEntries,
  putNodeKv,
  patchNodeKv,
  deleteNodeKv,
  addNode as _addNode,
  removeNode as _removeNode,
  setNodeNetwork as _setNodeNetwork,
} from "../gen/sdk.gen"
import type {
  ClusterNodeInfo,
  DebugDoc,
  MutationResult,
} from "../gen/types.gen"

export async function fetchCluster(): Promise<ClusterNodeInfo[]> {
  const { data, error } = await getCluster()
  if (error)
    throw new Error(
      (error as { error?: string }).error ?? "cluster fetch failed"
    )
  return data!
}

export async function fetchEntries(nodeId: string): Promise<DebugDoc[]> {
  const { data, error } = await getNodeEntries({ path: { id: nodeId } })
  if (error) {
    const e = error as { details?: string; error?: string }
    throw new Error(e.details ?? e.error ?? "entries fetch failed")
  }
  return data!
}

export async function putKV(
  nodeId: string,
  key: string,
  value: Record<string, unknown>
): Promise<MutationResult> {
  const { data, error } = await putNodeKv({
    path: { id: nodeId },
    body: { key, value },
  })
  if (error) {
    const e = error as { details?: string; error?: string }
    throw new Error(e.details ?? e.error ?? "PUT failed")
  }
  return data ?? {}
}

export async function patchKV(
  nodeId: string,
  key: string,
  value: Record<string, unknown>,
  deleteFields: string[]
): Promise<MutationResult> {
  const { data, error } = await patchNodeKv({
    path: { id: nodeId },
    body: { key, value, deleteFields },
  })
  if (error) {
    const e = error as { details?: string; error?: string }
    throw new Error(e.details ?? e.error ?? "PATCH failed")
  }
  return data ?? {}
}

export async function deleteKV(
  nodeId: string,
  key: string
): Promise<MutationResult> {
  const { data, error } = await deleteNodeKv({
    path: { id: nodeId },
    body: { key },
  })
  if (error) {
    const e = error as { details?: string; error?: string }
    throw new Error(e.details ?? e.error ?? "DELETE failed")
  }
  return data ?? {}
}

export async function addNode(): Promise<{ id: string; name: string }> {
  const { data, error } = await _addNode()
  if (error)
    throw new Error((error as { error?: string }).error ?? "add node failed")
  return data!
}

export async function removeNode(nodeId: string): Promise<void> {
  const { error } = await _removeNode({ path: { id: nodeId } })
  if (error)
    throw new Error((error as { error?: string }).error ?? "remove node failed")
}

export async function setNodeNetwork(
  nodeId: string,
  action: "connect" | "disconnect"
): Promise<void> {
  const { error } = await _setNodeNetwork({
    path: { id: nodeId },
    body: { action },
  })
  if (error) {
    const e = error as { error?: string }
    throw new Error(e.error ?? "network action failed")
  }
}
