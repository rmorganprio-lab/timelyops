import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import CSVImport from '../components/CSVImport'
import { CLIENT_TEMPLATE, validateClientRows, normalizePhone } from '../lib/csv'
import { useAdminOrg } from '../contexts/AdminOrgContext'

const emptyClient = {
  name: '', email: '', phone: '', address: '', notes: '', tags: [], status: 'active', preferred_contact: 'sms',
}

const contactOptions = ['email', 'sms', 'whatsapp', 'phone']
const contactLabels = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', phone: 'Phone call' }

const emptyProperty = {
  property_type: 'residential', bedrooms: '', bathrooms: '', square_footage: '',
  alarm_code: '', key_info: '', pet_details: '', parking_instructions: '',
  supply_location: '', special_notes: '',
}

const statusOptions = ['active', 'inactive', 'vip']
const propertyTypes = ['residential', 'commercial', 'office', 'other']

export default function Clients({ user }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modal, setModal] = useState(null) // 'add' | 'edit' | 'view' | null
  const [selectedClient, setSelectedClient] = useState(null)
  const [form, setForm] = useState(emptyClient)
  const [propertyForm, setPropertyForm] = useState(emptyProperty)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [clientTimeline, setClientTimeline] = useState([])

  const orgId = user?.org_id
  const { adminViewOrg } = useAdminOrg()
  const effectiveOrgId = adminViewOrg?.id ?? user?.org_id

  useEffect(() => {
    loadClients()
  }, [effectiveOrgId])

  async function loadClients() {
    const { data, error } = await supabase
      .from('clients')
      .select('*, client_properties(*)')
      .eq('org_id', effectiveOrgId)
      .order('name')
    
    if (data) setClients(data)
    setLoading(false)
  }

  // Filter clients
  const filtered = clients.filter(c => {
    const matchesSearch = !search || 
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || '').includes(search) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.address || '').toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter
    return matchesSearch && matchesStatus
  })

  // Open modals
  function openAdd() {
    setForm({ ...emptyClient })
    setPropertyForm({ ...emptyProperty })
    setTagInput('')
    setModal('add')
  }

  function openEdit(client) {
    setSelectedClient(client)
    setForm({
      name: client.name || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      notes: client.notes || '',
      tags: client.tags || [],
      status: client.status || 'active',
      preferred_contact: client.preferred_contact || (client.email ? 'email' : 'sms'),
    })
    const prop = client.client_properties?.[0] || emptyProperty
    setPropertyForm({
      property_type: prop.property_type || 'residential',
      bedrooms: prop.bedrooms ?? '',
      bathrooms: prop.bathrooms ?? '',
      square_footage: prop.square_footage ?? '',
      alarm_code: prop.alarm_code || '',
      key_info: prop.key_info || '',
      pet_details: prop.pet_details || '',
      parking_instructions: prop.parking_instructions || '',
      supply_location: prop.supply_location || '',
      special_notes: prop.special_notes || '',
    })
    setTagInput('')
    setModal('edit')
  }

  async function openView(client) {
    setSelectedClient(client)
    setClientTimeline([])
    setModal('view')
    const { data: timeline } = await supabase
      .from('client_timeline')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setClientTimeline(timeline || [])
  }

  // Save client
  async function handleSave() {
    setSaving(true)

    if (modal === 'add') {
      // Auto-detect preferred_contact if still at default
      const preferred = form.preferred_contact === 'sms' && form.email
        ? 'email'
        : form.preferred_contact

      // Create client
      const { data: newClient, error } = await supabase
        .from('clients')
        .insert({ ...form, preferred_contact: preferred, org_id: effectiveOrgId })
        .select()
        .single()

      if (newClient && hasPropertyData()) {
        await supabase.from('client_properties').insert({
          ...cleanProperty(),
          client_id: newClient.id,
          org_id: effectiveOrgId,
        })

        // Add timeline entry
        await supabase.from('client_timeline').insert({
          org_id: effectiveOrgId,
          client_id: newClient.id,
          event_type: 'note',
          summary: 'Client created',
          created_by: user.id,
        })
      }
    } else {
      // Update client
      const { error } = await supabase
        .from('clients')
        .update({ ...form })
        .eq('id', selectedClient.id)

      // Update or create property
      const existingProp = selectedClient.client_properties?.[0]
      if (hasPropertyData()) {
        if (existingProp) {
          await supabase
            .from('client_properties')
            .update(cleanProperty())
            .eq('id', existingProp.id)
        } else {
          await supabase.from('client_properties').insert({
            ...cleanProperty(),
            client_id: selectedClient.id,
            org_id: effectiveOrgId,
          })
        }
      }
    }

    setSaving(false)
    setModal(null)
    loadClients()
  }

  // Delete client
  async function handleDelete(id) {
    await supabase.from('clients').delete().eq('id', id)
    setDeleteConfirm(null)
    setModal(null)
    loadClients()
  }

  // Helpers
  function hasPropertyData() {
    return propertyForm.bedrooms || propertyForm.bathrooms || propertyForm.alarm_code || 
           propertyForm.key_info || propertyForm.pet_details || propertyForm.parking_instructions ||
           propertyForm.supply_location || propertyForm.special_notes || propertyForm.square_footage
  }

  function cleanProperty() {
    return {
      property_type: propertyForm.property_type,
      bedrooms: propertyForm.bedrooms ? Number(propertyForm.bedrooms) : null,
      bathrooms: propertyForm.bathrooms ? Number(propertyForm.bathrooms) : null,
      square_footage: propertyForm.square_footage ? Number(propertyForm.square_footage) : null,
      alarm_code: propertyForm.alarm_code || null,
      key_info: propertyForm.key_info || null,
      pet_details: propertyForm.pet_details || null,
      parking_instructions: propertyForm.parking_instructions || null,
      supply_location: propertyForm.supply_location || null,
      special_notes: propertyForm.special_notes || null,
    }
  }

  async function handleClientImport(rows) {
    let count = 0
    let skipped = 0

    for (const row of rows) {
      if (row.phone || row.email) {
        const { data: existing } = await supabase
          .from('clients')
          .select('id')
          .eq('org_id', effectiveOrgId)
          .or(`phone.eq.${normalizePhone(row.phone)},email.eq.${row.email}`)
          .limit(1)
        if (existing?.length > 0) { skipped++; continue }
      }

      const csvPreferred = row.preferred_contact?.toLowerCase()
      const validPreferred = ['email', 'sms', 'whatsapp', 'phone'].includes(csvPreferred) ? csvPreferred : null
      const autoPreferred = row.email ? 'email' : (row.phone ? 'sms' : 'sms')

      const { data: newClient } = await supabase.from('clients').insert({
        org_id: effectiveOrgId,
        name: row.name,
        phone: normalizePhone(row.phone) || null,
        email: row.email || null,
        address: row.address || null,
        notes: row.notes || null,
        tags: row.tags ? row.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [],
        status: (row.status || 'active').toLowerCase(),
        preferred_contact: validPreferred || autoPreferred,
      }).select().single()

      if (newClient) {
        count++
        const hasProperty = row.property_type || row.bedrooms || row.bathrooms || row.alarm_code || row.pet_details || row.parking || row.key_lockbox || row.supplies_location || row.special_notes
        if (hasProperty) {
          await supabase.from('client_properties').insert({
            client_id: newClient.id,
            org_id: effectiveOrgId,
            property_type: (row.property_type || 'residential').toLowerCase(),
            bedrooms: row.bedrooms ? Number(row.bedrooms) : null,
            bathrooms: row.bathrooms ? Number(row.bathrooms) : null,
            square_footage: row.square_footage ? Number(row.square_footage) : null,
            alarm_code: row.alarm_code || null,
            key_info: row.key_lockbox || null,
            pet_details: row.pet_details || null,
            parking_instructions: row.parking || null,
            supply_location: row.supplies_location || null,
            special_notes: row.special_notes || null,
          })
        }

        await supabase.from('client_timeline').insert({
          org_id: effectiveOrgId, client_id: newClient.id,
          event_type: 'note', summary: 'Client imported via CSV',
          created_by: user.id,
        })
      }
    }

    loadClients()
    return { success: true, count, skipped }
  }

  function addTag() {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !form.tags.includes(tag)) {
      setForm(f => ({ ...f, tags: [...f.tags, tag] }))
    }
    setTagInput('')
  }

  function removeTag(tag) {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  if (loading) {
    return <div className="p-6 md:p-8 text-stone-400">Loading clients...</div>
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Clients</h1>
          <p className="text-stone-500 text-sm mt-1">{clients.length} total clients</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-stone-200 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-50 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import CSV
          </button>
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Client
          </button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search by name, phone, email, or address..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          {['all', ...statusOptions].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors capitalize ${
                statusFilter === s
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Client List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center">
          <div className="text-stone-400 text-sm">
            {search || statusFilter !== 'all' ? 'No clients match your search.' : 'No clients yet. Add your first client to get started.'}
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(client => {
            const prop = client.client_properties?.[0]
            return (
              <div
                key={client.id}
                onClick={() => openView(client)}
                className="bg-white rounded-2xl border border-stone-200 p-4 sm:p-5 hover:border-stone-300 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm flex-shrink-0">
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-stone-900 text-sm">{client.name}</div>
                      <div className="text-stone-500 text-xs mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        {client.phone && <span>{client.phone}</span>}
                        {client.email && <span>{client.email}</span>}
                      </div>
                      {client.address && (
                        <div className="text-stone-400 text-xs mt-1 truncate">{client.address}</div>
                      )}
                      {/* Property summary */}
                      {prop && (prop.bedrooms || prop.bathrooms) && (
                        <div className="text-stone-400 text-xs mt-1">
                          {prop.bedrooms && `${prop.bedrooms}BR`}
                          {prop.bedrooms && prop.bathrooms && ' / '}
                          {prop.bathrooms && `${prop.bathrooms}BA`}
                          {prop.pet_details && ' · 🐾'}
                          {prop.alarm_code && ' · 🔐'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Tags */}
                    {client.tags?.length > 0 && (
                      <div className="hidden sm:flex gap-1">
                        {client.tags.slice(0, 2).map(tag => (
                          <span key={tag} className="px-2 py-0.5 bg-stone-100 text-stone-500 rounded-full text-xs">
                            {tag}
                          </span>
                        ))}
                        {client.tags.length > 2 && (
                          <span className="text-stone-400 text-xs">+{client.tags.length - 2}</span>
                        )}
                      </div>
                    )}
                    <StatusBadge status={client.status} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* View Client Modal */}
      {modal === 'view' && selectedClient && (
        <Modal onClose={() => setModal(null)}>
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-lg">
                {selectedClient.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-stone-900">{selectedClient.name}</h2>
                <StatusBadge status={selectedClient.status} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEdit(selectedClient)} className="px-3 py-1.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-lg hover:bg-stone-200 transition-colors">
                Edit
              </button>
              <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {/* Contact Info */}
          <Section title="Contact">
            <InfoRow label="Phone" value={selectedClient.phone} />
            <InfoRow label="Email" value={selectedClient.email} />
            <InfoRow label="Address" value={selectedClient.address} />
          </Section>

          {/* Property Details */}
          {selectedClient.client_properties?.[0] && (
            <Section title="Property">
              <PropertyView prop={selectedClient.client_properties[0]} />
            </Section>
          )}

          {/* Tags */}
          {selectedClient.tags?.length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-2">
                {selectedClient.tags.map(tag => (
                  <span key={tag} className="px-2.5 py-1 bg-stone-100 text-stone-600 rounded-full text-xs font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Notes */}
          {selectedClient.notes && (
            <Section title="Notes">
              <p className="text-sm text-stone-600 whitespace-pre-wrap">{selectedClient.notes}</p>
            </Section>
          )}

          {/* Activity Timeline */}
          <div className="mt-6 pt-4 border-t border-stone-200">
            <h3 className="text-sm font-semibold text-stone-700 mb-3">Activity Timeline</h3>
            {clientTimeline.length === 0 ? (
              <p className="text-xs text-stone-400">No activity recorded yet.</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {clientTimeline.map(event => (
                  <div key={event.id} className="flex gap-3 items-start">
                    <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                      event.event_type === 'payment' ? 'bg-emerald-500' :
                      event.event_type === 'quote' ? 'bg-blue-500' :
                      event.event_type === 'invoice' ? 'bg-amber-500' :
                      event.event_type === 'job' ? 'bg-purple-500' :
                      'bg-stone-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-stone-700">{event.summary}</div>
                      <div className="text-[10px] text-stone-400 mt-0.5">
                        {new Date(event.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' · '}
                        {new Date(event.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-stone-200">
            <button onClick={() => openEdit(selectedClient)} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
              Edit Client
            </button>
            <button
              onClick={() => setDeleteConfirm(selectedClient.id)}
              className="px-4 py-2.5 bg-red-50 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100 transition-colors"
            >
              Delete
            </button>
          </div>

          {/* Delete confirmation */}
          {deleteConfirm === selectedClient.id && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-700 mb-3">Delete {selectedClient.name}? This cannot be undone.</p>
              <div className="flex gap-2">
                <button onClick={() => handleDelete(selectedClient.id)} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Yes, delete</button>
                <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 bg-white text-stone-600 text-sm rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* CSV Import Modal */}
      {showImport && (
        <CSVImport
          onClose={() => { setShowImport(false); loadClients() }}
          onImport={handleClientImport}
          templateDef={CLIENT_TEMPLATE}
          validateRows={validateClientRows}
          entityName="clients"
        />
      )}

      {/* Add/Edit Client Modal */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal onClose={() => setModal(null)} wide>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-stone-900">
              {modal === 'add' ? 'Add Client' : 'Edit Client'}
            </h2>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
            {/* Basic Info */}
            <FormSection title="Contact Information">
              <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Full name" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="+1 650 290 0821" type="tel" />
                <Field label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="email@example.com" type="email" />
              </div>
              <Field label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="Full address" />
              <Field label="Status" value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} type="select" options={statusOptions} />
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Preferred Contact Method</label>
                <select
                  value={form.preferred_contact}
                  onChange={e => setForm(f => ({ ...f, preferred_contact: e.target.value }))}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                >
                  {contactOptions.map(o => (
                    <option key={o} value={o}>{contactLabels[o]}</option>
                  ))}
                </select>
              </div>
            </FormSection>

            {/* Property Profile */}
            <FormSection title="Property Details">
              <Field label="Property Type" value={propertyForm.property_type} onChange={v => setPropertyForm(f => ({ ...f, property_type: v }))} type="select" options={propertyTypes} />
              <div className="grid grid-cols-3 gap-4">
                <Field label="Bedrooms" value={propertyForm.bedrooms} onChange={v => setPropertyForm(f => ({ ...f, bedrooms: v }))} type="number" placeholder="0" />
                <Field label="Bathrooms" value={propertyForm.bathrooms} onChange={v => setPropertyForm(f => ({ ...f, bathrooms: v }))} type="number" placeholder="0" />
                <Field label="Sq Ft" value={propertyForm.square_footage} onChange={v => setPropertyForm(f => ({ ...f, square_footage: v }))} type="number" placeholder="0" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Alarm Code" value={propertyForm.alarm_code} onChange={v => setPropertyForm(f => ({ ...f, alarm_code: v }))} placeholder="e.g. 4521" />
                <Field label="Key / Lockbox Info" value={propertyForm.key_info} onChange={v => setPropertyForm(f => ({ ...f, key_info: v }))} placeholder="e.g. Lockbox on side gate, code 1234" />
              </div>
              <Field label="Pet Details" value={propertyForm.pet_details} onChange={v => setPropertyForm(f => ({ ...f, pet_details: v }))} placeholder="e.g. 2 dogs, need to be in backyard" />
              <Field label="Parking Instructions" value={propertyForm.parking_instructions} onChange={v => setPropertyForm(f => ({ ...f, parking_instructions: v }))} placeholder="e.g. Park in driveway, not on street" />
              <Field label="Supply Location" value={propertyForm.supply_location} onChange={v => setPropertyForm(f => ({ ...f, supply_location: v }))} placeholder="e.g. Under kitchen sink" />
              <Field label="Special Notes" value={propertyForm.special_notes} onChange={v => setPropertyForm(f => ({ ...f, special_notes: v }))} placeholder="Any other property-specific notes" type="textarea" />
            </FormSection>

            {/* Tags */}
            <FormSection title="Tags">
              <div className="flex flex-wrap gap-2 mb-2">
                {form.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="hover:text-emerald-900">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="Add a tag (e.g. weekly, commercial)"
                  className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                />
                <button onClick={addTag} className="px-3 py-2 bg-stone-100 text-stone-600 text-sm rounded-xl hover:bg-stone-200 transition-colors">Add</button>
              </div>
            </FormSection>

            {/* Notes */}
            <FormSection title="Notes">
              <Field value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="General notes about this client..." type="textarea" />
            </FormSection>
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-stone-200">
            <button onClick={() => setModal(null)} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : modal === 'add' ? 'Add Client' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Reusable Components ──────────────────────────────────────

function Modal({ children, onClose, wide }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-[10vh] overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`bg-white rounded-2xl shadow-xl p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

function FormSection({ title, children }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-stone-700 mb-3">{title}</h3>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', options = [] }) {
  const base = "w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
  
  if (type === 'select') {
    return (
      <div>
        {label && <label className="block text-xs font-medium text-stone-500 mb-1.5">{label}</label>}
        <select value={value} onChange={e => onChange(e.target.value)} className={base + " capitalize"}>
          {options.map(o => <option key={o} value={o} className="capitalize">{o}</option>)}
        </select>
      </div>
    )
  }

  if (type === 'textarea') {
    return (
      <div>
        {label && <label className="block text-xs font-medium text-stone-500 mb-1.5">{label}</label>}
        <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} className={base + " resize-none"} />
      </div>
    )
  }

  return (
    <div>
      {label && <label className="block text-xs font-medium text-stone-500 mb-1.5">{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} />
    </div>
  )
}

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex justify-between py-1.5">
      <span className="text-xs text-stone-400">{label}</span>
      <span className="text-sm text-stone-700">{value}</span>
    </div>
  )
}

function PropertyView({ prop }) {
  const items = [
    { label: 'Type', value: prop.property_type },
    { label: 'Bedrooms', value: prop.bedrooms },
    { label: 'Bathrooms', value: prop.bathrooms },
    { label: 'Sq Ft', value: prop.square_footage },
    { label: 'Alarm Code', value: prop.alarm_code },
    { label: 'Key/Lockbox', value: prop.key_info },
    { label: 'Pets', value: prop.pet_details },
    { label: 'Parking', value: prop.parking_instructions },
    { label: 'Supplies', value: prop.supply_location },
    { label: 'Special Notes', value: prop.special_notes },
  ].filter(i => i.value)

  return (
    <div className="space-y-0">
      {items.map(item => (
        <InfoRow key={item.label} label={item.label} value={item.value} />
      ))}
    </div>
  )
}

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-emerald-100 text-emerald-700',
    inactive: 'bg-stone-100 text-stone-500',
    vip: 'bg-amber-100 text-amber-700',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[status] || styles.active}`}>
      {status}
    </span>
  )
}
