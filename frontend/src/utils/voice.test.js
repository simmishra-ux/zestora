// Run with:  npm test   (Node's built-in test runner, no extra packages)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanTranscript, mapVoiceError } from './voice.js'

test('cleanTranscript removes trailing punctuation and extra spaces', () => {
  assert.equal(cleanTranscript('Running shoes.'), 'Running shoes')
  assert.equal(cleanTranscript('  iPhone   13  Pro  '), 'iPhone 13 Pro')
  assert.equal(cleanTranscript('women’s handbag!?'), 'women’s handbag')
  assert.equal(cleanTranscript('“coffee”'), 'coffee')
})

test('cleanTranscript keeps apostrophes inside words and numbers', () => {
  assert.equal(cleanTranscript("Levi's jeans."), "Levi's jeans")
  assert.equal(cleanTranscript('55 inch tv'), '55 inch tv')
})

test('cleanTranscript copes with empty and odd input', () => {
  assert.equal(cleanTranscript(''), '')
  assert.equal(cleanTranscript('   '), '')
  assert.equal(cleanTranscript('...'), '')
  assert.equal(cleanTranscript(null), '')
  assert.equal(cleanTranscript(undefined), '')
})

test('cleanTranscript caps the length of a runaway recording', () => {
  assert.equal(cleanTranscript('a'.repeat(500)).length, 100)
})

test('mapVoiceError groups browser error codes into situations we can explain', () => {
  assert.equal(mapVoiceError('not-allowed'), 'denied')
  assert.equal(mapVoiceError('service-not-allowed'), 'denied')
  assert.equal(mapVoiceError('no-speech'), 'no-speech')
  assert.equal(mapVoiceError('audio-capture'), 'no-mic')
  assert.equal(mapVoiceError('network'), 'network')
  assert.equal(mapVoiceError('aborted'), 'aborted')
  assert.equal(mapVoiceError('something-new'), 'unknown')
  assert.equal(mapVoiceError(undefined), 'unknown')
})
