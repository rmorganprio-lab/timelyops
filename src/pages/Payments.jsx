import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { todayInTimezone, formatDate, getTimezoneAbbr } from '../lib/timezone'

const METHODS = ['cash', 'venmo', 'zelle', 'card', 'bank_transfer', 'check', 'other']

const methodLabels = {
  cash: 'Cash', venmo: 'Venmo', zelle: 'Zelle', card: 'Card',
  bank_transfer: 'Bank Transfer', check: 'Check', other: 'Other',
}

const methodColors = {
  cash: 'bg-green-100 text-green-700',
  venmo: 'bg-blue-100 text-blue-700',
  zelle: 'bg-purple-100 text-purple-700',
  card: 'bg-amber-100 text-amber-700',
  bank_transfer: 'bg-cyan-100 text-cyan-700',
  check: 'bg-stone-100 text-stone-600',
  other: 'bg-stone-100 text-stone-500',
}

const emptyPayment = {
  client_id: '', invoice_id: '', amount: '', method: 'cash', date: '', notes: '', reference: '',
}

export default function Payments({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const tzAbbr = getTimezoneAbbr(tz)

  const [payments, setPayments] = useState([])
  const [clients, setClients] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyPayment)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState({ method: 'all', client: 'all', period: 'all' })
  const [search, setSearch] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [paymentsRes, clientsRes, invoicesRes] = await Promise.all([
      supabase.from('payments').select('*, clients(name), invoices(invoice_number)').order('date', { ascending: false }),
      supabase.from('clients').select('id, name').eq('status', 'active').order('name'),
      supabase.from('invoices').select('id, invoice_number, total, status, client_id, clients(name)').in('status', ['sent', 'overdue']).order('created_at', { ascending: false }),
    ])
    setPayments(paymentsRes.data || [])
    setClients(clientsRes.data || [])
    setInvoices(invoicesRes.data || [])
    setLoading(false)
  }

  // ── Filtering ──

  const today = todayInTimezone(tz)

  function getPeriodStart(period) {
    const d = new Date(today + 'T12:00:00')
    if (period === 'week') { d.setDate(d.getDate() - 7); return d }
    if (period === 'month') { d.setMonth(d.getMonth() - 1); return d }
    if (period === 'quarter') { d.setMonth(d.getMonth() - 3); return d }
    if (period === 'year') { d.setFullYear(d.getFullYear() - 1); return d }
    return null
  }

  const filtered = payments.filter(p => {
    if (filter.method !== 'all' && p.method !== filter.method) return false
    if (filter.client !== 'all' && p.client_id !== filter.client) return false
    if (filter.period !== 'all') {
      const start = getPeriodStart(filter.period)
      if (start && new Date(p.date + 'T12:00:00') < start) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const clientName = p.clients?.name?.toLowerCase() || ''
      const ref = p.reference?.toLowerCase() || ''
      const notes = p.notes?.toLowerCase() || ''
      if (!clientName.includes(q) && !ref.includes(q) && !notes.includes(q)) return false
    }
    return true
  })

  // ── Stats ──

  const totalFiltered = filtered.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const totalThisMonth = payments.filter(p => {
    const pDate = new Date(p.date + 'T12:00:00')
    const todayDate = new Date(today + 'T12:00:00')
    return pDate.getMonth() === todayDate.getMonth() && pDate.getFullYear() === todayDate.getFullYear()
  }).reduce((sum, p) => sum + Number(p.amount || 0), 0)

  const methodBreakdown = METHODS.map(m => ({
    method: m,
    total: filtered.filter(p => p.method === m).reduce((sum, p) => sum + Number(p.amount || 0), 0),
    count: filtered.filter(p => p.method === m).length,
  })).filter(m => m.count > 0)

  // ── Modal handlers ──

  function openAdd() {
    setForm({ ...emptyPayment, date: today })
    setSelectedPayment(null)
    setModal('add')
  }

  function openEdit(payment) {
    setSelectedPayment(payment)
    setForm({
      client_id: payment.client_id, invoice_id: payment.invoice_id || '',
      amount: payment.amount, method: payment.method, date: payment.date,
      notes: payment.notes || '', reference: payment.reference || '',
    })
    setModal('edit')
  }

  function openView(payment) {
    setSelectedPayment(payment)
    setModal('view')
  }

  // ── Save ──

  async function handleSave() {
    setSaving(true)
    const paymentData = {
      org_id: user.org_id,
      client_id: form.client_id,
      invoice_id: form.invoice_id || null,
      amount: Number(form.amount),
      method: form.method,
      date: form.date,
      notes: form.notes || null,
      reference: form.reference || null,
    }

    if (modal === 'add') {
      const { error } = await supabase.from('payments').insert(paymentData)
      if (!error && form.invoice_id) {
        // Check if invoice is fully paid
        const { data: invoicePayments } = await supabase.from('payments').select('amount').eq('invoice_id', form.invoice_id)
        const totalPaid = invoicePayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0
        const invoice = invoices.find(i => i.id === form.invoice_id)
        if (invoice && totalPaid >= Number(invoice.total)) {
          await supabase.from('invoices').update({ status: 'paid' }).eq('id', form.invoice_id)
        }
      }
      // Log to client timeline
      if (!error) {
        await supabase.from('client_timeline').insert({
          org_id: user.org_id,
          client_id: form.client_id,
          event_type: 'payment',
          summary: `Payment of $${Number(form.amount).toFixed(2)} received via ${methodLabels[form.method]}`,
          created_by: user.id,
        })
      }
    } else {
      await supabase.from('payments').update(paymentData).eq('id', selectedPayment.id)
    }

    setSaving(false)
    setModal(null)
    loadAll()
  }

  // ── Delete ──

  async function handleDelete() {
    if (!selectedPayment) return
    await supabase.from('payments').delete().eq('id', selectedPayment.id)
    setModal(null)
    loadAll()
  }

  // ── When client is selected, filter available invoices ──

  const clientInvoices = invoices.filter(i => i.client_id === form.client_id)

  const clientName = (id) => clients.find(c => c.id === id)?.name || 'Unknown'

  if (loading) return <div className="p-6 md:p-8 text-stone-400">Loading payments...</div>

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Payments</h1>
          <p className="text-stone-500 text-sm mt-1">
            {payments.length} total payments
            <span className="text-stone-300 mx-1.5">·</span>
            ${totalThisMonth.toFixed(2)} this month
          </p>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Record Payment
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-2">Showing</div>
          <div className="text-2xl font-bold text-stone-900">${totalFiltered.toFixed(2)}</div>
          <div className="text-xs text-stone-400 mt-1">{filtered.length} payments</div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-2">This Month</div>
          <div className="text-2xl font-bold text-emerald-700">${totalThisMonth.toFixed(2)}</div>
        </div>
        {methodBreakdown.slice(0, 2).map(mb => (
          <div key={mb.method} className="bg-white rounded-2xl border border-stone-200 p-4">
            <div className="text-xs font-medium text-stone-500 mb-2">{methodLabels[mb.method]}</div>
            <div className="text-2xl font-bold text-stone-700">${mb.total.toFixed(2)}</div>
            <div className="text-xs text-stone-400 mt-1">{mb.count} payments</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text" placeholder="Search client, reference..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 w-full sm:w-64"
        />
        <select value={filter.method} onChange={e => setFilter(f => ({...f, method: e.target.value}))} className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-600">
          <option value="all">All Methods</option>
          {METHODS.map(m => <option key={m} value={m}>{methodLabels[m]}</option>)}
        </select>
        <select value={filter.client} onChange={e => setFilter(f => ({...f, client: e.target.value}))} className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-600">
          <option value="all">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filter.period} onChange={e => setFilter(f => ({...f, period: e.target.value}))} className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-600">
          <option value="all">All Time</option>
          <option value="week">Last 7 Days</option>
          <option value="month">Last 30 Days</option>
          <option value="quarter">Last 3 Months</option>
          <option value="year">Last Year</option>
        </select>
      </div>

      {/* Payment List */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-stone-400 text-sm mb-3">{payments.length === 0 ? 'No payments recorded yet.' : 'No payments match your filters.'}</p>
            {payments.length === 0 && (
              <button onClick={openAdd} className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800">Record First Payment</button>
            )}
          </div>
        ) : (
          <div>
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-stone-100 text-xs font-semibold text-stone-400 uppercase tracking-wider">
              <div className="col-span-3">Client</div>
              <div className="col-span-2">Date</div>
              <div className="col-span-2">Method</div>
              <div className="col-span-2">Reference</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-1"></div>
            </div>

            {/* Rows */}
            {filtered.map(p => (
              <div key={p.id} onClick={() => openView(p)} className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-5 py-4 border-b border-stone-50 hover:bg-stone-50 cursor-pointer transition-colors items-center">
                <div className="md:col-span-3">
                  <div className="font-medium text-stone-900 text-sm">{p.clients?.name || 'Unknown'}</div>
                  {p.invoices?.invoice_number && <div className="text-xs text-stone-400">Invoice #{p.invoices.invoice_number}</div>}
                </div>
                <div className="md:col-span-2 text-sm text-stone-600">{formatDate(p.date)}</div>
                <div className="md:col-span-2">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${methodColors[p.method] || methodColors.other}`}>
                    {methodLabels[p.method] || p.method}
                  </span>
                </div>
                <div className="md:col-span-2 text-sm text-stone-500 truncate">{p.reference || '—'}</div>
                <div className="md:col-span-2 text-right font-semibold text-stone-900">${Number(p.amount).toFixed(2)}</div>
                <div className="md:col-span-1 text-right">
                  <button onClick={(e) => { e.stopPropagation(); openEdit(p) }} className="text-stone-400 hover:text-stone-600">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Method Breakdown */}
      {methodBreakdown.length > 2 && (
        <div className="mt-6 bg-white rounded-2xl border border-stone-200 p-5">
          <h3 className="text-sm font-semibold text-stone-900 mb-3">Payment Method Breakdown</h3>
          <div className="space-y-2">
            {methodBreakdown.map(mb => (
              <div key={mb.method} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${methodColors[mb.method]}`}>{methodLabels[mb.method]}</span>
                  <span className="text-xs text-stone-400">{mb.count} payments</span>
                </div>
                <span className="text-sm font-medium text-stone-700">${mb.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── View Payment Modal ── */}
      {modal === 'view' && selectedPayment && (
        <Modal onClose={() => setModal(null)}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Payment Details</h2>
              <p className="text-sm text-stone-500">{selectedPayment.clients?.name}</p>
            </div>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div className="space-y-2 mb-6">
            <InfoRow label="Amount" value={<span className="text-lg font-bold text-emerald-700">${Number(selectedPayment.amount).toFixed(2)}</span>} />
            <InfoRow label="Client" value={selectedPayment.clients?.name} />
            <InfoRow label="Date" value={formatDate(selectedPayment.date)} />
            <InfoRow label="Method" value={<span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${methodColors[selectedPayment.method]}`}>{methodLabels[selectedPayment.method]}</span>} />
            {selectedPayment.invoices?.invoice_number && <InfoRow label="Invoice" value={`#${selectedPayment.invoices.invoice_number}`} />}
            {selectedPayment.reference && <InfoRow label="Reference" value={selectedPayment.reference} />}
            {selectedPayment.notes && <InfoRow label="Notes" value={selectedPayment.notes} />}
          </div>

          <div className="flex gap-3 pt-4 border-t border-stone-200">
            <button onClick={() => openEdit(selectedPayment)} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800">Edit</button>
            <button onClick={handleDelete} className="px-4 py-2.5 bg-red-50 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100">Delete</button>
          </div>
        </Modal>
      )}

      {/* ── Add/Edit Payment Modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal onClose={() => setModal(null)}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-stone-900">{modal === 'add' ? 'Record Payment' : 'Edit Payment'}</h2>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div className="space-y-4">
            {/* Client */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Client *</label>
              <select value={form.client_id} onChange={e => setForm(f => ({...f, client_id: e.target.value, invoice_id: ''}))} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600">
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Invoice (optional) */}
            {clientInvoices.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Against Invoice (optional)</label>
                <select value={form.invoice_id} onChange={e => setForm(f => ({...f, invoice_id: e.target.value}))} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600">
                  <option value="">No invoice (general payment)</option>
                  {clientInvoices.map(i => <option key={i.id} value={i.id}>#{i.invoice_number} — ${Number(i.total).toFixed(2)}</option>)}
                </select>
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                <input type="number" value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))} placeholder="0.00" step="0.01" className="w-full pl-7 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
              </div>
            </div>

            {/* Method */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Payment Method *</label>
              <div className="grid grid-cols-4 gap-2">
                {METHODS.map(m => (
                  <button key={m} type="button" onClick={() => setForm(f => ({...f, method: m}))} className={`py-2 text-xs font-medium rounded-xl transition-colors ${form.method === m ? methodColors[m] + ' ring-2 ring-offset-1 ring-emerald-300' : 'bg-stone-50 text-stone-400 border border-stone-200 hover:border-stone-300'}`}>
                    {methodLabels[m]}
                  </button>
                ))}
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Date *</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </div>

            {/* Reference */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Reference / Confirmation #</label>
              <input type="text" value={form.reference} onChange={e => setForm(f => ({...f, reference: e.target.value}))} placeholder="e.g. Venmo confirmation, check number" className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Optional notes..." rows={2} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-none" />
            </div>
          </div>

          <div className="flex gap-3 mt-6 pt-4 border-t border-stone-200">
            <button onClick={() => setModal(null)} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.client_id || !form.amount || !form.date} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50">
              {saving ? 'Saving...' : modal === 'add' ? 'Record Payment' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }) {
  if (!value) return null
  return <div className="flex justify-between py-1.5"><span className="text-xs text-stone-400">{label}</span><span className="text-sm text-stone-700">{value}</span></div>
}
