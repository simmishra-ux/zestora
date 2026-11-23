import { ORDER_STEPS } from '@/services/orderService'

export default function OrderTracker({ index }) {
  if (index === -1) return <p className="cancelled">This order was cancelled.</p>
  return (
    <ol className="tracker">
      {ORDER_STEPS.map((s, i) => (
        <li key={s.key} className={i < index ? 'done' : i === index ? 'current' : ''}>
          <span className="tracker__dot">{i < index || (i === index && i === ORDER_STEPS.length - 1) ? '✓' : ''}</span>
          <span className="tracker__label">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}
