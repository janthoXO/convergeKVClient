import { useState, useEffect, useRef, useMemo } from "react"
import { fetchEntries, deleteKV, type DebugDoc, type DebugField } from "@/lib/api"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Plus,
  Pencil,
  RefreshCw,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"

interface Props {
  nodeId: string
  nodeName: string
  isOpen: boolean
  /** Whether the bridge can reach the node (true even when partitioned). */
  reachable: boolean
  onAddKv: () => void
  onEditKv: (doc: DebugDoc) => void
}

function JsonValue({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground">null</span>
  if (typeof value === "boolean")
    return <span className="text-blue-500">{String(value)}</span>
  if (typeof value === "number")
    return <span className="text-amber-500">{String(value)}</span>
  if (typeof value === "string")
    return <span className="text-green-600 dark:text-green-400">"{value}"</span>
  if (Array.isArray(value))
    return (
      <span>
        {"["}
        {value.map((v, i) => (
          <span key={i}>
            <JsonValue value={v} />
            {i < value.length - 1 ? ", " : ""}
          </span>
        ))}
        {"]"}
      </span>
    )
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    return (
      <span>
        {"{"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            <span className="text-purple-500 dark:text-purple-400">"{k}"</span>
            {": "}
            <JsonValue value={v} />
            {i < entries.length - 1 ? ", " : ""}
          </span>
        ))}
        {"}"}
      </span>
    )
  }
  return <span>{String(value)}</span>
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function FieldRow({ field }: { field: DebugField }) {
  const actorShort = field.dotActor ? field.dotActor.slice(0, 8) : "—"
  const physMs = Number(field.hlcPhysMs)
  const time = Number.isFinite(physMs) && physMs > 0 ? new Date(physMs) : null
  return (
    <div className="flex flex-col gap-0.5 font-mono text-[11px]">
      <div className="break-all">
        <span className="text-purple-500 dark:text-purple-400">"{field.name}"</span>
        {": "}
        <JsonValue value={parseJson(field.value)} />
      </div>
      <div
        className="text-muted-foreground truncate text-[10px]"
        title={`actor ${field.dotActor} · seq ${field.dotSeq} · hlc ${field.hlc}`}
      >
        {actorShort}…:{field.dotSeq} · {time ? time.toLocaleTimeString() : "—"}|
        {field.hlcLogical}
      </div>
    </div>
  )
}

export function NodeEntriesCard({
  nodeId,
  nodeName,
  isOpen,
  reachable,
  onAddKv,
  onEditKv,
}: Props) {
  const [docs, setDocs] = useState<DebugDoc[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState("")
  const [api, setApi] = useState<CarouselApi>()
  const [currentIndex, setCurrentIndex] = useState(0)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasFetchedRef = useRef(false)

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return docs
    return docs.filter(
      (d) => d.key.toLowerCase().includes(q) || d.document.toLowerCase().includes(q),
    )
  }, [docs, search])

  async function load() {
    if (!reachable) return
    setRefreshing(true)
    try {
      const data = await fetchEntries(nodeId)
      setDocs(data)
      setLoadError(null)
      hasFetchedRef.current = true
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const result = await deleteKV(nodeId, pendingDelete)
      if (result.partial) {
        toast.warning(`Deleted "${pendingDelete}" on ${nodeName}`, {
          description: result.detail,
        })
      } else {
        toast.success(`Deleted "${pendingDelete}" on ${nodeName}`)
      }
      setPendingDelete(null)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      load()
    } else {
      // Clear cache 5 s after close
      closeTimerRef.current = setTimeout(() => {
        hasFetchedRef.current = false
        setDocs([])
        setSearch("")
      }, 5000)
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, nodeId])

  // Scroll back to the first slide whenever the underlying docs or the
  // search filter changes, since the previous index may no longer be
  // meaningful. This drives the "select" listener below, which is what
  // actually updates currentIndex.
  useEffect(() => {
    api?.scrollTo(0, true)
  }, [docs, search, api])

  useEffect(() => {
    if (!api) return
    const onSelect = () => setCurrentIndex(api.selectedScrollSnap())
    onSelect()
    api.on("select", onSelect)
    api.on("reInit", onSelect)
    return () => {
      api.off("select", onSelect)
      api.off("reInit", onSelect)
    }
  }, [api])

  if (!reachable) {
    return (
      <div className="flex flex-col gap-2 p-1">
        <p className="text-muted-foreground text-xs">Node is unreachable.</p>
      </div>
    )
  }

  const currentDoc = filteredDocs[currentIndex]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{nodeName} · documents</span>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={load}
            disabled={refreshing}
            title="Refresh"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={onAddKv}
            title="Write key–value (overwrite/create)"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => currentDoc && onEditKv(currentDoc)}
            disabled={!currentDoc}
            title="Edit fields (patch)"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="text-muted-foreground absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search keys and values…"
          className="h-7 pl-7 text-xs"
        />
      </div>

      {loadError && <p className="text-destructive text-xs">{loadError}</p>}

      {docs.length === 0 && !loadError && (
        <p className="text-muted-foreground text-xs">
          {refreshing ? "Loading…" : "No documents."}
        </p>
      )}

      {docs.length > 0 && filteredDocs.length === 0 && (
        <p className="text-muted-foreground text-xs">No keys match "{search}".</p>
      )}

      {filteredDocs.length > 0 && (
        <>
          <Carousel setApi={setApi} className="px-1">
            <CarouselContent>
              {filteredDocs.map((doc) => (
                <CarouselItem key={`${doc.partition}:${doc.key}`}>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-mono text-xs font-semibold">
                          {doc.key}
                        </span>
                        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
                          p{doc.partition}
                        </Badge>
                        {doc.tombstone && (
                          <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                            tombstone
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive h-5 w-5 shrink-0"
                        title="Delete key"
                        onClick={() => setPendingDelete(doc.key)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <ScrollArea className="h-44">
                      <div className="flex flex-col gap-2 pr-2 pl-2">
                        {doc.tombstone ? (
                          <span className="text-destructive font-mono text-[11px] line-through">
                            deleted
                          </span>
                        ) : doc.fields && doc.fields.length > 0 ? (
                          doc.fields.map((f) => <FieldRow key={f.name} field={f} />)
                        ) : (
                          <span className="font-mono text-[11px] break-all">
                            <JsonValue value={parseJson(doc.document)} />
                          </span>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>

          <div className="flex items-center justify-between">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => api?.scrollPrev()}
              disabled={!api?.canScrollPrev()}
              title="Previous key"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <span className="text-muted-foreground text-[10px]">
              {filteredDocs.length === 0 ? 0 : currentIndex + 1} / {filteredDocs.length}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => api?.scrollNext()}
              disabled={!api?.canScrollNext()}
              title="Next key"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This issues KV.Delete for the key on {nodeName}. The delete
              propagates as a tombstone across the cluster.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
