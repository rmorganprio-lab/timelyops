import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { todayInTimezone, formatDate, formatTime, formatTimestamp, addDays, toDateStr } from '../lib/timezone'
import ExportModal from '../components/ExportModal'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

// ─── Helpers ─────────────────────────────────────────────────

function fmtMoney(n) { return '$' + Number(n || 0).toFixed(2) }

function fmtMins(mins) {
  if (mins === null || mins === undefined) return '—'
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.abs(mins) % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function minutesBetween(a, b) {
  if (!a || !b) return null
  return Math.round((new Date(b) - new Date(a)) / 60000)
}

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  d.setDate(d.getDate() + diff)
  return toDateStr(d)
}

function getWeekDays(mondayStr) {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayStr, i))
}

// Convert arrived_at UTC timestamp → minutes from midnight in org tz
function arrivedMinutes(arrivedAt, timezone) {
  if (!arrivedAt) return null
  const d = new Date(arrivedAt)
  const h = parseInt(new Intl.DateTimeFormat('en', { timeZone: timezone, hour: '2-digit', hour12: false }).format(d))
  const m = parseInt(new Intl.DateTimeFormat('en', { timeZone: timezone, minute: '2-digit' }).format(d))
  return h * 60 + m
}

function startTimeMinutes(startTime) {
  if (!startTime) return null
  const [h, m] = startTime.slice(0, 5).split(':').map(Number)
  return h * 60 + (m || 0)
}

function isLate(job, timezone) {
  if (!job.arrived_at || !job.start_time) return false
  const arrived = arrivedMinutes(job.arrived_at, timezone)
  const scheduled = startTimeMinutes(job.start_time)
  if (arrived === null || scheduled === null) return false
  return arrived > scheduled + 15
}

function lateMinutes(job, timezone) {
  const arrived = arrivedMinutes(job.arrived_at, timezone)
  const scheduled = startTimeMinutes(job.start_time)
  if (arrived === null || scheduled === null) return 0
  return Math.max(0, arrived - scheduled)
}

// ─── Shared UI ────────────────────────────────────────────────

function MetricCard({ label, value, sub, subColor = 'text-stone-400' }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-4">
      <div className="text-xs font-medium text-stone-500 mb-2">{label}</div>
      <div className="text-2xl font-bold text-stone-900">{value}</div>
      {sub && <div className={`text-xs mt-1 ${subColor}`}>{sub}</div>}
    </div>
  )
}

function SectionTitle({ children }) {
  return <h3 className="text-sm font-semibold text-stone-700 mb-3">{children}</h3>
}

function EmptyState({ message }) {
  return <div className="text-center py-10 text-stone-400 text-sm">{message}</div>
}

function PrevNext({ onPrev, onNext, label, onReset, resetLabel }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <button onClick={onPrev} className="p-2 rounded-xl border border-stone-200 hover:bg-stone-100 transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span className="text-sm font-medium text-stone-700 min-w-[200px] text-center">{label}</span>
      <button onClick={onNext} className="p-2 rounded-xl border border-stone-200 hover:bg-stone-100 transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      {onReset && (
        <button onClick={onReset} className="text-xs text-emerald-700 hover:underline">{resetLabel}</button>
      )}
    </div>
  )
}

const EMERALD = '#047857'
const PIE_COLORS = ['#047857', '#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0']

// ─── DAILY TAB ───────────────────────────────────────────────

function DailyTab({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const today = todayInTimezone(tz)
  const [date, setDate] = useState(today)
  const [jobs, setJobs] = useState([])
  const [payments, setPayments] = useState([])
  const [workers, setWorkers] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { load(date) }, [date])

  async function load(d) {
    setLoading(true)
    const [jobsRes, paymentsRes, usersRes] = await Promise.all([
      supabase.from('jobs').select('*, clients(name)').eq('date', d).order('start_time'),
      supabase.from('payments').select('amount, job_id, client_id').eq('date', d),
      supabase.from('users').select('id, name'),
    ])
    const wMap = {}
    ;(usersRes.data || []).forEach(u => { wMap[u.id] = u.name })
    setWorkers(wMap)
    setJobs(jobsRes.data || [])
    setPayments(paymentsRes.data || [])
    setLoading(false)
  }

  const completed = jobs.filter(j => j.status === 'completed')
  const arrived = jobs.filter(j => j.arrived_at)
  const pending = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled')
  const unassigned = pending.filter(j => !j.worker_id)
  const onTimeCount = arrived.filter(j => !isLate(j, tz)).length
  const lateCount = arrived.filter(j => isLate(j, tz)).length
  const totalRevenue = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const completionRate = jobs.length > 0 ? Math.round((completed.length / jobs.length) * 100) : 0

  function isPaid(job) {
    return payments.some(p => p.job_id === job.id || p.client_id === job.client_id)
  }

  function rowAccent(job) {
    if (job.status === 'scheduled' && job.date <= today && !job.arrived_at)
      return 'border-l-4 border-l-red-400'
    if (job.status === 'completed') {
      const bad = (job.arrived_at && isLate(job, tz)) || !isPaid(job)
      return bad ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-emerald-400'
    }
    return ''
  }

  return (
    <div>
      {/* Date selector */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setDate(addDays(date, -1))} className="p-2 rounded-xl border border-stone-200 hover:bg-stone-100 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
        <button onClick={() => setDate(addDays(date, 1))} className="p-2 rounded-xl border border-stone-200 hover:bg-stone-100 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        {date !== today && (
          <button onClick={() => setDate(today)} className="text-xs text-emerald-700 hover:underline">Today</button>
        )}
      </div>

      {loading ? (
        <div className="text-stone-400 text-sm py-8 text-center">Loading...</div>
      ) : (
        <>
          {/* Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricCard
              label="Jobs Completed"
              value={`${completed.length} / ${jobs.length}`}
              sub={`${completionRate}% completion rate`}
              subColor={completionRate >= 90 ? 'text-emerald-600' : completionRate >= 70 ? 'text-amber-600' : 'text-red-500'}
            />
            <MetricCard
              label="Revenue Collected"
              value={fmtMoney(totalRevenue)}
              sub={`${payments.length} payment${payments.length !== 1 ? 's' : ''}`}
            />
            <MetricCard
              label="On-Time Arrivals"
              value={`${onTimeCount} / ${arrived.length}`}
              sub={lateCount > 0 ? `${lateCount} late arrival${lateCount !== 1 ? 's' : ''}` : arrived.length > 0 ? 'All on time' : 'No arrivals yet'}
              subColor={lateCount > 0 ? 'text-amber-600' : 'text-emerald-600'}
            />
            <MetricCard
              label="Pending Jobs"
              value={pending.length}
              sub={unassigned.length > 0 ? `${unassigned.length} unassigned` : pending.length > 0 ? 'All assigned' : 'None pending'}
              subColor={unassigned.length > 0 ? 'text-amber-600' : 'text-stone-400'}
            />
          </div>

          {/* Job detail table */}
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-100">
              <SectionTitle>Today's Job Details — {formatDate(date)}</SectionTitle>
            </div>
            {jobs.length === 0 ? (
              <EmptyState message="No jobs scheduled for this date." />
            ) : (
              <div>
                <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-stone-100 text-xs font-semibold text-stone-400 uppercase tracking-wider">
                  <div className="col-span-2">Worker</div>
                  <div className="col-span-2">Client</div>
                  <div className="col-span-1">Sched</div>
                  <div className="col-span-1">Arrived</div>
                  <div className="col-span-1">Done</div>
                  <div className="col-span-2">Duration</div>
                  <div className="col-span-1">Status</div>
                  <div className="col-span-2">Payment</div>
                </div>
                {jobs.map(job => {
                  const actualMins = minutesBetween(job.arrived_at, job.completed_at)
                  const late = job.arrived_at && isLate(job, tz)
                  const paid = isPaid(job)
                  return (
                    <div key={job.id} className={`grid grid-cols-12 gap-3 px-5 py-3.5 border-b border-stone-50 items-center text-sm ${rowAccent(job)}`}>
                      <div className="col-span-2 font-medium text-stone-700 truncate">
                        {workers[job.worker_id] || <span className="text-stone-400 italic text-xs">Unassigned</span>}
                      </div>
                      <div className="col-span-2 text-stone-600 truncate">{job.clients?.name || '—'}</div>
                      <div className="col-span-1 text-stone-500 text-xs">{job.start_time ? formatTime(job.start_time) : '—'}</div>
                      <div className={`col-span-1 text-xs ${late ? 'text-amber-600' : 'text-stone-500'}`}>
                        {job.arrived_at ? formatTimestamp(job.arrived_at, tz) : '—'}
                        {late && <div className="text-[10px]">+{lateMinutes(job, tz)}m</div>}
                      </div>
                      <div className="col-span-1 text-stone-500 text-xs">
                        {job.completed_at ? formatTimestamp(job.completed_at, tz) : '—'}
                      </div>
                      <div className="col-span-2 text-stone-500 text-xs">
                        {actualMins !== null
                          ? <>{fmtMins(actualMins)} <span className="text-stone-300">/ est {fmtMins(job.duration_minutes)}</span></>
                          : job.duration_minutes ? <span className="text-stone-300">est {fmtMins(job.duration_minutes)}</span> : '—'}
                      </div>
                      <div className="col-span-1">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          job.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                          job.status === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                          'bg-stone-100 text-stone-500'
                        }`}>{job.status}</span>
                      </div>
                      <div className="col-span-2 text-xs">
                        {paid
                          ? <span className="font-medium text-emerald-600">✓ Paid</span>
                          : job.status === 'completed'
                            ? <span className="font-medium text-amber-600">Unpaid</span>
                            : <span className="text-stone-300">—</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── WEEKLY TAB ──────────────────────────────────────────────

function WeeklyTab({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const today = todayInTimezone(tz)
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(today))
  const [jobs, setJobs] = useState([])
  const [payments, setPayments] = useState([])
  const [workers, setWorkers] = useState({})
  const [loading, setLoading] = useState(true)

  const weekEnd = addDays(weekStart, 6)
  const weekDays = getWeekDays(weekStart)
  const thisWeek = getMondayOfWeek(today)

  useEffect(() => { load() }, [weekStart])

  async function load() {
    setLoading(true)
    const [jobsRes, paymentsRes, usersRes] = await Promise.all([
      supabase.from('jobs').select('*, clients(name)').gte('date', weekStart).lte('date', weekEnd).order('date'),
      supabase.from('payments').select('amount, date, job_id, client_id').gte('date', weekStart).lte('date', weekEnd),
      supabase.from('users').select('id, name'),
    ])
    const wMap = {}
    ;(usersRes.data || []).forEach(u => { wMap[u.id] = u.name })
    setWorkers(wMap)
    setJobs(jobsRes.data || [])
    setPayments(paymentsRes.data || [])
    setLoading(false)
  }

  const completed = jobs.filter(j => j.status === 'completed')
  const totalRevenue = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const avgJobValue = completed.length > 0 ? totalRevenue / completed.length : 0
  const activeClientIds = new Set(jobs.map(j => j.client_id))

  const revenueByDay = weekDays.map(d => ({
    day: new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    revenue: payments.filter(p => p.date === d).reduce((s, p) => s + Number(p.amount || 0), 0),
    jobs: jobs.filter(j => j.date === d).length,
  }))

  // Jobs by worker
  const workerStats = {}
  jobs.forEach(j => {
    if (!j.worker_id) return
    if (!workerStats[j.worker_id]) workerStats[j.worker_id] = { jobs: 0, revenue: 0, mins: 0, minsCount: 0 }
    workerStats[j.worker_id].jobs++
    payments.filter(p => p.job_id === j.id).forEach(p => { workerStats[j.worker_id].revenue += Number(p.amount || 0) })
    const dur = minutesBetween(j.arrived_at, j.completed_at)
    if (dur !== null) { workerStats[j.worker_id].mins += dur; workerStats[j.worker_id].minsCount++ }
  })
  const workerRows = Object.entries(workerStats)
    .map(([id, s]) => ({ name: workers[id] || 'Unknown', ...s, avg: s.minsCount > 0 ? Math.round(s.mins / s.minsCount) : null }))
    .sort((a, b) => b.jobs - a.jobs)

  // Top clients
  const clientStats = {}
  jobs.forEach(j => {
    if (!clientStats[j.client_id]) clientStats[j.client_id] = { name: j.clients?.name || 'Unknown', jobs: 0, revenue: 0 }
    clientStats[j.client_id].jobs++
    payments.filter(p => p.job_id === j.id).forEach(p => { clientStats[j.client_id].revenue += Number(p.amount || 0) })
  })
  const clientRows = Object.values(clientStats).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

  const weekLabel = `${formatDate(weekStart, { month: 'short', day: 'numeric' })} – ${formatDate(weekEnd, { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div>
      <PrevNext
        onPrev={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
        label={weekLabel}
        onReset={weekStart !== thisWeek ? () => setWeekStart(thisWeek) : null}
        resetLabel="This week"
      />

      {loading ? (
        <div className="text-stone-400 text-sm py-8 text-center">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricCard label="Total Revenue" value={fmtMoney(totalRevenue)} />
            <MetricCard label="Total Jobs" value={jobs.length} sub={`${completed.length} completed`} />
            <MetricCard label="Avg Job Value" value={avgJobValue > 0 ? fmtMoney(avgJobValue) : '—'} />
            <MetricCard label="Active Clients" value={activeClientIds.size} />
          </div>

          {/* Revenue by day */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-6">
            <SectionTitle>Revenue by Day</SectionTitle>
            {totalRevenue === 0 ? (
              <EmptyState message="No payments recorded this week." />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={revenueByDay} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#78716c' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#a8a29e' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={48} />
                  <Tooltip
                    formatter={v => [`$${Number(v).toFixed(2)}`, 'Revenue']}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e7e5e0', fontSize: 12 }}
                  />
                  <Bar dataKey="revenue" fill={EMERALD} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Jobs by worker */}
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-100"><SectionTitle>Jobs by Worker</SectionTitle></div>
              {workerRows.length === 0 ? <EmptyState message="No worker data." /> : (
                <div>
                  <div className="grid grid-cols-4 gap-2 px-4 py-2.5 border-b border-stone-100 text-xs font-semibold text-stone-400 uppercase">
                    <div>Worker</div><div className="text-right">Jobs</div><div className="text-right">Revenue</div><div className="text-right">Avg Time</div>
                  </div>
                  {workerRows.map((w, i) => (
                    <div key={i} className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-stone-50 text-sm items-center">
                      <div className="font-medium text-stone-700 truncate">{w.name}</div>
                      <div className="text-right text-stone-600">{w.jobs}</div>
                      <div className="text-right text-stone-600">{fmtMoney(w.revenue)}</div>
                      <div className="text-right text-stone-400">{w.avg !== null ? fmtMins(w.avg) : '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top clients */}
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-stone-100"><SectionTitle>Top Clients</SectionTitle></div>
              {clientRows.length === 0 ? <EmptyState message="No client data." /> : (
                <div>
                  <div className="grid grid-cols-3 gap-2 px-4 py-2.5 border-b border-stone-100 text-xs font-semibold text-stone-400 uppercase">
                    <div>Client</div><div className="text-right">Jobs</div><div className="text-right">Revenue</div>
                  </div>
                  {clientRows.map((c, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-stone-50 text-sm items-center">
                      <div className="font-medium text-stone-700 truncate">{c.name}</div>
                      <div className="text-right text-stone-600">{c.jobs}</div>
                      <div className="text-right text-stone-600">{fmtMoney(c.revenue)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── MONTHLY TAB ─────────────────────────────────────────────

function MonthlyTab({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const now = new Date(todayInTimezone(tz) + 'T12:00:00')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  function monthBounds(y, m) {
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
    return { start, end }
  }

  function prevMonth() { month === 1 ? (setYear(y => y - 1), setMonth(12)) : setMonth(m => m - 1) }
  function nextMonth() { month === 12 ? (setYear(y => y + 1), setMonth(1)) : setMonth(m => m + 1) }

  useEffect(() => { load() }, [year, month])

  async function load() {
    setLoading(true)
    const { start, end } = monthBounds(year, month)
    const pm = month === 1 ? 12 : month - 1
    const py = month === 1 ? year - 1 : year
    const { start: pStart, end: pEnd } = monthBounds(py, pm)

    const [jobsRes, prevJobsRes, paymentsRes, prevPaymentsRes, usersRes] = await Promise.all([
      supabase.from('jobs').select('*, clients(name)').gte('date', start).lte('date', end),
      supabase.from('jobs').select('id, client_id, date, worker_id, arrived_at, completed_at, duration_minutes').gte('date', pStart).lte('date', pEnd),
      supabase.from('payments').select('amount, date, job_id, client_id').gte('date', start).lte('date', end),
      supabase.from('payments').select('amount, client_id').gte('date', pStart).lte('date', pEnd),
      supabase.from('users').select('id, name'),
    ])

    const wMap = {}
    ;(usersRes.data || []).forEach(u => { wMap[u.id] = u.name })

    setData({
      jobs: jobsRes.data || [],
      prevJobs: prevJobsRes.data || [],
      payments: paymentsRes.data || [],
      prevPayments: prevPaymentsRes.data || [],
      workers: wMap,
    })
    setLoading(false)
  }

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  if (loading || !data) {
    return (
      <div>
        <PrevNext onPrev={prevMonth} onNext={nextMonth} label={monthLabel} />
        <div className="text-stone-400 text-sm py-8 text-center">Loading...</div>
      </div>
    )
  }

  const { jobs, prevJobs, payments, prevPayments, workers } = data

  const totalRevenue = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const prevRevenue = prevPayments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const revenueChangePct = prevRevenue > 0 ? (totalRevenue - prevRevenue) / prevRevenue * 100 : null

  const completed = jobs.filter(j => j.status === 'completed')
  const prevCompleted = prevJobs.filter(j => j.status === 'completed')
  const jobsDelta = completed.length - prevCompleted.length

  const activeClients = new Set(jobs.map(j => j.client_id))
  const prevActiveClients = new Set(prevJobs.map(j => j.client_id))
  const newClients = [...activeClients].filter(id => !prevActiveClients.has(id))
  const returningClients = [...activeClients].filter(id => prevActiveClients.has(id)).length
  const churnedClients = [...prevActiveClients].filter(id => !activeClients.has(id)).length

  const avgJobValue = completed.length > 0 ? totalRevenue / completed.length : 0
  const prevAvgJobValue = prevCompleted.length > 0 ? prevRevenue / prevCompleted.length : 0
  const avgDelta = prevAvgJobValue > 0 ? avgJobValue - prevAvgJobValue : null

  // Revenue by service type (grouped by job title, top 5 + Other)
  const serviceRevenue = {}
  payments.forEach(p => {
    const job = jobs.find(j => j.id === p.job_id)
    const key = job?.title || 'Other'
    serviceRevenue[key] = (serviceRevenue[key] || 0) + Number(p.amount || 0)
  })
  const sorted = Object.entries(serviceRevenue).sort((a, b) => b[1] - a[1])
  const top5 = sorted.slice(0, 5)
  const otherRev = sorted.slice(5).reduce((s, [, v]) => s + v, 0)
  const pieData = [...top5.map(([name, value]) => ({ name, value })), ...(otherRev > 0 ? [{ name: 'Other', value: otherRev }] : [])]

  // Revenue by client
  const clientRevenue = {}
  payments.forEach(p => {
    const job = jobs.find(j => j.id === p.job_id)
    if (!clientRevenue[p.client_id]) clientRevenue[p.client_id] = { name: job?.clients?.name || 'Unknown', jobs: 0, revenue: 0 }
    clientRevenue[p.client_id].revenue += Number(p.amount || 0)
    if (job) clientRevenue[p.client_id].jobs++
  })
  const clientRows = Object.values(clientRevenue).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
  const totalForPct = clientRows.reduce((s, c) => s + c.revenue, 0)

  // Revenue by worker
  const workerRevenue = {}
  jobs.forEach(j => {
    if (!j.worker_id) return
    if (!workerRevenue[j.worker_id]) workerRevenue[j.worker_id] = { name: workers[j.worker_id] || 'Unknown', jobs: 0, revenue: 0, mins: 0, minsCount: 0, onTime: 0, arrived: 0 }
    const s = workerRevenue[j.worker_id]
    s.jobs++
    payments.filter(p => p.job_id === j.id).forEach(p => { s.revenue += Number(p.amount || 0) })
    const dur = minutesBetween(j.arrived_at, j.completed_at)
    if (dur !== null) { s.mins += dur; s.minsCount++ }
    if (j.arrived_at) { s.arrived++; if (!isLate(j, tz)) s.onTime++ }
  })
  const workerRows = Object.values(workerRevenue).sort((a, b) => b.jobs - a.jobs)

  function DeltaBadge({ value, pct = false, higherIsBetter = true }) {
    if (value === null || value === 0) return null
    const good = higherIsBetter ? value > 0 : value < 0
    const color = good ? 'text-emerald-600' : 'text-red-500'
    const sign = value > 0 ? '+' : ''
    const display = pct ? `${sign}${value.toFixed(1)}%` : `${sign}${fmtMoney(Math.abs(value))}`
    return <span className={`text-xs ${color}`}>{display} vs last month</span>
  }

  return (
    <div>
      <PrevNext onPrev={prevMonth} onNext={nextMonth} label={monthLabel} />

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-2">Total Revenue</div>
          <div className="text-2xl font-bold text-stone-900">{fmtMoney(totalRevenue)}</div>
          <div className="mt-1"><DeltaBadge value={revenueChangePct} pct /></div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-2">Total Jobs</div>
          <div className="text-2xl font-bold text-stone-900">{completed.length}</div>
          <div className="mt-1"><DeltaBadge value={jobsDelta} /></div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-2">Active Clients</div>
          <div className="text-2xl font-bold text-stone-900">{activeClients.size}</div>
          {newClients.length > 0 && <div className="text-xs text-emerald-600 mt-1">{newClients.length} new this month</div>}
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-2">Avg Job Value</div>
          <div className="text-2xl font-bold text-stone-900">{avgJobValue > 0 ? fmtMoney(avgJobValue) : '—'}</div>
          <div className="mt-1"><DeltaBadge value={avgDelta} /></div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-5">
          <SectionTitle>Revenue by Service Type</SectionTitle>
          {pieData.length === 0 ? (
            <EmptyState message="No payment data this month." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => fmtMoney(v)} contentStyle={{ borderRadius: '12px', border: '1px solid #e7e5e0', fontSize: 12 }} />
                <Legend iconType="circle" iconSize={8} formatter={val => <span style={{ fontSize: 11, color: '#78716c' }}>{val}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-5">
          <SectionTitle>Client Retention</SectionTitle>
          <div className="space-y-3 mt-2">
            {[
              { label: 'Returning clients', sub: 'Had jobs last month too', value: returningClients, color: 'text-emerald-700' },
              { label: 'New clients', sub: 'First job this month', value: newClients.length, color: 'text-blue-600' },
              { label: 'Churned clients', sub: 'Had jobs last month, none this month', value: churnedClients, color: churnedClients > 0 ? 'text-red-500' : 'text-stone-300' },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center py-2 border-b border-stone-100 last:border-0">
                <div>
                  <div className="text-sm font-medium text-stone-700">{row.label}</div>
                  <div className="text-xs text-stone-400">{row.sub}</div>
                </div>
                <div className={`text-2xl font-bold ${row.color}`}>{row.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Revenue by client */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-stone-100"><SectionTitle>Revenue by Client (Top 10)</SectionTitle></div>
        {clientRows.length === 0 ? <EmptyState message="No payment data this month." /> : (
          <div>
            <div className="hidden md:grid grid-cols-5 gap-4 px-5 py-2.5 border-b border-stone-100 text-xs font-semibold text-stone-400 uppercase tracking-wider">
              <div className="col-span-2">Client</div>
              <div className="text-right">Jobs</div>
              <div className="text-right">Revenue</div>
              <div className="text-right">% of Total</div>
            </div>
            {clientRows.map((c, i) => (
              <div key={i} className="grid grid-cols-5 gap-4 px-5 py-3 border-b border-stone-50 text-sm items-center">
                <div className="col-span-2 font-medium text-stone-700 truncate">{c.name}</div>
                <div className="text-right text-stone-600">{c.jobs}</div>
                <div className="text-right font-medium text-stone-900">{fmtMoney(c.revenue)}</div>
                <div className="text-right text-stone-400">{totalForPct > 0 ? `${((c.revenue / totalForPct) * 100).toFixed(1)}%` : '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Revenue by worker */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100"><SectionTitle>Revenue by Worker</SectionTitle></div>
        {workerRows.length === 0 ? <EmptyState message="No worker data this month." /> : (
          <div>
            <div className="hidden md:grid grid-cols-5 gap-4 px-5 py-2.5 border-b border-stone-100 text-xs font-semibold text-stone-400 uppercase tracking-wider">
              <div>Worker</div>
              <div className="text-right">Jobs</div>
              <div className="text-right">Revenue</div>
              <div className="text-right">Avg Duration</div>
              <div className="text-right">On-Time %</div>
            </div>
            {workerRows.map((w, i) => {
              const onTimePct = w.arrived > 0 ? Math.round((w.onTime / w.arrived) * 100) : null
              return (
                <div key={i} className="grid grid-cols-5 gap-4 px-5 py-3 border-b border-stone-50 text-sm items-center">
                  <div className="font-medium text-stone-700">{w.name}</div>
                  <div className="text-right text-stone-600">{w.jobs}</div>
                  <div className="text-right text-stone-600">{fmtMoney(w.revenue)}</div>
                  <div className="text-right text-stone-400">{w.minsCount > 0 ? fmtMins(Math.round(w.mins / w.minsCount)) : '—'}</div>
                  <div className={`text-right font-medium ${onTimePct === null ? 'text-stone-300' : onTimePct >= 90 ? 'text-emerald-600' : onTimePct < 75 ? 'text-red-500' : 'text-stone-600'}`}>
                    {onTimePct !== null ? `${onTimePct}%` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ALERTS TAB ──────────────────────────────────────────────

function AlertsTab({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const today = todayInTimezone(tz)
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const ninetyDaysAgo = addDays(today, -90)
    const twoDaysAgo = addDays(today, -2)

    const [jobsRes, allPaymentsRes] = await Promise.all([
      supabase.from('jobs').select('*, clients(name)').gte('date', ninetyDaysAgo).lte('date', today).order('date', { ascending: false }),
      supabase.from('payments').select('job_id, client_id, amount'),
    ])

    const jobs = jobsRes.data || []
    const allPayments = allPaymentsRes.data || []
    const paidJobIds = new Set(allPayments.map(p => p.job_id).filter(Boolean))

    // Track latest job date per client (for dormant detection)
    const clientLastJob = {}
    jobs.forEach(j => {
      if (!clientLastJob[j.client_id] || j.date > clientLastJob[j.client_id].date) {
        clientLastJob[j.client_id] = { date: j.date, name: j.clients?.name }
      }
    })

    const found = []

    // RED: Job too short — actual < 50% of estimated
    jobs
      .filter(j => j.status === 'completed' && j.arrived_at && j.completed_at && j.duration_minutes)
      .forEach(j => {
        const actual = minutesBetween(j.arrived_at, j.completed_at)
        const est = Number(j.duration_minutes)
        if (actual !== null && est > 0 && actual < est * 0.5) {
          found.push({
            level: 'red', type: 'Job too short',
            desc: `${j.clients?.name || 'Unknown'}: ${fmtMins(actual)} actual vs ${fmtMins(est)} estimated`,
            date: j.date, id: `short-${j.id}`,
          })
        }
      })

    // RED: No-show — scheduled with no arrival, date has passed
    jobs
      .filter(j => j.status === 'scheduled' && !j.arrived_at && j.date <= today)
      .forEach(j => {
        found.push({
          level: 'red', type: 'No-show',
          desc: `${j.clients?.name || 'Unknown'}: scheduled ${j.start_time ? formatTime(j.start_time) : ''} on ${formatDate(j.date)}`,
          date: j.date, id: `noshow-${j.id}`,
        })
      })

    // AMBER: Job too long — actual > 150% of estimated
    jobs
      .filter(j => j.status === 'completed' && j.arrived_at && j.completed_at && j.duration_minutes)
      .forEach(j => {
        const actual = minutesBetween(j.arrived_at, j.completed_at)
        const est = Number(j.duration_minutes)
        if (actual !== null && est > 0 && actual > est * 1.5) {
          found.push({
            level: 'amber', type: 'Job too long',
            desc: `${j.clients?.name || 'Unknown'}: ${fmtMins(actual)} actual vs ${fmtMins(est)} estimated`,
            date: j.date, id: `long-${j.id}`,
          })
        }
      })

    // AMBER: Payment gap — completed >48h ago with no payment and has a price
    jobs
      .filter(j => j.status === 'completed' && j.date <= twoDaysAgo && !paidJobIds.has(j.id) && Number(j.price) > 0)
      .forEach(j => {
        found.push({
          level: 'amber', type: 'Payment gap',
          desc: `${j.clients?.name || 'Unknown'}: completed ${formatDate(j.date)}, ${fmtMoney(j.price)} due`,
          date: j.date, id: `payment-${j.id}`,
        })
      })

    // GRAY: Dormant client — had recurring job in last 90 days, none in last 30
    const thirtyDaysAgo = addDays(today, -30)
    const recentClientIds = new Set(jobs.filter(j => j.date >= thirtyDaysAgo).map(j => j.client_id))
    const recurringClients = {}
    jobs
      .filter(j => j.frequency && j.frequency !== 'one_time')
      .forEach(j => {
        if (!recurringClients[j.client_id] || j.date > recurringClients[j.client_id].date) {
          recurringClients[j.client_id] = { date: j.date, name: j.clients?.name, freq: j.frequency }
        }
      })
    Object.entries(recurringClients).forEach(([clientId, info]) => {
      if (!recentClientIds.has(clientId)) {
        found.push({
          level: 'gray', type: 'Dormant client',
          desc: `${info.name || 'Unknown'}: last job ${formatDate(info.date)} (${info.freq} schedule)`,
          date: info.date, id: `dormant-${clientId}`,
        })
      }
    })

    const order = { red: 0, amber: 1, gray: 2 }
    found.sort((a, b) => order[a.level] - order[b.level] || (b.date || '').localeCompare(a.date || ''))
    setAlerts(found)
    setLoading(false)
  }

  const dotColor = { red: 'bg-red-500', amber: 'bg-amber-400', gray: 'bg-stone-400' }
  const borderColor = { red: 'border-l-red-400', amber: 'border-l-amber-400', gray: 'border-l-stone-300' }
  const labelColor = { red: 'text-red-700', amber: 'text-amber-700', gray: 'text-stone-500' }

  const counts = { red: alerts.filter(a => a.level === 'red').length, amber: alerts.filter(a => a.level === 'amber').length, gray: alerts.filter(a => a.level === 'gray').length }

  return (
    <div>
      {loading ? (
        <div className="text-stone-400 text-sm py-8 text-center">Loading...</div>
      ) : alerts.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">✓</div>
          <div className="text-stone-700 font-medium mb-1">No active alerts</div>
          <div className="text-stone-400 text-sm">Everything looks good.</div>
        </div>
      ) : (
        <>
          {/* Summary counts */}
          <div className="flex items-center gap-4 mb-6 flex-wrap">
            {counts.red > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                <span className="font-semibold text-red-700">{counts.red} critical</span>
              </div>
            )}
            {counts.amber > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                <span className="font-semibold text-amber-700">{counts.amber} warning</span>
              </div>
            )}
            {counts.gray > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-stone-400 inline-block" />
                <span className="text-stone-500">{counts.gray} info</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {alerts.map(alert => (
              <div key={alert.id} className={`bg-white rounded-2xl border border-stone-200 border-l-4 ${borderColor[alert.level]} p-4 flex items-start gap-3`}>
                <span className={`w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0 ${dotColor[alert.level]}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${labelColor[alert.level]}`}>{alert.type}</div>
                  <div className="text-sm text-stone-600 mt-0.5">{alert.desc}</div>
                </div>
                {alert.date && (
                  <div className="text-xs text-stone-400 flex-shrink-0 pt-0.5">
                    {formatDate(alert.date, { month: 'short', day: 'numeric' })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────

const TABS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'alerts', label: 'Alerts' },
]

export default function Reports({ user }) {
  const [tab, setTab] = useState('daily')
  const [showExport, setShowExport] = useState(false)
  const canExport = ['ceo', 'support'].includes(user?.role)

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Reports</h1>
          <p className="text-stone-500 text-sm mt-1">{user?.organizations?.name}</p>
        </div>
        {canExport && (
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-stone-200 text-stone-700 text-sm font-medium rounded-xl hover:bg-stone-50 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Data
          </button>
        )}
      </div>

      {showExport && <ExportModal user={user} onClose={() => setShowExport(false)} />}

      <div className="flex gap-1 bg-white border border-stone-200 rounded-xl p-1 mb-6 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t.id ? 'bg-emerald-700 text-white' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'daily'   && <DailyTab   user={user} />}
      {tab === 'weekly'  && <WeeklyTab  user={user} />}
      {tab === 'monthly' && <MonthlyTab user={user} />}
      {tab === 'alerts'  && <AlertsTab  user={user} />}
    </div>
  )
}
