import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVoiceSearch } from '@/hooks/useVoiceSearch'
import { MicIcon } from './Icons'

// What we tell people when something goes wrong, in plain words and with a way forward.
const PROBLEMS = {
  'no-speech': { title: "Didn't catch that", text: 'Speak clearly, a little closer to your microphone, then try again.' },
  denied: { title: 'Microphone is blocked', text: 'Allow microphone access for this site in your browser settings, then try again.' },
  'no-mic': { title: 'No microphone found', text: 'Connect a microphone and try again, or type your search instead.' },
  network: { title: 'Voice search is unavailable', text: "Your browser couldn't reach its speech service. Try Chrome, Edge or Safari, or type your search instead." },
  unknown: { title: 'Something went wrong', text: 'Please try again, or type your search instead.' },
}

// The mic button for the search bar, plus the "Listening..." panel. Renders nothing in browsers without speech
// recognition (e.g. Firefox), so people there simply never see a button that can't work.
export default function VoiceSearch({ onResult }) {
  const [open, setOpen] = useState(false)
  const { supported, status, transcript, error, start, cancel } = useVoiceSearch({
    onResult: (query) => {
      setOpen(false)
      onResult(query)
    },
  })
  const cancelRef = useRef(null)

  const close = () => {
    cancel()
    setOpen(false)
  }

  // While the panel is open: Escape closes it, and keyboard focus moves into it.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && (cancel(), setOpen(false))
    document.addEventListener('keydown', onKey)
    cancelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, cancel])

  if (!supported) return null
  const problem = status === 'error' ? PROBLEMS[error] ?? PROBLEMS.unknown : null

  return (
    <>
      <button type="button" className="mic-btn" aria-label="Search by voice" onClick={() => { setOpen(true); start() }}>
        <MicIcon width={20} height={20} />
      </button>

      {open && createPortal(
        // A portal: the navbar's blur effect would otherwise trap a fixed-position panel inside the navbar.
        <div className="voice" role="dialog" aria-modal="true" aria-label="Voice search">
          <div className="scrim" onClick={close} />
          <div className="voice__card">
            <div className={`voice__mic ${status === 'listening' ? 'is-listening' : ''} ${problem ? 'is-problem' : ''}`} aria-hidden>
              <MicIcon width={34} height={34} />
            </div>

            {problem ? (
              <>
                <h2>{problem.title}</h2>
                <p className="voice__help" role="alert">{problem.text}</p>
                <div className="btn-row voice__actions">
                  <button type="button" className="btn btn--primary" onClick={start}>Try again</button>
                  <button type="button" className="btn btn--ghost" ref={cancelRef} onClick={close}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <h2>{status === 'listening' ? 'Listening…' : 'Getting ready…'}</h2>
                <p className="voice__heard" aria-live="polite">
                  {transcript || <span className="voice__hint">Try saying “iPhone 13 Pro” or “women’s handbag”</span>}
                </p>
                <button type="button" className="btn btn--ghost voice__cancel" ref={cancelRef} onClick={close}>Cancel</button>
              </>
            )}
            <small className="voice__note">Your browser may send what you say to its speech service to understand it.</small>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
