import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"

const PROTO_ROOT = path.join(import.meta.dirname, "proto")

const packageDef = protoLoader.loadSync(
  [
    path.join(PROTO_ROOT, "kv.proto"),
    path.join(PROTO_ROOT, "debug.proto"),
  ],
  {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_ROOT],
  }
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const grpcPkg = grpc.loadPackageDefinition(packageDef) as any

const kvClients = new Map<string, grpc.Client>()
const debugClients = new Map<string, grpc.Client>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getKvClient(addr: string): any {
  if (!kvClients.has(addr)) {
    kvClients.set(
      addr,
      new grpcPkg.convergekv.KV(addr, grpc.credentials.createInsecure())
    )
  }
  return kvClients.get(addr)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDebugClient(addr: string): any {
  if (!debugClients.has(addr)) {
    debugClients.set(
      addr,
      new grpcPkg.convergekv.Debug(addr, grpc.credentials.createInsecure())
    )
  }
  return debugClients.get(addr)
}

export interface Member {
  id: string
  addr: string
  dead: boolean
  generation: string
}

export interface Owner {
  id: string
  status: number
  dead: boolean
}

export interface PartitionOwners {
  partition: number
  owners: Owner[]
}

export interface InspectResult {
  nodeId: string
  generation: string
  partitions: number
  clientAddr: string
  nodeAddr: string
  members: Member[]
  partitionsTable: PartitionOwners[]
}

export interface DebugField {
  name: string
  value: string
  dotActor: string
  dotSeq: string
  hlc: string
  hlcPhysMs: string
  hlcLogical: number
}

export interface DebugDoc {
  partition: number
  key: string
  document: string
  contextHash: string
  tombstone: boolean
  fields: DebugField[]
}

function deadline(ms: number): { deadline: Date } {
  return { deadline: new Date(Date.now() + ms) }
}

/** Format 16 raw UUID bytes into a canonical 36-char UUID string. */
function uuidFromBytes(b: Buffer | Uint8Array | undefined | null): string {
  if (!b || b.length === 0) return ""
  const hex = Buffer.from(b).toString("hex")
  if (b.length !== 16) return hex // fall back to plain hex for unexpected lengths
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  )
}

function toBuf(v: Buffer | Uint8Array | undefined | null): Buffer {
  if (!v) return Buffer.alloc(0)
  return Buffer.isBuffer(v) ? v : Buffer.from(v)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInspect(res: any): InspectResult {
  return {
    nodeId: uuidFromBytes(res.nodeId),
    generation: String(res.generation ?? "0"),
    partitions: Number(res.partitions ?? 0),
    clientAddr: res.clientAddr ?? "",
    nodeAddr: res.nodeAddr ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    members: (res.members ?? []).map((m: any) => ({
      id: uuidFromBytes(m.id),
      addr: m.addr ?? "",
      dead: Boolean(m.dead),
      generation: String(m.generation ?? "0"),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    partitionsTable: (res.partitionsTable ?? []).map((pt: any) => ({
      partition: Number(pt.partition ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      owners: (pt.owners ?? []).map((o: any) => ({
        id: uuidFromBytes(o.id),
        status: Number(o.status ?? 0),
        dead: Boolean(o.dead),
      })),
    })),
  }
}

export function inspect(addr: string): Promise<InspectResult> {
  return new Promise((resolve, reject) => {
    getDebugClient(addr).Inspect(
      {},
      deadline(3000),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err: grpc.ServiceError | null, response: any) => {
        if (err) reject(err)
        else resolve(mapInspect(response))
      }
    )
  })
}

export function dumpDocuments(addr: string): Promise<DebugDoc[]> {
  return new Promise((resolve, reject) => {
    const call = getDebugClient(addr).DumpDocuments(
      {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as grpc.ClientReadableStream<any>
    const docs: DebugDoc[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call.on("data", (d: any) => {
      const tombstone = Boolean(d.tombstone)
      docs.push({
        partition: Number(d.partition ?? 0),
        key: toBuf(d.key).toString("utf8"),
        document: tombstone ? "" : toBuf(d.document).toString("utf8"),
        contextHash: toBuf(d.contextHash).toString("hex"),
        tombstone,
        fields: tombstone
          ? []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : (d.fields ?? []).map((f: any) => ({
              name: f.name ?? "",
              value: toBuf(f.value).toString("utf8"),
              dotActor: uuidFromBytes(f.dotActor),
              dotSeq: String(f.dotSeq ?? "0"),
              hlc: String(f.hlc ?? "0"),
              hlcPhysMs: String(f.hlcPhysMs ?? "0"),
              hlcLogical: Number(f.hlcLogical ?? 0),
            })),
      })
    })
    call.on("end", () => resolve(docs))
    call.on("error", (err: Error) => reject(err))
  })
}

export function putKV(
  addr: string,
  key: string,
  value: Buffer,
  timeoutMs = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    getKvClient(addr).Put(
      { key, value },
      new grpc.Metadata(),
      deadline(timeoutMs),
      (err: grpc.ServiceError | null) => {
        if (err) reject(err)
        else resolve()
      }
    )
  })
}

export function patchKV(
  addr: string,
  key: string,
  value: Buffer,
  deleteFields: string[],
  timeoutMs = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    getKvClient(addr).Patch(
      { key, value, deleteFields },
      new grpc.Metadata(),
      deadline(timeoutMs),
      (err: grpc.ServiceError | null) => {
        if (err) reject(err)
        else resolve()
      }
    )
  })
}

export function deleteKV(
  addr: string,
  key: string,
  timeoutMs = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    getKvClient(addr).Delete(
      { key },
      new grpc.Metadata(),
      deadline(timeoutMs),
      (err: grpc.ServiceError | null) => {
        if (err) reject(err)
        else resolve()
      }
    )
  })
}
