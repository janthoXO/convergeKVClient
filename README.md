# convergeKV debug client

Visual cluster debugger for the [convergeKV](https://github.com/janthoXO/convergeKV) distributed KV store.

## Structure

```
convergeKVClient/
├── contracts/          # OpenAPI 3.1 spec — single source of truth for the HTTP API
├── bridge/             # Express server: proxies gRPC calls + manages Docker network
└── client/             # React + Vite debug UI
```

`docker-compose.yml` in the root starts the convergeKV backend cluster.

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
