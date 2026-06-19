import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Props {
  total: number
  value: number | null
  onChange: (value: number | null) => void
}

const ALL = "all"

export function PartitionSelector({ total, value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background/90 px-2 py-1.5 shadow-sm backdrop-blur">
      <span className="text-xs font-medium text-muted-foreground">
        Partition
      </span>
      <Select
        value={value === null ? ALL : String(value)}
        onValueChange={(v) => onChange(v === ALL ? null : Number(v))}
        disabled={total === 0}
      >
        <SelectTrigger size="sm" className="h-7 w-28 text-xs">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All partitions</SelectItem>
          {Array.from({ length: total }, (_, p) => (
            <SelectItem key={p} value={String(p)}>
              Partition {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
