import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAdminOrg } from '../contexts/AdminOrgContext'
import { useToast } from '../contexts/ToastContext'
import { US_TIMEZONES, formatTime } from '../lib/timezone'

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
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadOrg() }, [effectiveOrgId])

  async function loadOrg() {
    setLoading(true)
    const { data } = await supabase
      .from('organizations')
      .select('id, name, settings')
      .eq('id', effectiveOrgId)
      .single()
    if (data) {
      setOrg(data)
      setOrgName(data.name || '')
      setTimezone(data.settings?.timezone || 'America/Los_Angeles')
      setTimeFormat(data.settings?.time_format || '12h')
      setTaxRate(data.settings?.tax_rate ?? 0)
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!canEdit) return
    setSaving(true)

    const newSettings = {
      ...(org?.settings || {}),
      timezone,
      time_format: timeFormat,
      tax_rate: Number(taxRate),
    }

    const { error } = await supabase
      .from('organizations')
      .update({ name: orgName.trim(), settings: newSettings })
      .eq('id', effectiveOrgId)

    if (error) {
      showToast('Failed to save settings: ' + error.message, 'error')
      setSaving(false)
      return
    }

    showToast('Settings saved')
    setTimeout(() => window.location.reload(), 600)
  }

  if (loading) return <div className="p-6 md:p-8 text-stone-400">Loading settings...</div>

  // Group timezones for the select
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
          {/* Business name */}
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

          {/* Timezone */}
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

          {/* Time format */}
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
      <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">Billing</h2>

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
