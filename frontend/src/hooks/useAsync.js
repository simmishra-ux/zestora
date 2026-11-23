import { useEffect, useState } from 'react'

const sameDeps = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

// Runs an async function when `deps` change and tracks loading / error state.
// - `cancelled` stops a slow old request from overwriting a newer result.
// - When deps change we flip to `loading` DURING render (not inside the effect), so the very first paint after a
//   change already shows the loading state, with no extra render pass.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const [seenDeps, setSeenDeps] = useState(deps)
  if (!sameDeps(seenDeps, deps)) {
    setSeenDeps(deps)
    setState((s) => ({ ...s, loading: true, error: null })) // keep old data visible while the new request runs
  }

  useEffect(() => {
    let cancelled = false
    fn()
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((error) => !cancelled && setState({ data: null, loading: false, error }))
    return () => {
      cancelled = true
    }
  }, deps) // caller-supplied, like useEffect's own 2nd argument (lint rule disabled for this file in .oxlintrc.json)

  return state
}
