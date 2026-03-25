import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'

const fmtDateTime = d => d
  ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—'

function ActionBadge({ action }) {
  const styles = {
    create: 'bg-emerald-100 text-emerald-700',
    update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[action] || 'bg-stone-100 text-stone-600'}`}>
      {action}
    </span>
  )
}

function AdminBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      Admin
    </span>
  )
}

function describeChanges(entry) {
  const { action, entity_type, changes } = entry
  if (!changes) return `${action} ${entity_type}`

  if (action === 'update' && typeof changes === 'object') {
    const parts = Object.entries(changes).map(([field, val]) => {
      if (val && val.from !== undefined && val.to !== undefined) {
        return `${field}: ${val.from ?? '—'} → ${val.to ?? '—'}`
      }
      return field
    })
    return parts.join(', ')
  }

  if (action === 'create') {
    const name = changes.name || changes.email || entry.entity_id?.slice(0, 8)
    return name ? `Created ${entity_type}: ${name}` : `Created ${entity_type}`
  }

  if (action === 'delete') {
    return `Deleted ${entity_type}`
  }

  return `${action} ${entity_type}`
}

const PAGE_SIZE = 50

export default function AdminAudit() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()

  const [entries, setEntries]   = useState([])
  const [orgs, setOrgs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [hasMore, setHasMore]   = useState(false)
  const [page, setPage]         = useState(0)

  // Filters — can be seeded from URL params (e.g., ?org_id=xxx from org panel "View all")
  const [filterOrg, setFilterOrg]         = useState(searchParams.get('org_id') || '')
  const [filterAction, setFilterAction]   = useState('')
  const [filterEntity, setFilterEntity]   = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo]   = useState('')

  useEffect(() => {
    supabase.from('organizations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data || []))
  }, [])

  const fetchEntries = useCallback(async (pageNum = 0) => {
    setLoading(true)
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(pageNum * PAGE_SIZE, pageNum * PAGE_SIZE + PAGE_SIZE - 1)

    if (filterOrg) query = query.eq('org_id', filterOrg)
    if (filterAction) query = query.eq('action', filterAction)
    if (filterEntity) query = query.eq('entity_type', filterEntity)
    if (filterDateFrom) query = query.gte('created_at', filterDateFrom)
    if (filterDateTo) query = query.lte('created_at', filterDateTo + 'T23:59:59Z')

    const { data, error } = await query
    if (error) {
      console.error('Failed to load audit log:', error)
      showToast('Failed to load audit log. Please try again.', 'error')
      setLoading(false)
      return
    }
    const results = data || []

    if (pageNum === 0) {
      setEntries(results)
    } else {
      setEntries(prev => [...prev, ...results])
    }
    setHasMore(results.length === PAGE_SIZE)
    setPage(pageNum)
    setLoading(false)
  }, [filterOrg, filterAction, filterEntity, filterDateFrom, filterDateTo])

  useEffect(() => { fetchEntries(0) }, [fetchEntries])

  const SELECT = 'px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600 text-stone-700'

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Audit Log</h1>
        <p className="text-stone-500 text-sm mt-1">All actions across all organizations</p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 mb-6 flex flex-wrap gap-3">
        <select value={filterOrg} onChange={e => setFilterOrg(e.target.value)} className={SELECT}>
          <option value="">All organizations</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className={SELECT}>
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
        </select>

        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} className={SELECT}>
          <option value="">All entity types</option>
          {['organization', 'user', 'client', 'invoice', 'payment', 'quote', 'job', 'worker'].map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
            className={SELECT} placeholder="From"
          />
          <span className="text-stone-400 text-sm">—</span>
          <input
            type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
            className={SELECT} placeholder="To"
          />
        </div>

        {(filterOrg || filterAction || filterEntity || filterDateFrom || filterDateTo) && (
          <button
            onClick={() => { setFilterOrg(''); setFilterAction(''); setFilterEntity(''); setFilterDateFrom(''); setFilterDateTo('') }}
            className="px-3 py-2 text-sm text-stone-500 hover:text-stone-700 border border-stone-200 rounded-xl hover:bg-stone-50"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {loading && entries.length === 0 ? (
        <div className="text-stone-400 text-sm">Loading…</div>
      ) : (
        <>
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Timestamp</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide hidden md:table-cell">Entity</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide hidden lg:table-cell">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className="border-b border-stone-50 last:border-0 hover:bg-stone-50">
                    <td className="px-4 py-3 text-xs text-stone-400 whitespace-nowrap">{fmtDateTime(entry.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-800 text-sm">{entry.user_name}</div>
                      <div className="text-xs text-stone-400 capitalize">{entry.user_role}</div>
                    </td>
                    <td className="px-4 py-3"><ActionBadge action={entry.action} /></td>
                    <td className="px-4 py-3 text-stone-500 capitalize hidden md:table-cell">{entry.entity_type}</td>
                    <td className="px-4 py-3 text-stone-500 hidden lg:table-cell max-w-xs truncate text-xs">{describeChanges(entry)}</td>
                    <td className="px-4 py-3">
                      {entry.is_admin_action && <AdminBadge />}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-400">No audit entries found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              onClick={() => fetchEntries(page + 1)}
              disabled={loading}
              className="mt-4 w-full py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
