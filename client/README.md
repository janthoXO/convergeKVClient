# convergeKV debug client

The React app you actually look at: a live, visual map of a convergeKV cluster, with tools to inspect and poke at it while it runs.

## Table of contents

- [What it does](#what-it-does)
- [Running it](#running-it)
- [Using the UI](#using-the-ui)
- [Troubleshooting](#troubleshooting)

## What it does

This is the front end of the debug tool described in the [top-level README](../README.md). It polls the [bridge](../bridge/README.md) for cluster state and renders every node as a card laid out in a ring, with lines drawn between nodes that believe they share a partition. From there you can drill into a node's stored data, write or delete keys, scale the cluster, and simulate a network partition — all without touching a terminal.

## Running it

Requires the [bridge](../bridge/README.md) running and a convergeKV cluster up — see the [top-level README](../README.md).

```bash
pnpm install   # first time only
pnpm dev       # opens http://localhost:5173
```

The dev server proxies `/api/*` requests to the bridge on `http://localhost:3030`, so there's no CORS configuration to worry about and nothing else to point at by hand.

## Using the UI

- **Cluster graph** — each node is a card positioned around a ring; an edge between two nodes means the source node believes the target co-owns one of its partitions. Green means both sides agree (mutual), amber means only one side does.
- **Hover / pin a node** — hovering opens a card showing the node's stored documents; click to pin it open. From there you can search keys, page through documents, and see each field's CRDT metadata (actor, sequence, timestamp).
- **Node info** — the small info icon opens a dialog with the node's identity, generation, owned partitions, and full gossip membership list.
- **Write a key** — the `+` icon opens a dialog to set a key to a JSON object value (`KV.Put`).
- **Edit a key** — the pencil icon lets you patch specific fields of the currently-shown document, or delete fields, without overwriting the whole value (`KV.Patch`).
- **Delete a key** — the trash icon on a document issues `KV.Delete`, which propagates as a tombstone.
- **Partition filter** — the dropdown in the top-left highlights only the edges and nodes relevant to one partition, dimming the rest.
- **Add a node** — the button in the top-right starts a new convergeKV container and adds it to the cluster.
- **Disconnect / reconnect a node** — click the small port handle on a node's edge of the ring to simulate (or heal) a network partition for that node.
- **Remove a node** — from the node info dialog, except for the seed node, which bootstraps the cluster and can't be removed.

A write issued to a node that's currently disconnected shows as a "partial" success (a yellow toast) — it landed locally but hasn't replicated to peers yet, and will once the node reconnects.

## Troubleshooting

- **"Bridge unreachable"** — the bridge isn't running, or isn't reachable at the proxied address. Start it with `pnpm dev` in `bridge/`.
- **"No convergeKV nodes found"** — the bridge is up but sees no cluster. Start the backend cluster (`docker compose up -d`) it's configured to manage.
- **A node looks faded/dimmed** — it's either disconnected from the network (`opacity-60`) or doesn't own the currently-selected partition filter (`opacity-30` + grayscale). Clear the partition filter to check.

See [README_DEV.md](README_DEV.md) for the technical internals, build/lint commands, and the codegen workflow.
