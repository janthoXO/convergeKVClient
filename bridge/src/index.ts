import express from "express"
import {
  listClusterNodes,
  connectNode,
  disconnectNode,
  addNode,
  removeNode,
  type ClusterNode,
} from "./docker.ts"
import {
  inspect,
  dumpDocuments,
  putKV,
  patchKV,
  deleteKV,
  type DebugDoc,
} from "./grpc.ts"
import {
  zPutKvRequest,
  zPatchKvRequest,
  zDeleteKvRequest,
  zNetworkActionRequest,
} from "./gen/zod.gen.ts"
import type { ClusterNodeInfo } from "./gen/types.gen.ts"
import { env } from "./env.ts"

const app = express()
app.use(express.json())

// gRPC status code for a call that ran past its deadline.
const GRPC_DEADLINE_EXCEEDED = 4

// A write to a partitioned node is applied locally but can't replicate to peers,
// so the call deadlines. Surface that as a partial success instead of an error.
function partitionPartial(
  err: unknown,
  node: { networkAttached: boolean }
): { partial: true; detail: string } | null {
  const e = err as { code?: number }
  if (e.code === GRPC_DEADLINE_EXCEEDED && !node.networkAttached) {
    return {
      partial: true,
      detail:
        "Saved on this node; replication to peers is pending while it is partitioned. It will reconcile when the node rejoins.",
    }
  }
  return null
}

function grpcError(err: unknown): { status: number; body: object } {
  const e = err as { code?: number; details?: string; message?: string }
  if (e.code !== undefined) {
    return {
      status: 502,
      body: { code: e.code, details: e.details ?? e.message },
    }
  }
  return { status: 500, body: { error: (e as Error).message } }
}

function publicFields(node: ClusterNode) {
  return {
    id: node.id,
    name: node.name,
    networkAttached: node.networkAttached,
    grpcHostPort: node.grpcHostPort,
  }
}

function unreachable(node: ClusterNode): ClusterNodeInfo {
  return {
    ...publicFields(node),
    reachable: false,
    nodeId: null,
    generation: null,
    partitionsTotal: null,
    clientAddr: null,
    nodeAddr: null,
    members: [],
    partitionsTable: [],
    ownedPartitions: [],
  }
}

app.get("/api/cluster", async (_req, res) => {
  try {
    const nodes = await listClusterNodes()
    const result: ClusterNodeInfo[] = await Promise.all(
      nodes.map(async (node) => {
        // Reach the node over its debug network even when it is partitioned
        // (networkAttached=false). Only a missing dial address is unreachable.
        if (!node.grpcAddr) {
          return unreachable(node)
        }
        try {
          const ins = await inspect(node.grpcAddr)
          const ownedPartitions = ins.partitionsTable
            .filter((pt) => pt.owners.some((o) => o.id === ins.nodeId))
            .map((pt) => pt.partition)
          return {
            ...publicFields(node),
            reachable: true,
            nodeId: ins.nodeId,
            generation: ins.generation,
            partitionsTotal: ins.partitions,
            clientAddr: ins.clientAddr,
            nodeAddr: ins.nodeAddr,
            members: ins.members,
            partitionsTable: ins.partitionsTable,
            ownedPartitions,
          }
        } catch {
          return unreachable(node)
        }
      })
    )
    res.json(result)
  } catch (err) {
    const { status, body } = grpcError(err)
    res.status(status).json(body)
  }
})

app.get("/api/nodes/:id/entries", async (req, res) => {
  try {
    const nodes = await listClusterNodes()
    const node = nodes.find(
      (n) => n.id === req.params.id || n.name === req.params.id
    )
    if (!node) {
      res.status(404).json({ error: "node not found" })
      return
    }
    if (!node.grpcAddr) {
      res.status(503).json({ error: "node has no reachable gRPC port" })
      return
    }
    const docs: DebugDoc[] = await dumpDocuments(node.grpcAddr)
    res.json(docs)
  } catch (err) {
    const { status, body } = grpcError(err)
    res.status(status).json(body)
  }
})

app.post("/api/nodes/:id/kv", async (req, res) => {
  const parsed = zPutKvRequest.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues })
    return
  }
  try {
    const nodes = await listClusterNodes()
    const node = nodes.find(
      (n) => n.id === req.params.id || n.name === req.params.id
    )
    if (!node) {
      res.status(404).json({ error: "node not found" })
      return
    }
    if (!node.grpcAddr) {
      res.status(503).json({ error: "node has no reachable gRPC port" })
      return
    }
    const value = Buffer.from(JSON.stringify(parsed.data.value), "utf8")
    // An isolated node never completes replication, so fail fast there.
    const timeout = node.networkAttached ? 5000 : 2000
    try {
      await putKV(node.grpcAddr, parsed.data.key, value, timeout)
      res.json({})
    } catch (err) {
      const partial = partitionPartial(err, node)
      if (partial) {
        res.json(partial)
        return
      }
      throw err
    }
  } catch (err) {
    const { status, body } = grpcError(err)
    res.status(status).json(body)
  }
})

app.patch("/api/nodes/:id/kv", async (req, res) => {
  const parsed = zPatchKvRequest.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues })
    return
  }
  try {
    const nodes = await listClusterNodes()
    const node = nodes.find(
      (n) => n.id === req.params.id || n.name === req.params.id
    )
    if (!node) {
      res.status(404).json({ error: "node not found" })
      return
    }
    if (!node.grpcAddr) {
      res.status(503).json({ error: "node has no reachable gRPC port" })
      return
    }
    const value = Buffer.from(JSON.stringify(parsed.data.value ?? {}), "utf8")
    const deleteFields = parsed.data.deleteFields ?? []
    // An isolated node never completes replication, so fail fast there.
    const timeout = node.networkAttached ? 5000 : 2000
    try {
      await patchKV(
        node.grpcAddr,
        parsed.data.key,
        value,
        deleteFields,
        timeout
      )
      res.json({})
    } catch (err) {
      const partial = partitionPartial(err, node)
      if (partial) {
        res.json(partial)
        return
      }
      throw err
    }
  } catch (err) {
    const { status, body } = grpcError(err)
    res.status(status).json(body)
  }
})

app.delete("/api/nodes/:id/kv", async (req, res) => {
  const parsed = zDeleteKvRequest.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues })
    return
  }
  try {
    const nodes = await listClusterNodes()
    const node = nodes.find(
      (n) => n.id === req.params.id || n.name === req.params.id
    )
    if (!node) {
      res.status(404).json({ error: "node not found" })
      return
    }
    if (!node.grpcAddr) {
      res.status(503).json({ error: "node has no reachable gRPC port" })
      return
    }
    const timeout = node.networkAttached ? 5000 : 2000
    try {
      await deleteKV(node.grpcAddr, parsed.data.key, timeout)
      res.json({})
    } catch (err) {
      const partial = partitionPartial(err, node)
      if (partial) {
        res.json(partial)
        return
      }
      throw err
    }
  } catch (err) {
    const { status, body } = grpcError(err)
    res.status(status).json(body)
  }
})

app.post("/api/nodes", async (_req, res) => {
  try {
    const node = await addNode()
    res.json(node)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete("/api/nodes/:id", async (req, res) => {
  try {
    await removeNode(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    const msg = (err as Error).message
    if (/not found/i.test(msg)) {
      res.status(404).json({ error: msg })
      return
    }
    if (/refusing to remove the seed/i.test(msg)) {
      res.status(400).json({ error: msg })
      return
    }
    res.status(500).json({ error: msg })
  }
})

app.post("/api/nodes/:id/network", async (req, res) => {
  const parsed = zNetworkActionRequest.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues })
    return
  }
  const { action } = parsed.data
  const containerName = req.params.id
  try {
    if (action === "disconnect") {
      await disconnectNode(containerName)
    } else {
      await connectNode(containerName)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.listen(env.PORT, () => {
  console.log(`Bridge server listening on http://localhost:${env.PORT}`)
})
