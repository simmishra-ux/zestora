import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import Field from '@/components/Field'
import AuthShell from './AuthForm'
import { isEmail } from '@/utils/validators'

export default function Login() {
  const { user, login } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const from = useLocation().state?.from || '/'
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={from} replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!isEmail(form.email)) errs.email = 'Enter a valid email address.'
    if (!form.password) errs.password = 'Enter your password.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await login(form)
      toast('Welcome back!')
      navigate(from, { replace: true })
    } catch (err) {
      setErrors({ form: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to continue shopping." footer={<>New to Zestora? <Link to="/signup" state={{ from }}>Create an account</Link></>}>
      <form onSubmit={submit} noValidate>
        {errors.form && <div className="alert" role="alert">{errors.form}</div>}
        <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
        <Field label="Password" type="password" value={form.password} onChange={set('password')} error={errors.password} autoComplete="current-password" />
        <button className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </AuthShell>
  )
}
