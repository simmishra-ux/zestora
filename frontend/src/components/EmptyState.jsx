import { Link } from 'react-router-dom'

export default function EmptyState({ emoji, title, text, actionLabel = 'Start shopping', to = '/products' }) {
  return (
    <div className="empty">
      <div className="empty__emoji">{emoji}</div>
      <h2>{title}</h2>
      <p>{text}</p>
      <Link to={to} className="btn btn--primary">{actionLabel}</Link>
    </div>
  )
}
