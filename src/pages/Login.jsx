import { useState } from 'react'
import { supabase } from '../lib/supabase'

function friendlyError(msg) {
  if (!msg) return msg
  const lower = msg.toLowerCase()
  if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('over_email') || lower.includes('email rate')) {
    return 'Too many attempts — please wait a few minutes before trying again.'
  }
  if (lower.includes('for security purposes')) {
    return 'Please wait a moment before requesting another code.'
  }
  return msg
}

export default function Login() {
  const [mode, setMode] = useState('phone') // 'phone' or 'email'
  const [phone, setPhone] = useState(() => localStorage.getItem('allbookd_phone') || '')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState('input') // 'input', 'verify', 'email_sent'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function switchMode(newMode) {
    setMode(newMode)
    setStep('input')
    setOtp('')
    setError(null)
  }

  async function handleSendOtp(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    let formatted = phone.trim()
    if (!formatted.startsWith('+')) {
      formatted = formatted.replace(/\D/g, '')
      if (formatted.length === 10) formatted = '+1' + formatted
      else if (formatted.length === 11 && formatted.startsWith('1')) formatted = '+' + formatted
      else formatted = '+' + formatted
    }

    const { error } = await supabase.auth.signInWithOtp({ phone: formatted })

    if (error) {
      setError(friendlyError(error.message))
    } else {
      setPhone(formatted)
      localStorage.setItem('allbookd_phone', formatted)
      setStep('verify')
    }
    setLoading(false)
  }

  async function handleVerifyOtp(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: 'sms',
    })

    if (error) {
      setError(friendlyError(error.message))
      setLoading(false)
    }
    // If successful, onAuthStateChange in App.jsx handles the rest
  }

  async function handleSendMagicLink(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })

    if (error) {
      setError(friendlyError(error.message))
    } else {
      setStep('email_sent')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-700 rounded-2xl mb-4">
            <svg width="36" height="36" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="20" stroke="white" strokeWidth="2.2" fill="none"/>
              <line x1="32" y1="32" x2="25" y2="22" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="32" y1="32" x2="41" y2="24" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="32" cy="32" r="2" fill="white"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900">TimelyOps</h1>
          <p className="text-stone-500 text-sm mt-1">
            {mode === 'phone' ? 'Sign in with your phone number' : 'Sign in with your email'}
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">

          {/* Phone: enter number */}
          {mode === 'phone' && step === 'input' && (
            <form onSubmit={handleSendOtp}>
              <label className="block text-sm font-medium text-stone-600 mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(650) 290-0821"
                className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent text-lg"
                required
                autoFocus
              />
              <p className="text-xs text-stone-400 mt-2">
                We'll text you a 6-digit code to sign in.
              </p>

              {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !phone.trim()}
                className="w-full mt-4 py-3 bg-emerald-700 text-white font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Sending code...' : 'Send code'}
              </button>

              <p className="text-center mt-4 text-sm text-stone-400">
                SMS not working?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('email')}
                  className="text-emerald-700 hover:underline"
                >
                  Use email instead
                </button>
              </p>
            </form>
          )}

          {/* Phone: verify OTP */}
          {mode === 'phone' && step === 'verify' && (
            <form onSubmit={handleVerifyOtp}>
              <div className="text-center mb-4">
                <p className="text-sm text-stone-600">
                  Code sent to <span className="font-medium">{phone}</span>
                </p>
                <button
                  type="button"
                  onClick={() => { setStep('input'); setOtp(''); setError(null); }}
                  className="text-emerald-700 text-sm hover:underline mt-1"
                >
                  Change number
                </button>
              </div>

              <label className="block text-sm font-medium text-stone-600 mb-2">
                Verification Code
              </label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent text-center text-2xl tracking-widest"
                required
                autoFocus
                inputMode="numeric"
              />

              {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full mt-4 py-3 bg-emerald-700 text-white font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Verifying...' : 'Verify & sign in'}
              </button>

              <button
                type="button"
                onClick={handleSendOtp}
                disabled={loading}
                className="w-full mt-2 py-2 text-stone-500 text-sm hover:text-stone-700"
              >
                Resend code
              </button>

              <p className="text-center mt-3 text-sm text-stone-400">
                SMS not working?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('email')}
                  className="text-emerald-700 hover:underline"
                >
                  Use email instead
                </button>
              </p>
            </form>
          )}

          {/* Email: enter address */}
          {mode === 'email' && step === 'input' && (
            <form onSubmit={handleSendMagicLink}>
              <label className="block text-sm font-medium text-stone-600 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent text-lg"
                required
                autoFocus
              />
              <p className="text-xs text-stone-400 mt-2">
                We'll send you a magic link to sign in.
              </p>

              {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full mt-4 py-3 bg-emerald-700 text-white font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Sending link...' : 'Send magic link'}
              </button>

              <p className="text-center mt-4 text-sm text-stone-400">
                <button
                  type="button"
                  onClick={() => switchMode('phone')}
                  className="text-emerald-700 hover:underline"
                >
                  Use phone instead
                </button>
              </p>
            </form>
          )}

          {/* Email: sent confirmation */}
          {mode === 'email' && step === 'email_sent' && (
            <div className="text-center py-2">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-emerald-50 rounded-full mb-4">
                <svg className="w-6 h-6 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="font-medium text-stone-900 mb-1">Check your email</p>
              <p className="text-sm text-stone-500 mb-1">
                Magic link sent to
              </p>
              <p className="text-sm font-medium text-stone-700 mb-4">{email}</p>
              <p className="text-xs text-stone-400">
                Click the link in the email to sign in. You can close this tab.
              </p>
              <button
                type="button"
                onClick={() => { setStep('input'); setError(null); }}
                className="mt-4 text-sm text-emerald-700 hover:underline"
              >
                Send again
              </button>
            </div>
          )}
        </div>

        <p className="text-center mt-4 text-xs text-stone-400">
          Having trouble?{' '}
          <button
            type="button"
            onClick={() => { const savedPhone = localStorage.getItem('allbookd_phone'); localStorage.clear(); sessionStorage.clear(); if (savedPhone) localStorage.setItem('allbookd_phone', savedPhone); window.location.href = '/' }}
            className="text-stone-500 hover:text-stone-700 underline"
          >
            Clear &amp; Reload
          </button>
        </p>
      </div>
    </div>
  )
}
