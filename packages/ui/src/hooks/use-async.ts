import { useCallback, useEffect, useRef, useState } from "react"

import { useMountedState } from "@/ui/hooks/use-mounted-state"

export function useAsync<Arguments extends unknown[], Result>(
  action: (...args: Arguments) => Promise<Result>
) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const mountedRef = useMountedState()
  const runningRef = useRef(false)
  const actionRef = useRef(action)

  useEffect(() => {
    actionRef.current = action
  }, [action])

  const run = useCallback(async (...args: Arguments) => {
    if (runningRef.current) {
      throw new Error("Action already running")
    }

    runningRef.current = true
    if (mountedRef.current) {
      setLoading(true)
      setError(null)
    }

    try {
      return await actionRef.current(...args)
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause)
      }
      throw cause
    } finally {
      runningRef.current = false
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [mountedRef])

  const reset = useCallback(() => {
    if (mountedRef.current) {
      setError(null)
      setLoading(false)
    }
  }, [mountedRef])

  return { loading, error, run, reset }
}
