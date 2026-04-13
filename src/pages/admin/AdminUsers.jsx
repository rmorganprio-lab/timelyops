import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'
import { logAudit } from '../../lib/auditLog'

// ─── Shared UI ────────────────────────────────────────────────

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

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const INPUT = 'w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600'

// ─── Create User Modal ────────────────────────────────────────

function CreateUserModal({ onClose, onCreated, adminUser }) {
  const { showToast } = useToast()
  const [orgs, setOrgs] = useState([])
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'worker', orgId: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('organizations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data || []))
  }, [])

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)

    // Normalize phone to E.164
    const rawPhone = form.phone.trim()
    let phone = null
    if (rawPhone) {
      if (rawPhone.startsWith('+')) {
        phone = rawPhone
      } else {
        const digits = rawPhone.replace(/\D/g, '')
        if (digits.length === 10) phone = '+1' + digits
        else if (digits.length === 11 && digits.startsWith('1')) phone = '+' + digits
        else phone = rawPhone
      }
    }

    const userId = crypto.randomUUID()

    const { error } = await supabase.from('users').insert({
      id:          userId,
      name:        form.name.trim(),
      email:       form.email.trim().toLowerCase() || null,
      phone,
      role:        form.role,
      org_id:      form.orgId || null,
      auth_linked: false,
    })
    if (error) { showToast(error.message, 'error'); setLoading(false); return }

    if (phone) {
      // Create auth user so they can log in immediately via phone OTP
      const { data: { session } } = await supabase.auth.getSession()
      const createRes = await fetch('https://vrssqhzzdhlqnptengju.supabase.co/functions/v1/admin-update-auth-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ create_user: true, user_id: userId, phone }),
      })

      if (!createRes.ok) {
        // Row exists but auth not set up — still usable but warn
        showToast('User created — auth setup failed, they may need manual linking', 'warning')
      } else {
        // Send login SMS
        const { data: orgData } = form.orgId
          ? await supabase.from('organizations').select('name').eq('id', form.orgId).single()
          : { data: null }
        const orgName = orgData?.name || 'your team'
        const { error: smsError } = await supabase.functions.invoke('send-sms', {
          body: {
            to: phone,
            message: `You've been added to ${orgName} on TimelyOps. Log in at timelyops.com — enter your phone number to get started.`,
          },
        })
        showToast(smsError ? 'User created — couldn\'t send login text, send manually' : 'User created — login instructions sent by text')
      }
    } else {
      showToast('User created')
    }

    if (adminUser) {
      await logAudit({ supabase, user: adminUser, action: 'create', entityType: 'user', entityId: userId, changes: { name: form.name.trim(), role: form.role, org_id: form.orgId || null }, metadata: { source: 'admin_panel' } })
    }
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stone-100">
          <h3 className="font-bold text-stone-900">New User</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <input required placeholder="Full name" value={form.name} onChange={e => set('name', e.target.value)} className={INPUT} />
          <input type="email" placeholder="Email (optional)" value={form.email} onChange={e => set('email', e.target.value)} className={INPUT} />
          <input type="tel" placeholder="Phone (optional)" value={form.phone} onChange={e => set('phone', e.target.value)} className={INPUT} />
          <select value={form.role} onChange={e => set('role', e.target.value)} className={INPUT}>
            <option value="ceo">Owner (CEO)</option>
            <option value="manager">Manager</option>
            <option value="worker">Worker</option>
          </select>
          <select value={form.orgId} onChange={e => set('orgId', e.target.value)} className={INPUT}>
            <option value="">— No organization —</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-stone-200 rounded-xl text-stone-600 text-sm hover:bg-stone-50">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50">
              {loading ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── User Detail Panel ────────────────────────────────────────

function UserDetailPanel({ user, onClose, onUpdated, adminUser }) {
  const { showToast } = useToast()
  const [form, setForm] = useState({
    name:   user.name  || '',
    email:  user.email || '',
    phone:  user.phone || '',
    orgId:  user.org_id || '',
    role:   user.role  || 'worker',
  })
  const [orgs, setOrgs]               = useState([])
  const [isPlatformAdmin, setIsAdmin] = useState(user.is_platform_admin)
  const [confirm, setConfirm]         = useState(null) // 'toggleAdmin' | { type:'reassignOrg', orgId, orgName }
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    supabase.from('organizations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data || []))
  }, [])

  function setField(k, v) { setForm(p => ({ ...p, [k]: v })) }

  const emailChanged = form.email.trim() !== (user.email || '')
  const phoneChanged = form.phone.trim() !== (user.phone || '')
  const orgChanged   = form.orgId !== (user.org_id || '')

  async function saveChanges() {
    setSaving(true)

    // Update auth.users credentials if linked and changed
    if (user.auth_linked && (emailChanged || phoneChanged)) {
      const body = { auth_user_id: user.id }
      if (emailChanged) body.email = form.email.trim().toLowerCase() || null
      if (phoneChanged) body.phone = form.phone.trim() || null
      const { error: fnError } = await supabase.functions.invoke('admin-update-auth-user', { body })
      if (fnError) {
        showToast('Failed to update login credentials: ' + fnError.message, 'error')
        setSaving(false)
        setConfirm(null)
        return
      }
    }

    const { error } = await supabase.from('users').update({
      name:   form.name.trim(),
      email:  form.email.trim().toLowerCase() || null,
      phone:  form.phone.trim() || null,
      org_id: form.orgId || null,
      role:   form.role,
    }).eq('id', user.id)

    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast('User saved')
      const changes = {}
      if (form.role !== user.role) changes.role = { from: user.role, to: form.role }
      if (emailChanged) changes.email = { from: user.email, to: form.email.trim().toLowerCase() }
      if (phoneChanged) changes.phone = { from: user.phone, to: form.phone.trim() }
      if (orgChanged) changes.org_id = { from: user.org_id, to: form.orgId }
      if (Object.keys(changes).length > 0 && adminUser) {
        await logAudit({ supabase, user: adminUser, action: 'update', entityType: 'user', entityId: user.id, changes, metadata: { source: 'admin_panel' } })
      }
      onUpdated()
    }
    setSaving(false)
    setConfirm(null)
  }

  async function togglePlatformAdmin() {
    const newVal = !isPlatformAdmin
    const { error } = await supabase.from('users').update({ is_platform_admin: newVal }).eq('id', user.id)
    if (error) {
      showToast(error.message, 'error')
    } else {
      setIsAdmin(newVal)
      showToast(newVal ? 'Platform admin granted' : 'Platform admin revoked')
      if (adminUser) {
        await logAudit({ supabase, user: adminUser, action: 'update', entityType: 'user', entityId: user.id, changes: { is_platform_admin: { from: isPlatformAdmin, to: newVal } }, metadata: { source: 'admin_panel' } })
      }
      onUpdated()
    }
    setConfirm(null)
  }

  function handleSave() {
    if (orgChanged) {
      const orgName = orgs.find(o => o.id === form.orgId)?.name || 'new org'
      setConfirm({ type: 'reassignOrg', orgName })
    } else {
      saveChanges()
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[440px] bg-white shadow-2xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 sticky top-0 bg-white">
          <h2 className="font-bold text-stone-900 truncate pr-4">{user.name || 'User'}</h2>
          <button onClick={onClose} className="flex-shrink-0 p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Editable profile fields */}
          <section>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Profile</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-stone-500 mb-1">Name</label>
                <input value={form.name} onChange={e => setField('name', e.target.value)} className={INPUT} placeholder="Full name" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} className={INPUT} placeholder="email@example.com" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Phone</label>
                <input type="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} className={INPUT} placeholder="+1 650 000 0000" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Organization</label>
                <select value={form.orgId} onChange={e => setField('orgId', e.target.value)} className={INPUT}>
                  <option value="">— No organization —</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Role</label>
                <select value={form.role} onChange={e => setField('role', e.target.value)} className={INPUT}>
                  <option value="ceo">Owner (CEO)</option>
                  <option value="manager">Manager</option>
                  <option value="worker">Worker</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-4 w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </section>

          {/* Platform admin toggle */}
          <section className="border-t border-stone-100 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-stone-800">Platform Admin</p>
                <p className="text-xs text-stone-400 mt-0.5">Full access to all organizations</p>
              </div>
              <button
                onClick={() => setConfirm('toggleAdmin')}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isPlatformAdmin ? 'bg-emerald-700' : 'bg-stone-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isPlatformAdmin ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </section>

          {/* Meta */}
          <section className="border-t border-stone-100 pt-4 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">Created</span>
              <span className="text-stone-600">{fmtDate(user.created_at)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">Auth ID</span>
              <span className="font-mono text-stone-500 truncate ml-4">{user.id}</span>
            </div>
          </section>
        </div>
      </div>

      {confirm === 'toggleAdmin' && (
        <ConfirmModal
          title={isPlatformAdmin ? 'Revoke platform admin?' : 'Grant platform admin?'}
          message={
            isPlatformAdmin
              ? `${user.name || 'This user'} will lose full platform access.`
              : `This gives ${user.name || 'this user'} full access to ALL organizations and platform settings.`
          }
          danger={!isPlatformAdmin}
          onConfirm={togglePlatformAdmin}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.type === 'reassignOrg' && (
        <ConfirmModal
          title="Reassign organization?"
          message={`Move ${user.name || 'this user'} to ${confirm.orgName}? They will lose access to their current org's data.`}
          danger={false}
          onConfirm={saveChanges}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function AdminUsers({ user: adminUser }) {
  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [showCreate, setShowCreate]     = useState(false)

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    const { data } = await supabase
      .from('users')
      .select('*, organizations(id, name)')
      .order('created_at', { ascending: false })
    setUsers(data || [])
    setLoading(false)
  }

  const filtered = users.filter(u =>
    !search ||
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.phone?.includes(search) ||
    u.organizations?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Users</h1>
          <p className="text-stone-500 text-sm mt-1">{users.length} total across all orgs</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 w-48"
          />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New User
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-stone-400 text-sm">Loading…</div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide hidden md:table-cell">Email / Phone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Organization</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide hidden lg:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className="border-b border-stone-50 last:border-0 hover:bg-stone-50 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-stone-800">{u.name || '—'}</div>
                    {u.is_platform_admin && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">platform admin</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-500 hidden md:table-cell">{u.email || u.phone || '—'}</td>
                  <td className="px-4 py-3 text-stone-500">{u.organizations?.name || '—'}</td>
                  <td className="px-4 py-3 text-stone-500 capitalize">{u.role}</td>
                  <td className="px-4 py-3 text-stone-400 text-xs hidden lg:table-cell">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-stone-400">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchUsers() }}
          adminUser={adminUser}
        />
      )}

      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onUpdated={() => { fetchUsers(); setSelectedUser(null) }}
          adminUser={adminUser}
        />
      )}
    </div>
  )
}
