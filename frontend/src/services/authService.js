// Real auth against the backend. The server hashes passwords (bcrypt) and issues a signed JWT;
// we keep only that token in localStorage and send it as `Authorization: Bearer <token>`.
import { api, getToken, setToken } from './api'

export async function signup({ name, email, password }) {
  const { token, user } = await api('/auth/signup', { method: 'POST', body: { name, email, password } })
  setToken(token)
  return user
}

export async function login({ email, password }) {
  const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } })
  setToken(token)
  return user
}

export const logout = () => setToken(null)

// Called once on app start: is the saved token still valid? Returns the user or null.
export async function restoreSession() {
  if (!getToken()) return null
  try {
    return await api('/auth/me')
  } catch (e) {
    if (e.status === 401) setToken(null) // expired/invalid token: forget it
    return null
  }
}

export const updateUser = (patch) => api('/auth/me', { method: 'PATCH', body: patch })
