import { createContext, useCallback, useContext, useMemo } from 'react'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useToast } from './ToastContext'

const WishlistContext = createContext(null)

export function WishlistProvider({ children }) {
  const [ids, setIds] = useLocalStorage('zestora.wishlist', [])
  const { toast } = useToast()

  const toggle = useCallback(
    (product) => {
      const has = ids.includes(product.id)
      setIds(has ? ids.filter((i) => i !== product.id) : [product.id, ...ids])
      toast(has ? 'Removed from wishlist' : 'Saved to wishlist ♥')
    },
    [ids, setIds, toast],
  )

  // Drop saved ids whose products were retired, so the badge and list never disagree.
  const prune = useCallback((valid) => setIds((prev) => (prev.every((i) => valid.includes(i)) ? prev : prev.filter((i) => valid.includes(i)))), [setIds])

  const value = useMemo(() => ({ ids, has: (id) => ids.includes(id), toggle, prune }), [ids, toggle, prune])
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}

export const useWishlist = () => useContext(WishlistContext)
