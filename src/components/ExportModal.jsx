import { useState } from 'react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

const CATEGORIES = [
  { id: 'clients',  label: 'Clients',       table: 'clients' },
  { id: 'workers',  label: 'Workers',        table: 'users' },
  { id: 'jobs',     label: 'Schedule / Jobs', table: 'jobs' },
  { id: 'quotes',   label: 'Quotes',         table: 'quotes' },
  { id: 'invoices', label: 'Invoices',       table: 'invoices' },
  { id: 'payments', label: 'Payments',       table: 'payments' },
]

// Joins: extra select clause and post-processing to resolve foreign-key names
const JOINS = {
  jobs: {
    select: '*, client:clients(name), assigned_worker:users(name)',
    transform: row => ({
      ...row,
      client_name: row.client?.name ?? '',
      worker_name: row.assigned_worker?.name ?? '',
      client: undefined,
      assigned_worker: undefined,
    }),
  },
  quotes: {
    select: '*, client:clients(name), line_items:quote_line_items(*)',
    transform: row => ({
      ...row,
      client_name: row.client?.name ?? '',
      client: undefined,
      line_items: undefined,
    }),
  },
  invoices: {
    select: '*, client:clients(name), line_items:invoice_line_items(*)',
    transform: row => ({
      ...row,
      client_name: row.client?.name ?? '',
      client: undefined,
      line_items: undefined,
    }),
  },
  payments: {
    select: '*, client:clients(name), job:jobs(date, title)',
    transform: row => ({
      ...row,
      client_name: row.client?.name ?? '',
      job_date:    row.job?.date  ?? '',
      job_title:   row.job?.title ?? '',
      client: undefined,
      job: undefined,
    }),
  },
}

function pad2(n) { return String(n).padStart(2, '0') }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

async function fetchTable(table, orgId, dateFrom, dateTo) {
  const join   = JOINS[table]
  const select = join?.select ?? '*'

  let q = supabase.from(table).select(select).eq('org_id', orgId)

  if (dateFrom) q = q.gte('created_at', dateFrom + 'T00:00:00')
  if (dateTo)   q = q.lte('created_at', dateTo   + 'T23:59:59')

  const { data, error } = await q
  if (error) throw new Error(`${table}: ${error.message}`)

  return (data ?? []).map(row => {
    const transformed = join ? join.transform(row) : row
    // Remove undefined keys
    return Object.fromEntries(
      Object.entries(transformed).filter(([, v]) => v !== undefined)
    )
  })
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href    = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function exportXLSX(sheets, filename) {
  const wb = XLSX.utils.book_new()
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}])
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  const buf  = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  downloadBlob(blob, filename)
}

async function exportCSVZip(sheets, filename) {
  // Dynamically import JSZip to avoid a hard dependency at bundle time
  const JSZip = (await import('jszip')).default
  const zip   = new JSZip()
  for (const { name, rows } of sheets) {
    const ws  = XLSX.utils.json_to_sheet(rows.length ? rows : [{}])
    const csv = XLSX.utils.sheet_to_csv(ws)
    zip.file(`${name}.csv`, csv)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, filename)
}

export default function ExportModal({ user, onClose }) {
  const orgId   = user?.org_id
  const orgName = (user?.organizations?.name ?? 'org').replace(/\s+/g, '-').toLowerCase()

  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [format,     setFormat]     = useState('xlsx')
  const [selected,   setSelected]   = useState(() => Object.fromEntries(CATEGORIES.map(c => [c.id, true])))
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)

  function toggle(id) {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleExport() {
    setLoading(true)
    setError(null)

    try {
      const chosen = CATEGORIES.filter(c => selected[c.id])
      if (!chosen.length) { setError('Select at least one category.'); setLoading(false); return }

      const sheets = await Promise.all(
        chosen.map(async c => ({
          name: c.label.replace(/\s*\/\s*/g, '-'),
          rows: await fetchTable(c.table, orgId, dateFrom, dateTo),
        }))
      )

      const date     = todayStr()
      const basename = `timelyops-export-${orgName}-${date}`

      if (format === 'xlsx') {
        await exportXLSX(sheets, basename + '.xlsx')
      } else {
        await exportCSVZip(sheets, basename + '.zip')
      }

      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-100">
          <h2 className="text-lg font-bold text-stone-900">Export Data</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-100"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Date range */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Date range <span className="text-stone-400 font-normal">(optional — default is all time)</span></label>
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="flex-1 px-3 py-2 border border-stone-200 rounded-xl text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <span className="text-stone-400 text-sm">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="flex-1 px-3 py-2 border border-stone-200 rounded-xl text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Format */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Format</label>
            <div className="flex gap-3">
              {['xlsx', 'csv'].map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-colors ${
                    format === f
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'border-stone-200 text-stone-600 hover:border-stone-300'
                  }`}
                >
                  {f === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.zip)'}
                </button>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-stone-700">Include</label>
              <button
                onClick={() => {
                  const allOn = CATEGORIES.every(c => selected[c.id])
                  setSelected(Object.fromEntries(CATEGORIES.map(c => [c.id, !allOn])))
                }}
                className="text-xs text-emerald-700 hover:underline"
              >
                {CATEGORIES.every(c => selected[c.id]) ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="space-y-1">
              {CATEGORIES.map(c => (
                <label key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-stone-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected[c.id]}
                    onChange={() => toggle(c.id)}
                    className="w-4 h-4 rounded accent-emerald-700"
                  />
                  <span className="text-sm text-stone-700">{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-stone-200 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
