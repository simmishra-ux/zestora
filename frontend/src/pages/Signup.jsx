import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import Field from '@/components/Field'
import AuthShell from './AuthForm'
import { isEmail, passwordIssues } from '@/utils/validators'

export default function Signup() {
  const { user, signup } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const from = useLocation().state?.from || '/'
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={from} replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (form.name.trim().length < 2) errs.name = 'Please enter your name.'
    if (!isEmail(form.email)) errs.email = 'Enter a valid email address.'
    const issues = passwordIssues(form.password)
    if (issues.length) errs.password = `Password needs ${issues.join(' and ')}.`
    if (form.confirm !== form.password) errs.confirm = 'Passwords do not match.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await signup({ name: form.name.trim(), email: form.email.trim(), password: form.password })
      toast('Account created. Welcome to Zestora!')
      navigate(from, { replace: true })
    } catch (err) {
      setErrors({ form: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Create your account" subtitle="Join Zestora in under a minute." footer={<>Already have an account? <Link to="/login" state={{ from }}>Log in</Link></>}>
      <form onSubmit={submit} noValidate>
        {errors.form && <div className="alert" role="alert">{errors.form}</div>}
        <Field label="Full name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="name" />
        <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
        <Field label="Password" type="password" value={form.password} onChange={set('password')} error={errors.password} hint="8+ characters with a letter and a number" autoComplete="new-password" />
        <Field label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" />
        <button className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
    </AuthShell>
  )
}
