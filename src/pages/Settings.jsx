import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAdminOrg } from '../contexts/AdminOrgContext'
import { useToast } from '../contexts/ToastContext'
import { US_TIMEZONES, formatTime } from '../lib/timezone'

const COUNTRY_PRESETS = {
  US: { currency_code: 'USD', currency_symbol: '$', calling_code: '+1', payment_methods: ['Cash', 'Venmo', 'Zelle', 'Card', 'Bank Transfer', 'Check', 'Other'] },
  NL: { currency_code: 'EUR', currency_symbol: '€', calling_code: '+31', payment_methods: ['Cash', 'iDEAL', 'Tikkie', 'Card', 'Bank Transfer', 'Other'] },
  GB: { currency_code: 'GBP', currency_symbol: '£', calling_code: '+44', payment_methods: ['Cash', 'Card', 'Bank Transfer', 'BACS', 'Other'] },
  CA: { currency_code: 'CAD', currency_symbol: '$', calling_code: '+1', payment_methods: ['Cash', 'Card', 'Bank Transfer', 'Interac', 'Other'] },
  AU: { currency_code: 'AUD', currency_symbol: '$', calling_code: '+61', payment_methods: ['Cash', 'Card', 'Bank Transfer', 'PayID', 'Other'] },
  DE: { currency_code: 'EUR', currency_symbol: '€', calling_code: '+49', payment_methods: ['Cash', 'Card', 'Bank Transfer', 'PayPal', 'Other'] },
  FR: { currency_code: 'EUR', currency_symbol: '€', calling_code: '+33', payment_methods: ['Cash', 'Card', 'Bank Transfer', 'Other'] },
  ES: { currency_code: 'EUR', currency_symbol: '€', calling_code: '+34', payment_methods: ['Cash', 'Card', 'Bank Transfer', 'Bizum', 'Other'] },
}

const DEFAULT_PRESET = { currency_code: 'USD', currency_symbol: '$', calling_code: '+1', payment_methods: ['Cash', 'Card', 'Bank Transfer', 'Other'] }

const COUNTRY_OPTIONS = [
  { code: 'US', label: 'United States' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'BE', label: 'Belgium' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'Other', label: 'Other' },
]

export default function Settings({ user }) {
  const { adminViewOrg } = useAdminOrg()
  const effectiveOrgId = adminViewOrg?.id ?? user?.org_id
  const { showToast } = useToast()

  const canEdit = user?.role === 'ceo' || user?.is_platform_admin

  const [org, setOrg] = useState(null)
  const [loading, setLoading] = useState(true)

  // Form state
  const [orgName, setOrgName] = useState('')
  const [timezone, setTimezone] = useState('America/Los_Angeles')
  const [timeFormat, setTimeFormat] = useState('12h')
  const [taxRate, setTaxRate] = useState(0)
  const [country, setCountry] = useState('US')
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [currencySymbol, setCurrencySymbol] = useState('$')
  const [callingCode, setCallingCode] = useState('+1')
  const [paymentMethods, setPaymentMethods] = useState(['Cash', 'Venmo', 'Zelle', 'Card', 'Bank Transfer', 'Check', 'Other'])
  const [newMethod, setNewMethod] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadOrg() }, [effectiveOrgId])

  async function loadOrg() {
    setLoading(true)
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, settings')
      .eq('id', effectiveOrgId)
      .single()
    if (error) {
      console.error('Failed to load settings:', error)
      showToast('Failed to load settings. Please try again.', 'error')
      setLoading(false)
      return
    }
    if (data) {
      setOrg(data)
      setOrgName(data.name || '')
      setTimezone(data.settings?.timezone || 'America/Los_Angeles')
      setTimeFormat(data.settings?.time_format || '12h')
      setTaxRate(data.settings?.tax_rate ?? 0)
      setCountry(data.settings?.country || 'US')
      setCurrencyCode(data.settings?.currency || 'USD')
      setCurrencySymbol(data.settings?.currency_symbol || '$')
      setCallingCode(data.settings?.default_country_calling_code || '+1')
      setPaymentMethods(data.settings?.payment_methods || ['Cash', 'Venmo', 'Zelle', 'Card', 'Bank Transfer', 'Check', 'Other'])
    }
    setLoading(false)
  }

  function handleCountryChange(newCountry) {
    setCountry(newCountry)
    const preset = COUNTRY_PRESETS[newCountry] || DEFAULT_PRESET
    setCurrencyCode(preset.currency_code)
    setCurrencySymbol(preset.currency_symbol)
    setCallingCode(preset.calling_code)
    setPaymentMethods(preset.payment_methods)
  }

  function addPaymentMethod() {
    const m = newMethod.trim()
    if (m && !paymentMethods.includes(m)) {
      setPaymentMethods(prev => [...prev, m])
    }
    setNewMethod('')
  }

  function removePaymentMethod(method) {
    setPaymentMethods(prev => prev.filter(m => m !== method))
  }

  async function handleSave() {
    if (!canEdit) return
    setSaving(true)

    const newSettings = {
      ...(org?.settings || {}),
      timezone,
      time_format: timeFormat,
      tax_rate: Number(taxRate),
      country,
      currency: currencyCode,
      currency_symbol: currencySymbol,
      default_country_calling_code: callingCode,
      payment_methods: paymentMethods,
    }

    const { error } = await supabase
      .from('organizations')
      .update({ name: orgName.trim(), settings: newSettings })
      .eq('id', effectiveOrgId)

    if (error) {
      console.error('Failed to save settings:', error)
      showToast('Failed to save changes. Please try again.', 'error')
      setSaving(false)
      return
    }

    showToast('Settings saved')
    setTimeout(() => window.location.reload(), 600)
  }

  if (loading) return <div className="p-6 md:p-8 text-stone-400">Loading settings...</div>

  const tzGroups = US_TIMEZONES.reduce((acc, tz) => {
    const g = tz.group || 'Other'
    if (!acc[g]) acc[g] = []
    acc[g].push(tz)
    return acc
  }, {})

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Settings</h1>
        <p className="text-stone-500 text-sm mt-1">Organization preferences</p>
      </div>

      {!canEdit && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          Only the account owner can change settings.
        </div>
      )}

      {/* Organization */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-4">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">Organization</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Business Name</label>
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              disabled={!canEdit}
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Country</label>
            <select
              value={country}
              onChange={e => handleCountryChange(e.target.value)}
              disabled={!canEdit}
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
            >
              {COUNTRY_OPTIONS.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <p className="text-xs text-stone-400 mt-1">Changing country updates currency and payment method defaults.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Timezone</label>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              disabled={!canEdit}
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
            >
              {Object.entries(tzGroups).map(([group, zones]) => (
                <optgroup key={group} label={group}>
                  {zones.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-stone-400 mt-1">All job dates and times are shown in this timezone.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 mb-2">Time Format</label>
            <div className="flex gap-2">
              {[
                { value: '12h', label: '12-hour', example: formatTime('09:30', '12h') },
                { value: '24h', label: '24-hour', example: formatTime('09:30', '24h') },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => canEdit && setTimeFormat(opt.value)}
                  disabled={!canEdit}
                  className={`flex-1 py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors disabled:cursor-default ${
                    timeFormat === opt.value
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                      : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-300'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span className="block text-xs font-mono mt-0.5 opacity-70">{opt.example}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Billing */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-4">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">Billing</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Default Tax Rate</label>
            <div className="flex items-center gap-2 max-w-[160px]">
              <div className="relative flex-1">
                <input
                  type="number"
                  value={taxRate}
                  onChange={e => setTaxRate(e.target.value)}
                  step="0.1"
                  min="0"
                  max="100"
                  disabled={!canEdit}
                  className="w-full px-3 py-2.5 pr-7 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">%</span>
              </div>
            </div>
            <p className="text-xs text-stone-400 mt-1">Applied automatically when creating new invoices.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Currency Code</label>
              <input
                type="text"
                value={currencyCode}
                onChange={e => setCurrencyCode(e.target.value)}
                disabled={!canEdit}
                maxLength={4}
                placeholder="USD"
                className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Currency Symbol</label>
              <input
                type="text"
                value={currencySymbol}
                onChange={e => setCurrencySymbol(e.target.value)}
                disabled={!canEdit}
                maxLength={3}
                placeholder="$"
                className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Calling Code</label>
              <input
                type="text"
                value={callingCode}
                onChange={e => setCallingCode(e.target.value)}
                disabled={!canEdit}
                maxLength={5}
                placeholder="+1"
                className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Payment Methods */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">Payment Methods</h2>
        <p className="text-xs text-stone-400 mb-4">These appear as chip options wherever payment method is selected.</p>

        <div className="flex flex-wrap gap-2 mb-4">
          {paymentMethods.map(method => (
            <span key={method} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 text-stone-700 rounded-xl text-sm font-medium">
              {method}
              {canEdit && (
                <button
                  onClick={() => removePaymentMethod(method)}
                  className="text-stone-400 hover:text-red-500 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </span>
          ))}
        </div>

        {canEdit && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newMethod}
              onChange={e => setNewMethod(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPaymentMethod() } }}
              placeholder="Add payment method..."
              className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <button onClick={addPaymentMethod} className="px-3 py-2 bg-stone-100 text-stone-600 text-sm rounded-xl hover:bg-stone-200 transition-colors">Add</button>
          </div>
        )}
      </div>

      {canEdit && (
        <button
          onClick={handleSave}
          disabled={saving || !orgName.trim()}
          className="w-full py-3 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      )}
    </div>
  )
}
