import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { todayInTimezone, addDays, currentHourInTimezone, getTimezoneAbbr } from '../lib/timezone'

export default function Dashboard({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'

  const [stats, setStats] = useState({
    todayJobs: [],
    weekJobs: [],
    overdueInvoices: [],
    totalClients: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    const today = todayInTimezone(tz)
    const weekEnd = addDays(today, 7)

    const [jobsToday, jobsWeek, overdue, clients] = await Promise.all([
      supabase.from('jobs').select('*, clients(name)').eq('date', today).order('start_time'),
      supabase.from('jobs').select('*, clients(name)').gte('date', today).lte('date', weekEnd).order('date').order('start_time'),
      supabase.from('invoices').select('*, clients(name)').eq('status', 'overdue'),
      supabase.from('clients').select('id', { count: 'exact', head: true }),
    ])

    setStats({
      todayJobs: jobsToday.data || [],
      weekJobs: jobsWeek.data || [],
      overdueInvoices: overdue.data || [],
      totalClients: clients.count || 0,
    })
    setLoading(false)
  }

  const greeting = () => {
    const hour = currentHourInTimezone(tz)
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <div className="text-stone-400">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900">
          {greeting()}, {user?.name?.split(' ')[0]}
        </h1>
        <p className="text-stone-500 text-sm mt-1">
          Here's what's happening today.
          <span className="text-stone-300 mx-1.5">·</span>
          <span className="text-stone-400">{getTimezoneAbbr(tz)}</span>
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Today's Jobs" value={stats.todayJobs.length} color="emerald" />
        <StatCard label="This Week" value={stats.weekJobs.length} color="blue" />
        <StatCard label="Overdue" value={stats.overdueInvoices.length} color={stats.overdueInvoices.length > 0 ? 'red' : 'stone'} />
        <StatCard label="Total Clients" value={stats.totalClients} color="stone" />
      </div>

      {/* Today's Jobs */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-6">
        <h2 className="font-semibold text-stone-900 mb-4">Today's Jobs</h2>
        {stats.todayJobs.length === 0 ? (
          <p className="text-stone-400 text-sm">No jobs scheduled for today.</p>
        ) : (
          <div className="space-y-3">
            {stats.todayJobs.map(job => (
              <div key={job.id} className="flex items-center justify-between p-3 bg-stone-50 rounded-xl">
                <div>
                  <div className="font-medium text-stone-900 text-sm">{job.title}</div>
                  <div className="text-stone-500 text-xs mt-0.5">{job.clients?.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-stone-600">{job.start_time?.slice(0, 5) || 'TBD'}</div>
                  <StatusBadge status={job.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Overdue Invoices */}
      {stats.overdueInvoices.length > 0 && (
        <div className="bg-red-50 rounded-2xl border border-red-200 p-6">
          <h2 className="font-semibold text-red-800 mb-4">Overdue Invoices</h2>
          <div className="space-y-3">
            {stats.overdueInvoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between p-3 bg-white rounded-xl">
                <div>
                  <div className="font-medium text-stone-900 text-sm">{inv.clients?.name}</div>
                  <div className="text-stone-500 text-xs">#{inv.invoice_number}</div>
                </div>
                <div className="font-semibold text-red-600">${Number(inv.total).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
    stone: 'bg-stone-100 text-stone-700',
  }
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-4">
      <div className="text-xs font-medium text-stone-500 mb-2">{label}</div>
      <div className={`text-2xl font-bold ${colors[color]?.split(' ')[1] || 'text-stone-900'}`}>
        {value}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const styles = {
    scheduled: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-amber-100 text-amber-700',
    completed: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-stone-100 text-stone-500',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${styles[status] || styles.scheduled}`}>
      {status?.replace('_', ' ')}
    </span>
  )
}
