import { useState } from 'react'
import { adminCoupons, createCoupon, removeCoupon, updateCoupon } from '@/services/adminService'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/context/ToastContext'
import Field from '@/components/Field'
import { CloseIcon } from '@/components/Icons'
import { formatDate } from '@/utils/format'

const METHODS = [{ id: 'upi', label: 'UPI' }, { id: 'card', label: 'Card' }, { id: 'cod', label: 'Cash on delivery' }]
const EMPTY = { code: '', title: '', description: '', kind: 'percent', value: '10', maxDiscount: '', minOrder: '0', paymentMethods: [], firstOrderOnly: false, perUserLimit: '', active: true, expiresAt: '' }

const toForm = (c) => ({ ...c, value: String(c.value), maxDiscount: c.maxDiscount ? String(c.maxDiscount) : '', minOrder: String(c.minOrder),
  perUserLimit: c.perUserLimit ? String(c.perUserLimit) : '', expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : '' })
const toBody = (f) => ({
  code: f.code.trim(), title: f.title.trim(), description: f.description.trim(), kind: f.kind, value: Number(f.value),
  maxDiscount: f.kind === 'percent' && f.maxDiscount ? Number(f.maxDiscount) : null, minOrder: Number(f.minOrder || 0),
  paymentMethods: f.paymentMethods, firstOrderOnly: f.firstOrderOnly, perUserLimit: f.perUserLimit ? Number(f.perUserLimit) : null,
  active: f.active, expiresAt: f.expiresAt ? `${f.expiresAt}T23:59:59Z` : null, // expires at the END of the chosen day
})

function validate(f, isNew) {
  const e = {}
  if (isNew && !/^[A-Za-z0-9]{3,20}$/.test(f.code)) e.code = '3–20 letters/numbers, no spaces.'
  if (f.title.trim().length < 3) e.title = 'Add a short title.'
  const v = Number(f.value)
  if (!(v > 0)) e.value = 'Enter a value above 0.'
  else if (f.kind === 'percent' && v > 100) e.value = 'Max 100%.'
  if (f.minOrder && !/^\d+$/.test(f.minOrder)) e.minOrder = 'Whole number.'
  if (f.maxDiscount && !(Number(f.maxDiscount) > 0)) e.maxDiscount = 'Enter an amount.'
  return e
}

function CouponModal({ initial, isNew, onSave, onClose }) {
  const [f, setF] = useState(initial)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const toggleMethod = (m) => setF({ ...f, paymentMethods: f.paymentMethods.includes(m) ? f.paymentMethods.filter((x) => x !== m) : [...f.paymentMethods, m] })

  const submit = async (e) => {
    e.preventDefault()
    const errs = validate(f, isNew)
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
    <div className="modal" role="dialog" aria-modal="true" aria-label="Coupon form">
      <div className="scrim" onClick={onClose} />
      <form className="modal__card" onSubmit={submit} noValidate>
        <button type="button" className="icon-btn modal__x" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        <h2>{isNew ? 'New coupon' : `Edit ${initial.code}`}</h2>
        <div className="form-grid">
          <Field label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} error={errors.code} disabled={!isNew} hint={isNew ? 'What customers type, e.g. SAVE20' : 'The code can’t be changed.'} />
          <Field label="Title" value={f.title} onChange={set('title')} error={errors.title} placeholder="Extra 5% off with UPI" />
          <div className="span2"><Field label="Description (optional)" value={f.description} onChange={set('description')} /></div>
          <Field label="Discount type" as="select" value={f.kind} onChange={set('kind')}>
            <option value="percent">Percentage (%)</option><option value="flat">Flat amount (₹)</option>
          </Field>
          <Field label={f.kind === 'percent' ? 'Percent off' : 'Rupees off'} value={f.value} onChange={set('value')} error={errors.value} inputMode="numeric" />
          {f.kind === 'percent' && <Field label="Max discount ₹ (optional)" value={f.maxDiscount} onChange={set('maxDiscount')} error={errors.maxDiscount} inputMode="numeric" />}
          <Field label="Minimum order ₹" value={f.minOrder} onChange={set('minOrder')} error={errors.minOrder} inputMode="numeric" />
          <Field label="Uses per customer (optional)" value={f.perUserLimit} onChange={set('perUserLimit')} inputMode="numeric" hint="Blank = unlimited" />
          <Field label="Expires on (optional)" type="date" value={f.expiresAt} onChange={set('expiresAt')} />
        </div>
        <fieldset className="method-set"><legend>Valid payment methods <span className="muted">(none ticked = all)</span></legend>
          {METHODS.map((m) => <label key={m.id} className="check"><input type="checkbox" checked={f.paymentMethods.includes(m.id)} onChange={() => toggleMethod(m.id)} /> {m.label}</label>)}
        </fieldset>
        <label className="check"><input type="checkbox" checked={f.firstOrderOnly} onChange={(e) => setF({ ...f, firstOrderOnly: e.target.checked })} /> First order only</label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (visible to customers)</label>
        <div className="btn-row">
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save coupon'}</button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

const describe = (c) => `${c.kind === 'percent' ? `${c.value}% off` : `₹${c.value} off`}${c.kind === 'percent' && c.maxDiscount ? ` (max ₹${c.maxDiscount})` : ''}`
const expired = (c) => c.expiresAt && new Date(c.expiresAt) < new Date()

export default function AdminCoupons() {
  const { toast } = useToast()
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState(null) // null | { isNew, initial }
  const { data, loading, error } = useAsync(adminCoupons, [version])

  const guard = async (fn, ok) => {
    try {
      await fn()
      toast(ok)
      setVersion((v) => v + 1)
      return true
    } catch (e) {
      toast(e.message, 'error')
      return false
    }
  }
  const onSave = async (body) => {
    const done = editing.isNew ? await guard(() => createCoupon(body), 'Coupon created') : await guard(() => updateCoupon(editing.initial.code, body), 'Coupon updated')
    if (done) setEditing(null)
  }
  const toggle = (c) => guard(() => updateCoupon(c.code, { ...toBody(toForm(c)), active: !c.active }), c.active ? `${c.code} deactivated` : `${c.code} activated`)
  const remove = (c) => window.confirm(`Delete coupon ${c.code}? Past orders keep the code they used.`) && guard(() => removeCoupon(c.code), 'Coupon deleted')

  return (
    <>
      <div className="admin-toolbar">
        <p className="muted" style={{ margin: 0 }}>Coupons appear to shoppers in the cart and on the payment step. Rules are checked again on the server at checkout.</p>
        <button className="btn btn--primary btn--sm" onClick={() => setEditing({ isNew: true, initial: EMPTY })}>+ New coupon</button>
      </div>
      {error && <p className="alert">{error.message}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Code</th><th>Offer</th><th>Conditions</th><th>Used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={6}><div className="skeleton" style={{ height: 40 }} /></td></tr>}
            {data?.map((c) => (
              <tr key={c.code}>
                <td><span className="offer__code offer__code--sm">{c.code}</span></td>
                <td><b>{c.title}</b><small className="block muted">{describe(c)}</small></td>
                <td className="conds">
                  {[c.minOrder ? `Min ₹${c.minOrder.toLocaleString('en-IN')}` : null, c.paymentMethods.length ? c.paymentMethods.join('/').toUpperCase() : null,
                    c.firstOrderOnly ? 'First order' : null, c.perUserLimit ? `${c.perUserLimit}×/user` : null, c.expiresAt ? `Exp ${formatDate(c.expiresAt)}` : null]
                    .filter(Boolean).join(' · ') || <span className="muted">No restrictions</span>}
                </td>
                <td>{c.used}</td>
                <td>
                  <button className={`switch ${c.active && !expired(c) ? 'switch--on' : ''}`} role="switch" aria-checked={c.active} onClick={() => toggle(c)} aria-label={`${c.code} active`} />
                  {expired(c) && <small className="warn block">Expired</small>}
                </td>
                <td className="actions">
                  <button className="link-btn" onClick={() => setEditing({ isNew: false, initial: toForm(c) })}>Edit</button>
                  <button className="link-btn danger" onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={6} className="muted center-cell">No coupons yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <CouponModal key={editing.initial.code || 'new'} initial={editing.initial} isNew={editing.isNew} onSave={onSave} onClose={() => setEditing(null)} />}
    </>
  )
}
