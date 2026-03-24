import { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { SubscriptionProvider } from './contexts/SubscriptionContext'
import { ToastProvider } from './contexts/ToastContext'
import { AdminOrgProvider } from './contexts/AdminOrgContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import Workers from './pages/Workers'
import Schedule from './pages/Schedule'
import Quotes from './pages/Quotes'
import Payments from './pages/Payments'
import Invoices from './pages/Invoices'
import Reports from './pages/Reports'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminOrgs from './pages/admin/AdminOrgs'
import AdminUsers from './pages/admin/AdminUsers'
import AdminAudit from './pages/admin/AdminAudit'
import QuoteApproval from './pages/QuoteApproval'
import InvoiceView from './pages/InvoiceView'
import PaymentReceipt from './pages/PaymentReceipt'

// Sends unauthenticated visitors to the static landing page
function LandingRedirect() {
  useEffect(() => { window.location.replace('/landing.html') }, [])
  return null
}

// Redirects non-platform-admins away from /admin/*
function AdminGuard({ user, children }) {
  if (!user?.is_platform_admin) return <Navigate to="/" replace />
  return children
}

function AppRoutes({ user, session }) {
  return (
    <SubscriptionProvider user={user}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={session ? <Navigate to="/" replace /> : <Login />}
          />
          <Route
            path="/"
            element={session ? <Layout user={user} /> : <LandingRedirect />}
          >
            <Route index element={<Dashboard user={user} />} />
            <Route path="clients" element={<Clients user={user} />} />
            <Route path="workers" element={<Workers user={user} />} />
            <Route path="schedule" element={<Schedule user={user} />} />
            <Route path="quotes" element={<Quotes user={user} />} />
            <Route path="payments" element={<Payments user={user} />} />
            <Route path="invoices" element={<Invoices user={user} />} />
            <Route path="reports" element={<Reports user={user} />} />

            {/* Platform admin routes */}
            <Route path="admin" element={<AdminGuard user={user}><AdminDashboard /></AdminGuard>} />
            <Route path="admin/orgs" element={<AdminGuard user={user}><AdminOrgs user={user} /></AdminGuard>} />
            <Route path="admin/users" element={<AdminGuard user={user}><AdminUsers user={user} /></AdminGuard>} />
            <Route path="admin/audit" element={<AdminGuard user={user}><AdminAudit /></AdminGuard>} />
          </Route>

          {/* Public token-based pages — no auth required */}
          <Route path="/approve/:token" element={<QuoteApproval />} />
          <Route path="/invoice/:token" element={<InvoiceView />} />
          <Route path="/receipt/:token" element={<PaymentReceipt />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SubscriptionProvider>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const loadingRef = useRef(true)
  const loadingUserRef = useRef(null)

  function resolveLoading() {
    loadingRef.current = false
    setLoading(false)
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (loadingRef.current) {
        loadingRef.current = false
        setLoading(false)
        setLoadError(true)
      }
    }, 3000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session)
        loadUser(session.user.id)
      } else {
        resolveLoading()
      }
    }).catch(() => resolveLoading())

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'INITIAL_SESSION') return
        if (event === 'TOKEN_REFRESHED') {
          if (session) setSession(session)
          return
        }
        setSession(session)
        if (session) {
          loadUser(session.user.id)
        } else {
          loadingUserRef.current = null
          setUser(null)
          resolveLoading()
        }
      }
    )

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  async function loadUser(authId) {
    if (loadingUserRef.current === authId) return
    loadingUserRef.current = authId

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*, organizations(*)')
        .eq('id', authId)
        .single()

      if (!error && data) {
        setUser(data)
        resolveLoading()
        return
      }

      // First-time OTP login — link auth UUID to existing users row via phone or email
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const phone = authUser?.phone
      const email = authUser?.email

      let existing = null

      if (phone) {
        const { data: byPhone } = await supabase
          .from('users')
          .select('*, organizations(*)')
          .eq('phone', phone)
          .maybeSingle()
        existing = byPhone
      }

      if (!existing && email) {
        const { data: byEmail } = await supabase
          .from('users')
          .select('*, organizations(*)')
          .eq('email', email)
          .maybeSingle()
        existing = byEmail
      }

      if (!existing) throw new Error('No matching user for phone or email')

      const { error: updateErr } = await supabase
        .from('users')
        .update({ id: authId, auth_linked: true })
        .eq('id', existing.id)
      if (updateErr) throw updateErr

      const { data: linked, error: refetchErr } = await supabase
        .from('users')
        .select('*, organizations(*)')
        .eq('id', authId)
        .single()
      if (refetchErr || !linked) throw new Error('Failed to re-fetch linked user')

      setUser(linked)
    } catch (err) {
      console.error('Failed to load user profile:', err)
      loadingUserRef.current = null
    }

    resolveLoading()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-stone-400 text-lg">Loading...</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="text-stone-600 text-lg mb-2">Couldn't connect</div>
          <p className="text-stone-400 text-sm mb-4">Check your connection and try again.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (session && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="text-stone-600 text-lg mb-2">Account not found</div>
          <p className="text-stone-400 text-sm">Your phone number is not linked to any organization.</p>
          <button
            onClick={() => {
              const savedPhone = localStorage.getItem('allbookd_phone')
              localStorage.clear()
              if (savedPhone) localStorage.setItem('allbookd_phone', savedPhone)
              supabase.auth.signOut()
            }}
            className="mt-4 px-4 py-2 bg-stone-200 rounded-lg text-stone-600 hover:bg-stone-300"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  // Account status enforcement — platform admins bypass all checks
  if (session && user && !user.is_platform_admin) {
    const status = user?.organizations?.subscription_status

    if (status === 'paused') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
          <div className="text-center max-w-sm">
            <div className="text-stone-700 text-lg font-semibold mb-2">Account paused</div>
            <p className="text-stone-400 text-sm">
              Your account is paused. Please contact{' '}
              <a href="mailto:info@timelyops.com" className="text-emerald-700 underline">info@timelyops.com</a>
              {' '}to reactivate.
            </p>
          </div>
        </div>
      )
    }

    if (status === 'cancelled') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
          <div className="text-center max-w-sm">
            <div className="text-stone-700 text-lg font-semibold mb-2">Account cancelled</div>
            <p className="text-stone-400 text-sm">
              Your account has been cancelled. Please contact{' '}
              <a href="mailto:info@timelyops.com" className="text-emerald-700 underline">info@timelyops.com</a>
              {' '}if you'd like to reactivate.
            </p>
          </div>
        </div>
      )
    }
  }

  return (
    <ToastProvider>
      <AdminOrgProvider>
        <AppRoutes user={user} session={session} />
      </AdminOrgProvider>
    </ToastProvider>
  )
}

export default App
