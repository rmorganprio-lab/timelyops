import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import LanguageSwitcher from '../components/LanguageSwitcher'

const sessionExpired = new URLSearchParams(window.location.search).get('expired') === '1'

export default function Login() {
  const { t } = useTranslation()

  function friendlyError(msg) {
    if (!msg) return msg
    const lower = msg.toLowerCase()
    if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('over_email') || lower.includes('email rate')) {
      return t('login.error_rate_limit')
    }
    if (lower.includes('for security purposes')) {
      return t('login.error_wait_moment')
    }
    return msg
  }
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

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: 'https://timelyops.com/login' },
    })

    if (error) {
      setError(friendlyError(error.message))
    } else {
      setStep('email_sent')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="fixed top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm">
        {/* Session expired banner */}
        {sessionExpired && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 text-center">
            {t('login.session_expired')}
          </div>
        )}

        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-3" style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, color: '#1c1917' }}>
            <span>Timely</span>
            <svg style={{ width: '28px', height: '28px', color: '#047857', margin: '0 0.5px', position: 'relative', top: '-0.5px' }} viewBox="0 0 64 64" fill="none" stroke="currentColor">
              <circle cx="32" cy="32" r="28" strokeWidth="5.5" fill="none"/>
              <line x1="32" y1="32" x2="24" y2="17" strokeWidth="5.5" strokeLinecap="round"/>
              <line x1="32" y1="32" x2="44" y2="23" strokeWidth="4" strokeLinecap="round"/>
              <circle cx="32" cy="32" r="3" fill="currentColor" stroke="none"/>
            </svg>
            <span style={{ fontWeight: 500, color: '#047857' }}>ps</span>
          </div>
          <p className="text-stone-500 text-sm mt-1">
            {mode === 'phone' ? t('login.subtitle_phone') : t('login.subtitle_email')}
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">

          {/* Phone: enter number */}
          {mode === 'phone' && step === 'input' && (
            <form onSubmit={handleSendOtp}>
              <label className="block text-sm font-medium text-stone-600 mb-2">
                {t('login.phone_label')}
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
                {t('login.phone_hint')}
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
                {loading ? t('login.sending_code') : t('login.send_code')}
              </button>

              <p className="text-center mt-4 text-sm text-stone-400">
                {t('login.sms_not_working')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('email')}
                  className="text-emerald-700 hover:underline"
                >
                  {t('login.use_email')}
                </button>
              </p>
            </form>
          )}

          {/* Phone: verify OTP */}
          {mode === 'phone' && step === 'verify' && (
            <form onSubmit={handleVerifyOtp}>
              <div className="text-center mb-4">
                <p className="text-sm text-stone-600">
                  {t('login.code_sent_to')} <span className="font-medium">{phone}</span>
                </p>
                <button
                  type="button"
                  onClick={() => { setStep('input'); setOtp(''); setError(null); }}
                  className="text-emerald-700 text-sm hover:underline mt-1"
                >
                  {t('login.change_number')}
                </button>
              </div>

              <label className="block text-sm font-medium text-stone-600 mb-2">
                {t('login.verification_code_label')}
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
                {loading ? t('login.verifying') : t('login.verify_sign_in')}
              </button>

              <button
                type="button"
                onClick={handleSendOtp}
                disabled={loading}
                className="w-full mt-2 py-2 text-stone-500 text-sm hover:text-stone-700"
              >
                {t('login.resend_code')}
              </button>

              <p className="text-center mt-3 text-sm text-stone-400">
                {t('login.sms_not_working')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('email')}
                  className="text-emerald-700 hover:underline"
                >
                  {t('login.use_email')}
                </button>
              </p>
            </form>
          )}

          {/* Email: enter address */}
          {mode === 'email' && step === 'input' && (
            <form onSubmit={handleSendMagicLink}>
              <label className="block text-sm font-medium text-stone-600 mb-2">
                {t('login.email_label')}
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
                {t('login.email_hint')}
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
                {loading ? t('login.sending_link') : t('login.send_magic_link')}
              </button>

              <p className="text-center mt-4 text-sm text-stone-400">
                <button
                  type="button"
                  onClick={() => switchMode('phone')}
                  className="text-emerald-700 hover:underline"
                >
                  {t('login.use_phone')}
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
              <p className="font-medium text-stone-900 mb-1">{t('login.check_your_email')}</p>
              <p className="text-sm text-stone-500 mb-1">
                {t('login.magic_link_sent_to')}
              </p>
              <p className="text-sm font-medium text-stone-700 mb-4">{email}</p>
              <p className="text-xs text-stone-400">
                {t('login.email_sent_detail')}
              </p>
              <button
                type="button"
                onClick={() => { setStep('input'); setError(null); }}
                className="mt-4 text-sm text-emerald-700 hover:underline"
              >
                {t('login.send_again')}
              </button>
            </div>
          )}
        </div>

        <p className="text-center mt-4 text-xs text-stone-400">
          {t('login.having_trouble')}{' '}
          <button
            type="button"
            onClick={() => { const savedPhone = localStorage.getItem('allbookd_phone'); localStorage.clear(); sessionStorage.clear(); if (savedPhone) localStorage.setItem('allbookd_phone', savedPhone); window.location.href = '/' }}
            className="text-stone-500 hover:text-stone-700 underline"
          >
            {t('login.clear_reload')}
          </button>
        </p>
        <p className="text-center mt-3 text-xs text-stone-400">
          <Link to="/terms" className="hover:text-stone-600 underline">{t('login.terms')}</Link>
          {' · '}
          <Link to="/privacy" className="hover:text-stone-600 underline">{t('login.privacy')}</Link>
        </p>
      </div>
    </div>
  )
}
