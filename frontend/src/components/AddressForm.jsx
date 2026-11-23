import Field from './Field'

const LABELS = ['Home', 'Work', 'Other']

// Controlled form: parent owns `value`, `errors`, and the Save button. Used in Profile (modal) and Checkout (inline).
export default function AddressForm({ value, onChange, errors = {}, showDefault = true }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value })
  return (
    <div>
      <div className="label-chips" role="radiogroup" aria-label="Address type">
        {LABELS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={value.label === l}
                  className={value.label === l ? 'on' : ''} onClick={() => onChange({ ...value, label: l })}>
            {l === 'Home' ? '🏠' : l === 'Work' ? '🏢' : '📍'} {l}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Full name" value={value.name} onChange={set('name')} error={errors.name} autoComplete="name" />
        <Field label="Mobile number" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
               error={errors.phone} inputMode="numeric" autoComplete="tel" />
        <div className="span2"><Field label="Address" value={value.line1} onChange={set('line1')} error={errors.line1} placeholder="House no, building, street, area" autoComplete="street-address" /></div>
        <Field label="City" value={value.city} onChange={set('city')} error={errors.city} autoComplete="address-level2" />
        <Field label="State" value={value.state} onChange={set('state')} error={errors.state} autoComplete="address-level1" />
        <Field label="Pincode" value={value.pincode} onChange={(e) => onChange({ ...value, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
               error={errors.pincode} inputMode="numeric" autoComplete="postal-code" />
      </div>
      {showDefault && (
        <label className="check">
          <input type="checkbox" checked={value.isDefault} onChange={(e) => onChange({ ...value, isDefault: e.target.checked })} />
          Make this my default address
        </label>
      )}
    </div>
  )
}
