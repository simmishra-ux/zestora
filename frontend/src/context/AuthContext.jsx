import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as auth from '@/services/authService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // `ready` is false until we've asked the server "is my saved token still valid?".
  // Without it, a refresh on /orders would bounce a logged-in user to /login for a split second.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    auth.restoreSession().then((u) => {
      if (cancelled) return
      setUser(u)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (creds) => setUser(await auth.login(creds)), [])
  const signup = useCallback(async (data) => setUser(await auth.signup(data)), [])
  const logout = useCallback(() => {
    auth.logout()
    setUser(null)
  }, [])
  // Address endpoints return the full list; we just drop it into the user object.
  const setAddresses = useCallback((addresses) => setUser((u) => ({ ...u, addresses })), [])
  const updateProfile = useCallback(async (patch) => setUser(await auth.updateUser(patch)), [])

  const value = useMemo(() => ({ user, ready, login, signup, logout, updateProfile, setAddresses }), [user, ready, login, signup, logout, updateProfile, setAddresses])
  return <AuthContext.Provider value={value}>{ready ? children : <div className="page-loader"><span className="spinner" /></div>}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
