import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { todayInTimezone, toDateStr, formatDateFull, formatTime, formatTimestamp, getTimezoneAbbr, nowInTimezone } from '../lib/timezone'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const statusColors = {
  scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-stone-100 text-stone-500 border-stone-200',
}

const emptyJob = {
  client_id: '', service_type_id: '', title: '', date: '', start_time: '09:00',
  duration_minutes: 120, status: 'scheduled', notes: '', price: '', frequency: 'one_time',
  assignees: [],
}

export default function Schedule({ user }) {
  const tz = user?.organizations?.settings?.timezone || 'America/Los_Angeles'
  const tzAbbr = getTimezoneAbbr(tz)

  const [view, setView] = useState('month')
  const [currentDate, setCurrentDate] = useState(() => nowInTimezone(tz))
  const [jobs, setJobs] = useState([])
  const [clients, setClients] = useState([])
  const [workers, setWorkers] = useState([])
  const [serviceTypes, setServiceTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyJob)
  const [selectedJob, setSelectedJob] = useState(null)
  const [saving, setSaving] = useState(false)
  const [recurringAction, setRecurringAction] = useState(null) // 'this' | 'future' | 'all'
  const [showRecurringOptions, setShowRecurringOptions] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [showDeleteRecurring, setShowDeleteRecurring] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [jobsRes, clientsRes, workersRes, typesRes] = await Promise.all([
      supabase.from('jobs').select('*, clients(name), job_assignments(user_id)').order('date').order('start_time'),
      supabase.from('clients').select('id, name').eq('status', 'active').order('name'),
      supabase.from('users').select('id, name, availability').in('role', ['ceo', 'manager', 'worker']).order('name'),
      supabase.from('service_types').select('*').eq('is_active', true).order('name'),
    ])
    setJobs(jobsRes.data || [])
    setClients(clientsRes.data || [])
    setWorkers(workersRes.data || [])
    setServiceTypes(typesRes.data || [])
    setLoading(false)
  }

  function navigate(dir) {
    const d = new Date(currentDate)
    if (view === 'month') d.setMonth(d.getMonth() + dir)
    else if (view === 'week') d.setDate(d.getDate() + (dir * 7))
    else d.setDate(d.getDate() + dir)
    setCurrentDate(d)
  }

  function goToday() { setCurrentDate(nowInTimezone(tz)) }

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  function getMonthDays() {
    const first = new Date(year, month, 1).getDay()
    const total = new Date(year, month + 1, 0).getDate()
    const days = []
    for (let i = 0; i < first; i++) days.push(null)
    for (let d = 1; d <= total; d++) days.push(d)
    return days
  }

  function getWeekDays() {
    const start = new Date(currentDate)
    start.setDate(start.getDate() - start.getDay())
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d })
  }

  function dateStr(d) {
    if (d instanceof Date) return toDateStr(d)
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  function jobsOnDate(ds) { return jobs.filter(j => j.date === ds) }

  const today = todayInTimezone(tz)

  const isRecurring = (job) => job?.recurrence_group_id != null

  // ── Modal openers ──

  function openAdd(date) {
    setForm({ ...emptyJob, date: date || today, client_id: clients[0]?.id || '', service_type_id: serviceTypes[0]?.id || '', title: serviceTypes[0]?.name || 'Cleaning' })
    setSelectedJob(null)
    setRecurringAction(null)
    setShowRecurringOptions(false)
    setDeleteConfirm(false)
    setShowDeleteRecurring(false)
    setModal('add')
  }

  function openEdit(job) {
    setSelectedJob(job)
    setForm({
      client_id: job.client_id, service_type_id: job.service_type_id || '', title: job.title,
      date: job.date, start_time: job.start_time || '09:00', duration_minutes: job.duration_minutes,
      status: job.status, notes: job.notes || '', price: job.price || '',
      frequency: job.frequency || 'one_time',
      assignees: job.job_assignments?.map(a => a.user_id) || [],
    })
    setRecurringAction(null)
    setDeleteConfirm(false)
    setShowDeleteRecurring(false)
    // If recurring, show options before edit form
    if (isRecurring(job)) {
      setShowRecurringOptions(true)
      setModal('recurring_choose')
    } else {
      setShowRecurringOptions(false)
      setModal('edit')
    }
  }

  function openView(job) {
    setSelectedJob(job)
    setDeleteConfirm(false)
    setShowDeleteRecurring(false)
    setModal('view')
  }

  function chooseRecurringEdit(action) {
    setRecurringAction(action)
    setShowRecurringOptions(false)
    setModal('edit')
  }

  // ── Save job ──

  async function handleSave() {
    setSaving(true)
    const jobData = {
      org_id: user.org_id, client_id: form.client_id, service_type_id: form.service_type_id || null,
      title: form.title, date: form.date, start_time: form.start_time,
      duration_minutes: Number(form.duration_minutes), status: form.status, notes: form.notes,
      price: form.price ? Number(form.price) : null, frequency: form.frequency,
    }

    if (modal === 'add') {
      const { data } = await supabase.from('jobs').insert(jobData).select().single()
      let jobId = data?.id

      // Create recurring instances
      if (form.frequency !== 'one_time' && jobId) {
        await supabase.from('jobs').update({ recurrence_group_id: jobId }).eq('id', jobId)
        const recurringJobs = []
        for (let i = 1; i <= 12; i++) {
          const nextDate = new Date(form.date + 'T12:00:00')
          if (form.frequency === 'monthly') nextDate.setMonth(nextDate.getMonth() + i)
          else { const interval = form.frequency === 'weekly' ? 7 : 14; nextDate.setDate(nextDate.getDate() + (interval * i)) }
          recurringJobs.push({ ...jobData, date: toDateStr(nextDate), recurrence_group_id: jobId, recurrence_rule: { frequency: form.frequency, parent_id: jobId } })
        }
        await supabase.from('jobs').insert(recurringJobs)
      }

      // Add assignments
      if (jobId && form.assignees.length > 0) {
        await supabase.from('job_assignments').insert(form.assignees.map(uid => ({ job_id: jobId, user_id: uid })))
      }
    } else {
      // Editing existing job
      const action = recurringAction || 'this'

      if (action === 'this') {
        // Update only this instance
        await supabase.from('jobs').update(jobData).eq('id', selectedJob.id)
        await supabase.from('job_assignments').delete().eq('job_id', selectedJob.id)
        if (form.assignees.length > 0) {
          await supabase.from('job_assignments').insert(form.assignees.map(uid => ({ job_id: selectedJob.id, user_id: uid })))
        }
      } else if (action === 'future') {
        // Update this and all future instances in the same recurrence group
        const groupId = selectedJob.recurrence_group_id
        const { data: futureJobs } = await supabase.from('jobs').select('id')
          .eq('recurrence_group_id', groupId).gte('date', selectedJob.date)
        
        if (futureJobs) {
          const futureIds = futureJobs.map(j => j.id)
          // Update all future jobs (except date which stays unique)
          for (const fid of futureIds) {
            const existing = jobs.find(j => j.id === fid)
            await supabase.from('jobs').update({
              client_id: form.client_id, service_type_id: form.service_type_id || null,
              title: form.title, start_time: form.start_time,
              duration_minutes: Number(form.duration_minutes), notes: form.notes,
              price: form.price ? Number(form.price) : null,
            }).eq('id', fid)
            // Update assignments
            await supabase.from('job_assignments').delete().eq('job_id', fid)
            if (form.assignees.length > 0) {
              await supabase.from('job_assignments').insert(form.assignees.map(uid => ({ job_id: fid, user_id: uid })))
            }
          }
        }
      } else if (action === 'all') {
        // Update all instances in the recurrence group
        const groupId = selectedJob.recurrence_group_id
        const { data: allJobs } = await supabase.from('jobs').select('id')
          .eq('recurrence_group_id', groupId)
        
        if (allJobs) {
          for (const aj of allJobs) {
            await supabase.from('jobs').update({
              client_id: form.client_id, service_type_id: form.service_type_id || null,
              title: form.title, start_time: form.start_time,
              duration_minutes: Number(form.duration_minutes), notes: form.notes,
              price: form.price ? Number(form.price) : null,
            }).eq('id', aj.id)
            await supabase.from('job_assignments').delete().eq('job_id', aj.id)
            if (form.assignees.length > 0) {
              await supabase.from('job_assignments').insert(form.assignees.map(uid => ({ job_id: aj.id, user_id: uid })))
            }
          }
        }
      }
    }

    setSaving(false)
    setModal(null)
    setRecurringAction(null)
    loadAll()
  }

  // ── Delete job ──

  async function handleDelete(scope) {
    if (!selectedJob) return

    if (scope === 'this' || !isRecurring(selectedJob)) {
      await supabase.from('jobs').delete().eq('id', selectedJob.id)
    } else if (scope === 'future') {
      await supabase.from('jobs').delete()
        .eq('recurrence_group_id', selectedJob.recurrence_group_id)
        .gte('date', selectedJob.date)
    } else if (scope === 'all') {
      await supabase.from('jobs').delete()
        .eq('recurrence_group_id', selectedJob.recurrence_group_id)
    }

    setModal(null)
    setDeleteConfirm(false)
    setShowDeleteRecurring(false)
    loadAll()
  }

  // ── Check-in ──

  async function handleCheckIn(job, type) {
    const updates = type === 'arrive'
      ? { status: 'in_progress', arrived_at: new Date().toISOString() }
      : { status: 'completed', completed_at: new Date().toISOString() }
    await supabase.from('jobs').update(updates).eq('id', job.id)
    loadAll()
    if (selectedJob?.id === job.id) setSelectedJob({ ...job, ...updates })
  }

  // ── Conflict detection ──

  const conflicts = useMemo(() => {
    if (!form.date || !form.start_time || form.assignees.length === 0) return []
    const formStart = timeToMinutes(form.start_time)
    const formEnd = formStart + Number(form.duration_minutes)
    const editId = selectedJob?.id
    return jobs.filter(j => {
      if (j.id === editId) return false
      if (j.date !== form.date || j.status === 'cancelled') return false
      const jStart = timeToMinutes(j.start_time)
      const jEnd = jStart + j.duration_minutes
      if (!(formStart < jEnd && formEnd > jStart)) return false
      const jAssignees = j.job_assignments?.map(a => a.user_id) || []
      return form.assignees.some(a => jAssignees.includes(a))
    })
  }, [form.date, form.start_time, form.duration_minutes, form.assignees, jobs, selectedJob])

  function timeToMinutes(t) { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m }

  function toggleAssignee(id) {
    setForm(f => ({ ...f, assignees: f.assignees.includes(id) ? f.assignees.filter(a => a !== id) : [...f.assignees, id] }))
  }

  function handleServiceTypeChange(id) {
    const st = serviceTypes.find(s => s.id === id)
    setForm(f => ({ ...f, service_type_id: id, title: st?.name || f.title, duration_minutes: st?.default_duration_minutes || f.duration_minutes }))
  }

  const clientName = (id) => clients.find(c => c.id === id)?.name || 'Unknown'
  const workerName = (id) => workers.find(w => w.id === id)?.name || 'Unknown'

  if (loading) return <div className="p-6 md:p-8 text-stone-400">Loading schedule...</div>

  const headerText = view === 'month' ? `${MONTHS[month]} ${year}`
    : view === 'week' ? (() => { const d = getWeekDays(); return `${d[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${d[6].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}` })()
    : currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Schedule</h1>
          <p className="text-stone-500 text-sm mt-1">{jobs.filter(j => j.status !== 'cancelled').length} active jobs<span className="text-stone-300 mx-1.5">·</span><span className="text-stone-400">{tzAbbr}</span></p>
        </div>
        <button onClick={() => openAdd(null)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Job
        </button>
      </div>

      {/* Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="p-2 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 text-stone-600"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <div className="text-sm font-semibold text-stone-900 min-w-[200px] text-center">{headerText}</div>
          <button onClick={() => navigate(1)} className="p-2 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 text-stone-600"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg></button>
          <button onClick={goToday} className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-medium text-stone-600 hover:bg-stone-50">Today</button>
        </div>
        <div className="flex gap-1 bg-white border border-stone-200 rounded-xl p-1">
          {['month','week','day'].map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize ${view === v ? 'bg-emerald-700 text-white' : 'text-stone-500 hover:text-stone-700'}`}>{v}</button>
          ))}
        </div>
      </div>

      {/* Views */}
      {view === 'month' && <MonthView days={getMonthDays()} year={year} month={month} today={today} jobsOnDate={jobsOnDate} dateStr={dateStr} onDayClick={(d) => { setView('day'); setCurrentDate(new Date(year, month, d)) }} />}
      {view === 'week' && <WeekView days={getWeekDays()} today={today} jobsOnDate={jobsOnDate} onJobClick={openView} onAddJob={(d) => openAdd(toDateStr(d))} />}
      {view === 'day' && <DayView date={currentDate} today={today} jobs={jobsOnDate(toDateStr(currentDate))} onJobClick={openView} onAddJob={() => openAdd(toDateStr(currentDate))} workerName={workerName} clientName={clientName} onCheckIn={handleCheckIn} tz={tz} />}

      {/* ── Recurring Edit Choice Modal ── */}
      {modal === 'recurring_choose' && selectedJob && (
        <Modal onClose={() => setModal(null)}>
          <h2 className="text-lg font-bold text-stone-900 mb-2">Edit Recurring Job</h2>
          <p className="text-sm text-stone-500 mb-6">This job is part of a recurring series. What would you like to edit?</p>
          <div className="space-y-3">
            <button onClick={() => chooseRecurringEdit('this')} className="w-full p-4 bg-stone-50 border border-stone-200 rounded-xl text-left hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
              <div className="font-medium text-stone-900 text-sm">This job only</div>
              <div className="text-xs text-stone-500 mt-0.5">Only change this specific instance on {formatDateFull(selectedJob.date)}</div>
            </button>
            <button onClick={() => chooseRecurringEdit('future')} className="w-full p-4 bg-stone-50 border border-stone-200 rounded-xl text-left hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
              <div className="font-medium text-stone-900 text-sm">This and all future jobs</div>
              <div className="text-xs text-stone-500 mt-0.5">Change this job and every instance after it</div>
            </button>
            <button onClick={() => chooseRecurringEdit('all')} className="w-full p-4 bg-stone-50 border border-stone-200 rounded-xl text-left hover:border-emerald-300 hover:bg-emerald-50 transition-colors">
              <div className="font-medium text-stone-900 text-sm">All jobs in this series</div>
              <div className="text-xs text-stone-500 mt-0.5">Change every instance, past and future</div>
            </button>
          </div>
          <button onClick={() => setModal(null)} className="w-full mt-4 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">Cancel</button>
        </Modal>
      )}

      {/* ── View Job Modal ── */}
      {modal === 'view' && selectedJob && (
        <Modal onClose={() => setModal(null)}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-stone-900">{selectedJob.title}</h2>
                {isRecurring(selectedJob) && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-medium">Recurring</span>}
              </div>
              <p className="text-sm text-stone-500">{clientName(selectedJob.client_id)}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEdit(selectedJob)} className="px-3 py-1.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-lg hover:bg-stone-200">Edit</button>
              <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div className="space-y-2 mb-4">
            <InfoRow label="Date" value={formatDateFull(selectedJob.date)} />
            <InfoRow label="Time" value={`${formatTime(selectedJob.start_time)} ${tzAbbr}`} />
            <InfoRow label="Duration" value={`${selectedJob.duration_minutes} min`} />
            <InfoRow label="Status" value={<span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[selectedJob.status]}`}>{selectedJob.status.replace('_',' ')}</span>} />
            {selectedJob.price && <InfoRow label="Price" value={`$${Number(selectedJob.price).toFixed(2)}`} />}
            {selectedJob.frequency && selectedJob.frequency !== 'one_time' && <InfoRow label="Frequency" value={selectedJob.frequency} />}
            {selectedJob.notes && <InfoRow label="Notes" value={selectedJob.notes} />}
            {selectedJob.arrived_at && <InfoRow label="Arrived" value={formatTimestamp(selectedJob.arrived_at, tz)} />}
            {selectedJob.completed_at && <InfoRow label="Completed" value={formatTimestamp(selectedJob.completed_at, tz)} />}
          </div>

          {selectedJob.job_assignments?.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Assigned To</div>
              <div className="flex flex-wrap gap-2">{selectedJob.job_assignments.map(a => <span key={a.user_id} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">{workerName(a.user_id)}</span>)}</div>
            </div>
          )}

          {selectedJob.status === 'scheduled' && <button onClick={() => handleCheckIn(selectedJob, 'arrive')} className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 mb-2">Mark as Arrived</button>}
          {selectedJob.status === 'in_progress' && <button onClick={() => handleCheckIn(selectedJob, 'complete')} className="w-full py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 mb-2">Mark as Completed</button>}

          <div className="flex gap-3 mt-4 pt-4 border-t border-stone-200">
            <button onClick={() => openEdit(selectedJob)} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800">Edit Job</button>
            <button onClick={() => { if (isRecurring(selectedJob)) setShowDeleteRecurring(true); else setDeleteConfirm(true) }} className="px-4 py-2.5 bg-red-50 text-red-600 text-sm font-medium rounded-xl hover:bg-red-100">Delete</button>
          </div>

          {/* Non-recurring delete confirm */}
          {deleteConfirm && !isRecurring(selectedJob) && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-700 mb-3">Delete this job?</p>
              <div className="flex gap-2">
                <button onClick={() => handleDelete('this')} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Yes, delete</button>
                <button onClick={() => setDeleteConfirm(false)} className="px-3 py-1.5 bg-white text-stone-600 text-sm rounded-lg border border-stone-200 hover:bg-stone-50">Cancel</button>
              </div>
            </div>
          )}

          {/* Recurring delete options */}
          {showDeleteRecurring && (
            <div className="mt-3 p-4 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm font-medium text-red-800 mb-3">Delete recurring job</p>
              <div className="space-y-2">
                <button onClick={() => handleDelete('this')} className="w-full p-3 bg-white border border-red-200 rounded-lg text-left hover:bg-red-100 transition-colors">
                  <div className="text-sm font-medium text-red-700">This job only</div>
                  <div className="text-xs text-red-500 mt-0.5">Delete only this instance</div>
                </button>
                <button onClick={() => handleDelete('future')} className="w-full p-3 bg-white border border-red-200 rounded-lg text-left hover:bg-red-100 transition-colors">
                  <div className="text-sm font-medium text-red-700">This and all future</div>
                  <div className="text-xs text-red-500 mt-0.5">Delete from this date forward</div>
                </button>
                <button onClick={() => handleDelete('all')} className="w-full p-3 bg-white border border-red-200 rounded-lg text-left hover:bg-red-100 transition-colors">
                  <div className="text-sm font-medium text-red-700">All in series</div>
                  <div className="text-xs text-red-500 mt-0.5">Delete every instance</div>
                </button>
                <button onClick={() => setShowDeleteRecurring(false)} className="w-full py-2 text-stone-500 text-sm hover:text-stone-700">Cancel</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Add/Edit Job Modal ── */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal onClose={() => setModal(null)} wide>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-stone-900">{modal === 'add' ? 'New Job' : 'Edit Job'}</h2>
              {recurringAction && (
                <p className="text-xs text-purple-600 mt-0.5">
                  Editing: {recurringAction === 'this' ? 'this instance only' : recurringAction === 'future' ? 'this and all future' : 'all instances'}
                </p>
              )}
            </div>
            <button onClick={() => setModal(null)} className="p-1.5 text-stone-400 hover:text-stone-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Client *</label>
              <select value={form.client_id} onChange={e => setForm(f => ({...f, client_id: e.target.value}))} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600">
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Service Type</label>
              <select value={form.service_type_id} onChange={e => handleServiceTypeChange(e.target.value)} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600">
                <option value="">Select type...</option>
                {serviceTypes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <Field label="Job Title" value={form.title} onChange={v => setForm(f => ({...f, title: v}))} placeholder="e.g. Standard Clean" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date *" value={form.date} onChange={v => setForm(f => ({...f, date: v}))} type="date" />
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Start Time ({tzAbbr})</label>
                <input type="time" value={form.start_time} onChange={e => setForm(f => ({...f, start_time: e.target.value}))} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Duration (min)" value={form.duration_minutes} onChange={v => setForm(f => ({...f, duration_minutes: v}))} type="number" />
              <Field label="Price ($)" value={form.price} onChange={v => setForm(f => ({...f, price: v}))} type="number" placeholder="0.00" />
            </div>

            {/* Frequency - only show on add, not edit */}
            {modal === 'add' && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">Frequency</label>
                <div className="flex gap-2">
                  {['one_time','weekly','biweekly','monthly'].map(freq => (
                    <button key={freq} type="button" onClick={() => setForm(f => ({...f, frequency: freq}))} className={`flex-1 py-2 text-xs font-medium rounded-xl capitalize ${form.frequency === freq ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-200' : 'bg-stone-50 text-stone-400 border border-stone-200'}`}>{freq.replace('_',' ')}</button>
                  ))}
                </div>
                {form.frequency !== 'one_time' && <p className="text-xs text-stone-400 mt-1.5">This will create 12 recurring instances.</p>}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))} className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 capitalize">
                {['scheduled','in_progress','completed','cancelled'].map(s => <option key={s} value={s} className="capitalize">{s.replace('_',' ')}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Assign Workers</label>
              <div className="flex flex-wrap gap-2">
                {workers.map(w => (
                  <button key={w.id} type="button" onClick={() => toggleAssignee(w.id)} className={`px-3 py-1.5 rounded-full text-xs font-medium ${form.assignees.includes(w.id) ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-200' : w.availability !== 'available' ? 'bg-stone-50 text-stone-300 border border-stone-200' : 'bg-stone-50 text-stone-500 border border-stone-200 hover:border-stone-300'}`}>
                    {w.name}{w.availability !== 'available' && ` (${w.availability === 'vacation' ? '🏖' : 'off'})`}
                  </button>
                ))}
              </div>
            </div>

            {conflicts.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="text-sm font-medium text-amber-800 mb-1">⚠️ Schedule Conflict</div>
                {conflicts.map(c => <div key={c.id} className="text-xs text-amber-700">{c.title} for {clientName(c.client_id)} at {formatTime(c.start_time)} ({c.duration_minutes}min)</div>)}
              </div>
            )}

            <Field label="Notes" value={form.notes} onChange={v => setForm(f => ({...f, notes: v}))} type="textarea" placeholder="Any notes for this job..." />
          </div>

          <div className="flex gap-3 mt-6 pt-4 border-t border-stone-200">
            <button onClick={() => setModal(null)} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200">Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.client_id || !form.date || !form.title.trim()} className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50">
              {saving ? 'Saving...' : modal === 'add' ? 'Create Job' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Views ──

function MonthView({ days, year, month, today, jobsOnDate, dateStr, onDayClick }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-stone-200">{DAYS.map(d => <div key={d} className="py-2 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">{d}</div>)}</div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          if (!d) return <div key={i} className="min-h-[80px] bg-stone-50 border-b border-r border-stone-100" />
          const ds = dateStr(d); const dayJobs = jobsOnDate(ds); const isToday = ds === today
          return (
            <div key={i} onClick={() => onDayClick(d)} className="min-h-[80px] p-1.5 border-b border-r border-stone-100 hover:bg-stone-50 cursor-pointer">
              <div className="flex items-center justify-between mb-1">
                <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-medium rounded-full ${isToday ? 'bg-emerald-700 text-white' : 'text-stone-600'}`}>{d}</span>
                {dayJobs.length > 0 && <span className="text-[10px] text-stone-400">{dayJobs.length}</span>}
              </div>
              <div className="space-y-0.5">
                {dayJobs.slice(0,3).map(j => <div key={j.id} className={`px-1.5 py-0.5 rounded text-[10px] font-medium truncate ${j.status==='completed'?'bg-emerald-50 text-emerald-600':j.status==='in_progress'?'bg-amber-50 text-amber-600':j.status==='cancelled'?'bg-stone-50 text-stone-400 line-through':'bg-blue-50 text-blue-600'}`}>{formatTime(j.start_time)} {j.title}</div>)}
                {dayJobs.length > 3 && <div className="text-[10px] text-stone-400 pl-1">+{dayJobs.length-3} more</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ days, today, jobsOnDate, onJobClick, onAddJob }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      <div className="grid grid-cols-7 divide-x divide-stone-100">
        {days.map(d => {
          const ds = toDateStr(d); const dayJobs = jobsOnDate(ds); const isToday = ds === today
          return (
            <div key={ds} className="min-h-[300px]">
              <div className={`py-2 px-2 text-center border-b border-stone-100 ${isToday ? 'bg-emerald-50' : ''}`}>
                <div className="text-[10px] text-stone-400 uppercase">{DAYS[d.getDay()]}</div>
                <div className={`text-sm font-semibold ${isToday ? 'text-emerald-700' : 'text-stone-700'}`}>{d.getDate()}</div>
              </div>
              <div className="p-1 space-y-1">
                {dayJobs.map(j => (
                  <div key={j.id} onClick={() => onJobClick(j)} className={`p-1.5 rounded-lg text-[10px] cursor-pointer hover:opacity-80 ${j.status==='completed'?'bg-emerald-50 border border-emerald-100':j.status==='in_progress'?'bg-amber-50 border border-amber-100':j.status==='cancelled'?'bg-stone-50 border border-stone-100':'bg-blue-50 border border-blue-100'}`}>
                    <div className="font-medium truncate">{formatTime(j.start_time)} {j.title}</div>
                    <div className="text-stone-500 truncate">{j.clients?.name}</div>
                  </div>
                ))}
                <button onClick={() => onAddJob(d)} className="w-full py-1 text-[10px] text-stone-300 hover:text-stone-500 hover:bg-stone-50 rounded">+</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayView({ date, today, jobs, onJobClick, onAddJob, workerName, clientName, onCheckIn, tz }) {
  const ds = toDateStr(date); const isToday = ds === today
  const sorted = [...jobs].sort((a, b) => (a.start_time||'').localeCompare(b.start_time||''))
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5">
      {sorted.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-stone-400 text-sm mb-3">No jobs scheduled for this day.</p>
          <button onClick={onAddJob} className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800">Add a Job</button>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(job => (
            <div key={job.id} className={`p-4 rounded-xl border cursor-pointer hover:shadow-sm ${statusColors[job.status]}`} onClick={() => onJobClick(job)}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-stone-900 text-sm flex items-center gap-1.5">
                    {job.title}
                    {job.recurrence_group_id && <span className="text-purple-500 text-[10px]">↻</span>}
                  </div>
                  <div className="text-stone-600 text-xs mt-0.5">{clientName(job.client_id)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-stone-700">{formatTime(job.start_time)}</div>
                  <div className="text-xs text-stone-400">{job.duration_minutes}min</div>
                </div>
              </div>
              {job.job_assignments?.length > 0 && <div className="flex gap-1 mt-2">{job.job_assignments.map(a => <span key={a.user_id} className="text-xs text-stone-500">{workerName(a.user_id)}</span>)}</div>}
              {isToday && (
                <div className="flex gap-2 mt-3" onClick={e => e.stopPropagation()}>
                  {job.status === 'scheduled' && <button onClick={() => onCheckIn(job, 'arrive')} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">Arrived</button>}
                  {job.status === 'in_progress' && <button onClick={() => onCheckIn(job, 'complete')} className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800">Completed</button>}
                  {job.arrived_at && <span className="text-xs text-stone-400">Arrived {formatTimestamp(job.arrived_at, tz)}</span>}
                  {job.completed_at && <span className="text-xs text-stone-400">Done {formatTimestamp(job.completed_at, tz)}</span>}
                </div>
              )}
              {job.price && <div className="mt-2 text-xs font-medium text-stone-600">${Number(job.price).toFixed(2)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shared ──

function Modal({ children, onClose, wide }) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`bg-white rounded-2xl shadow-xl p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>{children}</div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  const base = "w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
  if (type === 'textarea') return <div>{label && <label className="block text-xs font-medium text-stone-500 mb-1.5">{label}</label>}<textarea value={value||''} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} className={base + " resize-none"} /></div>
  return <div>{label && <label className="block text-xs font-medium text-stone-500 mb-1.5">{label}</label>}<input type={type} value={value||''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={base} /></div>
}

function InfoRow({ label, value }) {
  if (!value) return null
  return <div className="flex justify-between py-1.5"><span className="text-xs text-stone-400">{label}</span><span className="text-sm text-stone-700">{value}</span></div>
}
