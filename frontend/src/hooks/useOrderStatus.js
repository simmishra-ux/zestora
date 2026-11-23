import { useEffect, useReducer } from 'react'
import { getStatusIndex } from '@/services/orderService'

// The status is DERIVED from the order every render; the interval only forces a re-render every few seconds
// so a demo order visibly "moves" while you watch (no duplicated state to keep in sync).
export function useOrderStatus(order) {
  const [, rerender] = useReducer((n) => n + 1, 0)
  useEffect(() => {
    const id = setInterval(rerender, 5000)
    return () => clearInterval(id)
  }, [])
  return getStatusIndex(order)
}
