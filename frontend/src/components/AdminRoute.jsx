import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

// Like ProtectedRoute, but also requires user.isAdmin. Again: UX only. The API enforces admin on every call (403).
export default function AdminRoute() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!user.isAdmin) return <Navigate to="/" replace />
  return <Outlet />
}
