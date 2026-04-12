import { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from './lib/supabase'
import i18n from './lib/i18n'
import { SubscriptionProvider } from './contexts/SubscriptionContext'
import { ToastProvider } from './contexts/ToastContext'
import { AdminOrgProvider } from './contexts/AdminOrgContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
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
import AdminOrgDetail from './pages/admin/AdminOrgDetail'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUserDetail from './pages/admin/AdminUserDetail'
import AdminAudit from './pages/admin/AdminAudit'
import AdminProfiles from './pages/admin/AdminProfiles'
import Settings from './pages/Settings'
import QuoteApproval from './pages/QuoteApproval'
import InvoiceView from './pages/InvoiceView'
import PaymentReceipt from './pages/PaymentReceipt'
import BookingPage from './pages/BookingPage'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'

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
            <Route index element={<ErrorBoundary><Dashboard user={user} /></ErrorBoundary>} />
            <Route path="clients" element={<ErrorBoundary><Clients user={user} /></ErrorBoundary>} />
            <Route path="workers" element={<ErrorBoundary><Workers user={user} /></ErrorBoundary>} />
            <Route path="schedule" element={<ErrorBoundary><Schedule user={user} /></ErrorBoundary>} />
            <Route path="quotes" element={<ErrorBoundary><Quotes user={user} /></ErrorBoundary>} />
            <Route path="payments" element={<ErrorBoundary><Payments user={user} /></ErrorBoundary>} />
            <Route path="invoices" element={<ErrorBoundary><Invoices user={user} /></ErrorBoundary>} />
            <Route path="reports" element={<ErrorBoundary><Reports user={user} /></ErrorBoundary>} />
            <Route path="settings" element={<ErrorBoundary><Settings user={user} /></ErrorBoundary>} />

            {/* Platform admin routes */}
            <Route path="admin" element={<AdminGuard user={user}><ErrorBoundary><AdminDashboard /></ErrorBoundary></AdminGuard>} />
            <Route path="admin/orgs" element={<AdminGuard user={user}><ErrorBoundary><AdminOrgs user={user} /></ErrorBoundary></AdminGuard>} />
            <Route path="admin/orgs/:id" element={<AdminGuard user={user}><ErrorBoundary><AdminOrgDetail user={user} /></ErrorBoundary></AdminGuard>} />
            <Route path="admin/users" element={<AdminGuard user={user}><ErrorBoundary><AdminUsers user={user} /></ErrorBoundary></AdminGuard>} />
            <Route path="admin/users/:id" element={<AdminGuard user={user}><ErrorBoundary><AdminUserDetail user={user} /></ErrorBoundary></AdminGuard>} />
            <Route path="admin/audit" element={<AdminGuard user={user}><ErrorBoundary><AdminAudit /></ErrorBoundary></AdminGuard>} />
            <Route path="admin/profiles" element={<AdminGuard user={user}><ErrorBoundary><AdminProfiles /></ErrorBoundary></AdminGuard>} />
          </Route>

          {/* Public token-based pages — no auth required */}
          <Route path="/approve/:token" element={<QuoteApproval />} />
          <Route path="/invoice/:token" element={<InvoiceView />} />
          <Route path="/receipt/:token" element={<PaymentReceipt />} />
          <Route path="/book/:slug" element={<BookingPage />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SubscriptionProvider>
  )
}

function App() {
  const { t } = useTranslation()
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const loadingRef = useRef(true)
  const loadingUserRef = useRef(null)
  const sessionLoadedRef = useRef(false)

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
        sessionLoadedRef.current = true
        loadUser(session.user.id, session)
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
          sessionLoadedRef.current = true
          loadUser(session.user.id, session)
        } else {
          // Check if this is an intentional sign-out or an expired session
          const intentional = sessionStorage.getItem('intentional_signout')
          sessionStorage.removeItem('intentional_signout')
          if (sessionLoadedRef.current && !intentional) {
            // Session expired mid-use — redirect to login with message
            sessionLoadedRef.current = false
            loadingUserRef.current = null
            window.location.replace('/login?expired=1')
            return
          }
          sessionLoadedRef.current = false
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

  async function loadUser(authId, session) {
    if (loadingUserRef.current === authId) return
    loadingUserRef.current = authId

    const token = session?.access_token
    const phone = session?.user?.phone

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*, organizations(*)')
        .eq('id', authId)
        .single()

      if (!error && data) {
        if (!data.auth_linked && phone) {
          // Row found by auth id but auth_linked flag not set — call Edge Function to finalize
          await fetch('https://vrssqhzzdhlqnptengju.supabase.co/functions/v1/link-auth-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ phone }),
          })
          const { data: refreshed } = await supabase
            .from('users')
            .select('*, organizations(*)')
            .eq('id', authId)
            .single()
          if (refreshed) {
            i18n.changeLanguage(refreshed.organizations?.settings?.language || 'en')
            setUser(refreshed)
            resolveLoading()
            return
          }
        }
        i18n.changeLanguage(data.organizations?.settings?.language || 'en')
        setUser(data)
        resolveLoading()
        return
      }

      // User row not found by auth id — first-time phone OTP login
      if (!phone) throw new Error('No phone on auth user, cannot link')

      const linkRes = await fetch('https://vrssqhzzdhlqnptengju.supabase.co/functions/v1/link-auth-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ phone }),
      })
      if (!linkRes.ok) throw new Error('Failed to link auth: ' + (await linkRes.text()))

      const { data: linked, error: refetchErr } = await supabase
        .from('users')
        .select('*, organizations(*)')
        .eq('id', authId)
        .single()
      if (refetchErr || !linked) throw new Error('Failed to re-fetch linked user')

      i18n.changeLanguage(linked.organizations?.settings?.language || 'en')
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
        <div className="text-stone-400 text-lg">{t('app.loading')}</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="text-stone-600 text-lg mb-2">{t('app.error_title')}</div>
          <p className="text-stone-400 text-sm mb-4">{t('app.error_desc')}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 text-sm font-medium"
          >
            {t('app.btn_retry')}
          </button>
        </div>
      </div>
    )
  }

  if (session && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="text-stone-600 text-lg mb-2">{t('app.account_not_found')}</div>
          <p className="text-stone-400 text-sm">{t('app.account_not_found_desc')}</p>
          <button
            onClick={() => {
              const savedPhone = localStorage.getItem('allbookd_phone')
              localStorage.clear()
              if (savedPhone) localStorage.setItem('allbookd_phone', savedPhone)
              supabase.auth.signOut()
            }}
            className="mt-4 px-4 py-2 bg-stone-200 rounded-lg text-stone-600 hover:bg-stone-300"
          >
            {t('app.btn_sign_out')}
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
            <div className="text-stone-700 text-lg font-semibold mb-2">{t('app.account_paused')}</div>
            <p className="text-stone-400 text-sm">
              {t('app.account_paused_contact_prefix')}{' '}
              <a href="mailto:info@timelyops.com" className="text-emerald-700 underline">info@timelyops.com</a>
              {' '}{t('app.account_paused_contact_suffix')}
            </p>
          </div>
        </div>
      )
    }

    if (status === 'cancelled') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
          <div className="text-center max-w-sm">
            <div className="text-stone-700 text-lg font-semibold mb-2">{t('app.account_cancelled')}</div>
            <p className="text-stone-400 text-sm">
              {t('app.account_cancelled_contact_prefix')}{' '}
              <a href="mailto:info@timelyops.com" className="text-emerald-700 underline">info@timelyops.com</a>
              {' '}{t('app.account_cancelled_contact_suffix')}
            </p>
          </div>
        </div>
      )
    }
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AdminOrgProvider>
          <AppRoutes user={user} session={session} />
        </AdminOrgProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App
