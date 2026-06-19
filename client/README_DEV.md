# Client — developer guide

Technical reference for the React debug UI: component layout, data flow, and the build/codegen workflow it shares with the bridge.

## Table of contents

- [Stack](#stack)
- [Project layout](#project-layout)
- [Commands](#commands)
- [Data flow](#data-flow)
- [Contract-first codegen](#contract-first-codegen)
- [Cluster graph internals](#cluster-graph-internals)
- [shadcn/ui setup](#shadcnui-setup)
- [Build and Docker image](#build-and-docker-image)

## Stack

React 19 + Vite 8 (TypeScript, ESM). `@xyflow/react` (React Flow) renders the cluster graph. UI primitives are [shadcn/ui](https://ui.shadcn.com) on Radix, styled with Tailwind v4. Toasts via `sonner`. The generated SDK (`src/gen/`) is a thin typed wrapper over `fetch` from `@hey-api/client-fetch`.

## Project layout

```
client/src/
├── App.tsx                  # page shell: header legend + graph + toaster
├── hooks/use-cluster.ts      # polls GET /api/cluster every 1500ms
├── lib/api.ts                 # the only module the UI imports for data access
├── lib/utils.ts                # cn() class-merge helper (shadcn convention)
├── components/
│   ├── cluster-graph.tsx     # ReactFlow canvas: ring layout, edge building, toolbar
│   ├── kv-node.tsx            # node card: hover/pin, port handle, wires up the dialogs below
│   ├── partition-edge.tsx     # custom ReactFlow edge renderer (color/dim by selection)
│   ├── partition-selector.tsx # partition filter dropdown
│   ├── node-entries-card.tsx  # documents list shown on hover/pin (search, paging, delete)
│   ├── node-info-dialog.tsx   # identity/membership dialog + remove-node action
│   ├── add-kv-dialog.tsx      # KV.Put form
│   ├── edit-kv-dialog.tsx     # KV.Patch form (upsert/remove fields)
│   ├── theme-provider.tsx     # next-themes wrapper
│   └── ui/                    # shadcn-generated primitives — regenerate via the shadcn CLI, don't hand-edit
└── gen/                       # generated from contracts/openapi.yaml — see Codegen
```

## Commands

Run inside `client/`:

| Command | Purpose |
|---|---|
| `pnpm dev` | Vite dev server on `http://localhost:5173`, proxies `/api/*` → `http://localhost:3030` (see `vite.config.ts`). |
| `pnpm build` | `tsc -b && vite build` — typechecks via project references, then bundles to `dist/`. |
| `pnpm preview` | Serves the production build locally. |
| `pnpm typecheck` | `tsc --noEmit`. No test runner exists in this project; this plus manual UI checks are the correctness gate. |
| `pnpm lint` / `pnpm format` | ESLint / Prettier (Prettier config includes `prettier-plugin-tailwindcss` for class sorting). |
| `pnpm contracts:generate` | Regenerates `src/gen/` from `../contracts/openapi.yaml`. |

## Data flow

```
useCluster() ──1500ms poll──▶ fetchCluster() ──▶ GET /api/cluster ──▶ bridge
     │
     ▼
ClusterGraph builds ReactFlow nodes/edges from the returned ClusterNodeInfo[]
```

`src/lib/api.ts` re-exports every generated type and wraps each generated SDK function (`getCluster`, `getNodeEntries`, `putNodeKv`, ...) into a function that throws a plain `Error` instead of returning a `{ data, error }` tuple — every component above it calls these wrappers, never the generated SDK directly. This is the seam to extend if you add a new endpoint: add it to the OpenAPI spec, regenerate, then add a thin wrapper here.

`useCluster` (`src/hooks/use-cluster.ts`) is the only polling loop in the app; it owns `nodes`/`loading`/`error` state and aborts in-flight requests on unmount. Everything else derives from its output, passed down as props — there's no global store.

## Contract-first codegen

Same workflow as the bridge, generating the client-side half:

- `src/gen/types.gen.ts` — TypeScript interfaces (shared shape with the bridge's generated types).
- `src/gen/sdk.gen.ts` — typed `fetch`-based functions per `operationId`.

`src/gen/` is committed; regenerate with `pnpm contracts:generate` after editing `../contracts/openapi.yaml`, and do the same in `bridge/`. See [`contracts/README.md`](../contracts/README.md).

## Cluster graph internals

`cluster-graph.tsx` is the densest file in the app:

- **Ring layout** — node `i` of `total` is placed at angle `2π·i/total - π/2` (`ringAngle`), at a radius that grows with cluster size (`Math.max(180, total * 38)`). Positions are cached in a `Map` (`initialPositions`) keyed by node id so a node keeps its position across polls instead of jumping; only genuinely new nodes get a fresh ring slot.
- **Inward-facing handles** — `inwardPosition(angle)` picks which side of the card (top/right/bottom/left) faces the ring's center, so the port handle used to disconnect/reconnect always points inward regardless of where the node sits.
- **Edge building** (`buildEdges`) — for every node, for every partition in its own `partitionsTable`, for every other owner of that partition, draw a directed edge from this node to that owner. Each node reports its **own view** of who owns what, and views can diverge (e.g. during a partition), so a `source→target` edge existing doesn't imply `target→source` exists — they're tracked independently and can disagree. `kv-node.tsx`'s amber/green coloring elsewhere in the UI legend reflects this: green means both directions agree, amber means only one side's view says so.
- **Partition filter** — selecting a partition in `PartitionSelector` flows into both `buildEdges` (dims/highlights edges) and into `kv-node.tsx` (dims cards that don't own the selected partition via `ownsSelected`).

`kv-node.tsx` holds an **optimistic** `networkAttached` flag (`optimisticAttached`) so the connect/disconnect toggle flips immediately on click rather than waiting for the next 1500 ms poll; it's cleared once the polled value catches up, or rolled back on request failure.

`node-entries-card.tsx` only fetches a node's documents while its hover card is open (`isOpen`), and clears its cached copy 5 seconds after closing — it's not meant to be a live view, just a snapshot you pull up on demand.

## shadcn/ui setup

`components.json` pins the registry style (`radix-nova`, neutral base color, no RSC) and path aliases (`@/components`, `@/lib`, `@/hooks`, `@/components/ui`) used by both the shadcn CLI and `vite.config.ts`'s `@` alias. Files under `src/components/ui/` are managed by the [shadcn skill/CLI](https://ui.shadcn.com) — treat them as generated and prefer re-running the CLI over hand-editing when upgrading a primitive.

## Build and Docker image

`client/Dockerfile` builds the Vite app (`pnpm build`) and serves the static `dist/` with `nginx:alpine`. `nginx.conf` is an envsubst *template* (`/etc/nginx/templates/default.conf.template`) — at container start, nginx substitutes `${API_URL}` with the bridge's address and reverse-proxies the browser's same-origin `/api/*` calls there, so the browser only ever talks to this nginx container and never needs to resolve the bridge's Docker-internal hostname itself. `docker-compose.yml` at the repo root wires `API_URL` to `http://bridge:3001` by default.
