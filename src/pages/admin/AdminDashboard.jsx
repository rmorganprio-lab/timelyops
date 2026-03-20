import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-5">
      <div className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-3xl font-bold text-stone-900 mb-1">{value ?? '—'}</div>
      {sub && <div className="text-xs text-stone-400">{sub}</div>}
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchStats() }, [])

  async function fetchStats() {
    const [orgsRes, usersRes] = await Promise.all([
      supabase.from('organizations').select('id, subscription_tier, subscription_status, is_founding_customer'),
      supabase.from('users').select('id', { count: 'exact', head: true }),
    ])

    const orgs = orgsRes.data || []
    setStats({
      totalOrgs:       orgs.length,
      activeOrgs:      orgs.filter(o => ['active', 'trialing'].includes(o.subscription_status)).length,
      totalUsers:      usersRes.count || 0,
      starter:         orgs.filter(o => o.subscription_tier === 'starter').length,
      professional:    orgs.filter(o => o.subscription_tier === 'professional').length,
      growth:          orgs.filter(o => o.subscription_tier === 'growth').length,
      founding:        orgs.filter(o => o.is_founding_customer).length,
      pausedCancelled: orgs.filter(o => ['paused', 'cancelled'].includes(o.subscription_status)).length,
    })
    setLoading(false)
  }

  if (loading) return <div className="p-8 text-stone-400 text-sm">Loading...</div>

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Platform Overview</h1>
        <p className="text-stone-500 text-sm mt-1">All organizations on TimelyOps</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Organizations" value={stats.totalOrgs} />
        <StatCard label="Active / Trialing" value={stats.activeOrgs} />
        <StatCard label="Total Users" value={stats.totalUsers} sub="across all orgs" />
        <StatCard
          label="By Tier"
          value=""
          sub={`${stats.starter} starter · ${stats.professional} professional · ${stats.growth} growth`}
        />
        <StatCard label="Founding Customers" value={stats.founding} />
        <StatCard label="Paused / Cancelled" value={stats.pausedCancelled} />
      </div>

      <div className="flex gap-3">
        <Link
          to="/admin/orgs"
          className="px-4 py-2 bg-emerald-700 text-white rounded-xl text-sm font-medium hover:bg-emerald-800"
        >
          Manage Organizations
        </Link>
        <Link
          to="/admin/users"
          className="px-4 py-2 bg-white border border-stone-200 text-stone-700 rounded-xl text-sm font-medium hover:bg-stone-50"
        >
          Manage Users
        </Link>
      </div>
    </div>
  )
}
