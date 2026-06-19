import { useRef, useState } from "react"
import { patchKV, type DebugDoc } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

interface Props {
  nodeId: string
  nodeName: string
  doc: DebugDoc | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface FieldRow {
  id: string
  /** Original top-level field name. Empty for newly added rows. */
  originalName: string
  name: string
  valueText: string
  originalValueText: string
  isNew: boolean
  editing: boolean
}

function prettyPrint(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function parseDocument(doc: DebugDoc): Record<string, unknown> {
  if (doc.tombstone || !doc.document) return {}
  try {
    const parsed = JSON.parse(doc.document)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* fall through */
  }
  return {}
}

function rowsFromDoc(doc: DebugDoc): FieldRow[] {
  const obj = parseDocument(doc)
  return Object.entries(obj).map(([name, value], i) => {
    const text = prettyPrint(value)
    return {
      id: `orig-${i}-${name}`,
      originalName: name,
      name,
      valueText: text,
      originalValueText: text,
      isNew: false,
      editing: false,
    }
  })
}

export function EditKvDialog({
  nodeId,
  nodeName,
  doc,
  open,
  onOpenChange,
}: Props) {
  const [rows, setRows] = useState<FieldRow[]>([])
  const [original, setOriginal] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const newIdRef = useRef(0)

  // Re-initialize the working copy whenever the dialog opens for a (possibly
  // new) document. Adjusting state directly during render — rather than in
  // an effect — avoids an extra render and is React's recommended pattern
  // for resetting state in response to changed props.
  const formKey = open && doc ? `${doc.key}|${doc.document}` : null
  const [lastFormKey, setLastFormKey] = useState<string | null>(null)
  if (formKey !== lastFormKey) {
    setLastFormKey(formKey)
    setRows(formKey && doc ? rowsFromDoc(doc) : [])
    setOriginal(formKey && doc ? parseDocument(doc) : {})
    setError(null)
  }

  function updateRow(id: string, patch: Partial<FieldRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  function addRow() {
    newIdRef.current += 1
    setRows((rs) => [
      ...rs,
      {
        id: `new-${newIdRef.current}`,
        originalName: "",
        name: "",
        valueText: "",
        originalValueText: "",
        isNew: true,
        editing: true,
      },
    ])
  }

  function computeDiff():
    | { value: Record<string, unknown>; deleteFields: string[] }
    | { error: string } {
    const value: Record<string, unknown> = {}
    const seenNames = new Set<string>()

    for (const row of rows) {
      const name = row.name.trim()
      if (row.isNew) {
        if (!name) return { error: "Field name cannot be empty." }
        // Only collide with names still in use by another row — a field
        // that was deleted in this same edit is fair game to reuse.
        if (seenNames.has(name)) {
          return { error: `Duplicate field "${name}".` }
        }
        seenNames.add(name)
        let parsed: unknown
        try {
          parsed =
            row.valueText.trim() === "" ? null : JSON.parse(row.valueText)
        } catch {
          return { error: `Invalid JSON value for "${name}".` }
        }
        value[name] = parsed
      } else {
        seenNames.add(row.originalName)
        if (row.valueText !== row.originalValueText) {
          let parsed: unknown
          try {
            parsed = JSON.parse(row.valueText)
          } catch {
            return { error: `Invalid JSON value for "${row.originalName}".` }
          }
          const unchanged =
            JSON.stringify(parsed) ===
            JSON.stringify(original[row.originalName])
          if (!unchanged) value[row.originalName] = parsed
        }
      }
    }

    const deleteFields = Object.keys(original).filter(
      (name) => !seenNames.has(name)
    )
    return { value, deleteFields }
  }

  async function handleSubmit() {
    if (!doc) return
    setError(null)
    const diff = computeDiff()
    if ("error" in diff) {
      setError(diff.error)
      return
    }
    const { value, deleteFields } = diff
    if (Object.keys(value).length === 0 && deleteFields.length === 0) {
      onOpenChange(false)
      return
    }
    setSubmitting(true)
    try {
      const result = await patchKV(nodeId, doc.key, value, deleteFields)
      if (result.partial) {
        toast.warning(`Patched "${doc.key}" on ${nodeName}`, {
          description: result.detail,
        })
      } else {
        toast.success(`Patched "${doc.key}" on ${nodeName}`)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit "{doc?.key}" on {nodeName}
          </DialogTitle>
          <DialogDescription>
            Changes are sent as a partial update (KV.Patch): edited and added
            fields are upserted, removed fields are deleted, untouched fields
            are left as-is.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No top-level fields.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.id}
              className="group flex items-start justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                {row.isNew ? (
                  <Input
                    value={row.name}
                    onChange={(e) =>
                      updateRow(row.id, { name: e.target.value })
                    }
                    placeholder="field name"
                    className="mb-1 h-6 font-mono text-xs"
                    autoFocus
                  />
                ) : (
                  <span className="font-mono text-xs font-semibold">
                    {row.name}
                  </span>
                )}

                {row.editing || row.isNew ? (
                  <Textarea
                    value={row.valueText}
                    onChange={(e) =>
                      updateRow(row.id, { valueText: e.target.value })
                    }
                    placeholder='"value" or { } or 42'
                    rows={2}
                    className="mt-1 font-mono text-xs"
                  />
                ) : (
                  <pre className="mt-0.5 font-mono text-[11px] break-all whitespace-pre-wrap">
                    {row.valueText}
                  </pre>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                {!row.isNew && !row.editing && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    title="Edit value"
                    onClick={() => updateRow(row.id, { editing: true })}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 text-muted-foreground hover:text-destructive"
                  title="Delete field"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={addRow}
        >
          <Plus className="h-3 w-3" />
          Add field
        </Button>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !doc}
          >
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
