import { useState } from "react"
import { putKV } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

interface Props {
  nodeId: string
  nodeName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddKvDialog({ nodeId, nodeName, open, onOpenChange }: Props) {
  const [key, setKey] = useState("")
  const [valueText, setValueText] = useState("")
  const [valueError, setValueError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function validate(): Record<string, unknown> | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(valueText)
    } catch {
      setValueError("Invalid JSON")
      return null
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setValueError("Value must be a JSON object { … }")
      return null
    }
    setValueError(null)
    return parsed as Record<string, unknown>
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!key.trim()) return
    const value = validate()
    if (!value) return

    setSubmitting(true)
    try {
      const result = await putKV(nodeId, key.trim(), value)
      if (result.partial) {
        toast.warning(`Written "${key}" to ${nodeName}`, { description: result.detail })
      } else {
        toast.success(`Written "${key}" to ${nodeName}`)
      }
      setKey("")
      setValueText("")
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Write key–value to {nodeName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kv-key">Key</Label>
            <Input
              id="kv-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="my-key"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kv-value">Value (JSON object)</Label>
            <Textarea
              id="kv-value"
              value={valueText}
              onChange={(e) => {
                setValueText(e.target.value)
                setValueError(null)
              }}
              placeholder='{"field": "value"}'
              rows={4}
              className="font-mono text-xs"
            />
            {valueError && (
              <p className="text-destructive text-xs">{valueError}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !key.trim()}>
              {submitting ? "Writing…" : "Write"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
