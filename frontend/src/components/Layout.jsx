import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'
import MobileTabBar from './MobileTabBar'
import SupportChat from './SupportChat'
import { useAuth } from '@/context/AuthContext'

export default function Layout() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  // React Router keeps scroll position between routes; reset it on navigation.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <>
      <Navbar />
      <main className="main" key={pathname}>
        <Outlet />
      </main>
      <Footer />
      <MobileTabBar />
      {/* key: a fresh chat per account, so one customer's messages can never show up for another */}
      <SupportChat key={user?.id ?? 'guest'} />
    </>
  )
}
