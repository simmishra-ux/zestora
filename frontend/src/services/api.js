// One tiny fetch wrapper used by every service: adds the JWT, sends/reads JSON, turns errors into Error objects.
const TOKEN_KEY = 'zestora.token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

function errorMessage(body, status) {
  const d = body?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d) && d.length) {
    // FastAPI validation errors: [{ loc: ['body','email'], msg: '...' }]
    const field = d[0].loc?.at(-1)
    return `${field ? `${field}: ` : ''}${d[0].msg}`
  }
  return `Request failed (${status})`
}

export async function api(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`/api${path}`, window.location.origin)
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === '' || v === false) continue
    ;(Array.isArray(v) ? v : [v]).forEach((x) => url.searchParams.append(k, x)) // arrays → repeated keys
  }
  const token = getToken()
  let res
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    })
  } catch {
    throw new Error('Cannot reach the server. Is the backend running on port 8000?')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(errorMessage(data, res.status)), { status: res.status })
  return data
}
