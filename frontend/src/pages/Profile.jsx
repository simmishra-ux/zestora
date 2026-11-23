import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useWishlist } from '@/context/WishlistContext'
import { listOrders } from '@/services/orderService'
import { addAddress, deleteAddress, editAddress, makeDefaultAddress } from '@/services/addressService'
import { useAsync } from '@/hooks/useAsync'
import Field from '@/components/Field'
import AddressForm from '@/components/AddressForm'
import { EMPTY_ADDRESS } from '@/utils/address'
import { CloseIcon } from '@/components/Icons'
import { formatDate } from '@/utils/format'
import { isPhone, validateAddress } from '@/utils/validators'

const MAX_ADDRESSES = 10 // keep in sync with the backend limit

// Modal used for both "add" (editing === 'new') and "edit" (editing === address id).
function AddressModal({ initial, onSave, onClose, isFirst }) {
  const [value, setValue] = useState(initial)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const errs = validateAddress(value)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await onSave(value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Address form">
      <div className="scrim" onClick={onClose} />
      <form className="modal__card" onSubmit={submit} noValidate>
        <button type="button" className="icon-btn modal__x" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        <h2>{initial.id ? 'Edit address' : 'Add a new address'}</h2>
        <AddressForm value={value} onChange={setValue} errors={errors} showDefault={!isFirst && !initial.isDefault} />
        <div className="btn-row">
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

export default function Profile() {
  const { user, updateProfile, logout, setAddresses } = useAuth()
  const { toast } = useToast()
  const wishlist = useWishlist()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: user.name, phone: user.phone })
  const [errors, setErrors] = useState({})
  const [editing, setEditing] = useState(null) // null | 'new' | an address object
  const { data: orders } = useAsync(listOrders, [])

  const save = async (e) => {
    e.preventDefault()
    const errs = {}
    if (form.name.trim().length < 2) errs.name = 'Please enter your name.'
    if (form.phone && !isPhone(form.phone)) errs.phone = 'Enter a valid 10-digit mobile number.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await updateProfile({ name: form.name.trim(), phone: form.phone })
      toast('Profile updated')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  // One helper for every address action: call the API, store the returned list, toast the result.
  const run = async (action, okMessage) => {
    try {
      setAddresses(await action())
      toast(okMessage)
      return true
    } catch (err) {
      toast(err.message, 'error')
      return false
    }
  }
  const onSave = async (value) => {
    // An address that already has an id is being edited; a blank one (no id yet) is being added.
    const ok = editing.id ? await run(() => editAddress(editing.id, value), 'Address updated') : await run(() => addAddress(value), 'Address added')
    if (ok) setEditing(null)
  }
  const remove = (a) => window.confirm(`Delete the ${a.label} address for ${a.name}?`) && run(() => deleteAddress(a.id), 'Address deleted')

  return (
    <div className="container page narrow">
      <div className="profile-head">
        <div className="avatar avatar--lg">{user.name.charAt(0).toUpperCase()}</div>
        <div><h1>{user.name}</h1><span className="muted">{user.email} · Member since {formatDate(user.createdAt)}</span></div>
      </div>

      <div className="stats">
        <Link to="/orders"><b>{orders ? orders.length : '–'}</b><span>Orders</span></Link>
        <Link to="/wishlist"><b>{wishlist.ids.length}</b><span>Wishlist</span></Link>
        <a href="#addresses"><b>{user.addresses.length}</b><span>Addresses</span></a>
      </div>

      <form className="panel" onSubmit={save} noValidate>
        <h3>Personal details</h3>
        <div className="form-grid">
          <Field label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          <Field label="Mobile number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} inputMode="numeric" maxLength={10} />
          <div className="span2"><Field label="Email" value={user.email} disabled hint="Email can’t be changed in this demo." /></div>
        </div>
        <button className="btn btn--primary">Save changes</button>
      </form>

      <section className="panel" id="addresses">
        <div className="panel__head">
          <h3>Saved addresses <span className="muted">({user.addresses.length}/{MAX_ADDRESSES})</span></h3>
          <button className="btn btn--soft btn--sm" disabled={user.addresses.length >= MAX_ADDRESSES}
                  onClick={() => setEditing({ ...EMPTY_ADDRESS, name: user.name, phone: user.phone })}>+ Add new address</button>
        </div>
        {user.addresses.length === 0 && <p className="muted">No saved addresses yet. Add one to check out faster.</p>}
        <div className="addr-cards">
          {user.addresses.map((a) => (
            <article key={a.id} className={`addr-card ${a.isDefault ? 'addr-card--default' : ''}`}>
              <header>
                <span className="tag-label">{a.label === 'Home' ? '🏠' : a.label === 'Work' ? '🏢' : '📍'} {a.label}</span>
                {a.isDefault && <span className="tag-label tag-label--default">Default</span>}
              </header>
              <p><b>{a.name}</b> · {a.phone}<br /><span className="muted">{a.line1}, {a.city}, {a.state} – {a.pincode}</span></p>
              <footer>
                <button className="link-btn" onClick={() => setEditing(a)}>Edit</button>
                <button className="link-btn danger" onClick={() => remove(a)}>Delete</button>
                {!a.isDefault && <button className="link-btn" onClick={() => run(() => makeDefaultAddress(a.id), 'Default address updated')}>Set as default</button>}
              </footer>
            </article>
          ))}
        </div>
      </section>

      {editing && <AddressModal key={editing.id ?? 'new'} initial={editing} isFirst={user.addresses.length === 0 && !editing.id} onSave={onSave} onClose={() => setEditing(null)} />}

      <button className="btn btn--ghost" onClick={() => { logout(); navigate('/') }}>Log out</button>
    </div>
  )
}
