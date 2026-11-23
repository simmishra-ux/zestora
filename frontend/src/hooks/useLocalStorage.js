import { useCallback, useEffect, useState } from 'react'

// Like useState, but the value survives page reloads and syncs across browser tabs.
export function useLocalStorage(key, initialValue) {
  const read = useCallback(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initialValue : JSON.parse(raw)
    } catch {
      return initialValue // corrupted JSON or storage blocked: fall back safely
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const [value, setValue] = useState(read)

  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        try {
          localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          /* quota exceeded / private mode: keep working in memory */
        }
        return resolved
      })
    },
    [key],
  )

  useEffect(() => {
    const onStorage = (e) => e.key === key && setValue(read())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key, read])

  return [value, set]
}
