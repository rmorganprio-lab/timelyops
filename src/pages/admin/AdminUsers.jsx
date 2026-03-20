import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'

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

// ─── User Detail Panel ────────────────────────────────────────

function UserDetailPanel({ user, onClose, onUpdated }) {
  const { showToast } = useToast()
  const [role, setRole]                 = useState(user.role)
  const [isPlatformAdmin, setIsAdmin]   = useState(user.is_platform_admin)
  const [confirm, setConfirm]           = useState(null)
  const [saving, setSaving]             = useState(false)

  async function saveRole() {
    if (role === user.role) return
    setSaving(true)
    const { error } = await supabase.from('users').update({ role }).eq('id', user.id)
    if (error) showToast(error.message, 'error')
    else { showToast('Role updated'); onUpdated() }
    setSaving(false)
  }

  async function togglePlatformAdmin() {
    const newVal = !isPlatformAdmin
    const { error } = await supabase.from('users').update({ is_platform_admin: newVal }).eq('id', user.id)
    if (error) showToast(error.message, 'error')
    else {
      setIsAdmin(newVal)
      showToast(newVal ? 'Platform admin granted' : 'Platform admin revoked')
      onUpdated()
    }
    setConfirm(null)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[420px] bg-white shadow-2xl z-50 overflow-y-auto">
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
          {/* Profile (read-only) */}
          <section>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Profile</h3>
            <div className="space-y-2 text-sm">
              {[
                ['Name',         user.name    || '—'],
                ['Email',        user.email   || '—'],
                ['Phone',        user.phone   || '—'],
                ['Organization', user.organizations?.name || '—'],
                ['Created',      fmtDate(user.created_at)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-stone-400 flex-shrink-0">{label}</span>
                  <span className="text-stone-800 text-right truncate">{value}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Role */}
          <section className="border-t border-stone-100 pt-4">
            <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Role</label>
            <div className="flex gap-2">
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="flex-1 px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="ceo">Owner (CEO)</option>
                <option value="manager">Manager</option>
                <option value="worker">Worker</option>
                <option value="support">Support</option>
              </select>
              <button
                onClick={saveRole}
                disabled={saving || role === user.role}
                className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-40"
              >
                Save
              </button>
            </div>
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

          {/* Auth ID */}
          <section className="border-t border-stone-100 pt-4">
            <p className="text-xs text-stone-400 mb-1">Auth ID</p>
            <p className="text-xs font-mono text-stone-500 break-all">{user.id}</p>
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
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function AdminUsers() {
  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [selectedUser, setSelectedUser] = useState(null)

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
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 w-48"
        />
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

      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onUpdated={() => { fetchUsers(); setSelectedUser(null) }}
        />
      )}
    </div>
  )
}
