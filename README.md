# convergeKV debug client

Visual cluster debugger for the [convergeKV](https://github.com/janthoXO/convergeKV) distributed KV store.

## Structure

```
convergeKVClient/
├── contracts/          # OpenAPI 3.1 spec — single source of truth for the HTTP API
├── bridge/             # Express server: proxies gRPC calls + manages Docker network
└── client/             # React + Vite debug UI
```

The root `docker-compose.yml` builds and runs the debug tooling itself (the bridge and the client). The convergeKV backend cluster it inspects runs separately — see [Running with Docker Compose](#running-with-docker-compose).

## Running

```bash
# Start the backend cluster (requires a convergeKV Docker image)
docker compose up -d

# Start the bridge (one terminal)
cd bridge
pnpm install        # first time only
pnpm dev            # listens on http://localhost:3030

# Start the React client (another terminal)
cd client
pnpm install        # first time only
pnpm dev            # opens http://localhost:5173
```

The client's Vite dev server proxies `/api/*` to the bridge, so no CORS setup is needed.

### Running with Docker Compose

Instead of running the two dev servers by hand, the root `docker-compose.yml` builds and runs the whole debug tool as containers. From the repo root, `docker compose up -d --build` brings up the bridge (Express, published on `http://localhost:3001`) and the client (a static build served by nginx on `http://localhost:3000`) — open the client URL to use the debugger. The nginx container reverse-proxies the browser's same-origin `/api/*` requests to the bridge, so the only port you need is `3000`. The bridge container discovers and drives the cluster through the host's Docker daemon, so it mounts `/var/run/docker.sock` and reaches each node's published gRPC port over `host.docker.internal`; this means a convergeKV cluster (a Compose project labelled `convergekv`, with nodes exposing gRPC port `7000`) must already be running on the same Docker host before you start the tool. Three environment variables let you adjust this without editing the file: `COMPOSE_PROJECT` (default `convergekv`) selects which cluster to manage, `NODE_HOST` (default `host.docker.internal`) is where the bridge dials nodes' published ports, and `API_URL` (default `http://bridge:3001`) is the bridge address the client's nginx proxies to. Run `docker compose down` to stop everything.

## Codegen

Both subprojects generate types and SDK from `contracts/openapi.yaml`:

```bash
# After editing contracts/openapi.yaml, regenerate in both:
cd bridge && pnpm contracts:generate    # generates bridge/src/gen/ (Zod schemas + TS types)
cd client && pnpm contracts:generate    # generates client/src/gen/ (fetch SDK + TS types)
```

The generated `src/gen/` folders are committed, so a fresh clone works without running `pnpm contracts:generate`.

## Features

- **Cluster graph** — nodes laid out in a ring; edges show owner overlap per partition (green = mutual, amber = one-sided)
- **Node inspection** — open a node to inspect its identity, membership view, and all CRDT documents it holds, streamed via the gRPC `Debug` service (`Inspect` + `DumpDocuments`)
- **Write KV** — set, patch, or delete a key on the selected node via the gRPC `KV` service (`Put` / `Patch` / `Delete`)
- **Cluster size** — add or remove convergeKV containers on the fly
- **Network isolation** — disconnect/reconnect a node from the `convergekv` Docker network to simulate a partition
