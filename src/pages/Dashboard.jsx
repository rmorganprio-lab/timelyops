import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { todayInTimezone, addDays, currentHourInTimezone, getTimezoneAbbr, formatTime } from '../lib/timezone'
import { useAdminOrg } from '../contexts/AdminOrgContext'
import { useToast } from '../contexts/ToastContext'
import { formatCurrency } from '../lib/formatCurrency'
import { formatName, formatAddress } from '../lib/formatAddress'

export default function Dashboard({ user }) {
  const routerNavigate = useNavigate()
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const timeFormat = user?.organizations?.settings?.time_format || '12h'
  const currencySymbol = user?.organizations?.settings?.currency_symbol || '$'
  const role = user?.role || 'worker'
  const isWorker = role === 'worker'
  const { adminViewOrg } = useAdminOrg()
  const { showToast } = useToast()
  const effectiveOrgId = adminViewOrg?.id ?? user?.org_id

  const [data, setData] = useState({
    todayJobs: [], weekJobs: [], workers: [],
    overdueInvoices: [], recentPayments: [],
    totalClients: 0, totalOutstanding: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadDashboard() }, [effectiveOrgId])

  async function loadDashboard() {
    const today = todayInTimezone(tz)
    const weekEnd = addDays(today, 7)

    const queries = [
      supabase.from('jobs').select('*, clients(name, first_name, last_name, address_line_1, address_line_2, city, state_province, postal_code, country), job_assignments(user_id)').eq('org_id', effectiveOrgId).eq('date', today).neq('status', 'cancelled').order('start_time'),
      supabase.from('jobs').select('*, clients(name, first_name, last_name, address_line_1, address_line_2, city, state_province, postal_code, country)').eq('org_id', effectiveOrgId).gte('date', today).lte('date', weekEnd).neq('status', 'cancelled').order('date').order('start_time'),
      supabase.from('users').select('id, name, role, availability').eq('org_id', effectiveOrgId).in('role', ['ceo', 'manager', 'worker']).order('name'),
      supabase.from('invoices').select('*, clients(name)').eq('org_id', effectiveOrgId).eq('status', 'overdue'),
      supabase.from('payments').select('*, clients(name)').eq('org_id', effectiveOrgId).order('date', { ascending: false }).limit(5),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('org_id', effectiveOrgId),
    ]

    const [jobsToday, jobsWeek, workers, overdue, payments, clients] = await Promise.all(queries)

    const hasError = [jobsToday, jobsWeek, workers, overdue, payments, clients].some(r => r.error)
    if (hasError) {
      const errorResult = [jobsToday, jobsWeek, workers, overdue, payments, clients].find(r => r.error)
      console.error('Dashboard load error:', errorResult.error)
      showToast('Failed to load dashboard data. Please try again.', 'error')
      setLoading(false)
      return
    }

    // Calculate outstanding
    const totalOutstanding = (overdue.data || []).reduce((sum, inv) => sum + Number(inv.total || 0), 0)

    setData({
      todayJobs: jobsToday.data || [],
      weekJobs: jobsWeek.data || [],
      workers: workers.data || [],
      overdueInvoices: overdue.data || [],
      recentPayments: payments.data || [],
      totalClients: clients.count || 0,
      totalOutstanding,
    })
    setLoading(false)
  }

  const greeting = () => {
    const hour = currentHourInTimezone(tz)
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const firstName = user?.name?.split(' ')[0] || user?.organizations?.name?.split(' ')[0] || 'there'
  const today = todayInTimezone(tz)

  // Group today's jobs by worker
  function getJobsByWorker() {
    const byWorker = {}
    const unassigned = []

    data.todayJobs.forEach(job => {
      const assignments = job.job_assignments || []
      if (assignments.length === 0) {
        unassigned.push(job)
      } else {
        assignments.forEach(a => {
          if (!byWorker[a.user_id]) byWorker[a.user_id] = []
          byWorker[a.user_id].push(job)
        })
      }
    })

    return { byWorker, unassigned }
  }

  // For workers, filter to only their jobs
  function getMyJobs() {
    return data.todayJobs.filter(job => 
      job.job_assignments?.some(a => a.user_id === user.id)
    )
  }

  function handleJobClick(job) {
    routerNavigate('/schedule', { state: { jobId: job.id } })
  }

  if (loading) {
    return <div className="p-6 md:p-8 text-stone-400">Loading...</div>
  }

  // ── Worker Dashboard (simplified) ──
  if (isWorker) {
    const myJobs = getMyJobs()
    return (
      <div className="p-6 md:p-8 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-stone-900">{greeting()}, {firstName}</h1>
          <p className="text-stone-500 text-sm mt-1">
            {myJobs.length === 0 ? 'No jobs today' : `${myJobs.length} job${myJobs.length > 1 ? 's' : ''} today`}
          </p>
        </div>

        {myJobs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <div className="text-stone-600 font-medium">No jobs scheduled today</div>
            <div className="text-stone-400 text-sm mt-1">Enjoy your day off!</div>
          </div>
        ) : (
          <div className="space-y-3">
            {myJobs.map((job, idx) => (
              <JobCard key={job.id} job={job} isNext={idx === 0 && job.status === 'scheduled'} tz={tz} user={user} onUpdate={loadDashboard} onJobClick={() => handleJobClick(job)} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Owner/Manager Dashboard (morning briefing) ──
  const { byWorker, unassigned } = getJobsByWorker()
  const completedToday = data.todayJobs.filter(j => j.status === 'completed').length
  const inProgressToday = data.todayJobs.filter(j => j.status === 'in_progress').length
  const scheduledToday = data.todayJobs.filter(j => j.status === 'scheduled').length

  // Owner/manager's own assigned jobs (they might also be working today)
  const myJobs = getMyJobs()

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900">{greeting()}, {firstName}</h1>
        <p className="text-stone-500 text-sm mt-1">
          {new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          <span className="text-stone-300 mx-1.5">·</span>
          <span className="text-stone-400">{getTimezoneAbbr(tz)}</span>
        </p>
      </div>

      {/* My Jobs Today — shown when owner/manager has assigned jobs */}
      {myJobs.length > 0 && (
        <div className="mb-8">
          <h2 className="font-semibold text-stone-900 mb-3">My Jobs Today</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {myJobs.map((job, idx) => (
              <JobCard key={job.id} job={job} isNext={idx === 0 && job.status === 'scheduled'} tz={tz} user={user} onUpdate={loadDashboard} onJobClick={() => handleJobClick(job)} />
            ))}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Today's Jobs" value={data.todayJobs.length} sub={
          <span className="text-xs">
            {scheduledToday > 0 && <span className="text-blue-600">{scheduledToday} upcoming</span>}
            {inProgressToday > 0 && <span className="text-amber-600">{scheduledToday > 0 ? ' · ' : ''}{inProgressToday} active</span>}
            {completedToday > 0 && <span className="text-emerald-600">{(scheduledToday > 0 || inProgressToday > 0) ? ' · ' : ''}{completedToday} done</span>}
          </span>
        } />
        <StatCard label="This Week" value={data.weekJobs.length} />
        <StatCard label="Overdue" value={data.overdueInvoices.length} alert={data.overdueInvoices.length > 0} sub={
          data.totalOutstanding > 0 ? <span className="text-xs text-red-500">{formatCurrency(data.totalOutstanding.toFixed(0), currencySymbol)} outstanding</span> : null
        } />
        <StatCard label="Total Clients" value={data.totalClients} />
      </div>

      {/* ── Today's Team View ── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-stone-900">Today's Schedule by Team</h2>
          <Link to="/schedule" className="text-sm text-emerald-700 hover:text-emerald-800 font-medium">View full schedule →</Link>
        </div>

        {data.todayJobs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center">
            <div className="text-stone-400 text-sm">No jobs scheduled for today.</div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Worker columns */}
            {data.workers.filter(w => byWorker[w.id]?.length > 0).map(worker => (
              <div key={worker.id} className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
                {/* Worker header */}
                <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                      worker.availability === 'available' ? 'bg-emerald-100 text-emerald-700' :
                      worker.availability === 'vacation' ? 'bg-blue-100 text-blue-700' :
                      'bg-stone-100 text-stone-500'
                    }`}>
                      {worker.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-stone-900">{worker.name}</div>
                      <div className="text-[10px] text-stone-400 capitalize">{worker.role === 'ceo' ? 'Owner' : worker.role}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="text-xs text-stone-400">{byWorker[worker.id].length} jobs</div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-300"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                </div>

                {/* Worker's jobs */}
                <div className="p-2 space-y-1.5">
                  {byWorker[worker.id].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')).map(job => (
                    <div key={job.id} onClick={() => handleJobClick(job)} className={`px-3 py-2.5 rounded-xl text-xs cursor-pointer hover:shadow-sm transition-shadow ${
                      job.status === 'completed' ? 'bg-emerald-50 border border-emerald-100' :
                      job.status === 'in_progress' ? 'bg-amber-50 border border-amber-100' :
                      'bg-blue-50 border border-blue-100'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-stone-800">{formatTime(job.start_time, timeFormat)}</div>
                        <StatusDot status={job.status} />
                      </div>
                      <div className="text-stone-600 mt-0.5">{job.title}</div>
                      <div className="text-stone-400 mt-0.5">{formatName(job.clients?.first_name, job.clients?.last_name) || job.clients?.name}</div>
                      {(formatAddress(job.clients || {}) || job.clients?.address) && <div className="text-stone-300 mt-0.5 text-[10px]">{formatAddress(job.clients || {}) || job.clients?.address}</div>}
                      {job.price && <div className="text-stone-500 font-medium mt-1">{formatCurrency(job.price, currencySymbol)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Unassigned jobs */}
            {unassigned.length > 0 && (
              <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-100 bg-amber-50">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600 text-sm">⚠</span>
                    <div className="text-sm font-semibold text-amber-800">Unassigned</div>
                  </div>
                </div>
                <div className="p-2 space-y-1.5">
                  {unassigned.map(job => (
                    <div key={job.id} onClick={() => handleJobClick(job)} className="px-3 py-2.5 rounded-xl bg-amber-50/50 border border-amber-100 text-xs cursor-pointer hover:shadow-sm transition-shadow">
                      <div className="font-medium text-stone-800">{formatTime(job.start_time, timeFormat)} — {job.title}</div>
                      <div className="text-stone-500">{formatName(job.clients?.first_name, job.clients?.last_name) || job.clients?.name}</div>
                      {(formatAddress(job.clients || {}) || job.clients?.address) && <div className="text-stone-400 text-[10px] mt-0.5">{formatAddress(job.clients || {}) || job.clients?.address}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workers with no jobs today */}
            {data.workers.filter(w => !byWorker[w.id] && w.availability === 'available').length > 0 && (
              <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-stone-100">
                  <div className="text-sm font-semibold text-stone-500">Available — No Jobs</div>
                </div>
                <div className="p-3 space-y-2">
                  {data.workers.filter(w => !byWorker[w.id] && w.availability === 'available').map(w => (
                    <div key={w.id} className="flex items-center gap-2 text-xs text-stone-400">
                      <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 font-medium text-[10px]">
                        {w.name.charAt(0)}
                      </div>
                      {w.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Overdue Invoices ── */}
      {data.overdueInvoices.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-red-800">Overdue Payments</h2>
            <Link to="/payments" className="text-sm text-red-600 hover:text-red-700 font-medium">View all →</Link>
          </div>
          <div className="bg-red-50 rounded-2xl border border-red-200 divide-y divide-red-100">
            {data.overdueInvoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm font-medium text-stone-900">{inv.clients?.name}</div>
                  <div className="text-xs text-stone-500">#{inv.invoice_number}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-red-700">{formatCurrency(inv.total, currencySymbol)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Payments ── */}
      {data.recentPayments.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-stone-900">Recent Payments</h2>
            <Link to="/payments" className="text-sm text-emerald-700 hover:text-emerald-800 font-medium">View all →</Link>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 divide-y divide-stone-100">
            {data.recentPayments.map(p => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm font-medium text-stone-900">{p.clients?.name}</div>
                  <div className="text-xs text-stone-400 capitalize">{p.method} · {p.date}</div>
                </div>
                <div className="text-sm font-semibold text-emerald-700">+{formatCurrency(p.amount, currencySymbol)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Components ──

function StatCard({ label, value, sub, alert }) {
  return (
    <div className={`rounded-2xl border p-4 ${alert ? 'bg-red-50 border-red-200' : 'bg-white border-stone-200'}`}>
      <div className="text-xs font-medium text-stone-500 mb-1.5">{label}</div>
      <div className={`text-2xl font-bold ${alert ? 'text-red-700' : 'text-stone-900'}`}>{value}</div>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  )
}

function StatusDot({ status }) {
  const colors = {
    scheduled: 'bg-blue-500',
    in_progress: 'bg-amber-500 animate-pulse',
    completed: 'bg-emerald-500',
    cancelled: 'bg-stone-300',
  }
  return <div className={`w-2 h-2 rounded-full ${colors[status] || colors.scheduled}`} />
}

function JobCard({ job, isNext, tz, user, onUpdate, onJobClick }) {
  const [step, setStep] = useState('idle') // idle | askPayment | paymentForm | done
  const [payAmount, setPayAmount] = useState(job.price ? String(job.price) : '')
  const currencySymbol = user?.organizations?.settings?.currency_symbol || '$'
  const paymentMethods = user?.organizations?.settings?.payment_methods || ['Cash', 'Venmo', 'Zelle', 'Card', 'Check']
  const [payMethod, setPayMethod] = useState(paymentMethods[0] || 'Cash')
  const [saving, setSaving] = useState(false)

  async function handleArrive() {
    await supabase.from('jobs').update({ status: 'in_progress', arrived_at: new Date().toISOString() }).eq('id', job.id)
    onUpdate?.()
  }

  async function handleComplete() {
    await supabase.from('jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', job.id)
    // Immediately ask about payment
    setStep('askPayment')
  }

  function handleNoPayment() {
    setStep('done')
    onUpdate?.()
  }

  function handleYesPayment() {
    setStep('paymentForm')
  }

  async function handleRecordPayment() {
    if (!payAmount || Number(payAmount) <= 0) return
    setSaving(true)
    await supabase.from('payments').insert({
      org_id: user.org_id,
      client_id: job.client_id,
      job_id: job.id,
      amount: Number(payAmount),
      method: payMethod,
      date: todayInTimezone(user?.organizations?.settings?.timezone || 'America/Los_Angeles'),
      notes: `Payment for ${job.title}`,
    })
    await supabase.from('client_timeline').insert({
      org_id: user.org_id,
      client_id: job.client_id,
      event_type: 'payment',
      summary: `${formatCurrency(payAmount, currencySymbol)} received via ${payMethod}`,
      created_by: user.id,
    })
    setSaving(false)
    setStep('done')
    onUpdate?.()
  }

  return (
    <div className={`bg-white rounded-2xl border p-5 ${
      isNext ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-stone-200'
    }`}>
      {isNext && <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-2">Up Next</div>}
      <div className="flex items-start justify-between cursor-pointer" onClick={() => onJobClick?.()}>
        <div>
          <div className="font-semibold text-stone-900">{job.title}</div>
          <div className="text-sm text-stone-500 mt-0.5">{formatName(job.clients?.first_name, job.clients?.last_name) || job.clients?.name}</div>
          {(formatAddress(job.clients || {}) || job.clients?.address) && <div className="text-xs text-stone-400 mt-0.5">{formatAddress(job.clients || {}) || job.clients?.address}</div>}
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-stone-700">{formatTime(job.start_time, timeFormat)}</div>
          <div className="text-xs text-stone-400">{job.duration_minutes}min</div>
        </div>
      </div>
      {job.price && <div className="text-sm font-medium text-stone-600 mt-2">{formatCurrency(job.price, currencySymbol)}</div>}
      
      {/* Actions */}
      <div className="mt-4 pt-3 border-t border-stone-100">

        {/* Scheduled → Arrived */}
        {job.status === 'scheduled' && step === 'idle' && (
          <button onClick={handleArrive} className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors">
            Arrived
          </button>
        )}

        {/* In Progress → Completed (triggers payment question) */}
        {job.status === 'in_progress' && step === 'idle' && (
          <button onClick={handleComplete} className="w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
            Completed
          </button>
        )}

        {/* Step: Ask about payment */}
        {step === 'askPayment' && (
          <div className="space-y-3">
            <div className="text-center">
              <div className="text-emerald-600 text-sm font-medium mb-3">✓ Job completed</div>
              <div className="text-sm font-medium text-stone-700">Did you receive payment?</div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleYesPayment} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
                Yes
              </button>
              <button onClick={handleNoPayment} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">
                No
              </button>
            </div>
          </div>
        )}

        {/* Step: Payment form */}
        {step === 'paymentForm' && (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium text-stone-700">Amount received</div>
              {job.price && <div className="text-xs text-stone-400 mt-0.5">Job total: {formatCurrency(job.price, currencySymbol)}</div>}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">{currencySymbol}</span>
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" step="0.01" className="w-full pl-7 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </div>
            {job.price && payAmount && Number(payAmount) < Number(job.price) && (
              <div className="text-xs text-amber-600">Partial payment — {formatCurrency(Number(job.price) - Number(payAmount), currencySymbol)} remaining</div>
            )}
            {job.price && payAmount && Number(payAmount) > Number(job.price) && (
              <div className="text-xs text-blue-600">Overpayment of {formatCurrency(Number(payAmount) - Number(job.price), currencySymbol)} — includes tip or credit</div>
            )}
            <div className="flex flex-wrap gap-2">
              {paymentMethods.map(m => (
                <button key={m} onClick={() => setPayMethod(m)} className={`px-3 py-2 text-sm font-medium rounded-xl transition-colors min-h-[44px] ${
                  payMethod === m ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}>{m}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('askPayment')} className="flex-1 py-2 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Back</button>
              <button onClick={handleRecordPayment} disabled={saving || !payAmount} className="flex-1 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </div>
        )}

        {/* Already completed (loaded from DB or after flow) */}
        {job.status === 'completed' && step === 'idle' && (
          <div className="py-2.5 text-center text-emerald-600 text-sm font-medium">✓ Done</div>
        )}

        {/* Just finished the flow */}
        {step === 'done' && (
          <div className="py-2.5 text-center text-emerald-600 text-sm font-medium">✓ Done</div>
        )}
      </div>
    </div>
  )
}
