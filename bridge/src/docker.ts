import os from "node:os"
import Dockerode from "dockerode"
import { env } from "./env.ts"

const docker = new Dockerode()

// The bridge's own container, used to join per-node debug networks. Docker sets
// the hostname to the container id by default; override via BRIDGE_CONTAINER.
const selfContainer = () => env.BRIDGE_CONTAINER || os.hostname()

// The live cluster is a docker-compose project. Containers are identified by the
// compose project label; the data-plane gRPC (KV + Debug) listens on port 7000,
// published to a host port per node.
//
// The bridge dials each node on its published host port for normal traffic. To
// keep a node observable *while* it is partitioned from its peers, every node is
// also attached to its own dedicated single-member "debug" network: isolating a
// node ("port click") disconnects it from the shared CLUSTER network — which
// drops its published-port forwarding — so the bridge falls back to the node's
// private debug-network IP, which survives the partition.
const COMPOSE_PROJECT = env.COMPOSE_PROJECT
const GRPC_PORT = 7000
const DEBUG_NET_PREFIX = "convergekv-dbg-"

const debugNetName = (containerName: string) =>
  `${DEBUG_NET_PREFIX}${containerName}`
const isDebugNet = (name: string) => name.startsWith(DEBUG_NET_PREFIX)

export interface ClusterNode {
  id: string
  name: string
  /** Membership in the shared cluster network (i.e. NOT partitioned). */
  networkAttached: boolean
  /** host:port the bridge dials for gRPC (the node's debug-network IP). */
  grpcAddr: string | null
  /** Published host port for the gRPC port, if any (informational). */
  grpcHostPort: number | null
}

type NetworkEntry = { IPAddress?: string }
type PortInfo = { PrivatePort: number; PublicPort?: number; Type: string }
type RawContainer = {
  Id: string
  Names: string[]
  Ports: PortInfo[]
  Labels: Record<string, string>
  NetworkSettings?: { Networks?: Record<string, NetworkEntry> }
}

function containerName(c: RawContainer): string {
  return c.Names[0].replace(/^\//, "")
}

function isClusterContainer(c: RawContainer): boolean {
  const svc = c.Labels["com.docker.compose.service"]
  return svc === "seed" || svc === "node"
}

function networksOf(c: RawContainer): Record<string, NetworkEntry> {
  return c.NetworkSettings?.Networks ?? {}
}

// The cluster network is the non-debug network shared by the most cluster
// containers. Picking by shared membership (not by a hardcoded/substring name)
// ignores leftover networks and the per-node debug networks.
function pickClusterNetwork(containers: RawContainer[]): string | null {
  const counts = new Map<string, number>()
  for (const c of containers) {
    for (const [name, entry] of Object.entries(networksOf(c))) {
      if (isDebugNet(name)) continue
      if (entry.IPAddress) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  let best: string | null = null
  let bestCount = 0
  for (const [name, n] of counts) {
    if (n > bestCount) {
      best = name
      bestCount = n
    }
  }
  return best
}

async function listClusterContainers(): Promise<RawContainer[]> {
  const containers = (await docker.listContainers({
    all: false,
    filters: { label: [`com.docker.compose.project=${COMPOSE_PROJECT}`] },
  })) as RawContainer[]
  return containers.filter(isClusterContainer)
}

// Connect a container to its dedicated debug network, creating the network on
// first use. Idempotent; safe to call repeatedly.
async function attachDebugNetwork(name: string): Promise<void> {
  const net = debugNetName(name)
  try {
    await docker.getNetwork(net).connect({ Container: name })
  } catch (err) {
    const msg = (err as Error).message || ""
    if (/already exists|already connected/i.test(msg)) return
    if (/not found|no such network/i.test(msg)) {
      await docker
        .createNetwork({
          Name: net,
          Driver: "bridge",
          Attachable: true,
          Labels: { "convergekv.debug": "true" },
        })
        .catch((e) => {
          // Tolerate a concurrent create.
          if (!/already exists/i.test((e as Error).message || "")) throw e
        })
      await docker.getNetwork(net).connect({ Container: name })
      return
    }
    throw err
  }
}

// Debug networks the bridge has already joined this process. Keeps the steady
// state cheap — once attached we never re-issue the connect call.
const selfAttached = new Set<string>()

// Best-effort: attach the bridge's own container to a node's debug network so
// it can dial a partitioned node by its debug-network IP. A no-op when the
// bridge is not itself a container (e.g. local `pnpm dev`), where the published
// host port already reaches the node — so failures here are swallowed.
async function attachSelfToDebugNetwork(net: string): Promise<void> {
  if (selfAttached.has(net)) return
  try {
    await docker.getNetwork(net).connect({ Container: selfContainer() })
    selfAttached.add(net)
  } catch (err) {
    const msg = (err as Error).message || ""
    if (/already exists|already connected/i.test(msg)) selfAttached.add(net)
    // Otherwise (network not created yet, or not running in a container) skip;
    // it is retried on the next poll.
  }
}

// Ensure every cluster container — and the bridge itself — is attached to each
// debug network. Node attachment only re-lists when something is missing, so
// the steady state is a single listContainers call per poll; self-attachment is
// short-circuited by the selfAttached cache.
async function ensureDebugNetworks(
  containers: RawContainer[]
): Promise<RawContainer[]> {
  const missing = containers.filter(
    (c) => !networksOf(c)[debugNetName(containerName(c))]?.IPAddress
  )
  await Promise.all(
    containers.map((c) =>
      attachSelfToDebugNetwork(debugNetName(containerName(c)))
    )
  )
  if (missing.length === 0) return containers
  await Promise.all(missing.map((c) => attachDebugNetwork(containerName(c))))
  return listClusterContainers()
}

export async function listClusterNodes(): Promise<ClusterNode[]> {
  const containers = await ensureDebugNetworks(await listClusterContainers())
  const clusterNet = pickClusterNetwork(containers)

  return containers.map((c) => {
    const name = containerName(c)
    const nets = networksOf(c)
    const debugIp = nets[debugNetName(name)]?.IPAddress || null
    const clusterIp = clusterNet ? nets[clusterNet]?.IPAddress || null : null
    const onCluster = Boolean(clusterIp)
    const portEntry = c.Ports.find(
      (p) => p.PrivatePort === GRPC_PORT && p.PublicPort
    )
    const publishedPort = portEntry?.PublicPort ?? null

    // Prefer the node's published host port for normal communication. A
    // published port is a NAT rule onto the container's cluster-network IP, so
    // it stops forwarding once the node is isolated from that network — in that
    // case fall back to the per-node debug network IP, the lifeline that
    // survives isolation. Final fallbacks cover the brief window before the
    // debug attach lands.
    let grpcAddr: string | null = null
    if (onCluster && publishedPort)
      grpcAddr = `${env.NODE_HOST}:${publishedPort}`
    else if (debugIp) grpcAddr = `${debugIp}:${GRPC_PORT}`
    else if (publishedPort) grpcAddr = `${env.NODE_HOST}:${publishedPort}`
    else if (clusterIp) grpcAddr = `${clusterIp}:${GRPC_PORT}`

    return {
      id: c.Id,
      name,
      networkAttached: onCluster,
      grpcAddr,
      grpcHostPort: publishedPort,
    }
  })
}

// Resolve the shared CLUSTER network for connect/disconnect by exact name
// (Docker's name filter is a substring match, so we match on .Name ourselves).
async function getClusterNetwork(): Promise<Dockerode.Network> {
  const containers = await listClusterContainers()
  const clusterNet = pickClusterNetwork(containers)
  if (!clusterNet) {
    throw new Error(
      "cluster network not found (no attached cluster containers)"
    )
  }
  const networks = (await docker.listNetworks()) as {
    Id: string
    Name: string
  }[]
  const match = networks.find((n) => n.Name === clusterNet)
  if (!match) throw new Error(`network ${clusterNet} not found`)
  return docker.getNetwork(match.Id)
}

// Create and start a new node, replicating an existing node's image/env so it
// joins the cluster the same way the compose replicas do. The debug network is
// attached on the next poll by ensureDebugNetworks.
export async function addNode(): Promise<{ id: string; name: string }> {
  const containers = await listClusterContainers()
  const template = containers.find(
    (c) => c.Labels["com.docker.compose.service"] === "node"
  )
  if (!template) {
    throw new Error("no existing node to replicate as a template")
  }
  const clusterNet = pickClusterNetwork(containers)
  if (!clusterNet) throw new Error("cluster network not found")

  const spec = await docker.getContainer(template.Id).inspect()

  // Pick the next free convergekv-node-N name across all containers.
  const allNames = new Set(
    (await docker.listContainers({ all: true })).flatMap((c) =>
      c.Names.map((n) => n.replace(/^\//, ""))
    )
  )
  let n = 1
  let name = `convergekv-node-${n}`
  while (allNames.has(name)) {
    n += 1
    name = `convergekv-node-${n}`
  }

  const created = await docker.createContainer({
    name,
    Image: spec.Config.Image,
    Env: spec.Config.Env,
    Labels: {
      "com.docker.compose.project": COMPOSE_PROJECT,
      "com.docker.compose.service": "node",
      "convergekv.bridge-managed": "true",
    },
    HostConfig: { RestartPolicy: spec.HostConfig.RestartPolicy },
    NetworkingConfig: { EndpointsConfig: { [clusterNet]: {} } },
  })
  await created.start()
  return { id: created.id, name }
}

// Stop and remove a node container (and its debug network). The seed is
// protected because it bootstraps gossip for every other node.
export async function removeNode(idOrName: string): Promise<void> {
  const containers = await listClusterContainers()
  const node = containers.find(
    (c) => c.Id === idOrName || containerName(c) === idOrName
  )
  if (!node) throw new Error("node not found")
  if (node.Labels["com.docker.compose.service"] === "seed") {
    throw new Error("refusing to remove the seed node")
  }
  const name = containerName(node)
  await docker.getContainer(node.Id).remove({ force: true })
  // Best-effort cleanup of the now-orphaned debug network. Detach the bridge
  // first (an active endpoint would block removal) and forget it so a reused
  // node name re-attaches cleanly.
  const net = debugNetName(name)
  selfAttached.delete(net)
  await docker
    .getNetwork(net)
    .disconnect({ Container: selfContainer(), Force: true })
    .catch(() => {})
  await docker
    .getNetwork(net)
    .remove()
    .catch(() => {})
}

export async function disconnectNode(containerName: string): Promise<void> {
  const network = await getClusterNetwork()
  await network.disconnect({ Container: containerName, Force: false })
}

export async function connectNode(containerName: string): Promise<void> {
  const network = await getClusterNetwork()
  await network.connect({ Container: containerName })
}
