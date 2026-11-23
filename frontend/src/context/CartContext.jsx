import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { getProductsByIds } from '@/services/productService'
import { getOffers } from '@/services/couponService'
import { calcTotals } from '@/utils/pricing'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'

const CartContext = createContext(null)
const MAX_QTY = 10

export function CartProvider({ children }) {
  // Only { id, qty, color } is persisted. Prices are looked up fresh, so the cart can't hold stale prices.
  const [entries, setEntries] = useLocalStorage('zestora.cart', [])
  const [couponCode, setCouponCode] = useLocalStorage('zestora.coupon', '')
  const [products, setProducts] = useState([])
  const [offers, setOffers] = useState([])
  const [offersLoading, setOffersLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState(null) // set by the checkout's payment step
  const { toast } = useToast()
  const { user } = useAuth()
  const couponRef = useRef(couponCode)
  couponRef.current = couponCode

  const idsKey = entries.map((e) => e.id).join(',')
  useEffect(() => {
    let cancelled = false
    getProductsByIds(entries.map((e) => e.id)).then((p) => !cancelled && setProducts(p))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  // Re-evaluate all offers whenever the cart, payment method or user changes. If the applied coupon stops
  // being valid (item removed, COD chosen for a UPI-only offer...), drop it and tell the user why.
  const cartKey = entries.map((e) => `${e.id}x${e.qty}`).join(',')
  useEffect(() => {
    if (!entries.length) {
      setOffers([])
      return
    }
    let cancelled = false
    setOffersLoading(true)
    getOffers(entries, paymentMethod)
      .then(({ offers: list }) => {
        if (cancelled) return
        setOffers(list)
        const code = couponRef.current
        const applied = code && list.find((o) => o.code === code)
        if (code && (!applied || !applied.eligible)) {
          setCouponCode('')
          toast(`Coupon ${code} removed${applied?.reason ? `: ${applied.reason}` : ''}`, 'error')
        }
      })
      .catch(() => !cancelled && setOffers([])) // offers are a nice-to-have; never block the cart on them
      .finally(() => !cancelled && setOffersLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey, paymentMethod, user?.id])

  const lines = useMemo(
    () =>
      entries
        .map((e) => ({ ...e, product: products.find((p) => p.id === e.id) }))
        .filter((l) => l.product),
    [entries, products],
  )
  const applied = useMemo(() => offers.find((o) => o.code === couponCode && o.eligible) ?? null, [offers, couponCode])
  const totals = useMemo(() => calcTotals(lines, applied?.discount ?? 0), [lines, applied])

  const add = useCallback(
    (product, qty = 1, color) => {
      setEntries((prev) => {
        const found = prev.find((e) => e.id === product.id)
        if (found) return prev.map((e) => (e.id === product.id ? { ...e, qty: Math.min(MAX_QTY, e.qty + qty) } : e))
        return [...prev, { id: product.id, qty, color: color || product.colors?.[0]?.name || null }]
      })
      toast(`Added “${product.title}” to cart`)
    },
    [setEntries, toast],
  )
  const setQty = useCallback(
    (id, qty) =>
      setEntries((prev) =>
        qty < 1 ? prev.filter((e) => e.id !== id) : prev.map((e) => (e.id === id ? { ...e, qty: Math.min(MAX_QTY, qty) } : e)),
      ),
    [setEntries],
  )
  const remove = useCallback((id) => setEntries((prev) => prev.filter((e) => e.id !== id)), [setEntries])
  const clear = useCallback(() => {
    setEntries([])
    setCouponCode('')
  }, [setEntries, setCouponCode])

  // Returns { ok, message }. Works for offers from the list and for codes typed by hand.
  const applyCoupon = useCallback(
    (raw) => {
      const code = raw.trim().toUpperCase()
      if (!code) return { ok: false, message: 'Enter a coupon code.' }
      if (!entries.length) return { ok: false, message: 'Add items to your cart first.' }
      const offer = offers.find((o) => o.code === code)
      if (!offer) return { ok: false, message: 'This coupon code isn’t valid.' }
      if (!offer.eligible) return { ok: false, message: offer.reason }
      setCouponCode(code)
      return { ok: true, message: `${code} applied — you save ₹${offer.discount.toLocaleString('en-IN')}` }
    },
    [entries.length, offers, setCouponCode],
  )

  const value = useMemo(
    () => ({
      lines, totals, couponCode, applied, offers, offersLoading, paymentMethod, setPaymentMethod,
      add, setQty, remove, clear, applyCoupon, removeCoupon: () => setCouponCode(''), count: totals.itemCount, MAX_QTY,
    }),
    [lines, totals, couponCode, applied, offers, offersLoading, paymentMethod, add, setQty, remove, clear, applyCoupon, setCouponCode],
  )
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export const useCart = () => useContext(CartContext)
