// Pure helpers for voice search (no browser APIs, so they are easy to unit-test).

// Speech engines add punctuation and spacing a search box doesn't want: "Running shoes." -> "Running shoes".
export function cleanTranscript(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,!?;:।]+$/g, '') // quotes at the edges and trailing punctuation; apostrophes inside words stay
    .trim()
    .slice(0, 100)
}

// The browser reports failures as short codes. Map them to the handful of situations we explain to people.
export function mapVoiceError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied' // the microphone is blocked
    case 'no-speech':
      return 'no-speech'
    case 'audio-capture':
      return 'no-mic'
    case 'network':
      return 'network' // the browser's speech service can't be reached (also what Brave reports: it blocks that service)
    case 'aborted':
      return 'aborted' // the person cancelled: not an error
    default:
      return 'unknown'
  }
}
