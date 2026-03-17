import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [phone, setPhone] = useState(() => localStorage.getItem('allbookd_phone') || '')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState('phone') // 'phone' or 'verify'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSendOtp(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Format phone: ensure it starts with +1
    let formatted = phone.trim()
    if (!formatted.startsWith('+')) {
      formatted = formatted.replace(/\D/g, '')
      if (formatted.length === 10) formatted = '+1' + formatted
      else if (formatted.length === 11 && formatted.startsWith('1')) formatted = '+' + formatted
      else formatted = '+' + formatted
    }

    const { error } = await supabase.auth.signInWithOtp({ phone: formatted })
    
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setPhone(formatted)
      localStorage.setItem('allbookd_phone', formatted)
      setStep('verify')
      setLoading(false)
    }
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
      setError(error.message)
      setLoading(false)
    }
    // If successful, the onAuthStateChange in App.jsx handles the rest
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-700 rounded-2xl mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <path d="M9 16l2 2 4-4"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900">AllBookd</h1>
          <p className="text-stone-500 text-sm mt-1">Sign in with your phone number</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
          {step === 'phone' ? (
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
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <div className="text-center mb-4">
                <p className="text-sm text-stone-600">
                  Code sent to <span className="font-medium">{phone}</span>
                </p>
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setOtp(''); setError(null); }}
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
            </form>
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
