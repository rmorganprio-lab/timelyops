import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import CSVImport from '../components/CSVImport'
import { WORKER_TEMPLATE, validateWorkerRows, normalizePhone } from '../lib/csv'
import { useAdminOrg } from '../contexts/AdminOrgContext'
import { useToast } from '../contexts/ToastContext'

export default function Workers({ user }) {
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [selectedWorker, setSelectedWorker] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [skillInput, setSkillInput] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showImport, setShowImport] = useState(false)

  const orgId = user?.org_id
  const { adminViewOrg } = useAdminOrg()
  const { showToast } = useToast()
  const effectiveOrgId = adminViewOrg?.id ?? user?.org_id

  useEffect(() => {
    loadWorkers()
  }, [effectiveOrgId])

  async function loadWorkers() {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('org_id', effectiveOrgId)
      .order('name')

    if (error) {
      console.error('Failed to load workers:', error)
      showToast('Failed to load workers. Please try again.', 'error')
      setLoading(false)
      return
    }
    if (data) setWorkers(data)
    setLoading(false)
  }

  function openAdd() {
    setForm({
      name: '',
      phone: '',
      email: '',
      role: 'worker',
      availability: 'available',
      skills: [],
      address_line_1: '', address_line_2: '', city: '', state_province: '', postal_code: '', country: 'US',
    })
    setSkillInput('')
    setSelectedWorker(null)
    setModal('add')
  }

  function openView(worker) {
    setSelectedWorker(worker)
    setDeleteConfirm(null)
    setModal('view')
  }

  function openEdit(worker) {
    setSelectedWorker(worker)
    setForm({
      name: worker.name || '',
      phone: worker.phone || '',
      email: worker.email || '',
      role: worker.role || 'worker',
      availability: worker.availability || 'available',
      skills: worker.skills || [],
      address_line_1: worker.address_line_1 || '',
      address_line_2: worker.address_line_2 || '',
      city: worker.city || '',
      state_province: worker.state_province || '',
      postal_code: worker.postal_code || '',
      country: worker.country || 'US',
    })
    setSkillInput('')
    setDeleteConfirm(null)
    setModal('edit')
  }

  async function handleSave() {
    setSaving(true)

    const addressFields = {
      address_line_1: form.address_line_1 || null,
      address_line_2: form.address_line_2 || null,
      city: form.city || null,
      state_province: form.state_province || null,
      postal_code: form.postal_code || null,
      country: form.country || null,
    }

    if (modal === 'add') {
      // Create a manual worker (no auth account)
      const newId = crypto.randomUUID()
      const { error } = await supabase.from('users').insert({
        id: newId,
        org_id: effectiveOrgId,
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        role: form.role,
        availability: form.availability,
        skills: form.skills,
        auth_linked: false,
        ...addressFields,
      })
      if (error) {
        console.error('Failed to add worker:', error)
        showToast('Failed to save changes. Please try again.', 'error')
        setSaving(false)
        return
      }
    } else {
      const { error } = await supabase
        .from('users')
        .update({
          name: form.name,
          phone: form.phone || null,
          email: form.email || null,
          role: form.role,
          availability: form.availability,
          skills: form.skills,
          ...addressFields,
        })
        .eq('id', selectedWorker.id)
      if (error) {
        console.error('Failed to update worker:', error)
        showToast('Failed to save changes. Please try again.', 'error')
        setSaving(false)
        return
      }
    }

    setSaving(false)
    setModal(null)
    loadWorkers()
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('users').delete().eq('id', id)
    if (error) {
      console.error('Failed to delete worker:', error)
      showToast('Failed to delete worker. Please try again.', 'error')
      return
    }
    setDeleteConfirm(null)
    setModal(null)
    loadWorkers()
  }

  async function toggleAvailability(worker, newStatus) {
    const { error } = await supabase
      .from('users')
      .update({ availability: newStatus })
      .eq('id', worker.id)
    if (error) {
      console.error('Failed to update availability:', error)
      showToast('Something went wrong. Please try again.', 'error')
      return
    }
    loadWorkers()
  }

  async function handleWorkerImport(rows) {
    let count = 0
    let skipped = 0

    for (const row of rows) {
      if (row.phone) {
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('org_id', effectiveOrgId)
          .eq('phone', normalizePhone(row.phone))
          .limit(1)
        if (existing?.length > 0) { skipped++; continue }
      }

      const newId = crypto.randomUUID()
      const { error } = await supabase.from('users').insert({
        id: newId,
        org_id: effectiveOrgId,
        name: row.name,
        phone: normalizePhone(row.phone) || null,
        email: row.email || null,
        role: (row.role || 'worker').toLowerCase(),
        availability: (row.availability || 'available').toLowerCase(),
        skills: row.skills ? row.skills.split(',').map(s => s.trim()).filter(Boolean) : [],
        address_line_1: row.address_1 || null,
        address_line_2: row.address_2 || null,
        city: row.city || null,
        state_province: row.state_province || null,
        postal_code: row.postal_code || null,
        country: row.country || null,
        auth_linked: false,
      })

      if (!error) count++
    }

    loadWorkers()
    return { success: true, count, skipped }
  }

  function addSkill() {
    const skill = skillInput.trim()
    if (skill && !form.skills.includes(skill)) {
      setForm(f => ({ ...f, skills: [...f.skills, skill] }))
    }
    setSkillInput('')
  }

  function removeSkill(skill) {
    setForm(f => ({ ...f, skills: f.skills.filter(s => s !== skill) }))
  }

  if (loading) {
    return <div className="p-6 md:p-8 text-stone-400">Loading workers...</div>
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Workers</h1>
          <p className="text-stone-500 text-sm mt-1">{workers.length} team members</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-stone-200 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-50 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import CSV
          </button>
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Worker
          </button>
        </div>
      </div>

      {/* Worker Grid */}
      {workers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center">
          <div className="text-stone-400 text-sm mb-3">No team members yet.</div>
          <button onClick={openAdd} className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
            Add your first worker
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workers.map(worker => (
            <div
              key={worker.id}
              onClick={() => openView(worker)}
              className="bg-white rounded-2xl border border-stone-200 p-5 hover:border-stone-300 hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                    worker.availability === 'available' ? 'bg-emerald-100 text-emerald-700' :
                    worker.availability === 'vacation' ? 'bg-blue-100 text-blue-700' :
                    'bg-stone-100 text-stone-500'
                  }`}>
                    {worker.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-stone-900 text-sm flex items-center gap-1.5">
                      {worker.name}
                      {!worker.auth_linked && (
                        <span className="text-[10px] text-stone-400 font-normal">(no login)</span>
                      )}
                    </div>
                    <div className="text-xs text-stone-400 capitalize">{worker.role === 'ceo' ? 'CEO (Owner)' : worker.role}</div>
                  </div>
                </div>
                <AvailabilityBadge status={worker.availability} />
              </div>

              {worker.phone && (
                <div className="text-xs text-stone-500 mb-1">{worker.phone}</div>
              )}
              {worker.email && (
                <div className="text-xs text-stone-500 mb-1">{worker.email}</div>
              )}

              {worker.skills?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {worker.skills.map(skill => (
                    <span key={skill} className="px-2 py-0.5 bg-stone-100 text-stone-500 rounded-full text-xs">
                      {skill}
                    </span>
                  ))}
                </div>
              )}

              {/* Quick availability toggle */}
              <div className="flex gap-2 mt-4 pt-3 border-t border-stone-100">
                {['available', 'unavailable', 'vacation'].map(status => (
                  <button
                    key={status}
                    onClick={(e) => { e.stopPropagation(); toggleAvailability(worker, status); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize ${
                      worker.availability === status
                        ? status === 'available' ? 'bg-emerald-100 text-emerald-700'
                        : status === 'vacation' ? 'bg-blue-100 text-blue-700'
                        : 'bg-stone-200 text-stone-600'
                        : 'text-stone-400 hover:bg-stone-50'
                    }`}
                  >
                    {status === 'unavailable' ? 'Off' : status}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View Worker Modal */}
      {modal === 'view' && selectedWorker && (
        <Modal onClose={() => setModal(null)}>
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
                selectedWorker.availability === 'available' ? 'bg-emerald-100 text-emerald-700' :
                selectedWorker.availability === 'vacation' ? 'bg-blue-100 text-blue-700' :
                'bg-stone-100 text-stone-500'
              }`}>
                {selectedWorker.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-stone-900">{selectedWorker.name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-stone-400 capitalize">{selectedWorker.role === 'ceo' ? 'CEO (Owner)' : selectedWorker.role}</span>
                  <AvailabilityBadge status={selectedWorker.availability} />
                  {selectedWorker.auth_linked ? (
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">Can log in</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-400 rounded-full">No login</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEdit(selectedWorker)} className="px-3 py-1.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-lg hover:bg-stone-200 transition-colors">
                Edit
              </button>
              <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {selectedWorker.phone && (
              <div className="flex justify-between py-1.5">
                <span className="text-xs text-stone-400">Phone</span>
                <span className="text-sm text-stone-700">{selectedWorker.phone}</span>
              </div>
            )}
            {selectedWorker.email && (
              <div className="flex justify-between py-1.5">
                <span className="text-xs text-stone-400">Email</span>
                <span className="text-sm text-stone-700">{selectedWorker.email}</span>
              </div>
            )}

            {selectedWorker.skills?.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Skills</div>
                <div className="flex flex-wrap gap-2">
                  {selectedWorker.skills.map(skill => (
                    <span key={skill} className="px-2.5 py-1 bg-stone-100 text-stone-600 rounded-full text-xs font-medium">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-6 pt-4 border-t border-stone-200">
            <button onClick={() => openEdit(selectedWorker)} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
              Edit Worker
            </button>
            {selectedWorker.id !== user.id && (
              <button
                onClick={() => setDeleteConfirm(selectedWorker.id)}
                className="px-4 py-2.5 bg-red-50 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100 transition-colors"
              >
                Delete
              </button>
            )}
          </div>

          {deleteConfirm === selectedWorker.id && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-700 mb-3">Remove {selectedWorker.name} from the team? This cannot be undone.</p>
              <div className="flex gap-2">
                <button onClick={() => handleDelete(selectedWorker.id)} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Yes, remove</button>
                <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 bg-white text-stone-600 text-sm rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* CSV Import Modal */}
      {showImport && (
        <CSVImport
          onClose={() => { setShowImport(false); loadWorkers() }}
          onImport={handleWorkerImport}
          templateDef={WORKER_TEMPLATE}
          validateRows={validateWorkerRows}
          entityName="workers"
        />
      )}

      {/* Add/Edit Worker Modal */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal onClose={() => setModal(null)}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-stone-900">
              {modal === 'add' ? 'Add Worker' : 'Edit Worker'}
            </h2>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div className="space-y-4">
            <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Full name" />
            <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} type="tel" placeholder="+1 650 686 8323" />
            <Field label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" placeholder="Optional" />
            
            {/* Role */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Role</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
              >
                <option value="worker">Worker</option>
                <option value="manager">Manager</option>
                <option value="ceo">CEO (Owner)</option>
              </select>
              <p className="text-xs text-stone-400 mt-1">
                {form.role === 'worker' && 'Can view schedule, check in, record payments on assigned jobs'}
                {form.role === 'manager' && 'Can manage schedule, assign workers, manage staff'}
                {form.role === 'ceo' && 'Full access to everything including finances and settings'}
              </p>
            </div>

            {/* Availability */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Availability</label>
              <div className="flex gap-2">
                {['available', 'unavailable', 'vacation'].map(status => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, availability: status }))}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-xl transition-colors capitalize ${
                      form.availability === status
                        ? status === 'available' ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-200'
                        : status === 'vacation' ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-200'
                        : 'bg-stone-200 text-stone-700 ring-2 ring-stone-300'
                        : 'bg-stone-50 text-stone-400 border border-stone-200'
                    }`}
                  >
                    {status === 'unavailable' ? 'Off' : status}
                  </button>
                ))}
              </div>
            </div>

            {/* Home Address */}
            <div>
              <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider text-[11px] mb-3">Home Address (optional — for route planning)</label>
              <div className="space-y-3">
                <Field label="Address Line 1" value={form.address_line_1} onChange={v => setForm(f => ({ ...f, address_line_1: v }))} placeholder="123 Main St" />
                <Field label="Address Line 2" value={form.address_line_2} onChange={v => setForm(f => ({ ...f, address_line_2: v }))} placeholder="Apt, suite, unit, etc." />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City" value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} placeholder="Sacramento" />
                  <Field label="State / Province" value={form.state_province} onChange={v => setForm(f => ({ ...f, state_province: v }))} placeholder="CA" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Postal Code" value={form.postal_code} onChange={v => setForm(f => ({ ...f, postal_code: v }))} placeholder="95814" />
                  <Field label="Country" value={form.country} onChange={v => setForm(f => ({ ...f, country: v }))} placeholder="US" />
                </div>
              </div>
            </div>

            {/* Skills */}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Skills / Certifications</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {form.skills?.map(skill => (
                  <span key={skill} className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
                    {skill}
                    <button onClick={() => removeSkill(skill)} className="hover:text-emerald-900">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                  placeholder="Add a skill..."
                  className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                />
                <button onClick={addSkill} className="px-3 py-2 bg-stone-100 text-stone-600 text-sm rounded-xl hover:bg-stone-200 transition-colors">Add</button>
              </div>
            </div>
          </div>

          {modal === 'add' && (
            <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-xl">
              <p className="text-xs text-stone-500">
                This adds the worker to your team so you can assign them to jobs. They don't need a login account to appear on the schedule. If they need to log in later (to check in, view their jobs, or record payments), they can be linked to a phone number.
              </p>
            </div>
          )}

          <div className="flex gap-3 mt-6 pt-4 border-t border-stone-200">
            <button onClick={() => setModal(null)} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name?.trim()}
              className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : modal === 'add' ? 'Add Worker' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-[10vh] overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-stone-500 mb-1.5">{label}</label>}
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
      />
    </div>
  )
}

function AvailabilityBadge({ status }) {
  const styles = {
    available: 'bg-emerald-100 text-emerald-700',
    unavailable: 'bg-stone-100 text-stone-500',
    vacation: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[status] || styles.available}`}>
      {status}
    </span>
  )
}
