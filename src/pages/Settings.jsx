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

const FREQUENCIES = [
  { value: 'one_time',  label: 'One-time' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly',  label: 'Monthly' },
]
const BED_OPTIONS  = [1, 2, 3, 4, 5]
const BATH_OPTIONS = [1, 2, 3, 4]

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
  const [taxLabel, setTaxLabel] = useState('Tax')
  const [vatNumber, setVatNumber] = useState('')
  const [country, setCountry] = useState('US')
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [currencySymbol, setCurrencySymbol] = useState('$')
  const [callingCode, setCallingCode] = useState('+1')
  const [paymentMethods, setPaymentMethods] = useState(['Cash', 'Venmo', 'Zelle', 'Card', 'Bank Transfer', 'Check', 'Other'])
  const [newMethod, setNewMethod] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  // Pricing matrix state
  const [serviceTypes, setServiceTypes]               = useState([])
  const [selectedServiceType, setSelectedServiceType] = useState(null)
  const [selectedFrequency, setSelectedFrequency]     = useState('one_time')
  const [pricingData, setPricingData]                 = useState({})
  const [pricingSaving, setPricingSaving]             = useState(false)

  useEffect(() => { loadOrg() }, [effectiveOrgId])
  useEffect(() => { if (effectiveOrgId) loadPricing() }, [effectiveOrgId])

  async function loadOrg() {
    setLoading(true)
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name, settings, default_tax_rate, tax_label, vat_number')
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
      setTaxRate(data.default_tax_rate ?? data.settings?.tax_rate ?? 0)
      setTaxLabel(data.tax_label || 'Tax')
      setVatNumber(data.vat_number || '')
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

  function validate() {
    const errs = {}
    if (!orgName.trim()) errs.orgName = 'Business name is required.'
    if (taxRate === '' || isNaN(Number(taxRate)) || Number(taxRate) < 0 || Number(taxRate) > 100) {
      errs.taxRate = 'Tax rate must be a number between 0 and 100.'
    }
    if (paymentMethods.length === 0) errs.paymentMethods = 'At least one payment method is required.'
    return errs
  }

  async function loadPricing() {
    const { data: types } = await supabase
      .from('service_types')
      .select('id, name')
      .eq('org_id', effectiveOrgId)
      .eq('is_active', true)
      .order('name')
    const stList = types || []
    setServiceTypes(stList)
    if (stList.length > 0) setSelectedServiceType(prev => prev || stList[0].id)

    const { data: matrix } = await supabase
      .from('pricing_matrix')
      .select('*')
      .eq('org_id', effectiveOrgId)
    const map = {}
    for (const row of matrix || []) {
      map[`${row.service_type_id}:${row.frequency}:${row.bedrooms}:${row.bathrooms}`] = String(row.price)
    }
    setPricingData(map)
  }

  function getPricingValue(stId, freq, beds, baths) {
    return pricingData[`${stId}:${freq}:${beds}:${baths}`] || ''
  }

  function updatePricingValue(stId, freq, beds, baths, val) {
    setPricingData(prev => ({ ...prev, [`${stId}:${freq}:${beds}:${baths}`]: val }))
  }

  async function savePricing() {
    if (!selectedServiceType) return
    setPricingSaving(true)
    const rows = []
    for (const { value: freq } of FREQUENCIES) {
      for (const beds of BED_OPTIONS) {
        for (const baths of BATH_OPTIONS) {
          const val = getPricingValue(selectedServiceType, freq, beds, baths)
          if (val !== '' && !isNaN(Number(val)) && Number(val) > 0) {
            rows.push({ org_id: effectiveOrgId, service_type_id: selectedServiceType, bedrooms: beds, bathrooms: baths, frequency: freq, price: Number(val) })
          }
        }
      }
    }
    const { error: delErr } = await supabase.from('pricing_matrix').delete().eq('org_id', effectiveOrgId).eq('service_type_id', selectedServiceType)
    if (delErr) {
      showToast('Failed to save pricing. Please try again.', 'error')
      setPricingSaving(false)
      return
    }
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('pricing_matrix').insert(rows)
      if (insErr) {
        showToast('Failed to save pricing. Please try again.', 'error')
        setPricingSaving(false)
        return
      }
    }
    showToast(`Pricing saved — ${rows.length} price${rows.length !== 1 ? 's' : ''} set`)
    setPricingSaving(false)
  }

  async function handleSave() {
    if (!canEdit) return
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
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
      .update({
        name: orgName.trim(),
        settings: newSettings,
        default_tax_rate: Number(taxRate) || null,
        tax_label: taxLabel.trim() || 'Tax',
        vat_number: vatNumber.trim() || null,
      })
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
              onChange={e => { setOrgName(e.target.value); setErrors(er => { const n = {...er}; delete n.orgName; return n }) }}
              disabled={!canEdit}
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
            />
            {errors.orgName && <p className="text-xs text-red-500 mt-1">{errors.orgName}</p>}
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
            {errors.taxRate && <p className="text-xs text-red-500 mt-1">{errors.taxRate}</p>}
            <p className="text-xs text-stone-400 mt-1">Applied automatically when creating new invoices.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Tax Label</label>
            <input
              type="text"
              value={taxLabel}
              onChange={e => setTaxLabel(e.target.value)}
              disabled={!canEdit}
              maxLength={20}
              placeholder="Tax"
              className="w-full max-w-[200px] px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
            />
            <p className="text-xs text-stone-400 mt-1">How the tax line is labelled on invoices — e.g. VAT, GST, Sales Tax.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">VAT / Tax Registration Number <span className="font-normal text-stone-400">(optional)</span></label>
            <input
              type="text"
              value={vatNumber}
              onChange={e => setVatNumber(e.target.value)}
              disabled={!canEdit}
              maxLength={50}
              placeholder="e.g. GB123456789"
              className="w-full max-w-[280px] px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
            />
            <p className="text-xs text-stone-400 mt-1">Printed on invoice PDFs where required by law.</p>
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
        {errors.paymentMethods && <p className="text-xs text-red-500 mt-2">{errors.paymentMethods}</p>}
      </div>

      {/* Pricing Matrix */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-1">Pricing Matrix</h2>
        <p className="text-xs text-stone-400 mb-4">Set prices for each service, size, and frequency. Used by the AI booking agent.</p>

        {serviceTypes.length === 0 ? (
          <p className="text-sm text-stone-400">No active service types found. Add service types before setting prices.</p>
        ) : (
          <>
            {/* Service type selector */}
            {serviceTypes.length > 1 && (
              <div className="flex gap-2 mb-4 flex-wrap">
                {serviceTypes.map(st => (
                  <button
                    key={st.id}
                    onClick={() => setSelectedServiceType(st.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      selectedServiceType === st.id
                        ? 'bg-emerald-700 text-white'
                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    }`}
                  >
                    {st.name}
                  </button>
                ))}
              </div>
            )}

            {/* Frequency tabs */}
            <div className="flex gap-1.5 mb-4 flex-wrap">
              {FREQUENCIES.map(f => (
                <button
                  key={f.value}
                  onClick={() => setSelectedFrequency(f.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    selectedFrequency === f.value
                      ? 'bg-stone-800 text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Price grid: rows = bedrooms, cols = bathrooms */}
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="pb-2 pr-4 text-stone-400 font-medium text-left">Beds / Baths</th>
                    {BATH_OPTIONS.map(b => (
                      <th key={b} className="pb-2 px-2 text-stone-400 font-medium text-center">{b} bath</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BED_OPTIONS.map(beds => (
                    <tr key={beds}>
                      <td className="py-1.5 pr-4 text-stone-500 font-medium whitespace-nowrap">{beds} bed</td>
                      {BATH_OPTIONS.map(baths => (
                        <td key={baths} className="py-1.5 px-1">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-xs pointer-events-none">$</span>
                            <input
                              type="number"
                              min="0"
                              step="5"
                              placeholder="—"
                              disabled={!canEdit}
                              value={getPricingValue(selectedServiceType, selectedFrequency, beds, baths)}
                              onChange={e => updatePricingValue(selectedServiceType, selectedFrequency, beds, baths, e.target.value)}
                              className="w-20 pl-5 pr-1 py-1.5 border border-stone-200 rounded-lg text-xs text-stone-800 bg-stone-50 focus:outline-none focus:ring-1 focus:ring-emerald-600 text-right disabled:opacity-60"
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canEdit && (
              <button
                onClick={savePricing}
                disabled={pricingSaving}
                className="mt-4 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors"
              >
                {pricingSaving ? 'Saving…' : 'Save Pricing'}
              </button>
            )}
          </>
        )}
      </div>

      {canEdit && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      )}
    </div>
  )
}
