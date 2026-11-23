export default function QuantityStepper({ value, onChange, max = 10, min = 1 }) {
  return (
    <div className="stepper" role="group" aria-label="Quantity">
      <button onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Decrease quantity">−</button>
      <output aria-live="polite">{value}</output>
      <button onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">+</button>
    </div>
  )
}
