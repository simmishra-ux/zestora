import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { askAsGuest, getMyThread, sendSupportMessage } from '@/services/supportService'
import { CloseIcon } from './Icons'

const MENU = ['Where is my order?', 'Payment problem', 'Quality issue', 'Return or replacement', 'Talk to a person']
const GREETING = {
  id: 'greeting', sender: 'bot', links: [], quickReplies: MENU,
  text: "Hi! I'm Zestora's help assistant. I can check an order, look into a payment, handle a quality issue, or pass you to our team.",
}
const STATUS_TEXT = { bot: 'Help assistant', waiting_agent: 'Waiting for our team', answered: 'Our team replied', resolved: 'Resolved' }
const SEEN_KEY = 'zestora.support.seen'

const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}
const writeSeen = (id) => {
  try {
    localStorage.setItem(SEEN_KEY, String(id))
  } catch {
    /* private mode: the badge just won't remember */
  }
}

// Floating help chat. Logged-in customers get a saved conversation (and a ticket when the bot hands over to a person);
// visitors get general answers only. Remounted via `key` when the user changes, so state never leaks between accounts.
export default function SupportChat() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [thread, setThread] = useState(null) // server thread (logged in)
  const [guest, setGuest] = useState([]) // local messages (visitors)
  const [pending, setPending] = useState(null) // the message being sent, shown immediately
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [seen, setSeen] = useState(readSeen)
  const openRef = useRef(false)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const nextId = useRef(0) // ids for the visitor's local messages

  const messages = user ? (thread?.messages ?? []) : guest
  const lastAgentId = messages.filter((m) => m.sender === 'agent').reduce((max, m) => Math.max(max, m.id), 0)
  const unread = !open && user && lastAgentId > seen

  // Poll for new replies from our team: quickly while the window is open, slowly in the background.
  const applyThread = useCallback((t) => {
    setThread(t)
    if (openRef.current && t) {
      const id = t.messages.filter((m) => m.sender === 'agent').reduce((max, m) => Math.max(max, m.id), 0)
      writeSeen(id)
      setSeen(id)
    }
  }, [])
  const poll = useCallback(() => getMyThread().then(applyThread).catch(() => {}), [applyThread]) // offline/logged out: next tick
  useEffect(() => {
    if (!user) return undefined
    poll()
    const id = setInterval(poll, open ? 5000 : 20000)
    return () => clearInterval(id)
  }, [user, open, poll])

  // Keep the newest message in view.
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [open, messages.length, pending, sending])

  const toggle = (next) => {
    openRef.current = next
    setOpen(next)
    if (next) {
      writeSeen(lastAgentId)
      setSeen(lastAgentId)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const send = async (raw) => {
    const text = raw.trim()
    if (!text || sending) return
    setInput('')
    setError('')
    setSending(true)
    if (user) {
      setPending(text)
      try {
        setThread(await sendSupportMessage(text))
      } catch (e) {
        setError(e.message)
        setInput(text) // give the message back so nothing typed is lost
      } finally {
        setPending(null)
        setSending(false)
      }
    } else {
      setGuest((g) => [...g, { id: ++nextId.current, sender: 'user', text, quickReplies: [], links: [] }])
      try {
        const r = await askAsGuest(text)
        setGuest((g) => [...g, { id: ++nextId.current, sender: 'bot', text: r.text, quickReplies: r.quickReplies, links: r.links }])
      } catch (e) {
        setError(e.message)
      } finally {
        setSending(false)
      }
    }
  }

  const shown = [GREETING, ...messages]
  const last = shown[shown.length - 1]
  const showChips = last.sender === 'bot' && last.quickReplies?.length > 0 && !sending && !pending
  const humanMode = thread?.status === 'waiting_agent' || thread?.status === 'answered'

  return (
    <>
      <button className="chat-fab" onClick={() => toggle(!open)} aria-label={open ? 'Close support chat' : 'Open support chat'} aria-expanded={open}>
        <span aria-hidden>{open ? '✕' : '💬'}</span>
        <span className="chat-fab__label">{open ? 'Close' : 'Help'}</span>
        {unread && <span className="chat-fab__dot" role="status" aria-label="New reply from our team" />}
      </button>

      {open && (
        <section className="chat" role="dialog" aria-label="Support chat" onKeyDown={(e) => e.key === 'Escape' && toggle(false)}>
          <header className="chat__head">
            <div>
              <b>Zestora support</b>
              <small>{thread ? `Ticket ${thread.id} · ${STATUS_TEXT[thread.status]}` : user ? 'Usually instant' : 'Log in to talk to our team'}</small>
            </div>
            <button className="icon-btn" onClick={() => toggle(false)} aria-label="Minimise chat"><CloseIcon width={20} height={20} /></button>
          </header>

          <div className="chat__list" ref={listRef} role="log" aria-live="polite" aria-label="Conversation">
            {shown.map((m) => (
              <div key={m.id} className={`msg msg--${m.sender}`}>
                {m.sender === 'agent' && <span className="msg__who">Support team</span>}
                <p>{m.text}</p>
                {m.links?.length > 0 && (
                  <div className="msg__links">
                    {m.links.map((l) => <Link key={l.to + l.label} to={l.to} className="msg__link" onClick={() => toggle(false)}>{l.label}</Link>)}
                  </div>
                )}
              </div>
            ))}
            {pending && <div className="msg msg--user"><p>{pending}</p></div>}
            {sending && !humanMode && <div className="msg msg--bot msg--typing" aria-label="Assistant is typing"><i /><i /><i /></div>}
            {thread?.status === 'resolved' && <p className="chat__note">This conversation was marked resolved. Send a message to start a new one.</p>}
          </div>

          {showChips && (
            <div className="chat__chips">
              {last.quickReplies.map((q) => <button key={q} className="chip-btn" onClick={() => send(q)}>{q}</button>)}
            </div>
          )}
          {!user && <p className="chat__note">Want us to look at your orders or open a ticket? <Link to="/login" onClick={() => toggle(false)}>Log in</Link></p>}
          {error && <p className="chat__error" role="alert">{error}</p>}

          <form className="chat__form" onSubmit={(e) => { e.preventDefault(); send(input) }}>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={humanMode ? 'Message our team…' : 'Type your question…'}
                   aria-label="Message" maxLength={1000} autoComplete="off" />
            <button className="btn btn--primary btn--sm" disabled={sending || !input.trim()}>Send</button>
          </form>
        </section>
      )}
    </>
  )
}
