import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAdminOrg } from '../contexts/AdminOrgContext'
import { useToast } from '../contexts/ToastContext'
import { todayInTimezone, formatDate, getTimezoneAbbr } from '../lib/timezone'
import { jsPDF } from 'jspdf'

const statusColors = {
  draft: 'bg-stone-100 text-stone-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-600',
}

const emptyLine = { description: '', quantity: 1, unit_price: 0, job_id: '' }

export default function Invoices({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const taxRate = user?.organizations?.settings?.tax_rate || 0
  const orgId = user?.org_id
  const { adminViewOrg } = useAdminOrg()
  const effectiveOrgId = adminViewOrg?.id ?? user?.org_id
  const { showToast } = useToast()

  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [completedJobs, setCompletedJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  // Form
  const [formClient, setFormClient] = useState('')
  const [formLines, setFormLines] = useState([{ ...emptyLine }])
  const [formNotes, setFormNotes] = useState('')
  const [formDueDate, setFormDueDate] = useState('')
  const [formStatus, setFormStatus] = useState('draft')

  // Payment inline
  const [showPayment, setShowPayment] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [paymentSaving, setPaymentSaving] = useState(false)

  useEffect(() => { loadAll() }, [effectiveOrgId])

  async function loadAll() {
    const [invRes, clientsRes, jobsRes] = await Promise.all([
      supabase.from('invoices').select('*, clients(name, phone, email, address), invoice_line_items(*)').eq('org_id', effectiveOrgId).order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('org_id', effectiveOrgId).eq('status', 'active').order('name'),
      supabase.from('jobs').select('id, title, date, price, client_id, status, clients(name)').eq('org_id', effectiveOrgId).eq('status', 'completed').is('invoice_id', null).order('date', { ascending: false }),
    ])
    setInvoices(invRes.data || [])
    setClients(clientsRes.data || [])
    setCompletedJobs(jobsRes.data || [])
    setLoading(false)
  }

  // ── Filtering ──

  const filtered = invoices.filter(inv => {
    if (filter !== 'all' && inv.status !== filter) return false
    if (search) {
      const s = search.toLowerCase()
      return inv.clients?.name?.toLowerCase().includes(s) || inv.invoice_number?.toLowerCase().includes(s)
    }
    return true
  })

  // ── Helpers ──

  function getNextInvoiceNumber() {
    const existing = invoices.map(inv => {
      const num = inv.invoice_number?.replace(/\D/g, '')
      return num ? Number(num) : 0
    })
    const max = existing.length > 0 ? Math.max(...existing) : 0
    return `INV-${String(max + 1).padStart(4, '0')}`
  }

  function getClientJobs(clientId) {
    return completedJobs.filter(j => j.client_id === clientId)
  }

  const lineTotal = (line) => Number(line.quantity) * Number(line.unit_price)
  const formSubtotal = formLines.reduce((sum, l) => sum + lineTotal(l), 0)
  const formTax = formSubtotal * (taxRate / 100)
  const formTotal = formSubtotal + formTax

  // ── Modal openers ──

  function openAdd(fromJob = null) {
    const today = todayInTimezone(tz)
    const dueDate = new Date(today + 'T12:00:00')
    dueDate.setDate(dueDate.getDate() + 30)
    const dueStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`

    if (fromJob) {
      setFormClient(fromJob.client_id)
      setFormLines([{
        description: fromJob.title,
        quantity: 1,
        unit_price: Number(fromJob.price) || 0,
        job_id: fromJob.id,
      }])
    } else {
      setFormClient('')
      setFormLines([{ ...emptyLine }])
    }

    setFormNotes('')
    setFormDueDate(dueStr)
    setFormStatus('draft')
    setSelectedInvoice(null)
    setShowPayment(false)
    setModal('add')
  }

  function openEdit(invoice) {
    setSelectedInvoice(invoice)
    setFormClient(invoice.client_id)
    setFormLines(
      invoice.invoice_line_items?.length > 0
        ? invoice.invoice_line_items.map(li => ({
            id: li.id,
            description: li.description,
            quantity: li.quantity,
            unit_price: Number(li.unit_price),
            job_id: li.job_id || '',
          }))
        : [{ ...emptyLine }]
    )
    setFormNotes(invoice.notes || '')
    setFormDueDate(invoice.due_date || '')
    setFormStatus(invoice.status)
    setShowPayment(false)
    setModal('edit')
  }

  function openView(invoice) {
    setSelectedInvoice(invoice)
    setShowPayment(false)
    setModal('view')
  }

  // ── Client change → show their completed jobs ──

  function handleClientChange(clientId) {
    setFormClient(clientId)
    const jobs = getClientJobs(clientId)
    // If client has uninvoiced completed jobs, auto-fill first one
    if (jobs.length > 0 && formLines.length === 1 && !formLines[0].description) {
      setFormLines([{
        description: jobs[0].title,
        quantity: 1,
        unit_price: Number(jobs[0].price) || 0,
        job_id: jobs[0].id,
      }])
    }
  }

  // ── Add job as line item ──

  function addJobAsLine(job) {
    const alreadyAdded = formLines.some(l => l.job_id === job.id)
    if (alreadyAdded) return

    const newLine = {
      description: job.title,
      quantity: 1,
      unit_price: Number(job.price) || 0,
      job_id: job.id,
    }

    // Replace empty first line or append
    if (formLines.length === 1 && !formLines[0].description) {
      setFormLines([newLine])
    } else {
      setFormLines(lines => [...lines, newLine])
    }
  }

  // ── Line management ──

  function updateLine(idx, field, value) {
    setFormLines(lines => {
      const updated = [...lines]
      updated[idx] = { ...updated[idx], [field]: value }
      return updated
    })
  }

  function addLine() {
    setFormLines(lines => [...lines, { ...emptyLine }])
  }

  function removeLine(idx) {
    if (formLines.length <= 1) return
    setFormLines(lines => lines.filter((_, i) => i !== idx))
  }

  // ── Save ──

  async function handleSave() {
    if (!formClient || formLines.length === 0) return
    setSaving(true)

    const today = todayInTimezone(tz)
    const invoiceData = {
      org_id: effectiveOrgId,
      client_id: formClient,
      invoice_number: selectedInvoice?.invoice_number || getNextInvoiceNumber(),
      subtotal: formSubtotal,
      tax_amount: formTax,
      total: formTotal,
      status: formStatus,
      issue_date: selectedInvoice?.issue_date || today,
      due_date: formDueDate || null,
      notes: formNotes || null,
    }

    let invoiceId
    if (modal === 'add') {
      const { data } = await supabase.from('invoices').insert(invoiceData).select().single()
      invoiceId = data?.id

      if (invoiceId) {
        await supabase.from('client_timeline').insert({
          org_id: effectiveOrgId, client_id: formClient,
          event_type: 'invoice',
          summary: `Invoice ${invoiceData.invoice_number} created for $${formTotal.toFixed(2)}`,
          created_by: user.id,
        })
      }
    } else {
      await supabase.from('invoices').update(invoiceData).eq('id', selectedInvoice.id)
      invoiceId = selectedInvoice.id
      await supabase.from('invoice_line_items').delete().eq('invoice_id', invoiceId)
    }

    // Insert line items
    if (invoiceId) {
      const lineItems = formLines.filter(l => l.description).map(l => ({
        invoice_id: invoiceId,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        total: Number(l.quantity) * Number(l.unit_price),
        job_id: l.job_id || null,
      }))
      if (lineItems.length > 0) {
        await supabase.from('invoice_line_items').insert(lineItems)
      }

      // Link completed jobs to this invoice
      const jobIds = formLines.filter(l => l.job_id).map(l => l.job_id)
      if (jobIds.length > 0) {
        for (const jid of jobIds) {
          await supabase.from('jobs').update({ invoice_id: invoiceId }).eq('id', jid)
        }
      }

      // Check if jobs already have payments that cover this invoice
      if (invoiceId && modal === 'add') {
        if (jobIds.length > 0) {
          const { data: existingPayments } = await supabase
            .from('payments')
            .select('amount')
            .in('job_id', jobIds)
          const totalPaid = (existingPayments || []).reduce((sum, p) => sum + Number(p.amount), 0)
          if (totalPaid >= formTotal) {
            const today = todayInTimezone(tz)
            await supabase.from('invoices').update({
              status: 'paid',
              paid_date: today
            }).eq('id', invoiceId)
            // Link the existing payments to this invoice
            for (const jid of jobIds) {
              await supabase.from('payments').update({ invoice_id: invoiceId }).eq('job_id', jid).is('invoice_id', null)
            }
          }
        }
      }
    }

    setSaving(false)
    setModal(null)
    loadAll()
  }

  // ── Send invoice email ──

  async function sendInvoice(invoice) {
    if (!invoice.clients?.email) {
      showToast('Client has no email address', 'error')
      return
    }
    setSending(true)
    try {
      // Generate view token if missing
      let token = invoice.view_token
      if (!token) {
        token = crypto.randomUUID()
        await supabase.from('invoices').update({ view_token: token }).eq('id', invoice.id)
      }

      const { data, error } = await supabase.functions.invoke('send-email', {
        body: { type: 'invoice', invoice_id: invoice.id },
      })

      if (error || data?.error) throw new Error(error?.message || data?.error || 'Send failed')

      if (invoice.status === 'draft') {
        await supabase.from('invoices').update({ status: 'sent' }).eq('id', invoice.id)
      }

      showToast(`Invoice sent to ${invoice.clients.email}`)
      loadAll()
      setSelectedInvoice(prev => prev ? { ...prev, status: 'sent', view_token: token } : prev)
    } catch (err) {
      showToast(err.message || 'Failed to send invoice', 'error')
    } finally {
      setSending(false)
    }
  }

  // ── Status update ──

  async function updateStatus(invoice, newStatus) {
    await supabase.from('invoices').update({ status: newStatus }).eq('id', invoice.id)

    if (newStatus === 'sent') {
      await supabase.from('client_timeline').insert({
        org_id: effectiveOrgId, client_id: invoice.client_id,
        event_type: 'invoice', summary: `Invoice ${invoice.invoice_number} sent`,
        created_by: user.id,
      })
    }

    loadAll()
    if (selectedInvoice?.id === invoice.id) {
      setSelectedInvoice({ ...invoice, status: newStatus })
    }
  }

  // ── Inline payment from invoice ──

  async function handleInvoicePayment() {
    if (!payAmount || Number(payAmount) <= 0) return
    setPaymentSaving(true)

    await supabase.from('payments').insert({
      org_id: effectiveOrgId,
      client_id: selectedInvoice.client_id,
      invoice_id: selectedInvoice.id,
      amount: Number(payAmount),
      method: payMethod,
      date: todayInTimezone(tz),
      notes: `Payment for invoice ${selectedInvoice.invoice_number}`,
    })

    // Check if fully paid
    const { data: allPayments } = await supabase.from('payments').select('amount').eq('invoice_id', selectedInvoice.id)
    const totalPaid = (allPayments || []).reduce((sum, p) => sum + Number(p.amount), 0)

    if (totalPaid >= Number(selectedInvoice.total)) {
      await supabase.from('invoices').update({ status: 'paid', paid_date: todayInTimezone(tz) }).eq('id', selectedInvoice.id)
    }

    await supabase.from('client_timeline').insert({
      org_id: effectiveOrgId, client_id: selectedInvoice.client_id,
      event_type: 'payment',
      summary: `$${Number(payAmount).toFixed(2)} received for invoice ${selectedInvoice.invoice_number}`,
      created_by: user.id,
    })

    setPaymentSaving(false)
    setShowPayment(false)
    setModal(null)
    loadAll()
  }

  // ── Delete ──

  async function handleDelete(id) {
    // Unlink any jobs
    await supabase.from('jobs').update({ invoice_id: null }).eq('invoice_id', id)
    await supabase.from('invoice_line_items').delete().eq('invoice_id', id)
    await supabase.from('invoices').delete().eq('id', id)
    setModal(null)
    loadAll()
  }

  function generatePDF(invoice) {
    const doc = new jsPDF()
    const orgName = user?.organizations?.name || 'TimelyOps'
    const pageWidth = doc.internal.pageSize.getWidth()

    // Header
    doc.setFontSize(24)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(45, 106, 79) // emerald
    doc.text(orgName, 20, 25)

    doc.setFontSize(28)
    doc.setTextColor(28, 25, 23) // stone-900
    doc.text('INVOICE', pageWidth - 20, 25, { align: 'right' })

    // Invoice details
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 113, 108) // stone-500
    doc.text(`Invoice #: ${invoice.invoice_number}`, pageWidth - 20, 35, { align: 'right' })
    doc.text(`Date: ${invoice.issue_date || 'N/A'}`, pageWidth - 20, 41, { align: 'right' })
    if (invoice.due_date) doc.text(`Due: ${invoice.due_date}`, pageWidth - 20, 47, { align: 'right' })
    if (invoice.status === 'paid' && invoice.paid_date) {
      doc.setTextColor(5, 150, 105) // emerald-600
      doc.text(`PAID: ${invoice.paid_date}`, pageWidth - 20, 53, { align: 'right' })
    }

    // Bill To
    doc.setTextColor(120, 113, 108)
    doc.setFontSize(9)
    doc.text('BILL TO', 20, 45)
    doc.setFontSize(11)
    doc.setTextColor(28, 25, 23)
    doc.setFont('helvetica', 'bold')
    doc.text(invoice.clients?.name || 'Client', 20, 52)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(68, 64, 60)
    let billY = 58
    if (invoice.clients?.address) { doc.text(invoice.clients.address, 20, billY); billY += 5 }
    if (invoice.clients?.phone) { doc.text(invoice.clients.phone, 20, billY); billY += 5 }
    if (invoice.clients?.email) { doc.text(invoice.clients.email, 20, billY); billY += 5 }

    // Line items table
    const tableTop = 80
    doc.setFillColor(245, 245, 244) // stone-100
    doc.rect(20, tableTop, pageWidth - 40, 8, 'F')
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(120, 113, 108)
    doc.text('Description', 24, tableTop + 5.5)
    doc.text('Qty', 120, tableTop + 5.5, { align: 'center' })
    doc.text('Price', 150, tableTop + 5.5, { align: 'right' })
    doc.text('Total', pageWidth - 24, tableTop + 5.5, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(28, 25, 23)
    doc.setFontSize(10)
    let rowY = tableTop + 14
    const lineItems = invoice.invoice_line_items || []
    lineItems.forEach((li) => {
      doc.text(li.description || '', 24, rowY)
      doc.text(String(li.quantity), 120, rowY, { align: 'center' })
      doc.text('$' + Number(li.unit_price).toFixed(2), 150, rowY, { align: 'right' })
      doc.text('$' + Number(li.total).toFixed(2), pageWidth - 24, rowY, { align: 'right' })
      doc.setDrawColor(229, 231, 235)
      doc.line(20, rowY + 3, pageWidth - 20, rowY + 3)
      rowY += 10
    })

    // Totals
    rowY += 5
    doc.setFontSize(10)
    doc.setTextColor(120, 113, 108)
    doc.text('Subtotal:', 140, rowY, { align: 'right' })
    doc.setTextColor(28, 25, 23)
    doc.text('$' + Number(invoice.subtotal).toFixed(2), pageWidth - 24, rowY, { align: 'right' })

    if (Number(invoice.tax_amount) > 0) {
      rowY += 7
      doc.setTextColor(120, 113, 108)
      doc.text('Tax:', 140, rowY, { align: 'right' })
      doc.setTextColor(28, 25, 23)
      doc.text('$' + Number(invoice.tax_amount).toFixed(2), pageWidth - 24, rowY, { align: 'right' })
    }

    rowY += 8
    doc.setDrawColor(28, 25, 23)
    doc.line(130, rowY - 2, pageWidth - 20, rowY - 2)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    if (invoice.status === 'paid') {
      doc.setTextColor(5, 150, 105)
      doc.text('PAID', 140, rowY + 5, { align: 'right' })
    } else {
      doc.setTextColor(120, 113, 108)
      doc.text('Total Due:', 140, rowY + 5, { align: 'right' })
    }
    doc.setTextColor(28, 25, 23)
    doc.text('$' + Number(invoice.total).toFixed(2), pageWidth - 24, rowY + 5, { align: 'right' })

    // Notes
    if (invoice.notes) {
      rowY += 20
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(120, 113, 108)
      doc.text('Notes:', 20, rowY)
      doc.setTextColor(68, 64, 60)
      doc.text(invoice.notes, 20, rowY + 6)
    }

    // Footer
    doc.setFontSize(8)
    doc.setTextColor(168, 162, 158)
    doc.text('Generated by TimelyOps', pageWidth / 2, 285, { align: 'center' })

    doc.save(`${invoice.invoice_number}-${(invoice.clients?.name || 'invoice').replace(/\s+/g, '-')}.pdf`)
  }

  if (loading) return <div className="p-6 md:p-8 text-stone-400">Loading invoices...</div>

  // ── Stats ──
  const totalOutstanding = invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + Number(i.total || 0), 0)
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total || 0), 0)
  const overdueCount = invoices.filter(i => i.status === 'overdue').length

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Invoices</h1>
          <p className="text-stone-500 text-sm mt-1">
            {invoices.length} total
            {overdueCount > 0 && <span className="text-red-600"> · {overdueCount} overdue</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {completedJobs.length > 0 && (
            <div className="relative group">
              <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-50 text-blue-700 text-sm font-medium rounded-xl hover:bg-blue-100 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                {completedJobs.length} jobs ready to invoice
              </button>
            </div>
          )}
          <button onClick={() => openAdd()} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Invoice
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-1">Outstanding</div>
          <div className={`text-2xl font-bold ${totalOutstanding > 0 ? 'text-amber-600' : 'text-stone-400'}`}>${totalOutstanding.toFixed(0)}</div>
        </div>
        <div className={`rounded-2xl border p-4 ${overdueCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-stone-200'}`}>
          <div className="text-xs font-medium text-stone-500 mb-1">Overdue</div>
          <div className={`text-2xl font-bold ${overdueCount > 0 ? 'text-red-700' : 'text-stone-400'}`}>{overdueCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-1">Collected</div>
          <div className="text-2xl font-bold text-emerald-700">${totalPaid.toFixed(0)}</div>
        </div>
      </div>

      {/* Uninvoiced completed jobs banner */}
      {completedJobs.length > 0 && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-2xl">
          <div className="text-sm font-medium text-blue-800 mb-2">Completed jobs ready to invoice</div>
          <div className="flex flex-wrap gap-2">
            {completedJobs.slice(0, 5).map(job => (
              <button key={job.id} onClick={() => openAdd(job)} className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 rounded-xl text-xs hover:bg-blue-100 transition-colors">
                <span className="font-medium text-stone-800">{job.clients?.name}</span>
                <span className="text-stone-400">·</span>
                <span className="text-stone-600">{job.title}</span>
                <span className="text-stone-400">·</span>
                <span className="font-medium text-blue-700">${Number(job.price || 0).toFixed(0)}</span>
                <span className="text-blue-600">→</span>
              </button>
            ))}
            {completedJobs.length > 5 && (
              <span className="text-xs text-blue-600 self-center">+{completedJobs.length - 5} more</span>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder="Search client or invoice #..." value={search} onChange={e => setSearch(e.target.value)} className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 w-full sm:w-64" />
        <div className="flex gap-1 bg-white border border-stone-200 rounded-xl p-1">
          {['all', 'draft', 'sent', 'overdue', 'paid'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${filter === s ? 'bg-emerald-700 text-white' : 'text-stone-500 hover:text-stone-700'}`}>{s}</button>
          ))}
        </div>
      </div>

      {/* Invoice List */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-stone-400 text-sm mb-3">{invoices.length === 0 ? 'No invoices yet.' : 'No invoices match your filter.'}</p>
            {invoices.length === 0 && completedJobs.length > 0 && (
              <button onClick={() => openAdd(completedJobs[0])} className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800">Invoice First Completed Job</button>
            )}
          </div>
        ) : (
          <div>
            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-stone-100 text-xs font-semibold text-stone-400 uppercase tracking-wider">
              <div className="col-span-1">#</div>
              <div className="col-span-3">Client</div>
              <div className="col-span-2">Issued</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Total</div>
              <div className="col-span-2 text-right">Due</div>
            </div>
            {filtered.map(inv => (
              <div key={inv.id} onClick={() => openView(inv)} className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-5 py-4 border-b border-stone-50 hover:bg-stone-50 cursor-pointer transition-colors items-center">
                <div className="md:col-span-1 text-xs font-mono text-stone-400">{inv.invoice_number}</div>
                <div className="md:col-span-3 font-medium text-stone-900 text-sm">{inv.clients?.name}</div>
                <div className="md:col-span-2 text-sm text-stone-600">{formatDate(inv.issue_date)}</div>
                <div className="md:col-span-2">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[inv.status]}`}>{inv.status}</span>
                </div>
                <div className="md:col-span-2 text-right font-semibold text-stone-900">${Number(inv.total).toFixed(2)}</div>
                <div className="md:col-span-2 text-right text-sm text-stone-400">{inv.due_date ? formatDate(inv.due_date) : '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── View Invoice Modal ── */}
      {modal === 'view' && selectedInvoice && (
        <Modal onClose={() => setModal(null)} wide>
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-stone-900">Invoice {selectedInvoice.invoice_number}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[selectedInvoice.status]}`}>{selectedInvoice.status}</span>
              </div>
              <p className="text-sm text-stone-500 mt-0.5">{selectedInvoice.clients?.name}</p>
            </div>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Client */}
          <div className="mb-4 p-3 bg-stone-50 rounded-xl text-sm">
            <div className="font-medium text-stone-700">{selectedInvoice.clients?.name}</div>
            {selectedInvoice.clients?.address && <div className="text-stone-500 text-xs mt-0.5">{selectedInvoice.clients.address}</div>}
            {selectedInvoice.clients?.phone && <div className="text-stone-500 text-xs mt-0.5">{selectedInvoice.clients.phone}</div>}
          </div>

          {/* Dates */}
          <div className="flex gap-4 mb-4 text-sm">
            <div><span className="text-stone-400 text-xs">Issued:</span> <span className="text-stone-700">{formatDate(selectedInvoice.issue_date)}</span></div>
            {selectedInvoice.due_date && <div><span className="text-stone-400 text-xs">Due:</span> <span className="text-stone-700">{formatDate(selectedInvoice.due_date)}</span></div>}
            {selectedInvoice.paid_date && <div><span className="text-stone-400 text-xs">Paid:</span> <span className="text-emerald-700">{formatDate(selectedInvoice.paid_date)}</span></div>}
          </div>

          {/* Line items */}
          <div className="mb-4">
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-stone-50 text-xs font-semibold text-stone-500">
                <div className="col-span-6">Description</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-right">Price</div>
                <div className="col-span-2 text-right">Total</div>
              </div>
              {(selectedInvoice.invoice_line_items || []).map((li, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 px-4 py-2.5 border-t border-stone-100 text-sm">
                  <div className="col-span-6 text-stone-800">{li.description}</div>
                  <div className="col-span-2 text-center text-stone-600">{li.quantity}</div>
                  <div className="col-span-2 text-right text-stone-600">${Number(li.unit_price).toFixed(2)}</div>
                  <div className="col-span-2 text-right font-medium text-stone-800">${Number(li.total).toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="mb-4 space-y-1 text-right">
            <div className="text-sm text-stone-500">Subtotal: ${Number(selectedInvoice.subtotal).toFixed(2)}</div>
            {Number(selectedInvoice.tax_amount) > 0 && <div className="text-sm text-stone-500">Tax: ${Number(selectedInvoice.tax_amount).toFixed(2)}</div>}
            <div className="text-lg font-bold text-stone-900">Total: ${Number(selectedInvoice.total).toFixed(2)}</div>
          </div>

          {selectedInvoice.notes && <div className="mb-4 p-3 bg-stone-50 rounded-xl text-sm text-stone-600">{selectedInvoice.notes}</div>}

          <button onClick={() => generatePDF(selectedInvoice)} className="w-full py-2.5 bg-stone-100 text-stone-700 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors mb-2 flex items-center justify-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download PDF
          </button>

          {/* ── Connected flow actions ── */}
          <div className="pt-4 border-t border-stone-200 space-y-2">
            {selectedInvoice.status === 'draft' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => openEdit(selectedInvoice)} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Edit</button>
                  <button onClick={() => updateStatus(selectedInvoice, 'sent')} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Mark as Sent</button>
                </div>
                <button
                  onClick={() => sendInvoice(selectedInvoice)}
                  disabled={sending}
                  className="w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  {sending ? 'Sending…' : 'Send Invoice'}
                </button>
              </div>
            )}

            {(selectedInvoice.status === 'sent' || selectedInvoice.status === 'overdue') && !showPayment && (
              <div className="space-y-2">
                <button
                  onClick={() => sendInvoice(selectedInvoice)}
                  disabled={sending}
                  className="w-full py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  {sending ? 'Sending…' : 'Resend Invoice'}
                </button>
                <button onClick={() => { setPayAmount(String(selectedInvoice.total)); setPayMethod('cash'); setShowPayment(true) }} className="w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
                  Record Payment →
                </button>
              </div>
            )}

            {selectedInvoice.status === 'paid' && (
              <div className="py-2.5 text-center text-emerald-600 text-sm font-medium">✓ Paid{selectedInvoice.paid_date ? ` on ${formatDate(selectedInvoice.paid_date)}` : ''}</div>
            )}

            {/* Inline payment form */}
            {showPayment && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
                <div className="text-sm font-medium text-emerald-800">Record payment for this invoice</div>
                <div>
                  <div className="text-xs text-emerald-600 mb-1">Amount (Invoice total: ${Number(selectedInvoice.total).toFixed(2)})</div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                    <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} step="0.01" className="w-full pl-7 pr-3 py-2.5 bg-white border border-emerald-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                  </div>
                  {payAmount && Number(payAmount) < Number(selectedInvoice.total) && (
                    <div className="text-xs text-amber-600 mt-1">Partial — ${(Number(selectedInvoice.total) - Number(payAmount)).toFixed(2)} remaining</div>
                  )}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {['cash', 'venmo', 'zelle', 'card', 'check'].map(m => (
                    <button key={m} onClick={() => setPayMethod(m)} className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${payMethod === m ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' : 'bg-white text-stone-400 border border-stone-200'}`}>{m}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowPayment(false)} className="flex-1 py-2 bg-white text-stone-600 text-sm font-medium rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors">Cancel</button>
                  <button onClick={handleInvoicePayment} disabled={paymentSaving || !payAmount || Number(payAmount) <= 0} className="flex-1 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors">
                    {paymentSaving ? 'Saving...' : 'Save Payment'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              {selectedInvoice.status !== 'paid' && <button onClick={() => openEdit(selectedInvoice)} className="flex-1 py-2 text-stone-500 text-sm hover:text-stone-700 transition-colors">Edit</button>}
              <button onClick={() => handleDelete(selectedInvoice.id)} className="flex-1 py-2 text-red-400 text-sm hover:text-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add/Edit Invoice Modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal onClose={() => setModal(null)} wide>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-stone-900">{modal === 'add' ? 'New Invoice' : 'Edit Invoice'}</h2>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
            {/* Client */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Client *</label>
              <select value={formClient} onChange={e => handleClientChange(e.target.value)} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600">
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Completed jobs for this client — quick add */}
            {formClient && getClientJobs(formClient).length > 0 && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="text-xs font-semibold text-blue-700 mb-2">Completed jobs to invoice</div>
                <div className="flex flex-wrap gap-2">
                  {getClientJobs(formClient).map(job => {
                    const added = formLines.some(l => l.job_id === job.id)
                    return (
                      <button key={job.id} onClick={() => addJobAsLine(job)} disabled={added} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${added ? 'bg-blue-100 text-blue-400' : 'bg-white text-blue-700 border border-blue-200 hover:bg-blue-100'}`}>
                        {job.title} · {formatDate(job.date)} · ${Number(job.price || 0).toFixed(0)}
                        {added ? ' ✓' : ' +'}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-stone-500">Line Items</label>
                <button onClick={addLine} className="text-xs text-emerald-700 hover:text-emerald-800 font-medium">+ Add line</button>
              </div>
              <div className="space-y-3">
                {formLines.map((line, idx) => (
                  <div key={idx} className="p-3 bg-stone-50 border border-stone-200 rounded-xl">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-6">
                        <input type="text" value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} placeholder="Description" className="w-full px-2.5 py-2 bg-white border border-stone-200 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                      </div>
                      <div className="col-span-1">
                        <input type="number" value={line.quantity} onChange={e => updateLine(idx, 'quantity', e.target.value)} min="1" className="w-full px-2 py-2 bg-white border border-stone-200 rounded-lg text-sm text-center text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                      </div>
                      <div className="col-span-2">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-xs">$</span>
                          <input type="number" value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)} step="0.01" className="w-full pl-5 pr-2 py-2 bg-white border border-stone-200 rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                        </div>
                      </div>
                      <div className="col-span-2 text-right text-sm font-medium text-stone-700">${lineTotal(line).toFixed(0)}</div>
                      <div className="col-span-1 text-right">
                        {formLines.length > 1 && (
                          <button onClick={() => removeLine(idx)} className="p-1 text-stone-300 hover:text-red-500 transition-colors">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {line.job_id && <div className="text-[10px] text-blue-500 mt-1">Linked to completed job</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="text-right space-y-1 p-3 bg-stone-50 rounded-xl">
              <div className="text-sm text-stone-500">Subtotal: ${formSubtotal.toFixed(2)}</div>
              {taxRate > 0 && <div className="text-sm text-stone-500">Tax ({taxRate}%): ${formTax.toFixed(2)}</div>}
              <div className="text-lg font-bold text-stone-900">Total: ${formTotal.toFixed(2)}</div>
            </div>

            {/* Due date */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Due Date</label>
              <input type="date" value={formDueDate} onChange={e => setFormDueDate(e.target.value)} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </div>

            {/* Status (edit only) */}
            {modal === 'edit' && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Status</label>
                <div className="flex gap-2 flex-wrap">
                  {['draft', 'sent', 'paid', 'overdue'].map(s => (
                    <button key={s} type="button" onClick={() => setFormStatus(s)} className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${formStatus === s ? statusColors[s] + ' ring-1 ring-offset-1' : 'bg-stone-50 text-stone-400 border border-stone-200'}`}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Notes</label>
              <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Any notes for this invoice..." rows={2} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-none" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-stone-200">
            <button onClick={() => setModal(null)} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving || !formClient || formLines.every(l => !l.description)} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : modal === 'add' ? 'Create Invoice' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose, wide }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`bg-white rounded-2xl shadow-xl p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>{children}</div>
    </div>
  )
}
