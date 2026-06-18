import { useState, useEffect } from "react"
import { fetchCluster, type ClusterNodeInfo } from "@/lib/api"

export function useCluster() {
  const [nodes, setNodes] = useState<ClusterNodeInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()

    async function poll() {
      try {
        const data = await fetchCluster()
        if (!ac.signal.aborted) {
          setNodes(data)
          setError(null)
        }
      } catch (e) {
        if (!ac.signal.aborted) setError((e as Error).message)
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }

    poll()
    const interval = setInterval(poll, 1500)
    return () => {
      ac.abort()
      clearInterval(interval)
    }
  }, [])

  return { nodes, loading, error }
}
