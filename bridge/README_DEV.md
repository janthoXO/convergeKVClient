# Bridge — developer guide

Technical reference for the bridge: its HTTP API, the gRPC and Docker integration underneath it, and the codegen workflow it shares with the client.

## Table of contents

- [Stack](#stack)
- [Project layout](#project-layout)
- [Commands](#commands)
- [Environment variables](#environment-variables)
- [HTTP API](#http-api)
- [Contract-first codegen](#contract-first-codegen)
- [Node discovery and the debug network](#node-discovery-and-the-debug-network)
- [gRPC layer](#grpc-layer)
- [Scaling the cluster](#scaling-the-cluster)
- [Partition simulation](#partition-simulation)
- [Build and Docker image](#build-and-docker-image)

## Stack

Express 5 on TypeScript/ESM, run directly with `tsx` (no separate build step in dev). `dockerode` talks to the Docker daemon; `@grpc/grpc-js` + `@grpc/proto-loader` talk to convergeKV nodes. Request bodies are validated with Zod schemas generated from the OpenAPI contract.

## Project layout

```
bridge/src/
├── index.ts        # Express app: all 8 routes
├── docker.ts        # dockerode: node discovery, debug networks, add/remove/connect/disconnect
├── grpc.ts          # grpc-js clients for the KV and Debug services
├── env.ts           # zod-validated environment config
├── proto/           # kv.proto, debug.proto (package `convergekv`)
└── gen/              # generated from contracts/openapi.yaml — see Codegen
```

## Commands

Run inside `bridge/`:

| Command | Purpose |
|---|---|
| `pnpm dev` | `tsx watch src/index.ts` — dev server with reload, listens on `PORT` (default 3030). |
| `pnpm build` | `tsc` to `dist/`, then copies `src/proto/` into `dist/proto/` (loaded at runtime relative to `grpc.ts`). |
| `pnpm start` | Runs the compiled `dist/index.js` with plain `node`. |
| `pnpm typecheck` | `tsc --noEmit`. The closest thing to a test suite — there is no test runner. |
| `pnpm lint` / `pnpm format` | ESLint / Prettier. |
| `pnpm contracts:generate` | Regenerates `src/gen/` from `../contracts/openapi.yaml`. |

## Environment variables

Validated by `src/env.ts` (`EnvSchema`); read from `process.env` via `dotenv`.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3030` | HTTP port. |
| `COMPOSE_PROJECT` | `convergekv` | Docker Compose project label used to find cluster containers (`docker.ts` filters on `com.docker.compose.project`). The bridge has no static node list — it always re-discovers via the Docker daemon. |
| `NODE_HOST` | `127.0.0.1` | Host used to dial a node's *published* gRPC port. Must be `host.docker.internal` (or equivalent) when the bridge itself runs in a container, since loopback would otherwise point at the bridge. |
| `BRIDGE_CONTAINER` | hostname | The bridge's own container id/name, used to join each node's private debug network (see below). Docker sets the container hostname to the container id by default, so this rarely needs overriding. Irrelevant when running the bridge with plain `pnpm dev` outside a container. |

There is no auth token. The convergeKV backend's `KV` and `Debug` gRPC services are unauthenticated (plain `grpc.NewServer()`, no interceptor), so the bridge sends no credentials. If a future backend build adds an auth interceptor, that would need a new env var and matching metadata in `grpc.ts`.

## HTTP API

`{id}` in any route accepts either the container id or its container name — `index.ts` matches against both via `listClusterNodes()`.

| Method | Path | operationId | Maps to |
|---|---|---|---|
| GET | `/api/cluster` | `getCluster` | Discovers nodes, fans out `Debug.Inspect` to each. |
| GET | `/api/nodes/{id}/entries` | `getNodeEntries` | `Debug.DumpDocuments` (streamed, buffered into a JSON array). |
| POST | `/api/nodes/{id}/kv` | `putNodeKv` | `KV.Put`. |
| PATCH | `/api/nodes/{id}/kv` | `patchNodeKv` | `KV.Patch` (upsert/remove fields). |
| DELETE | `/api/nodes/{id}/kv` | `deleteNodeKv` | `KV.Delete`. |
| POST | `/api/nodes` | `addNode` | Starts a new container cloned from an existing node. |
| DELETE | `/api/nodes/{id}` | `removeNode` | Stops and removes a container (seed excluded). |
| POST | `/api/nodes/{id}/network` | `setNodeNetwork` | Connects/disconnects the container from the cluster's Docker network. |

Request bodies for the four POST/PATCH/DELETE-with-body routes are validated with the generated Zod schemas (`zPutKvRequest`, `zPatchKvRequest`, `zDeleteKvRequest`, `zNetworkActionRequest`) before any gRPC/Docker call is made; a failed parse returns `400` with the Zod issues.

A write to a partitioned node (`networkAttached: false`) is given a short 2s deadline (vs. 5s when attached) since it can never complete replication. If the call fails with gRPC code `DEADLINE_EXCEEDED` (4) on a partitioned node, the route returns `200` with `{ partial: true, detail: "..." }` instead of an error — the write did land locally, it just hasn't replicated yet.

## Contract-first codegen

`contracts/openapi.yaml` is the single source of truth for this API, shared with the client. `pnpm contracts:generate` runs `@hey-api/openapi-ts` (configured in `openapi-ts.config.ts`) and writes:

- `src/gen/types.gen.ts` — TypeScript interfaces for every schema (e.g. `ClusterNodeInfo`).
- `src/gen/zod.gen.ts` — Zod schemas used for request validation in `index.ts`.

`src/gen/` is committed, so a fresh clone doesn't need to regenerate. When you change the API: edit `contracts/openapi.yaml`, run `pnpm contracts:generate` in **both** `bridge/` and `client/`, then fix the TypeScript errors that fall out — they're the intended spec-drift detector. Full details in [`contracts/README.md`](../contracts/README.md).

## Node discovery and the debug network

`docker.ts` never keeps a static node list — every call to `listClusterNodes()` re-queries the Docker daemon (`docker.listContainers`, filtered by `com.docker.compose.project=<COMPOSE_PROJECT>` and service label `seed`/`node`).

The cluster's gRPC port is fixed at `7000` (`GRPC_PORT` in `docker.ts`); the bridge reads each container's *published* host port for that private port to get a `host:port` it can dial directly.

The tricky part is keeping a node observable **while it's partitioned**. Isolating a node disconnects it from the shared cluster network — but that's also the network the node's published-port NAT rule depends on, so once disconnected its published port stops forwarding too, and the bridge would lose the node entirely. To avoid that:

- Every node container is also attached to its own per-node "debug" network (`convergekv-dbg-<container-name>`), created on first use and attachable.
- The bridge attaches **itself** to every node's debug network too (best-effort; a no-op if the bridge isn't running in a container, e.g. plain `pnpm dev`, since the published port already reaches it there).
- `listClusterNodes()` prefers the published host port when the node is on the shared cluster network, and falls back to the node's private debug-network IP when it isn't — that fallback is what survives a simulated partition.

The shared "cluster" network itself isn't hardcoded by name — `pickClusterNetwork()` picks whichever non-debug network the most cluster containers are attached to, so it tolerates whatever name Compose generates.

## gRPC layer

`grpc.ts` loads `src/proto/kv.proto` and `src/proto/debug.proto` (package `convergekv`, services `KV` and `Debug`) with `keepCase: false`, so generated message fields are accessed camelCased in TS even though the `.proto` uses snake_case. Clients are cached per `addr` (`Map<string, grpc.Client>`) rather than recreated per call.

- `inspect(addr)` — single `Debug.Inspect` call, mapped into a plain `InspectResult` (node id/generation/partition table/members). Raw 16-byte UUIDs are reformatted into canonical `xxxxxxxx-xxxx-...` strings by `uuidFromBytes`.
- `dumpDocuments(addr)` — server-streaming `Debug.DumpDocuments`, buffered into an array of `DebugDoc` before resolving.
- `putKV` / `patchKV` / `deleteKV` — unary `KV.Put` / `KV.Patch` / `KV.Delete`, each with a caller-supplied deadline.

`Get` is defined in `kv.proto` but unused by the bridge — debugging reads go through `Debug.DumpDocuments` instead, since it returns CRDT metadata (dots, HLC timestamps) that `Get` doesn't.

## Scaling the cluster

`addNode()` finds an existing `node`-labelled container as a template, copies its image/env, and starts a new container named `convergekv-node-<n>` (next free index) attached to the shared cluster network — mirroring how `docker compose --scale` would add a replica. Its debug network is attached lazily on the next `listClusterNodes()` poll.

`removeNode()` force-removes the container and best-effort cleans up its now-orphaned debug network (detaching the bridge from it first, since an active endpoint blocks network removal). The **seed** container is explicitly protected — it bootstraps gossip for every other node, so removing it would be far more disruptive than removing a regular replica.

## Partition simulation

`disconnectNode` / `connectNode` resolve the shared cluster network by exact name (Docker's own name filter is a substring match, so `docker.ts` filters the full network list itself) and call `network.disconnect` / `network.connect` with the target container. This is a real Docker network operation — the container keeps running, it just loses connectivity to the rest of the cluster, exactly like a network partition would.

## Build and Docker image

`bridge/Dockerfile` is a 4-stage build: compile TS → `dist/` (stage `build`, also copies `src/proto` into `dist/proto` since `grpc.ts` loads protos relative to its own directory at runtime), install prod-only deps in a separate stage, then assemble a minimal `gcr.io/distroless/nodejs24-debian13` runtime image with no shell, package manager, or dev tooling. `docker-compose.yml` at the repo root builds this image, mounts the host's `/var/run/docker.sock` (the bridge drives Docker directly, not over a URL), and sets `NODE_HOST=host.docker.internal` so it can still reach nodes' published ports from inside its own container.
