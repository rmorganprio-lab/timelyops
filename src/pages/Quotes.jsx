import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAdminOrg } from '../contexts/AdminOrgContext'
import { useToast } from '../contexts/ToastContext'
import { todayInTimezone, formatDate, getTimezoneAbbr } from '../lib/timezone'
import DeliveryModal from '../components/DeliveryModal'
import { formatCurrency } from '../lib/formatCurrency'
import { formatName } from '../lib/formatAddress'
import { logAudit } from '../lib/auditLog'
import { voidQuote } from '../lib/financialActions'

const statusColors = {
  draft: 'bg-stone-100 text-stone-600',
  sent: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-600',
  expired: 'bg-amber-100 text-amber-600',
  voided: 'bg-stone-200 text-stone-400 line-through',
}

const statusFlow = ['draft', 'sent', 'approved', 'declined', 'expired', 'voided']

const emptyLine = { description: '', quantity: 1, unit_price: 0, frequency: 'one_time' }

function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) }

export default function Quotes({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const currencySymbol = user?.organizations?.settings?.currency_symbol || '$'
  const orgId = user?.org_id
  const { adminViewOrg } = useAdminOrg()
  const effectiveOrgId = adminViewOrg?.id ?? user?.org_id
  const { showToast } = useToast()

  const [quotes, setQuotes] = useState([])
  const [clients, setClients] = useState([])
  const [workers, setWorkers] = useState([])
  const [serviceTypes, setServiceTypes] = useState([])
  const [pricingMatrix, setPricingMatrix] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // 'add' | 'edit' | 'view'
  const [selectedQuote, setSelectedQuote] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [deliveryModal, setDeliveryModal] = useState(null) // quote being sent
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [errors, setErrors] = useState({})

  // Void
  const [voidModal, setVoidModal] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidSaving, setVoidSaving] = useState(false)

  // Schedule form state
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [scheduleDuration, setScheduleDuration] = useState(120)
  const [scheduleFrequency, setScheduleFrequency] = useState('one_time')
  const [scheduleWorker, setScheduleWorker] = useState('')

  // Form state
  const [formClient, setFormClient] = useState('')
  const [formClientProperty, setFormClientProperty] = useState(null)
  const [formLines, setFormLines] = useState([{ ...emptyLine }])
  const [formNotes, setFormNotes] = useState('')
  const [formValidUntil, setFormValidUntil] = useState('')
  const [formStatus, setFormStatus] = useState('draft')
  const [isNewClient, setIsNewClient] = useState(false)
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '', address: '' })
  const [newProperty, setNewProperty] = useState({ property_type: 'residential', bedrooms: '', bathrooms: '', square_footage: '', alarm_code: '', key_info: '', pet_details: '', parking_instructions: '', supply_location: '', special_notes: '' })

  useEffect(() => { loadAll() }, [effectiveOrgId])

  async function loadAll() {
    const [quotesRes, clientsRes, typesRes, matrixRes, workersRes] = await Promise.all([
      supabase.from('quotes').select('*, clients(name, first_name, last_name, phone, email, address, preferred_contact), quote_line_items(*)').eq('org_id', effectiveOrgId).order('created_at', { ascending: false }),
      supabase.from('clients').select('*, client_properties(*)').eq('org_id', effectiveOrgId).eq('status', 'active').order('first_name'),
      supabase.from('service_types').select('*').eq('org_id', effectiveOrgId).eq('is_active', true).order('name'),
      supabase.from('pricing_matrix').select('*').eq('org_id', effectiveOrgId),
      supabase.from('users').select('id, name, availability').eq('org_id', effectiveOrgId).in('role', ['ceo', 'manager', 'worker']).eq('availability', 'available').order('name'),
    ])
    if (quotesRes.error) {
      console.error('Failed to load quotes:', quotesRes.error)
      showToast('Failed to load quotes. Please try again.', 'error')
    }
    if (clientsRes.error) console.error('Failed to load clients for quotes:', clientsRes.error)
    if (typesRes.error) console.error('Failed to load service types for quotes:', typesRes.error)
    if (matrixRes.error) console.error('Failed to load pricing matrix for quotes:', matrixRes.error)
    if (workersRes.error) console.error('Failed to load workers for quotes:', workersRes.error)
    setQuotes(quotesRes.data || [])
    setClients(clientsRes.data || [])
    setServiceTypes(typesRes.data || [])
    setPricingMatrix(matrixRes.data || [])
    setWorkers(workersRes.data || [])
    setLoading(false)
  }

  // ── Filtering ──
  const filtered = quotes.filter(q => {
    if (filter !== 'all' && q.status !== filter) return false
    if (search) {
      const s = search.toLowerCase()
      const clientName = formatName(q.clients?.first_name, q.clients?.last_name) || q.clients?.name || ''
      return clientName.toLowerCase().includes(s) || q.quote_number?.toLowerCase().includes(s)
    }
    return true
  })

  // ── Helpers ──

  function getNextQuoteNumber() {
    const existing = quotes.map(q => {
      const num = q.quote_number?.replace(/\D/g, '')
      return num ? Number(num) : 0
    })
    const max = existing.length > 0 ? Math.max(...existing) : 0
    return `QT-${String(max + 1).padStart(4, '0')}`
  }

  // ── Auto-fill helpers ──

  function getClientProperty(clientId) {
    const client = clients.find(c => c.id === clientId)
    return client?.client_properties?.[0] || null
  }

  function lookupPrice(serviceTypeId, bedrooms, bathrooms, frequency) {
    if (!serviceTypeId || !bedrooms || !bathrooms) return null
    const match = pricingMatrix.find(p =>
      p.service_type_id === serviceTypeId &&
      p.bedrooms === Number(bedrooms) &&
      p.bathrooms === Number(bathrooms) &&
      p.frequency === frequency
    )
    return match?.price || null
  }

  function getNextQuoteNumber() {
    const existing = quotes.map(q => {
      const num = q.quote_number?.replace(/\D/g, '')
      return num ? Number(num) : 0
    })
    const max = existing.length > 0 ? Math.max(...existing) : 0
    return `Q-${String(max + 1).padStart(4, '0')}`
  }

  // ── Modal openers ──

  function openAdd() {
    const today = todayInTimezone(tz)
    const validDate = new Date(today + 'T12:00:00')
    validDate.setDate(validDate.getDate() + 30)
    const validStr = `${validDate.getFullYear()}-${String(validDate.getMonth() + 1).padStart(2, '0')}-${String(validDate.getDate()).padStart(2, '0')}`

    setFormClient('')
    setFormClientProperty(null)
    setFormLines([{ ...emptyLine }])
    setFormNotes('')
    setFormValidUntil(validStr)
    setFormStatus('draft')
    setSelectedQuote(null)
    setIsNewClient(false)
    setNewClient({ name: '', phone: '', email: '', address: '' })
    setNewProperty({ property_type: 'residential', bedrooms: '', bathrooms: '', square_footage: '', alarm_code: '', key_info: '', pet_details: '', parking_instructions: '', supply_location: '', special_notes: '' })
    setErrors({})
    setModal('add')
  }

  function openEdit(quote) {
    setSelectedQuote(quote)
    setFormClient(quote.client_id)
    setFormClientProperty(getClientProperty(quote.client_id))
    setFormLines(
      quote.quote_line_items?.length > 0
        ? quote.quote_line_items.map(li => ({
            id: li.id,
            description: li.description,
            quantity: li.quantity,
            unit_price: Number(li.unit_price),
            frequency: li.frequency || 'one_time',
          }))
        : [{ ...emptyLine }]
    )
    setFormNotes(quote.notes || '')
    setFormValidUntil(quote.valid_until || '')
    setFormStatus(quote.status)
    setErrors({})
    setModal('edit')
  }

  function openView(quote) {
    setSelectedQuote(quote)
    setShowScheduleForm(false)
    setModal('view')
  }

  // ── Client selection → auto-fill ──

  function handleClientChange(clientId) {
    setFormClient(clientId)
    const prop = getClientProperty(clientId)
    setFormClientProperty(prop)

    // Auto-fill first line item if we have service types and property data
    if (prop && serviceTypes.length > 0 && formLines.length === 1 && !formLines[0].description) {
      const st = serviceTypes[0]
      const price = lookupPrice(st.id, prop.bedrooms, prop.bathrooms, 'one_time')
      setFormLines([{
        description: st.name,
        quantity: 1,
        unit_price: price || st.default_price || 0,
        frequency: 'one_time',
        service_type_id: st.id,
      }])
    }
  }

  // ── Line item management ──

  function updateLine(idx, field, value) {
    setFormLines(lines => {
      const updated = [...lines]
      updated[idx] = { ...updated[idx], [field]: value }

      // If service type changed, update description and try to auto-fill price
      if (field === 'service_type_id') {
        const st = serviceTypes.find(s => s.id === value)
        if (st) {
          updated[idx].description = st.name
          const prop = formClientProperty
          if (prop?.bedrooms && prop?.bathrooms) {
            const price = lookupPrice(value, prop.bedrooms, prop.bathrooms, updated[idx].frequency)
            if (price) updated[idx].unit_price = price
            else updated[idx].unit_price = st.default_price || 0
          } else {
            updated[idx].unit_price = st.default_price || 0
          }
        }
      }

      // If frequency changed, re-lookup price
      if (field === 'frequency' && updated[idx].service_type_id && formClientProperty) {
        const price = lookupPrice(
          updated[idx].service_type_id,
          formClientProperty.bedrooms,
          formClientProperty.bathrooms,
          value
        )
        if (price) updated[idx].unit_price = price
      }

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

  // ── Pricing matrix empty check ──
  // Returns true if the matrix has no entries for the given service type (or is entirely empty)
  function matrixEmptyForLine(line) {
    if (pricingMatrix.length === 0) return true
    if (!line.service_type_id) return false
    return !pricingMatrix.some(p => p.service_type_id === line.service_type_id)
  }

  // ── Calculated totals ──

  const lineTotal = (line) => Number(line.quantity) * Number(line.unit_price)
  const formSubtotal = formLines.reduce((sum, l) => sum + lineTotal(l), 0)
  const taxRate = user?.organizations?.default_tax_rate ?? user?.organizations?.settings?.tax_rate ?? 0
  const taxLabel = user?.organizations?.tax_label || 'Tax'
  const formTax = formSubtotal * (taxRate / 100)
  const formTotal = formSubtotal + formTax

  // ── Auto-fill price for new client property inputs ──

  function autoFillNewClientPrice(bedrooms, bathrooms) {
    if (!bedrooms || !bathrooms || serviceTypes.length === 0) return
    const st = formLines[0]?.service_type_id ? serviceTypes.find(s => s.id === formLines[0].service_type_id) : serviceTypes[0]
    if (!st) return
    const freq = formLines[0]?.frequency || 'one_time'
    const price = lookupPrice(st.id, Number(bedrooms), Number(bathrooms), freq)
    if (price) {
      setFormLines(lines => {
        const updated = [...lines]
        updated[0] = { ...updated[0], unit_price: price, description: updated[0].description || st.name, service_type_id: updated[0].service_type_id || st.id }
        return updated
      })
    }
  }

  function validate() {
    const errs = {}
    if (!formClient && !isNewClient) errs.client = 'Please select a client.'
    if (isNewClient && !newClient.name.trim()) errs.client = 'Client name is required.'
    if (formLines.length === 0) errs.lines = 'Add at least one line item.'
    const lineErrs = formLines.map((l, i) => {
      if (!l.description.trim()) return `Line ${i + 1}: description is required.`
      if (Number(l.quantity) <= 0) return `Line ${i + 1}: quantity must be greater than 0.`
      if (Number(l.unit_price) < 0) return `Line ${i + 1}: price cannot be negative.`
      return null
    }).filter(Boolean)
    if (lineErrs.length > 0) errs.lines = lineErrs[0]
    if (formSubtotal <= 0) errs.total = 'Total must be greater than 0.'
    return errs
  }

  // ── Save ──

  async function handleSave() {
    setSaving(true)
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); setSaving(false); return; }

    let clientId = formClient

    if (isNewClient) {
      if (!newClient.name.trim()) return setSaving(false)

      const { data: createdClient, error: clientError } = await supabase.from('clients').insert({
        org_id: effectiveOrgId,
        name: newClient.name,
        phone: newClient.phone || null,
        email: newClient.email || null,
        address: newClient.address || null,
        status: 'active',
        tags: ['quote'],
      }).select().single()

      if (clientError || !createdClient) {
        console.error('Failed to create new client:', clientError)
        showToast('Failed to save changes. Please try again.', 'error')
        setSaving(false)
        return
      }
      clientId = createdClient.id

      const hasPropertyData = newProperty.bedrooms || newProperty.bathrooms || newProperty.pet_details || newProperty.parking_instructions || newProperty.square_footage
      if (hasPropertyData) {
        await supabase.from('client_properties').insert({
          client_id: clientId,
          org_id: effectiveOrgId,
          property_type: newProperty.property_type || 'residential',
          bedrooms: newProperty.bedrooms ? Number(newProperty.bedrooms) : null,
          bathrooms: newProperty.bathrooms ? Number(newProperty.bathrooms) : null,
          square_footage: newProperty.square_footage ? Number(newProperty.square_footage) : null,
          alarm_code: newProperty.alarm_code || null,
          key_info: newProperty.key_info || null,
          pet_details: newProperty.pet_details || null,
          parking_instructions: newProperty.parking_instructions || null,
          supply_location: newProperty.supply_location || null,
          special_notes: newProperty.special_notes || null,
        })
      }

      await supabase.from('client_timeline').insert({
        org_id: effectiveOrgId, client_id: clientId,
        event_type: 'note', summary: 'Client created from quote',
        created_by: user.id,
      })
    }

    const quoteData = {
      org_id: effectiveOrgId,
      client_id: clientId,
      quote_number: selectedQuote?.quote_number || getNextQuoteNumber(),
      subtotal: formSubtotal,
      tax_amount: formTax,
      total: formTotal,
      status: formStatus,
      notes: formNotes || null,
      valid_until: formValidUntil || null,
    }

    let quoteId
    if (modal === 'add') {
      const { data, error: quoteError } = await supabase.from('quotes').insert(quoteData).select().single()
      if (quoteError) {
        console.error('Failed to create quote:', quoteError)
        showToast('Failed to save changes. Please try again.', 'error')
        setSaving(false)
        return
      }
      quoteId = data?.id

      // Timeline entry
      if (quoteId) {
        await supabase.from('client_timeline').insert({
          org_id: effectiveOrgId, client_id: clientId,
          event_type: 'quote', summary: `Quote ${quoteData.quote_number} created for ${formatCurrency(formTotal, currencySymbol)}`,
          created_by: user.id,
        })
        await logAudit({
          supabase, user, adminViewOrg,
          action: 'create',
          entityType: 'quote',
          entityId: quoteId,
          changes: { quote_number: quoteData.quote_number, total: formTotal, status: formStatus },
        })
      }
    } else {
      const { error: quoteError } = await supabase.from('quotes').update(quoteData).eq('id', selectedQuote.id)
      if (quoteError) {
        console.error('Failed to update quote:', quoteError)
        showToast('Failed to save changes. Please try again.', 'error')
        setSaving(false)
        return
      }
      quoteId = selectedQuote.id
      // Delete old line items
      await supabase.from('quote_line_items').delete().eq('quote_id', quoteId)
    }

    // Insert line items
    if (quoteId) {
      const lineItems = formLines.filter(l => l.description).map(l => ({
        quote_id: quoteId,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
        total: Number(l.quantity) * Number(l.unit_price),
      }))
      if (lineItems.length > 0) {
        await supabase.from('quote_line_items').insert(lineItems)
      }
    }

    setSaving(false)
    setModal(null)
    loadAll()

    // For new quotes: fetch full quote with client data and open delivery modal immediately
    if (modal === 'add' && quoteId) {
      const { data: freshQuote } = await supabase
        .from('quotes')
        .select('*, clients(name, first_name, last_name, phone, email, address, preferred_contact), quote_line_items(*)')
        .eq('id', quoteId)
        .single()
      if (freshQuote) setDeliveryModal(freshQuote)
    }
  }

  // ── Send quote ──

  async function ensureApprovalToken(quote) {
    let token = quote.approval_token
    if (!token) {
      token = crypto.randomUUID()
      await supabase.from('quotes').update({ approval_token: token }).eq('id', quote.id)
    }
    return token
  }

  async function sendQuoteEmail(quote) {
    setSending(true)
    try {
      const token = await ensureApprovalToken(quote)
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error } = await supabase.functions.invoke('send-email', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { type: 'quote', quote_id: quote.id },
      })
      if (error || data?.error) throw new Error(error?.message || data?.error || 'Send failed')
      if (quote.status === 'draft') {
        await supabase.from('quotes').update({ status: 'sent' }).eq('id', quote.id)
        await logAudit({ supabase, user, adminViewOrg, action: 'status_change', entityType: 'quote', entityId: quote.id, changes: { status: { from: 'draft', to: 'sent' } }, metadata: { channel: 'email' } })
      }
      showToast(`Quote emailed to ${quote.clients.email}`)
      setDeliveryModal(null)
      loadAll()
      setSelectedQuote(prev => prev ? { ...prev, status: 'sent', approval_token: token } : prev)
    } catch (err) {
      showToast(err.message || 'Failed to send quote', 'error')
    } finally {
      setSending(false)
    }
  }

  async function sendQuoteSms(quote) {
    setSending(true)
    try {
      const token = await ensureApprovalToken(quote)
      const firstName = quote.clients.first_name || quote.clients.name?.split(' ')[0] || 'there'
      const orgName = user.organizations?.name || ''
      const link = `https://www.timelyops.com/approve/${token}`
      const message = `Hi ${firstName}, ${orgName} sent you a quote for ${formatCurrency(quote.total, currencySymbol)}. View and approve: ${link}`
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: { to: quote.clients.phone, message },
      })
      if (error || data?.error) throw new Error(error?.message || data?.error || 'SMS failed')
      if (quote.status === 'draft') {
        await supabase.from('quotes').update({ status: 'sent' }).eq('id', quote.id)
        await logAudit({ supabase, user, adminViewOrg, action: 'status_change', entityType: 'quote', entityId: quote.id, changes: { status: { from: 'draft', to: 'sent' } }, metadata: { channel: 'sms' } })
      }
      showToast(`Quote sent via SMS to ${quote.clients.phone}`)
      setDeliveryModal(null)
      loadAll()
      setSelectedQuote(prev => prev ? { ...prev, status: 'sent', approval_token: token } : prev)
    } catch (err) {
      showToast(err.message || 'Failed to send SMS', 'error')
    } finally {
      setSending(false)
    }
  }

  async function copyQuoteLink(quote) {
    const token = await ensureApprovalToken(quote)
    const link = `https://www.timelyops.com/approve/${token}`
    await navigator.clipboard.writeText(link)
    if (quote.status === 'draft') {
      await supabase.from('quotes').update({ status: 'sent' }).eq('id', quote.id)
      await logAudit({ supabase, user, adminViewOrg, action: 'status_change', entityType: 'quote', entityId: quote.id, changes: { status: { from: 'draft', to: 'sent' } }, metadata: { channel: 'link' } })
    }
    showToast('Link copied! Paste it in WhatsApp or text.')
    setDeliveryModal(null)
    loadAll()
    setSelectedQuote(prev => prev ? { ...prev, status: 'sent', approval_token: token } : prev)
  }

  // ── Status update ──

  async function updateStatus(quote, newStatus) {
    const { error } = await supabase.from('quotes').update({ status: newStatus }).eq('id', quote.id)
    if (error) {
      console.error('Failed to update quote status:', error)
      showToast('Something went wrong. Please try again.', 'error')
      return
    }

    await logAudit({
      supabase, user, adminViewOrg,
      action: 'status_change',
      entityType: 'quote',
      entityId: quote.id,
      changes: { status: { from: quote.status, to: newStatus } },
    })

    if (newStatus === 'approved') {
      await supabase.from('client_timeline').insert({
        org_id: effectiveOrgId, client_id: quote.client_id,
        event_type: 'quote', summary: `Quote ${quote.quote_number} approved`,
        created_by: user.id,
      })
    }

    loadAll()
    if (selectedQuote?.id === quote.id) {
      setSelectedQuote({ ...quote, status: newStatus })
    }
  }

  // ── Convert to Job ──

  async function handleConvertToJob() {
    if (!selectedQuote || !scheduleDate) return
    setSaving(true)

    const firstLine = selectedQuote.quote_line_items?.[0]
    const perVisitPrice = firstLine ? Number(firstLine.unit_price) : Number(selectedQuote.total)

    const jobData = {
      org_id: effectiveOrgId,
      client_id: selectedQuote.client_id,
      title: firstLine?.description || 'Service',
      date: scheduleDate,
      start_time: scheduleTime,
      duration_minutes: scheduleDuration,
      status: 'scheduled',
      price: perVisitPrice,
      notes: `From quote ${selectedQuote.quote_number}`,
      frequency: scheduleFrequency,
    }

    const { data: newJob } = await supabase.from('jobs').insert(jobData).select().single()

    if (newJob) {
      if (scheduleWorker) {
        await supabase.from('job_assignments').insert({ job_id: newJob.id, user_id: scheduleWorker })
      }

      if (scheduleFrequency !== 'one_time') {
        await supabase.from('jobs').update({ recurrence_group_id: newJob.id }).eq('id', newJob.id)
        const recurringJobs = []
        for (let i = 1; i <= 11; i++) {
          const nextDate = new Date(scheduleDate + 'T12:00:00')
          if (scheduleFrequency === 'monthly') nextDate.setMonth(nextDate.getMonth() + i)
          else {
            const interval = scheduleFrequency === 'weekly' ? 7 : 14
            nextDate.setDate(nextDate.getDate() + (interval * i))
          }
          const dateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
          recurringJobs.push({ ...jobData, date: dateStr, recurrence_group_id: newJob.id })
        }
        const { data: createdJobs } = await supabase.from('jobs').insert(recurringJobs).select()
        if (scheduleWorker && createdJobs) {
          const assignments = createdJobs.map(j => ({ job_id: j.id, user_id: scheduleWorker }))
          await supabase.from('job_assignments').insert(assignments)
        }
      }

      await supabase.from('client_timeline').insert({
        org_id: effectiveOrgId, client_id: selectedQuote.client_id,
        event_type: 'job',
        summary: `Job${scheduleFrequency !== 'one_time' ? 's (12 recurring)' : ''} created from quote ${selectedQuote.quote_number}`,
        created_by: user.id,
      })
    }

    setSaving(false)
    setShowScheduleForm(false)
    setModal(null)
    loadAll()
  }

  // ── Void ──

  async function handleVoidQuote() {
    if (!voidModal || !voidReason.trim()) return
    setVoidSaving(true)
    try {
      await voidQuote({ supabase, quoteId: voidModal.id, reason: voidReason, user, adminViewOrg })
      setVoidModal(null)
      setVoidReason('')
      setModal(null)
      showToast('Quote voided.')
      loadAll()
    } catch (err) {
      showToast(err.message || 'Failed to void quote.', 'error')
    } finally {
      setVoidSaving(false)
    }
  }

  const clientName = (id) => { const c = clients.find(c => c.id === id); return c ? (formatName(c.first_name, c.last_name) || c.name || 'Unknown') : 'Unknown' }

  if (loading) return <div className="p-6 md:p-8 text-stone-400">Loading quotes...</div>

  // ── Stats ──
  const draftCount = quotes.filter(q => q.status === 'draft').length
  const sentCount = quotes.filter(q => q.status === 'sent').length
  const approvedTotal = quotes.filter(q => q.status === 'approved').reduce((s, q) => s + Number(q.total || 0), 0)

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Quotes</h1>
          <p className="text-stone-500 text-sm mt-1">
            {quotes.length} total
            {draftCount > 0 && <span className="text-stone-400"> · {draftCount} drafts</span>}
            {sentCount > 0 && <span className="text-blue-600"> · {sentCount} awaiting response</span>}
          </p>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Quote
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-1">Drafts</div>
          <div className="text-2xl font-bold text-stone-700">{draftCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-1">Awaiting Response</div>
          <div className="text-2xl font-bold text-blue-700">{sentCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 mb-1">Approved Value</div>
          <div className="text-2xl font-bold text-emerald-700">{currencySymbol}{approvedTotal.toFixed(0)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder="Search client or quote #..." value={search} onChange={e => setSearch(e.target.value)} className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 w-full sm:w-64" />
        <div className="flex gap-1 bg-white border border-stone-200 rounded-xl p-1">
          {['all', ...statusFlow].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${filter === s ? 'bg-emerald-700 text-white' : 'text-stone-500 hover:text-stone-700'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Quote List */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-stone-400 text-sm mb-3">{quotes.length === 0 ? 'No quotes yet.' : 'No quotes match your filter.'}</p>
            {quotes.length === 0 && <button onClick={openAdd} className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800">Create First Quote</button>}
          </div>
        ) : (
          <div>
            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-stone-100 text-xs font-semibold text-stone-400 uppercase tracking-wider">
              <div className="col-span-1">#</div>
              <div className="col-span-3">Client</div>
              <div className="col-span-2">Date</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Total</div>
              <div className="col-span-2 text-right">Valid Until</div>
            </div>
            {filtered.map(q => (
              <div key={q.id} onClick={() => openView(q)} className={`grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-5 py-4 border-b border-stone-50 hover:bg-stone-50 cursor-pointer transition-colors items-center ${q.status === 'voided' ? 'opacity-60' : ''}`}>
                <div className="md:col-span-1 text-xs font-mono text-stone-400">{q.quote_number}</div>
                <div className="md:col-span-3">
                  <div className={`font-medium text-sm ${q.status === 'voided' ? 'text-stone-400 line-through' : 'text-stone-900'}`}>{formatName(q.clients?.first_name, q.clients?.last_name) || q.clients?.name}</div>
                </div>
                <div className="md:col-span-2 text-sm text-stone-600">{formatDate(q.created_at?.split('T')[0])}</div>
                <div className="md:col-span-2">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[q.status] || 'bg-stone-100 text-stone-400'}`}>{q.status}</span>
                </div>
                <div className={`md:col-span-2 text-right font-semibold ${q.status === 'voided' ? 'text-stone-400 line-through' : 'text-stone-900'}`}>{formatCurrency(q.total, currencySymbol)}</div>
                <div className="md:col-span-2 text-right text-sm text-stone-400">{q.valid_until ? formatDate(q.valid_until) : '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── View Quote Modal ── */}
      {modal === 'view' && selectedQuote && (
        <Modal onClose={() => setModal(null)} wide>
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-stone-900">Quote {selectedQuote.quote_number}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[selectedQuote.status]}`}>{selectedQuote.status}</span>
              </div>
              <p className="text-sm text-stone-500 mt-0.5">{formatName(selectedQuote.clients?.first_name, selectedQuote.clients?.last_name) || selectedQuote.clients?.name}</p>
            </div>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Client details */}
          <div className="mb-4 p-3 bg-stone-50 rounded-xl text-sm">
            <div className="font-medium text-stone-700">{formatName(selectedQuote.clients?.first_name, selectedQuote.clients?.last_name) || selectedQuote.clients?.name}</div>
            {selectedQuote.clients?.address && <div className="text-stone-500 text-xs mt-0.5">{selectedQuote.clients.address}</div>}
            {selectedQuote.clients?.phone && <div className="text-stone-500 text-xs mt-0.5">{selectedQuote.clients.phone}</div>}
          </div>

          {/* Line items */}
          <div className="mb-4">
            <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Line Items</div>
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-stone-50 text-xs font-semibold text-stone-500">
                <div className="col-span-6">Description</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-right">Price</div>
                <div className="col-span-2 text-right">Total</div>
              </div>
              {(selectedQuote.quote_line_items || []).map((li, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 px-4 py-2.5 border-t border-stone-100 text-sm">
                  <div className="col-span-6 text-stone-800">{li.description}</div>
                  <div className="col-span-2 text-center text-stone-600">{li.quantity}</div>
                  <div className="col-span-2 text-right text-stone-600">{formatCurrency(li.unit_price, currencySymbol)}</div>
                  <div className="col-span-2 text-right font-medium text-stone-800">{formatCurrency(li.total, currencySymbol)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="mb-4 space-y-1 text-right">
            <div className="text-sm text-stone-500">Subtotal: {formatCurrency(selectedQuote.subtotal, currencySymbol)}</div>
            {Number(selectedQuote.tax_amount) > 0 && <div className="text-sm text-stone-500">{taxLabel}{taxRate > 0 ? ` (${taxRate}%)` : ''}: {formatCurrency(selectedQuote.tax_amount, currencySymbol)}</div>}
            <div className="text-lg font-bold text-stone-900">Total: {formatCurrency(selectedQuote.total, currencySymbol)}</div>
          </div>

          {selectedQuote.valid_until && (
            <div className="text-xs text-stone-400 mb-2">Valid until {formatDate(selectedQuote.valid_until)}</div>
          )}
          {selectedQuote.notes && (
            <div className="mb-4 p-3 bg-stone-50 rounded-xl text-sm text-stone-600">{selectedQuote.notes}</div>
          )}

          {/* Status actions — the connected flow */}
          <div className="pt-4 border-t border-stone-200 space-y-2">
            {selectedQuote.status === 'draft' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => openEdit(selectedQuote)} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Edit</button>
                  <button onClick={() => updateStatus(selectedQuote, 'sent')} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Mark as Sent</button>
                </div>
                <button
                  onClick={() => setDeliveryModal(selectedQuote)}
                  className="w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Send Quote
                </button>
              </div>
            )}
            {selectedQuote.status === 'sent' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => updateStatus(selectedQuote, 'approved')} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">Approved</button>
                  <button onClick={() => updateStatus(selectedQuote, 'declined')} className="flex-1 py-2.5 bg-red-50 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100 transition-colors">Declined</button>
                </div>
                <button
                  onClick={() => setDeliveryModal(selectedQuote)}
                  className="w-full py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Resend Quote
                </button>
              </div>
            )}
            {selectedQuote.status === 'approved' && !showScheduleForm && (
              <button onClick={() => {
                setShowScheduleForm(true)
                setScheduleDate(todayInTimezone(tz))
                setScheduleTime('09:00')
                const firstLine = selectedQuote.quote_line_items?.[0]
                const qty = firstLine?.quantity || 1
                setScheduleFrequency(qty > 1 ? 'weekly' : 'one_time')
                setScheduleDuration(120)
              }} className="w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
                Schedule Job from This Quote →
              </button>
            )}

            {showScheduleForm && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
                <div className="text-sm font-medium text-emerald-800">Schedule this job</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">Start Date *</label>
                    <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">Time</label>
                    <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">Duration (min)</label>
                    <input type="number" value={scheduleDuration} onChange={e => setScheduleDuration(Number(e.target.value))} className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">Frequency</label>
                    <select value={scheduleFrequency} onChange={e => setScheduleFrequency(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600">
                      <option value="one_time">One time</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Biweekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                {scheduleFrequency !== 'one_time' && (
                  <div className="text-xs text-emerald-600">This will create 12 recurring instances starting {scheduleDate}</div>
                )}
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Assign Worker (optional)</label>
                  <select value={scheduleWorker} onChange={e => setScheduleWorker(e.target.value)} className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600">
                    <option value="">Unassigned</option>
                    {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowScheduleForm(false)} className="flex-1 py-2 bg-white text-stone-600 text-sm font-medium rounded-xl border border-stone-200 hover:bg-stone-50 transition-colors">Cancel</button>
                  <button onClick={() => handleConvertToJob()} disabled={!scheduleDate || saving} className="flex-1 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors">
                    {saving ? 'Creating...' : 'Create Job'}
                  </button>
                </div>
              </div>
            )}

            {selectedQuote.status === 'declined' && (
              <button onClick={() => openEdit(selectedQuote)} className="w-full py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Revise Quote</button>
            )}

            {selectedQuote.status === 'voided' && (
              <div className="mt-2 p-3 bg-stone-50 border border-stone-200 rounded-xl">
                <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">Void Reason</div>
                <div className="text-sm text-stone-600">{selectedQuote.void_reason || '—'}</div>
              </div>
            )}

            {selectedQuote.status !== 'voided' && (
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setVoidModal(selectedQuote); setVoidReason('') }} className="flex-1 py-2 text-red-400 text-sm hover:text-red-600 transition-colors">Void Quote</button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Add/Edit Quote Modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal onClose={() => setModal(null)} wide>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-stone-900">{modal === 'add' ? 'New Quote' : 'Edit Quote'}</h2>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
            {/* Client selector OR new client form */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-stone-500">Client *</label>
                <button type="button" onClick={() => { setIsNewClient(!isNewClient); setFormClient(''); setFormClientProperty(null) }} className="text-xs text-emerald-700 hover:text-emerald-800 font-medium">
                  {isNewClient ? '← Select existing client' : '+ New client'}
                </button>
              </div>

              {!isNewClient ? (
                <>
                  <select value={formClient} onChange={e => { handleClientChange(e.target.value); setErrors(er => { const n = {...er}; delete n.client; return n }) }} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600">
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{formatName(c.first_name, c.last_name) || c.name}</option>)}
                  </select>
                  {errors.client && <p className="text-xs text-red-500 mt-1">{errors.client}</p>}
                </>
              ) : (
                <div className="space-y-3 p-4 bg-stone-50 border border-stone-200 rounded-xl">
                  <div className="text-xs font-semibold text-stone-600 mb-2">New Client Details</div>
                  <input type="text" value={newClient.name} onChange={e => { setNewClient(nc => ({...nc, name: e.target.value})); setErrors(er => { const n = {...er}; delete n.client; return n }) }} placeholder="Full name *" className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                  {errors.client && <p className="text-xs text-red-500 mt-1">{errors.client}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <input type="tel" value={newClient.phone} onChange={e => setNewClient(nc => ({...nc, phone: e.target.value}))} placeholder="Phone" className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                    <input type="email" value={newClient.email} onChange={e => setNewClient(nc => ({...nc, email: e.target.value}))} placeholder="Email" className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                  </div>
                  <input type="text" value={newClient.address} onChange={e => setNewClient(nc => ({...nc, address: e.target.value}))} placeholder="Address" className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />

                  <div className="text-xs font-semibold text-stone-600 mt-3 mb-2">Property Details</div>
                  <div className="grid grid-cols-4 gap-2">
                    <select value={newProperty.property_type} onChange={e => setNewProperty(np => ({...np, property_type: e.target.value}))} className="w-full px-2 py-2 bg-white border border-stone-200 rounded-xl text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600">
                      <option value="residential">Residential</option>
                      <option value="commercial">Commercial</option>
                      <option value="office">Office</option>
                      <option value="other">Other</option>
                    </select>
                    <input type="number" value={newProperty.bedrooms} onChange={e => { setNewProperty(np => ({...np, bedrooms: e.target.value})); autoFillNewClientPrice(e.target.value, newProperty.bathrooms) }} placeholder="BR" className="w-full px-2 py-2 bg-white border border-stone-200 rounded-xl text-sm text-center text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                    <input type="number" value={newProperty.bathrooms} onChange={e => { setNewProperty(np => ({...np, bathrooms: e.target.value})); autoFillNewClientPrice(newProperty.bedrooms, e.target.value) }} placeholder="BA" className="w-full px-2 py-2 bg-white border border-stone-200 rounded-xl text-sm text-center text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                    <input type="number" value={newProperty.square_footage} onChange={e => setNewProperty(np => ({...np, square_footage: e.target.value}))} placeholder="Sq ft" className="w-full px-2 py-2 bg-white border border-stone-200 rounded-xl text-sm text-center text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                  </div>
                  <input type="text" value={newProperty.pet_details} onChange={e => setNewProperty(np => ({...np, pet_details: e.target.value}))} placeholder="Pets? (e.g. 1 dog, friendly)" className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                  <input type="text" value={newProperty.parking_instructions} onChange={e => setNewProperty(np => ({...np, parking_instructions: e.target.value}))} placeholder="Parking instructions" className="w-full px-3 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                </div>
              )}
            </div>

            {/* Property summary — shows auto-detected info */}
            {formClientProperty && (formClientProperty.bedrooms || formClientProperty.bathrooms) && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="text-xs font-semibold text-emerald-700 mb-1">Property on file</div>
                <div className="text-sm text-emerald-800">
                  {formClientProperty.bedrooms && `${formClientProperty.bedrooms} BR`}
                  {formClientProperty.bedrooms && formClientProperty.bathrooms && ' / '}
                  {formClientProperty.bathrooms && `${formClientProperty.bathrooms} BA`}
                  {formClientProperty.square_footage && ` · ${formClientProperty.square_footage} sq ft`}
                  {formClientProperty.pet_details && ' · 🐾'}
                </div>
                <div className="text-[10px] text-emerald-600 mt-1">Price auto-filled from pricing matrix</div>
              </div>
            )}

            {/* Pricing matrix empty state prompt */}
            {pricingMatrix.length === 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start justify-between gap-3">
                <div className="text-xs text-amber-800">
                  <span className="font-semibold">Pricing matrix not set up</span> — prices won't auto-fill until you add your rates.
                </div>
                <Link to="/settings" className="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900 underline whitespace-nowrap">
                  Set up pricing →
                </Link>
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
                    {/* Service type quick-select */}
                    {serviceTypes.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap mb-2">
                        {serviceTypes.map(st => (
                          <button key={st.id} type="button" onClick={() => updateLine(idx, 'service_type_id', st.id)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                              line.service_type_id === st.id ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200' : 'bg-white text-stone-400 border border-stone-200 hover:border-stone-300'
                            }`}>
                            {st.name}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <input type="text" value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} placeholder="Description" className="w-full px-2.5 py-2 bg-white border border-stone-200 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                      </div>
                      <div className="col-span-2">
                        <select value={line.frequency || 'one_time'} onChange={e => updateLine(idx, 'frequency', e.target.value)} className="w-full px-2 py-2 bg-white border border-stone-200 rounded-lg text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-600">
                          <option value="one_time">Once</option>
                          <option value="weekly">Weekly</option>
                          <option value="biweekly">Biweekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>
                      <div className="col-span-1">
                        <input type="number" value={line.quantity} onChange={e => updateLine(idx, 'quantity', e.target.value)} min="1" className="w-full px-2 py-2 bg-white border border-stone-200 rounded-lg text-sm text-center text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
                      </div>
                      <div className="col-span-2">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 text-xs">{currencySymbol}</span>
                          <input type="number" value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)} step="0.01" className={`w-full pl-5 pr-2 py-2 bg-white border rounded-lg text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 ${pricingMatrix.length > 0 && line.service_type_id && matrixEmptyForLine(line) && Number(line.unit_price) === 0 ? 'border-amber-300' : 'border-stone-200'}`} />
                        </div>
                        {pricingMatrix.length > 0 && line.service_type_id && matrixEmptyForLine(line) && Number(line.unit_price) === 0 && (
                          <div className="text-[10px] text-amber-600 mt-0.5">No rate set for this service type</div>
                        )}
                      </div>
                      <div className="col-span-1 text-right text-sm font-medium text-stone-700">{currencySymbol}{lineTotal(line).toFixed(0)}</div>
                      <div className="col-span-1 text-right">
                        {formLines.length > 1 && (
                          <button onClick={() => removeLine(idx)} className="p-1 text-stone-300 hover:text-red-500 transition-colors">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {errors.lines && <p className="text-xs text-red-500 mt-1">{errors.lines}</p>}

            {/* Totals */}
            <div className="text-right space-y-1 p-3 bg-stone-50 rounded-xl">
              <div className="text-sm text-stone-500">Subtotal: {formatCurrency(formSubtotal, currencySymbol)}</div>
              {taxRate > 0 && <div className="text-sm text-stone-500">{taxLabel} ({taxRate}%): {formatCurrency(formTax, currencySymbol)}</div>}
              <div className="text-lg font-bold text-stone-900">Total: {formatCurrency(formTotal, currencySymbol)}</div>
            </div>
            {errors.total && <p className="text-xs text-red-500 mt-1">{errors.total}</p>}

            {/* Valid until */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Valid Until</label>
              <input type="date" value={formValidUntil} onChange={e => setFormValidUntil(e.target.value)} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </div>

            {/* Status (edit only) */}
            {modal === 'edit' && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Status</label>
                <div className="flex gap-2 flex-wrap">
                  {statusFlow.filter(s => s !== 'voided').map(s => (
                    <button key={s} type="button" onClick={() => setFormStatus(s)} className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${formStatus === s ? statusColors[s] + ' ring-1 ring-offset-1' : 'bg-stone-50 text-stone-400 border border-stone-200'}`}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Notes</label>
              <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Any notes for this quote..." rows={2} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-none" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-stone-200">
            <button onClick={() => setModal(null)} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : modal === 'add' ? 'Create Quote' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delivery picker */}
      {deliveryModal && (
        <DeliveryModal
          client={deliveryModal.clients}
          publicUrl={`https://www.timelyops.com/approve/${deliveryModal.approval_token}`}
          label="Quote"
          sending={sending}
          onEmail={() => sendQuoteEmail(deliveryModal)}
          onSms={() => sendQuoteSms(deliveryModal)}
          onCopyLink={() => copyQuoteLink(deliveryModal)}
          onClose={() => setDeliveryModal(null)}
        />
      )}

      {/* ── Void Quote Modal ── */}
      {voidModal && (
        <Modal onClose={() => { setVoidModal(null); setVoidReason('') }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-stone-900">Void Quote {voidModal.quote_number}</h2>
            <button onClick={() => { setVoidModal(null); setVoidReason('') }} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p className="text-sm text-stone-500 mb-4">Voiding is permanent and cannot be undone. The quote record will be preserved for audit purposes.</p>
          <div className="mb-4">
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Reason for voiding *</label>
            <textarea
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              rows={3}
              placeholder="e.g. Client changed mind, duplicate quote, price no longer valid…"
              className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setVoidModal(null); setVoidReason('') }} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Cancel</button>
            <button onClick={handleVoidQuote} disabled={voidSaving || !voidReason.trim()} className="flex-1 py-2.5 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors">
              {voidSaving ? 'Voiding…' : 'Void Quote'}
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
