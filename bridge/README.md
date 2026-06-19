# convergeKV bridge

The bridge is the backend half of the convergeKV debug tool. It is a small Express server that sits between the [debug client](../client/README.md) in your browser and the convergeKV cluster's gRPC API, and that drives Docker to scale the cluster or simulate network partitions.

## Table of contents

- [What it does](#what-it-does)
- [Running it](#running-it)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

## What it does

A convergeKV cluster doesn't expose a browser-friendly API — its nodes speak gRPC, and the only way to scale the cluster up/down or partition a node is to talk to the Docker daemon. The bridge exists to turn that into plain HTTP/JSON the client can call:

- **Discovers the cluster** — finds every running convergeKV container and reports its identity, gossip membership, and which partitions it owns.
- **Reads node state** — dumps all CRDT documents stored on a node.
- **Writes keys** — sets, patches, or deletes a key on a chosen node.
- **Scales the cluster** — starts or stops convergeKV containers.
- **Simulates partitions** — disconnects or reconnects a node from the cluster's Docker network so you can watch how the rest of the cluster reacts.

It does not store any state itself; every request is a live call to the cluster.

## Running it

The bridge needs a convergeKV cluster already running and reachable via the host's Docker daemon — see the [top-level README](../README.md) for starting the cluster.

```bash
pnpm install   # first time only
pnpm dev       # listens on http://localhost:3030
```

The [client](../client/README.md) is the only intended caller; point its dev server at this bridge (it does so by default) or use the bundled `docker compose up` from the repo root.

## Configuration

The bridge reads its settings from environment variables (or a `.env` file):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3030` | Port the bridge listens on. |
| `COMPOSE_PROJECT` | `convergekv` | Which Docker Compose project (cluster) to discover and manage. |
| `NODE_HOST` | `127.0.0.1` | Host the bridge dials for a node's published gRPC port. Leave as-is when running the bridge directly on your machine; set to `host.docker.internal` when the bridge itself runs in a container (Compose does this for you). |

## Troubleshooting

- **"No convergeKV nodes found" in the client** — the bridge couldn't see any containers labelled with the `COMPOSE_PROJECT` it's configured for. Confirm the cluster is up (`docker compose ps` in the cluster's directory) and that `COMPOSE_PROJECT` matches its Compose project name.
- **A node shows as unreachable** — the bridge couldn't open a gRPC connection to it. This is expected for a node you've just disconnected via the partition feature; for anything else, check that the node's container is healthy.
- **Writes to a disconnected node report "partial" success** — this is by design. The write is applied locally but can't replicate to peers while the node is partitioned; it reconciles once the node reconnects.

See [README_DEV.md](README_DEV.md) for the technical internals, the HTTP API, and the codegen workflow.
