import { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { SubscriptionProvider } from './contexts/SubscriptionContext'
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

// Sends unauthenticated visitors to the static landing page
function LandingRedirect() {
  useEffect(() => { window.location.replace('/landing.html') }, [])
  return null
}

function App() {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // useRef so timeout and loadUser can check/set the real current value
  // without stale closure bugs — this is what broke auth after 5 seconds
  const loadingRef = useRef(true)
  // Tracks which userId is currently being fetched to prevent duplicate calls
  const loadingUserRef = useRef(null)

  function resolveLoading() {
    loadingRef.current = false
    setLoading(false)
  }

  useEffect(() => {
    // After 3 seconds with no resolution, show error + retry instead of
    // spinning forever. Uses loadingRef (not the stale `loading` closure value)
    // so it's a true no-op once auth resolves successfully.
    const timeout = setTimeout(() => {
      if (loadingRef.current) {
        loadingRef.current = false
        setLoading(false)
        setLoadError(true)
      }
    }, 3000)

    // getSession() handles the initial auth check on page load / refresh.
    // onAuthStateChange handles subsequent events (sign-in, sign-out).
    // We use both but skip INITIAL_SESSION in onAuthStateChange to avoid
    // calling loadUser() twice concurrently on mount.
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
        // INITIAL_SESSION fires immediately on mount — already handled by
        // getSession() above, skip it to avoid a duplicate loadUser call.
        if (event === 'INITIAL_SESSION') return

        // TOKEN_REFRESHED is a background operation. The session token is
        // updated but the user profile hasn't changed — just update the
        // session reference and return. Calling loadUser here caused
        // spurious re-fetches and, if they failed, unnecessary sign-outs.
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
    // Skip if we're already loading (or have already loaded) this user.
    // Prevents race conditions when getSession() and onAuthStateChange both
    // fire on mount.
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

      // No user found by auth ID — first-time OTP login.
      // Link the auth UUID to the existing user row via phone number.
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const phone = authUser?.phone
      if (!phone) throw new Error('No phone on auth user')

      const { data: existing, error: phoneErr } = await supabase
        .from('users')
        .select('*, organizations(*)')
        .eq('phone', phone)
        .single()

      if (phoneErr || !existing) throw new Error('No matching user for phone')

      const { error: updateErr } = await supabase
        .from('users')
        .update({ id: authId, auth_linked: true })
        .eq('phone', phone)
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
      // Do NOT sign the user out here. A transient DB error shouldn't end
      // the session. The session stays valid; the "session && !user" guard
      // below shows the "account not found" state if user is still null.
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

  return (
    <SubscriptionProvider user={user}>
    <BrowserRouter>
      <Routes>
        {/* /login: redirect to dashboard if already authenticated */}
        <Route
          path="/login"
          element={session ? <Navigate to="/" replace /> : <Login />}
        />

        {/* All app routes are always registered so React Router can match them.
            The parent element guards auth: authenticated users get Layout,
            unauthenticated users get LandingRedirect (which does window.location.replace).
            Child routes are statically declared — never conditional — so /clients,
            /workers, etc. always exist in the route tree and never fall through to *. */}
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </SubscriptionProvider>
  )
}

export default App
