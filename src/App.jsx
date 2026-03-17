import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import Workers from './pages/Workers'
import Schedule from './pages/Schedule'
import Quotes from './pages/Quotes'
import Payments from './pages/Payments'
import Invoices from './pages/Invoices'

function App() {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // If still loading after 5 seconds, give up and show the login page
    const timeout = setTimeout(() => {
      if (loading) {
        setSession(null)
        setUser(null)
        setLoading(false)
      }
    }, 5000)

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error || !session) {
        supabase.auth.signOut()
        setSession(null)
        setUser(null)
        setLoading(false)
        return
      }
      setSession(session)
      loadUser(session.user.id)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'TOKEN_REFRESHED' && !session) {
          await supabase.auth.signOut()
          setSession(null)
          setUser(null)
          setLoading(false)
          return
        }
        
        setSession(session)
        if (session) await loadUser(session.user.id)
        else {
          setUser(null)
          setLoading(false)
        }
      }
    )

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  async function loadUser(authId) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*, organizations(*)')
        .eq('id', authId)
        .single()

      if (!error && data) {
        setUser(data)
        setLoading(false)
        return
      }

      // No user found by auth ID — check if this is a first-time OTP login
      // by looking up the phone number from the auth session
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const phone = authUser?.phone
      if (!phone) throw new Error('No phone on auth user')

      const { data: existing, error: phoneErr } = await supabase
        .from('users')
        .select('*, organizations(*)')
        .eq('phone', phone)
        .single()

      if (phoneErr || !existing) throw new Error('No matching user for phone')

      // Update the user row: set id to auth UUID and mark as linked
      const { error: updateErr } = await supabase
        .from('users')
        .update({ id: authId, auth_linked: true })
        .eq('phone', phone)

      if (updateErr) throw updateErr

      // Re-fetch the now-linked row
      const { data: linked, error: refetchErr } = await supabase
        .from('users')
        .select('*, organizations(*)')
        .eq('id', authId)
        .single()

      if (refetchErr || !linked) throw new Error('Failed to re-fetch linked user')
      setUser(linked)
    } catch (err) {
      console.error('Failed to load user:', err)
      await supabase.auth.signOut()
      setSession(null)
      setUser(null)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-stone-400 text-lg">Loading...</div>
      </div>
    )
  }

  if (!session) {
    return <Login />
  }

  if (session && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="text-stone-600 text-lg mb-2">Account not found</div>
          <p className="text-stone-400 text-sm">Your phone number is not linked to any organization.</p>
          <button 
            onClick={() => { const savedPhone = localStorage.getItem('allbookd_phone'); localStorage.clear(); if (savedPhone) localStorage.setItem('allbookd_phone', savedPhone); supabase.auth.signOut() }}
            className="mt-4 px-4 py-2 bg-stone-200 rounded-lg text-stone-600 hover:bg-stone-300"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout user={user} />}>
          <Route index element={<Dashboard user={user} />} />
          <Route path="clients" element={<Clients user={user} />} />
          <Route path="workers" element={<Workers user={user} />} />
          <Route path="schedule" element={<Schedule user={user} />} />
          <Route path="quotes" element={<Quotes user={user} />} />
          <Route path="payments" element={<Payments user={user} />} />
          <Route path="invoices" element={<Invoices user={user} />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
