import dotenv from "dotenv";
import z from "zod";

dotenv.config();

export const EnvSchema = z.object({
  PORT: z.coerce.number().default(3030),
  // The docker-compose project label of the convergeKV cluster to manage. The
  // bridge discovers, dials, and partitions nodes by this label; it does not
  // take a cluster URL (it talks to the Docker daemon socket, not the nodes
  // directly). Override to point the bridge at a differently-named cluster.
  COMPOSE_PROJECT: z.string().default("convergekv"),
  // Host the bridge dials for a node's *published* gRPC port. Running on the
  // host directly this is loopback; running inside a container it must be the
  // host gateway (compose sets host.docker.internal).
  NODE_HOST: z.string().default("127.0.0.1"),
  // The bridge's own container id/name, used to attach itself to each node's
  // debug network so it can still reach a partitioned node. Defaults to the
  // hostname (Docker sets this to the container id); unused outside a container.
  BRIDGE_CONTAINER: z.string().optional(),
})

export type Env = z.output<typeof EnvSchema>;

export const env = EnvSchema.parse(process.env);
