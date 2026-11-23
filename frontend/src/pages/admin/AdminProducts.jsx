import { useState } from 'react'
import { adminProducts, createProduct, removeProduct, updateProduct } from '@/services/adminService'
import { getCategories } from '@/services/productService'
import { useAsync } from '@/hooks/useAsync'
import { useDebounce } from '@/hooks/useDebounce'
import { useToast } from '@/context/ToastContext'
import Field from '@/components/Field'
import { CloseIcon } from '@/components/Icons'
import ProductArt from '@/components/ProductArt'
import { formatPrice } from '@/utils/format'

const EMPTY = { title: '', brand: '', category: 'electronics', price: '', mrp: '', stock: '10', emoji: '📦', hue: 260, description: '', active: true }
// The API wants exactly these fields (it rejects anything else being missing), so we pick them from a product.
const toForm = (p) => ({ title: p.title, brand: p.brand, category: p.category, price: String(p.price), mrp: String(p.mrp), stock: String(p.stock), emoji: p.emoji, hue: p.hue, description: p.description, active: p.active })
const toBody = (f) => ({ ...f, price: Number(f.price), mrp: Number(f.mrp), stock: Number(f.stock), hue: Number(f.hue) })

function validate(f) {
  const e = {}
  if (f.title.trim().length < 2) e.title = 'Enter a product name.'
  if (!f.brand.trim()) e.brand = 'Required.'
  if (!(Number(f.price) > 0)) e.price = 'Enter a price above 0.'
  if (!(Number(f.mrp) > 0)) e.mrp = 'Enter the MRP.'
  else if (Number(f.price) > Number(f.mrp)) e.price = 'Price can’t exceed MRP.'
  if (!/^\d+$/.test(f.stock)) e.stock = 'Whole number, 0 or more.'
  if (f.description.trim().length < 10) e.description = 'At least 10 characters.'
  return e
}

function ProductModal({ initial, onSave, onClose }) {
  const [f, setF] = useState(initial)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    const errs = validate(f)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await onSave(toBody(f))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Product form">
      <div className="scrim" onClick={onClose} />
      <form className="modal__card" onSubmit={submit} noValidate>
        <button type="button" className="icon-btn modal__x" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        <h2>{initial.title ? 'Edit product' : 'New product'}</h2>
        <div className="form-grid">
          <div className="span2"><Field label="Product name" value={f.title} onChange={set('title')} error={errors.title} /></div>
          <Field label="Brand" value={f.brand} onChange={set('brand')} error={errors.brand} />
          <Field label="Category" as="select" value={f.category} onChange={set('category')}>
            {getCategories().map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            {!getCategories().some((c) => c.slug === f.category) && <option value={f.category}>{f.category} (old category)</option>}
          </Field>
          <Field label="Selling price (₹)" value={f.price} onChange={set('price')} error={errors.price} inputMode="numeric" />
          <Field label="MRP (₹)" value={f.mrp} onChange={set('mrp')} error={errors.mrp} inputMode="numeric" hint="Discount % is calculated for you." />
          <Field label="Stock" value={f.stock} onChange={set('stock')} error={errors.stock} inputMode="numeric" />
          <Field label="Emoji (placeholder image)" value={f.emoji} onChange={set('emoji')} maxLength={8} />
          <div className="span2"><Field label="Description" as="textarea" rows={3} value={f.description} onChange={set('description')} error={errors.description} /></div>
        </div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Visible in the shop <span className="muted">(hidden products stay in the database)</span></label>
        <div className="btn-row">
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

// Editable stock cell: saves when you press Enter or leave the field, only if the number actually changed.
function StockCell({ product, onSave }) {
  const [v, setV] = useState(String(product.stock))
  const commit = () => {
    if (v === String(product.stock)) return
    if (!/^\d+$/.test(v)) return setV(String(product.stock))
    onSave(product, Number(v))
  }
  return (
    <input className={`stock-input ${product.stock <= 5 ? 'stock-input--low' : ''}`} value={v} inputMode="numeric" aria-label={`Stock for ${product.title}`}
           onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  )
}

export default function AdminProducts() {
  const { toast } = useToast()
  const [q, setQ] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [visibility, setVisibility] = useState('all')
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState(null) // null | 'new' | product
  const dq = useDebounce(q, 250)
  const { data, loading, error } = useAsync(() => adminProducts({ q: dq, lowStock: lowOnly, visibility }), [dq, lowOnly, visibility, version])
  const reload = () => setVersion((v) => v + 1)

  const guard = async (fn, ok) => {
    try {
      await fn()
      toast(ok)
      reload()
      return true
    } catch (e) {
      toast(e.message, 'error')
      return false
    }
  }
  const onSave = async (body) => {
    const done = editing._new ? await guard(() => createProduct(body), 'Product created') : await guard(() => updateProduct(editing.id, body), 'Product updated')
    if (done) setEditing(null)
  }
  const saveStock = (p, stock) => guard(() => updateProduct(p.id, { ...toBody(toForm(p)), stock }), `Stock updated for ${p.title}`)
  const toggleVisible = (p) => guard(() => updateProduct(p.id, { ...toBody(toForm(p)), active: !p.active }), p.active ? `“${p.title}” is now hidden` : `“${p.title}” is visible again`)
  const remove = (p) => window.confirm(`Delete “${p.title}”? Past orders keep their own copy.`) && guard(() => removeProduct(p.id), 'Product deleted')

  return (
    <>
      <div className="admin-toolbar">
        <input type="search" placeholder="Search by name, brand or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        <label className="select">
          <span className="sr-only">Show</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="all">All products</option><option value="visible">Visible in shop</option><option value="hidden">Hidden</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
        <button className="btn btn--primary btn--sm" onClick={() => setEditing({ ...EMPTY, _new: true })}>+ New product</button>
      </div>
      {error && <p className="alert">{error.message}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Rating</th><th>Visible</th><th /></tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={7}><div className="skeleton" style={{ height: 40 }} /></td></tr>}
            {data?.map((p) => (
              <tr key={`${p.id}-${p.stock}`}>
                <td><div className="cell-product"><ProductArt product={p} size="xs" /><div><b>{p.title}</b><small>{p.brand} · {p.id}</small></div></div></td>
                <td className="cap">{p.category}</td>
                <td>{formatPrice(p.price)}{p.discount > 0 && <small className="muted"> {p.discount}% off</small>}</td>
                <td><StockCell product={p} onSave={saveStock} /></td>
                <td>{p.reviews ? `${p.rating.toFixed(1)} ★ (${p.reviews})` : <span className="muted">New</span>}</td>
                <td><button className={`switch ${p.active ? 'switch--on' : ''}`} role="switch" aria-checked={p.active} onClick={() => toggleVisible(p)} aria-label={`${p.title} visible in shop`} /></td>
                <td className="actions"><button className="link-btn" onClick={() => setEditing(p)}>Edit</button><button className="link-btn danger" onClick={() => remove(p)}>Delete</button></td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={7} className="muted center-cell">No products match.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <ProductModal key={editing.id ?? 'new'} initial={editing._new ? EMPTY : toForm(editing)} onSave={onSave} onClose={() => setEditing(null)} />}
    </>
  )
}
