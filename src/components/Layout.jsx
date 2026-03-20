import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useState } from 'react'

// Full nav for CEO and Manager
const ownerNav = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/clients', label: 'Clients', icon: 'clients' },
  { to: '/workers', label: 'Workers', icon: 'workers' },
  { to: '/schedule', label: 'Schedule', icon: 'schedule' },
  { to: '/quotes', label: 'Quotes', icon: 'quotes' },
  { to: '/invoices', label: 'Invoices', icon: 'invoices' },
  { to: '/payments', label: 'Payments', icon: 'payments' },
  { to: '/reports', label: 'Reports', icon: 'reports', roles: ['ceo', 'manager', 'support'] },
]

// Simplified nav for workers — only what they need
const workerNav = [
  { to: '/', label: 'My Jobs', icon: 'schedule' },
  { to: '/clients', label: 'Clients', icon: 'clients' },
]

function NavIcon({ name, size = 20 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' }
  
  switch (name) {
    case 'dashboard': return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    case 'clients': return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    case 'workers': return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/><line x1="20" y1="8" x2="20" y2="14"/></svg>
    case 'schedule': return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    case 'quotes': return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
    case 'invoices': return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
    case 'payments': return <svg {...p}><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
    case 'reports': return <svg {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    default: return null
  }
}

export default function Layout({ user }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const orgName = user?.organizations?.name || 'TimelyOps'
  const role = user?.role || 'worker'
  const isWorker = role === 'worker'
  const navItems = isWorker
    ? workerNav
    : ownerNav.filter(item => !item.roles || item.roles.includes(role))

  async function handleSignOut() {
    await supabase.auth.signOut()
    const savedPhone = localStorage.getItem('allbookd_phone')
    localStorage.clear()
    if (savedPhone) localStorage.setItem('allbookd_phone', savedPhone)
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-stone-50 flex">
      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50
        w-64 bg-white border-r border-stone-200
        flex flex-col
        transform transition-transform duration-200
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Brand */}
        <div className="p-5 border-b border-stone-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-700 rounded-xl flex items-center justify-center">
              <svg width="30" height="30" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="20" stroke="white" strokeWidth="2.2" fill="none"/>
                <line x1="32" y1="32" x2="25" y2="22" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                <line x1="32" y1="32" x2="41" y2="24" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="32" cy="32" r="2" fill="white"/>
              </svg>
            </div>
            <div>
              <div className="font-bold text-stone-900 text-sm leading-tight">{orgName}</div>
              <div className="text-xs text-stone-400">TimelyOps</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors
                ${isActive 
                  ? 'bg-emerald-50 text-emerald-700' 
                  : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'}
              `}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User / Sign Out */}
        <div className="p-4 border-t border-stone-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-stone-700">{user?.name}</div>
              <div className="text-xs text-stone-400 capitalize">{role === 'ceo' ? 'Owner' : role}</div>
            </div>
            <button
              onClick={handleSignOut}
              className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
              title="Sign out"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Mobile header */}
        <header className="md:hidden bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 text-stone-600 hover:bg-stone-100 rounded-lg"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div className="font-bold text-stone-900 text-sm">{orgName}</div>
          <div className="w-10" />
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
