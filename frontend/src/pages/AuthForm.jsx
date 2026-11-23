import { Link } from 'react-router-dom'
import { Logo } from '@/components/Navbar'

// Shared split-screen shell for Login and Signup.
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <div className="auth__art">
        <Logo />
        <h2>Everything you love,<br />one tap away.</h2>
        <p>Track orders, save favourites and check out faster.</p>
        <div className="auth__emojis" aria-hidden>🎧 👟 🪴 💄 📚 🧸</div>
      </div>
      <div className="auth__panel">
        <div className="auth__card">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
          <p className="auth__foot">{footer}</p>
          <Link to="/" className="link-btn">← Continue browsing</Link>
        </div>
      </div>
    </div>
  )
}
