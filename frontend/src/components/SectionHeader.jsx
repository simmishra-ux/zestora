import { Link } from 'react-router-dom'

export default function SectionHeader({ eyebrow, title, linkTo, linkLabel = 'View all' }) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {linkTo && <Link to={linkTo} className="link-arrow">{linkLabel} →</Link>}
    </div>
  )
}
