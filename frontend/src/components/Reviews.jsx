import { useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteReview, getReviews, saveReview } from '@/services/reviewService'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { formatDate } from '@/utils/format'

const Stars = ({ value }) => <span className="stars" aria-label={`${value} out of 5`}>{'★'.repeat(value)}{'☆'.repeat(5 - value)}</span>

function ReviewForm({ initial, onSubmit, onDelete }) {
  const [rating, setRating] = useState(initial?.rating ?? 0)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!rating) return setError('Please choose a star rating.')
    setError('')
    setBusy(true)
    try {
      await onSubmit({ rating, title, body })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="review-form" onSubmit={submit}>
      <h4>{initial ? 'Your review' : 'Write a review'}</h4>
      <div className="star-picker" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>★</button>
        ))}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Headline (optional)" maxLength={100} aria-label="Review headline" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did you like or dislike?" rows={3} maxLength={2000} aria-label="Review text" />
      {error && <p className="warn">{error}</p>}
      <div className="btn-row">
        <button className="btn btn--primary btn--sm" disabled={busy}>{busy ? 'Saving…' : initial ? 'Update review' : 'Submit review'}</button>
        {initial && <button type="button" className="btn btn--ghost btn--sm danger" onClick={onDelete} disabled={busy}>Delete my review</button>}
      </div>
    </form>
  )
}

// `onChanged` lets the page refetch the product, because the average rating changes when a review is saved.
export default function Reviews({ product, onChanged }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [version, setVersion] = useState(0)
  const { data, loading } = useAsync(() => getReviews(product.id), [product.id, user?.id, version])

  const refresh = () => {
    setVersion((v) => v + 1)
    onChanged?.()
  }
  const save = async (review) => {
    await saveReview(product.id, review)
    toast('Thanks for your review!')
    refresh()
  }
  const remove = async () => {
    if (!window.confirm('Delete your review?')) return
    try {
      await deleteReview(product.id)
      toast('Review deleted')
      refresh()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <section id="reviews">
      <h2>Ratings & reviews</h2>
      <div className="reviews__summary">
        <b>{product.reviews ? product.rating.toFixed(1) : '–'}</b>
        <span>{product.reviews ? `out of 5 · ${product.reviews.toLocaleString('en-IN')} ratings` : 'No ratings yet'}</span>
      </div>

      {user ? (
        data?.canReview
          ? <ReviewForm key={data.mine?.id ?? 'new'} initial={data.mine} onSubmit={save} onDelete={remove} />
          : !loading && <p className="muted review-note">Only customers who bought this product can review it.</p>
      ) : (
        <p className="muted review-note"><Link to="/login" state={{ from: `/products/${product.id}` }} className="link-btn">Log in</Link> to review products you’ve bought.</p>
      )}

      {loading && !data && <div className="skeleton" style={{ height: 90 }} />}
      {data?.reviews.length === 0 && !loading && <p className="muted">No written reviews yet.{data.canReview ? ' Be the first!' : ''}</p>}
      {data?.reviews.map((r) => (
        <blockquote key={r.id} className="review">
          <div><Stars value={r.rating} /> {r.title && <b className="review__title">{r.title}</b>}</div>
          {r.body && <p>{r.body}</p>}
          <cite>— {r.author} · {formatDate(r.createdAt)} · <span className="verified">✓ Verified buyer</span></cite>
        </blockquote>
      ))}
    </section>
  )
}
