import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'
import { useAdminOrg } from '../../contexts/AdminOrgContext'
import { logAudit } from '../../lib/auditLog'
import { ADD_ONS } from '../../lib/tiers'

// ─── Shared UI ────────────────────────────────────────────────

function TierBadge({ tier }) {
  const cls = {
    starter:      'bg-stone-100 text-stone-600',
    professional: 'bg-blue-100 text-blue-700',
    growth:       'bg-emerald-100 text-emerald-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls[tier] || 'bg-stone-100 text-stone-600'}`}>
      {tier}
    </span>
  )
}

function StatusBadge({ status }) {
  const cls = {
    active:    'bg-emerald-100 text-emerald-700',
    trialing:  'bg-amber-100 text-amber-700',
    past_due:  'bg-orange-100 text-orange-700',
    paused:    'bg-stone-100 text-stone-600',
    cancelled: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls[status] || 'bg-stone-100 text-stone-600'}`}>
      {status?.replace('_', ' ')}
    </span>
  )
}

function ConfirmModal({ title, message, onConfirm, onCancel, danger = true }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-bold text-stone-900 mb-2">{title}</h3>
        <p className="text-stone-500 text-sm mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 border border-stone-200 rounded-xl text-stone-600 text-sm hover:bg-stone-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2 rounded-xl text-white text-sm font-medium ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-700 hover:bg-emerald-800'}`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

const INPUT = 'w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600'
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// ─── Add User Modal ───────────────────────────────────────────

function AddUserModal({ orgId, onClose, onAdded, adminUser }) {
  const { showToast } = useToast()
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'worker' })
  const [loading, setLoading] = useState(false)

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    const newId = crypto.randomUUID()
    const { error } = await supabase.from('users').insert({
      id:          newId,
      name:        form.name.trim(),
      email:       form.email.trim().toLowerCase(),
      phone:       form.phone.trim() || null,
      role:        form.role,
      org_id:      orgId,
      auth_linked: false,
    })
    if (error) { showToast(error.message, 'error'); setLoading(false); return }
    showToast('User added')
    if (adminUser) {
      await logAudit({ supabase, user: adminUser, action: 'create', entityType: 'user', entityId: newId, changes: { name: form.name.trim(), email: form.email.trim().toLowerCase(), role: form.role, org_id: orgId }, metadata: { source: 'admin_panel' } })
    }
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stone-100">
          <h3 className="font-bold text-stone-900">Add User</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <input required placeholder="Name" value={form.name} onChange={e => set('name', e.target.value)} className={INPUT} />
          <input required type="email" placeholder="Email" value={form.email} onChange={e => set('email', e.target.value)} className={INPUT} />
          <input type="tel" placeholder="Phone (optional)" value={form.phone} onChange={e => set('phone', e.target.value)} className={INPUT} />
          <select value={form.role} onChange={e => set('role', e.target.value)} className={INPUT}>
            <option value="ceo">Owner (CEO)</option>
            <option value="manager">Manager</option>
            <option value="worker">Worker</option>
          </select>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-stone-200 rounded-xl text-stone-600 text-sm hover:bg-stone-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50">
              {loading ? 'Adding…' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Create Org Modal ─────────────────────────────────────────

function CreateOrgModal({ onClose, onCreated, adminUser }) {
  const { showToast } = useToast()
  const [form, setForm] = useState({
    name: '', ownerName: '', ownerEmail: '', ownerPhone: '',
    tier: 'starter', status: 'active', isFoundingCustomer: false, trialEndsAt: '',
  })
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState(null)

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .insert({
          name:                 form.name.trim(),
          subscription_tier:   form.tier,
          subscription_status: form.status,
          is_founding_customer: form.isFoundingCustomer,
          trial_ends_at:       form.trialEndsAt || null,
        })
        .select()
        .single()
      if (orgErr) throw orgErr

      const { error: userErr } = await supabase.from('users').insert({
        id:          crypto.randomUUID(),
        name:        form.ownerName.trim(),
        email:       form.ownerEmail.trim().toLowerCase(),
        phone:       form.ownerPhone.trim() || null,
        role:        'ceo',
        org_id:      org.id,
        auth_linked: false,
      })
      if (userErr) throw userErr

      if (adminUser) {
        await logAudit({ supabase, user: adminUser, action: 'create', entityType: 'organization', entityId: org.id, changes: { name: form.name.trim(), subscription_tier: form.tier, subscription_status: form.status }, metadata: { source: 'admin_panel' } })
      }
      setCreated(org)
      onCreated()
    } catch (err) {
      showToast(err.message, 'error')
    }
    setLoading(false)
  }

  if (created) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-emerald-50 rounded-xl mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h3 className="text-lg font-bold text-stone-900 mb-1">Organization created</h3>
          <p className="text-stone-500 text-sm mb-1">
            <span className="font-medium text-stone-700">{created.name}</span> is ready.
          </p>
          <p className="text-stone-400 text-sm mb-5">
            The owner can now sign in at timelyops.com using their email.
          </p>
          <button
            onClick={() => { navigator.clipboard.writeText('https://timelyops.com/login'); showToast('Invite link copied') }}
            className="w-full mb-3 py-2.5 border border-stone-200 text-stone-700 text-sm font-medium rounded-xl hover:bg-stone-50"
          >
            Copy invite link
          </button>
          <button onClick={onClose} className="w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800">
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-4">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-100">
          <h2 className="text-lg font-bold text-stone-900">New Organization</h2>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Business</p>
            <input required placeholder="Business name" value={form.name} onChange={e => set('name', e.target.value)} className={INPUT} />
          </div>

          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Owner</p>
            <div className="space-y-2">
              <input required placeholder="Owner name" value={form.ownerName} onChange={e => set('ownerName', e.target.value)} className={INPUT} />
              <input required type="email" placeholder="Owner email" value={form.ownerEmail} onChange={e => set('ownerEmail', e.target.value)} className={INPUT} />
              <input type="tel" placeholder="Owner phone (optional)" value={form.ownerPhone} onChange={e => set('ownerPhone', e.target.value)} className={INPUT} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Subscription</p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select value={form.tier} onChange={e => set('tier', e.target.value)} className={INPUT}>
                <option value="starter">Starter ($79/mo)</option>
                <option value="professional">Professional ($129/mo)</option>
                <option value="growth">Growth ($249/mo)</option>
              </select>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={INPUT}>
                <option value="active">Active</option>
                <option value="trialing">Trialing</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            {form.status === 'trialing' && (
              <input
                type="date" value={form.trialEndsAt} onChange={e => set('trialEndsAt', e.target.value)}
                placeholder="Trial ends at" className={`${INPUT} mb-2`}
              />
            )}
            <label className="flex items-center gap-2 cursor-pointer mt-2">
              <input type="checkbox" checked={form.isFoundingCustomer} onChange={e => set('isFoundingCustomer', e.target.checked)} className="w-4 h-4 rounded accent-emerald-700" />
              <span className="text-sm text-stone-700">Founding customer</span>
            </label>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-stone-200 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50">
              {loading ? 'Creating…' : 'Create Organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Org Detail Panel ─────────────────────────────────────────

function OrgDetailPanel({ org, onClose, onUpdated, onViewOrg, adminUser }) {
  const { showToast } = useToast()
  const [form, setForm] = useState({
    name:               org.name,
    tier:               org.subscription_tier,
    status:             org.subscription_status,
    addOns:             org.add_ons || [],
    isFoundingCustomer: org.is_founding_customer,
    trialEndsAt:        org.trial_ends_at ? org.trial_ends_at.slice(0, 10) : '',
  })
  const [users, setUsers]             = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [saving, setSaving]           = useState(false)
  const [showAddUser, setShowAddUser] = useState(false)
  const [confirm, setConfirm]         = useState(null)
  const [auditEntries, setAuditEntries] = useState([])
  const [auditLoading, setAuditLoading] = useState(true)

  function setField(k, v) { setForm(p => ({ ...p, [k]: v })) }

  function toggleAddOn(slug) {
    setForm(p => ({
      ...p,
      addOns: p.addOns.includes(slug) ? p.addOns.filter(a => a !== slug) : [...p.addOns, slug],
    }))
  }

  useEffect(() => { fetchUsers(); fetchAudit() }, [org.id])

  async function fetchAudit() {
    setAuditLoading(true)
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false })
      .limit(10)
    setAuditEntries(data || [])
    setAuditLoading(false)
  }

  async function fetchUsers() {
    setUsersLoading(true)
    const { data } = await supabase.from('users').select('*').eq('org_id', org.id).order('name')
    setUsers(data || [])
    setUsersLoading(false)
  }

  async function saveOrg() {
    setSaving(true)
    const changes = {}
    if (form.name.trim() !== org.name) changes.name = { from: org.name, to: form.name.trim() }
    if (form.tier !== org.subscription_tier) changes.subscription_tier = { from: org.subscription_tier, to: form.tier }
    if (form.status !== org.subscription_status) changes.subscription_status = { from: org.subscription_status, to: form.status }

    const { error } = await supabase.from('organizations').update({
      name:                 form.name.trim(),
      subscription_tier:   form.tier,
      subscription_status: form.status,
      add_ons:             form.addOns,
      is_founding_customer: form.isFoundingCustomer,
      trial_ends_at:       form.trialEndsAt || null,
    }).eq('id', org.id)

    if (error) {
      console.error('Failed to save organization:', error)
      showToast('Failed to save changes. Please try again.', 'error')
    } else {
      showToast('Organization saved')
      if (Object.keys(changes).length > 0 && adminUser) {
        await logAudit({ supabase, user: adminUser, action: 'update', entityType: 'organization', entityId: org.id, changes, metadata: { source: 'admin_panel' } })
      }
      onUpdated()
    }
    setSaving(false)
  }

  async function changeRole(userId, newRole) {
    const oldUser = users.find(u => u.id === userId)
    const { error } = await supabase.from('users').update({ role: newRole }).eq('id', userId)
    if (error) {
      console.error('Failed to update user role:', error)
      showToast('Failed to save changes. Please try again.', 'error')
    } else {
      showToast('Role updated')
      if (adminUser) {
        await logAudit({ supabase, user: adminUser, action: 'update', entityType: 'user', entityId: userId, changes: { role: { from: oldUser?.role, to: newRole } }, metadata: { source: 'admin_panel', org_id: org.id } })
      }
      fetchUsers()
    }
  }

  async function removeUser(userId) {
    const { error } = await supabase.from('users').delete().eq('id', userId)
    if (error) {
      console.error('Failed to remove user:', error)
      showToast('Failed to delete user. Please try again.', 'error')
    } else { showToast('User removed'); fetchUsers() }
    setConfirm(null)
  }

  const shortId = id => id ? id.slice(0, 8) + '…' : '—'

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[500px] bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 sticky top-0 bg-white">
          <h2 className="font-bold text-stone-900 text-lg truncate pr-4">{org.name}</h2>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onViewOrg}
              className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800"
            >
              View org data
            </button>
            <button onClick={onClose} className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-6">
          {/* Settings */}
          <section>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Organization Settings</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-stone-500 mb-1">Business name</label>
                <input value={form.name} onChange={e => setField('name', e.target.value)} className={INPUT} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Tier</label>
                  <select value={form.tier} onChange={e => setField('tier', e.target.value)} className={INPUT}>
                    <option value="starter">Starter ($79/mo)</option>
                    <option value="professional">Professional ($129/mo)</option>
                    <option value="growth">Growth ($249/mo)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Status</label>
                  <select value={form.status} onChange={e => setField('status', e.target.value)} className={INPUT}>
                    <option value="active">Active</option>
                    <option value="trialing">Trialing</option>
                    <option value="past_due">Past Due</option>
                    <option value="paused">Paused</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              {form.status === 'trialing' && (
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Trial ends at</label>
                  <input type="date" value={form.trialEndsAt} onChange={e => setField('trialEndsAt', e.target.value)} className={INPUT} />
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isFoundingCustomer} onChange={e => setField('isFoundingCustomer', e.target.checked)} className="w-4 h-4 rounded accent-emerald-700" />
                <span className="text-sm text-stone-700">Founding customer</span>
              </label>

              {/* Add-ons */}
              <div>
                <label className="block text-xs text-stone-500 mb-2">Add-ons</label>
                <div className="space-y-1.5">
                  {Object.entries(ADD_ONS).map(([slug, addon]) => (
                    <label key={slug} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.addOns.includes(slug)} onChange={() => toggleAddOn(slug)} className="w-4 h-4 rounded accent-emerald-700" />
                      <span className="text-sm text-stone-700">{addon.name}</span>
                      <span className="text-xs text-stone-400">${addon.price}/mo</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={saveOrg}
              disabled={saving}
              className="mt-4 w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </section>

          {/* Meta */}
          <section className="border-t border-stone-100 pt-4 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">Created</span>
              <span className="text-stone-600">{fmtDate(org.created_at)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">Org ID</span>
              <button
                onClick={() => { navigator.clipboard.writeText(org.id); showToast('Copied') }}
                className="font-mono text-stone-500 hover:text-stone-800"
              >
                {shortId(org.id)}
              </button>
            </div>
          </section>

          {/* Users */}
          <section className="border-t border-stone-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Users</h3>
              <button onClick={() => setShowAddUser(true)} className="text-xs text-emerald-700 font-medium hover:underline">
                + Add User
              </button>
            </div>

            {usersLoading ? (
              <p className="text-sm text-stone-400">Loading…</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-stone-400">No users in this org.</p>
            ) : (
              <div className="space-y-0">
                {users.map(u => (
                  <div key={u.id} className="flex items-center gap-2 py-2.5 border-b border-stone-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-800 truncate">{u.name || '—'}</div>
                      <div className="text-xs text-stone-400 truncate">{u.email || u.phone || '—'}</div>
                    </div>
                    <select
                      value={u.role}
                      onChange={e => changeRole(u.id, e.target.value)}
                      className="text-xs border border-stone-200 rounded-lg px-2 py-1 bg-white text-stone-700 focus:outline-none"
                    >
                      <option value="ceo">Owner</option>
                      <option value="manager">Manager</option>
                      <option value="worker">Worker</option>
                    </select>
                    <button
                      onClick={() => setConfirm({ userId: u.id, userName: u.name })}
                      className="p-1 text-stone-300 hover:text-red-500 rounded flex-shrink-0"
                      title="Remove user"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14H6L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/>
                        <path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent audit log */}
          <section className="border-t border-stone-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Recent Activity</h3>
              <a
                href={`/admin/audit?org_id=${org.id}`}
                className="text-xs text-emerald-700 font-medium hover:underline"
              >
                View all
              </a>
            </div>
            {auditLoading ? (
              <p className="text-sm text-stone-400">Loading…</p>
            ) : auditEntries.length === 0 ? (
              <p className="text-sm text-stone-400">No activity recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {auditEntries.map(entry => (
                  <div key={entry.id} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                      entry.action === 'create' ? 'bg-emerald-100 text-emerald-700' :
                      entry.action === 'delete' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{entry.action}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-stone-600">{entry.user_name}</span>
                      <span className="text-stone-400 mx-1">·</span>
                      <span className="text-stone-500 capitalize">{entry.entity_type}</span>
                      {entry.is_admin_action && (
                        <span className="ml-1 text-purple-500">·admin</span>
                      )}
                    </div>
                    <span className="text-stone-300 flex-shrink-0">
                      {new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {showAddUser && (
        <AddUserModal
          orgId={org.id}
          onClose={() => setShowAddUser(false)}
          onAdded={() => { setShowAddUser(false); fetchUsers() }}
          adminUser={adminUser}
        />
      )}

      {confirm && (
        <ConfirmModal
          title="Remove user"
          message={`Remove ${confirm.userName} from this org? This cannot be undone.`}
          onConfirm={() => removeUser(confirm.userId)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function AdminOrgs({ user }) {
  const navigate = useNavigate()
  const { setAdminViewOrg } = useAdminOrg()
  const { showToast } = useToast()
  const [orgs, setOrgs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedOrg, setSelectedOrg] = useState(null)

  useEffect(() => { fetchOrgs() }, [])

  async function fetchOrgs() {
    const { data, error } = await supabase
      .from('organizations')
      .select('*, users(id, name, role, email)')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('Failed to load organizations:', error)
      showToast('Failed to load organizations. Please try again.', 'error')
      setLoading(false)
      return
    }
    setOrgs(data || [])
    setLoading(false)
  }

  function handleViewOrg(org) {
    setAdminViewOrg(org)
    navigate('/')
  }

  async function handleOrgUpdated() {
    // Refresh list and keep panel open with fresh data
    const { data: fresh } = await supabase
      .from('organizations')
      .select('*, users(id, name, role, email)')
      .eq('id', selectedOrg.id)
      .single()
    if (fresh) setSelectedOrg(fresh)
    fetchOrgs()
  }

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Organizations</h1>
          <p className="text-stone-500 text-sm mt-1">{orgs.length} total</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Organization
        </button>
      </div>

      {loading ? (
        <div className="text-stone-400 text-sm">Loading…</div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Organization</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide hidden md:table-cell">Owner</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Tier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide hidden lg:table-cell">Staff</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide hidden lg:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => {
                const owner = org.users?.find(u => u.role === 'ceo')
                return (
                  <tr
                    key={org.id}
                    onClick={() => setSelectedOrg(org)}
                    className="border-b border-stone-50 last:border-0 hover:bg-stone-50 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-800">{org.name}</div>
                      {org.is_founding_customer && <span className="text-xs text-amber-600">⭐ Founding</span>}
                    </td>
                    <td className="px-4 py-3 text-stone-500 hidden md:table-cell">{owner?.name || '—'}</td>
                    <td className="px-4 py-3"><TierBadge tier={org.subscription_tier} /></td>
                    <td className="px-4 py-3"><StatusBadge status={org.subscription_status} /></td>
                    <td className="px-4 py-3 text-stone-500 hidden lg:table-cell">{org.users?.length ?? 0}</td>
                    <td className="px-4 py-3 text-stone-400 text-xs hidden lg:table-cell">{fmtDate(org.created_at)}</td>
                  </tr>
                )
              })}
              {orgs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-400">No organizations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateOrgModal
          onClose={() => setShowCreate(false)}
          onCreated={fetchOrgs}
          adminUser={user}
        />
      )}

      {selectedOrg && (
        <OrgDetailPanel
          org={selectedOrg}
          onClose={() => setSelectedOrg(null)}
          onUpdated={handleOrgUpdated}
          onViewOrg={() => handleViewOrg(selectedOrg)}
          adminUser={user}
        />
      )}
    </div>
  )
}
