import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanTranscript, mapVoiceError } from '@/utils/voice'

const engine = () => (typeof window === 'undefined' ? undefined : window.SpeechRecognition || window.webkitSpeechRecognition)

// Wraps the browser's speech recognition (Chrome, Edge, Safari). Where it doesn't exist (Firefox), `supported` is false.
//   status:     idle | starting | listening | error
//   transcript: what has been heard so far, updating while the person is still speaking
//   error:      denied | no-speech | no-mic | network | unknown   (see utils/voice.js)
export function useVoiceSearch({ onResult, lang = 'en-IN' }) {
  const [supported] = useState(() => Boolean(engine()))
  const [status, setStatus] = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState(null)
  const recognition = useRef(null)
  const settled = useRef(false) // true once this attempt produced a result or an error
  const latest = useRef(onResult) // always call the newest onResult without restarting the recognition
  useEffect(() => {
    latest.current = onResult
  })

  // Detach our handlers first so a late event from a finished recognition can never update the screen.
  const teardown = useCallback(() => {
    const r = recognition.current
    recognition.current = null
    if (!r) return
    r.onstart = r.onresult = r.onerror = r.onend = null
    try {
      r.abort()
    } catch {
      /* already stopped */
    }
  }, [])

  const cancel = useCallback(() => {
    teardown()
    setStatus('idle')
    setTranscript('')
    setError(null)
  }, [teardown])

  const fail = useCallback((kind) => {
    settled.current = true
    setError(kind)
    setStatus('error')
  }, [])

  const start = useCallback(() => {
    const Engine = engine()
    if (!Engine) return
    teardown()
    settled.current = false
    setTranscript('')
    setError(null)
    setStatus('starting')

    const rec = new Engine()
    rec.lang = lang
    rec.interimResults = true // show words as they are heard
    rec.continuous = false // stop by itself when the person stops talking
    rec.maxAlternatives = 1
    rec.onstart = () => setStatus('listening')
    rec.onresult = (event) => {
      const results = Array.from(event.results)
      setTranscript(results.map((r) => r[0].transcript).join(' '))
      if (!results[results.length - 1]?.isFinal) return
      const query = cleanTranscript(results.map((r) => r[0].transcript).join(' '))
      teardown()
      if (!query) return fail('no-speech')
      settled.current = true
      setStatus('idle')
      latest.current(query)
    }
    rec.onerror = (event) => {
      const kind = mapVoiceError(event.error)
      if (kind !== 'aborted') fail(kind)
    }
    rec.onend = () => {
      if (!settled.current) fail('no-speech') // it ended without hearing anything
    }
    recognition.current = rec
    try {
      rec.start()
    } catch {
      fail('unknown') // e.g. start() called twice
    }
  }, [lang, teardown, fail])

  useEffect(() => teardown, [teardown]) // leaving the page stops the microphone
  return { supported, status, transcript, error, start, cancel }
}
