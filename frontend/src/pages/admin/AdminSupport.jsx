import { useEffect, useState } from 'react'
import { supportAction, supportReply, supportThread, supportThreads } from '@/services/adminService'
import { useAsync } from '@/hooks/useAsync'
import { useToast } from '@/context/ToastContext'

const FILTERS = [
  { key: 'needs_reply', label: 'Needs reply' }, { key: 'answered', label: 'Answered' },
  { key: 'bot', label: 'With bot' }, { key: 'resolved', label: 'Resolved' }, { key: 'all', label: 'All' },
]
const STATUS = { bot: 'With bot', waiting_agent: 'Needs reply', answered: 'Answered', resolved: 'Resolved' }
const WHO = { user: 'Customer', bot: 'Bot', agent: 'You' }
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Detail({ id, onChanged }) {
  const { toast } = useToast()
  const [version, setVersion] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: t, loading } = useAsync(() => supportThread(id), [id, version])

  const run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      toast(ok)
      setVersion((v) => v + 1)
      onChanged()
      return true
    } catch (e) {
      toast(e.message, 'error')
      return false
    } finally {
      setBusy(false)
    }
  }
  const reply = async (e) => {
    e.preventDefault()
    if (text.trim() && (await run(() => supportReply(id, text), 'Reply sent'))) setText('')
  }

  if (!t) return <div className="skeleton" style={{ height: 240 }} />
  return (
    <div className="ticket__detail" aria-busy={loading}>
      <header>
        <div>
          <h3>{t.customerName} <span className="muted">· {t.customerEmail}</span></h3>
          <p className="muted">Ticket {t.id} · {STATUS[t.status]}{t.category ? ` · ${t.category}` : ''}{t.orderId ? ` · order ${t.orderId}` : ''}</p>
        </div>
        {t.status === 'resolved'
          ? <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => supportAction(id, 'reopen'), 'Ticket reopened')}>Reopen</button>
          : <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => supportAction(id, 'resolve'), 'Ticket resolved')}>Mark resolved</button>}
      </header>
      <ol className="ticket__log" aria-label="Conversation">
        {t.messages.map((m) => (
          <li key={m.id} className={`tmsg tmsg--${m.sender}`}><span>{WHO[m.sender]} · {when(m.createdAt)}</span><p>{m.text}</p></li>
        ))}
      </ol>
      <form className="ticket__reply" onSubmit={reply}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="Write a reply to the customer…" aria-label="Reply to customer" />
        <button className="btn btn--primary btn--sm" disabled={busy || !text.trim()}>Send reply</button>
      </form>
    </div>
  )
}

export default function AdminSupport() {
  const [filter, setFilter] = useState('needs_reply')
  const [selected, setSelected] = useState(null)
  const [version, setVersion] = useState(0)
  const { data: threads, loading, error } = useAsync(() => supportThreads(filter), [filter, version])

  useEffect(() => { // new tickets appear on their own
    const id = setInterval(() => setVersion((v) => v + 1), 10000)
    return () => clearInterval(id)
  }, [])

  return (
    <>
      <div className="chips admin-filters" role="tablist" aria-label="Filter tickets">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} className={`chip ${filter === f.key ? 'chip--on' : ''}`} onClick={() => { setFilter(f.key); setSelected(null) }}>{f.label}</button>
        ))}
      </div>
      {error && <p className="alert">{error.message}</p>}
      <div className="tickets">
        <ul className="tickets__list" aria-label="Tickets">
          {loading && !threads && <li><div className="skeleton" style={{ height: 64 }} /></li>}
          {threads?.length === 0 && <li className="muted tickets__empty">No tickets here.</li>}
          {threads?.map((t) => (
            <li key={t.id}>
              <button className={`ticket ${selected === t.id ? 'ticket--on' : ''}`} onClick={() => setSelected(t.id)}>
                <span className="ticket__top"><b>{t.customerName}</b><span className={`tstatus tstatus--${t.status}`}>{STATUS[t.status]}</span></span>
                <span className="ticket__preview">{t.lastSender === 'user' ? '' : `${WHO[t.lastSender]}: `}{t.lastMessage}</span>
                <small className="muted">{t.id}{t.category ? ` · ${t.category}` : ''} · {when(t.updatedAt)}</small>
              </button>
            </li>
          ))}
        </ul>
        <div>{selected ? <Detail key={selected} id={selected} onChanged={() => setVersion((v) => v + 1)} /> : <p className="muted tickets__empty">Select a ticket to read the conversation and reply.</p>}</div>
      </div>
    </>
  )
}
