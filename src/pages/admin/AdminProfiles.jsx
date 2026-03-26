import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../contexts/ToastContext'

function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-bold text-stone-900 mb-2">{title}</h3>
        <p className="text-stone-500 text-sm mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 border border-stone-200 rounded-xl text-stone-600 text-sm hover:bg-stone-50">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 py-2 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminProfiles() {
  const { showToast } = useToast()

  const [profiles, setProfiles]             = useState([])
  const [loading, setLoading]               = useState(true)
  const [expanded, setExpanded]             = useState(null)

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(null)
  const [editForm, setEditForm]             = useState({})
  const [addingProfile, setAddingProfile]   = useState(false)
  const [newProfileForm, setNewProfileForm] = useState({ name: '', description: '' })
  const [profSaving, setProfSaving]         = useState(false)

  // Service type editing
  const [stEditing, setStEditing]           = useState(null)
  const [stEditForm, setStEditForm]         = useState({})
  const [stAdding, setStAdding]             = useState(null)
  const [stNewForm, setStNewForm]           = useState({ name: '', description: '', default_duration_minutes: 120 })
  const [stSaving, setStSaving]             = useState(false)

  const [confirm, setConfirm]               = useState(null)

  useEffect(() => { loadProfiles() }, [])

  async function loadProfiles() {
    setLoading(true)
    const { data, error } = await supabase
      .from('industry_profiles')
      .select('id, name, description, is_active, sort_order, profile_service_types(id, name, description, default_duration_minutes, sort_order)')
      .order('sort_order')
    if (error) {
      showToast('Failed to load profiles.', 'error')
      setLoading(false)
      return
    }
    const sorted = (data || []).map(p => ({
      ...p,
      profile_service_types: [...(p.profile_service_types || [])].sort((a, b) => a.sort_order - b.sort_order),
    }))
    setProfiles(sorted)
    setLoading(false)
  }

  // ── Profile CRUD ─────────────────────────────────────────────

  async function addProfile() {
    if (!newProfileForm.name.trim()) return
    setProfSaving(true)
    const maxOrder = profiles.length > 0 ? Math.max(...profiles.map(p => p.sort_order)) + 1 : 1
    const { error } = await supabase.from('industry_profiles').insert({
      name: newProfileForm.name.trim(),
      description: newProfileForm.description.trim() || null,
      sort_order: maxOrder,
    })
    if (error) { showToast('Failed to add profile.', 'error') }
    else { setAddingProfile(false); setNewProfileForm({ name: '', description: '' }); await loadProfiles() }
    setProfSaving(false)
  }

  async function saveProfile(id) {
    if (!editForm.name?.trim()) return
    setProfSaving(true)
    const { error } = await supabase.from('industry_profiles').update({
      name: editForm.name.trim(),
      description: editForm.description?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { showToast('Failed to save profile.', 'error') }
    else { setEditingProfile(null); await loadProfiles() }
    setProfSaving(false)
  }

  async function toggleProfileActive(profile) {
    const { error } = await supabase.from('industry_profiles').update({
      is_active: !profile.is_active,
      updated_at: new Date().toISOString(),
    }).eq('id', profile.id)
    if (error) { showToast('Failed to update profile.', 'error') }
    else await loadProfiles()
  }

  async function moveProfile(profile, dir) {
    const sorted = [...profiles].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex(p => p.id === profile.id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const swap = sorted[swapIdx]
    await Promise.all([
      supabase.from('industry_profiles').update({ sort_order: swap.sort_order }).eq('id', profile.id),
      supabase.from('industry_profiles').update({ sort_order: profile.sort_order }).eq('id', swap.id),
    ])
    await loadProfiles()
  }

  async function deleteProfile(id) {
    const { data: orgs } = await supabase
      .from('organization_profiles')
      .select('org_id, organizations(name)')
      .eq('profile_id', id)
    const orgCount = orgs?.length ?? 0
    const orgNames = (orgs || []).map(o => o.organizations?.name).filter(Boolean).join(', ')
    setConfirm({
      title: 'Delete Profile',
      message: orgCount > 0
        ? `This profile is applied to ${orgCount} org(s): ${orgNames}. Deleting it removes the template but does not affect their existing service types.`
        : 'Delete this profile and all its service type templates? This cannot be undone.',
      onConfirm: async () => {
        const { error } = await supabase.from('industry_profiles').delete().eq('id', id)
        if (error) { showToast('Failed to delete profile.', 'error') }
        else { setExpanded(null); setEditingProfile(null); await loadProfiles() }
        setConfirm(null)
      },
    })
  }

  // ── Service type CRUD ─────────────────────────────────────────

  async function addServiceType(profileId) {
    if (!stNewForm.name.trim()) return
    setStSaving(true)
    const profile = profiles.find(p => p.id === profileId)
    const maxOrder = (profile?.profile_service_types?.length ?? 0) > 0
      ? Math.max(...profile.profile_service_types.map(st => st.sort_order)) + 1
      : 1
    const { error } = await supabase.from('profile_service_types').insert({
      profile_id: profileId,
      name: stNewForm.name.trim(),
      description: stNewForm.description?.trim() || null,
      default_duration_minutes: Number(stNewForm.default_duration_minutes) || 120,
      sort_order: maxOrder,
    })
    if (error) { showToast('Failed to add service type.', 'error') }
    else {
      setStAdding(null)
      setStNewForm({ name: '', description: '', default_duration_minutes: 120 })
      await loadProfiles()
    }
    setStSaving(false)
  }

  async function saveServiceType(id) {
    if (!stEditForm.name?.trim()) return
    setStSaving(true)
    const { error } = await supabase.from('profile_service_types').update({
      name: stEditForm.name.trim(),
      description: stEditForm.description?.trim() || null,
      default_duration_minutes: Number(stEditForm.default_duration_minutes) || 120,
    }).eq('id', id)
    if (error) { showToast('Failed to update service type.', 'error') }
    else { setStEditing(null); await loadProfiles() }
    setStSaving(false)
  }

  async function moveServiceType(profileId, st, dir) {
    const profile = profiles.find(p => p.id === profileId)
    const sorted = [...(profile?.profile_service_types || [])].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex(s => s.id === st.id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const swap = sorted[swapIdx]
    await Promise.all([
      supabase.from('profile_service_types').update({ sort_order: swap.sort_order }).eq('id', st.id),
      supabase.from('profile_service_types').update({ sort_order: st.sort_order }).eq('id', swap.id),
    ])
    await loadProfiles()
  }

  async function deleteServiceType(id) {
    setConfirm({
      title: 'Remove Service Type',
      message: 'Remove this service type from the template? Orgs that already have this service type are not affected.',
      onConfirm: async () => {
        const { error } = await supabase.from('profile_service_types').delete().eq('id', id)
        if (error) { showToast('Failed to delete service type.', 'error') }
        else await loadProfiles()
        setConfirm(null)
      },
    })
  }

  // ── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-stone-400 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-stone-900">Industry Profiles</h1>
            <p className="text-sm text-stone-500 mt-0.5">
              Master service type templates. Apply them to an org during onboarding to pre-populate their service types.
            </p>
          </div>
          <button
            onClick={() => { setAddingProfile(true); setNewProfileForm({ name: '', description: '' }) }}
            className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 flex-shrink-0"
          >
            + Add Profile
          </button>
        </div>

        {/* Add profile form */}
        {addingProfile && (
          <div className="bg-white rounded-2xl border border-emerald-200 p-5 mb-4">
            <p className="text-sm font-semibold text-stone-800 mb-3">New Profile</p>
            <div className="space-y-2 mb-3">
              <input
                autoFocus
                placeholder="Profile name (e.g. Residential Cleaning)"
                className="w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                value={newProfileForm.name}
                onChange={e => setNewProfileForm(p => ({ ...p, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addProfile() }}
              />
              <textarea
                rows={2}
                placeholder="Description (optional)"
                className="w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-none"
                value={newProfileForm.description}
                onChange={e => setNewProfileForm(p => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={addProfile}
                disabled={profSaving || !newProfileForm.name.trim()}
                className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50"
              >
                {profSaving ? 'Saving…' : 'Create Profile'}
              </button>
              <button
                onClick={() => setAddingProfile(false)}
                className="px-4 py-2 border border-stone-200 text-stone-600 text-sm rounded-xl hover:bg-stone-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Summary */}
        <p className="text-xs text-stone-400 mb-4">{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</p>

        {/* Profile list */}
        <div className="space-y-3">
          {profiles.length === 0 && !addingProfile && (
            <div className="text-center py-16 text-stone-400 text-sm">
              No profiles yet. Click "Add Profile" to create the first one.
            </div>
          )}

          {profiles.map((profile, idx) => (
            <div key={profile.id} className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
              {/* Profile header row */}
              <div
                className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-stone-50 select-none"
                onClick={() => {
                  setExpanded(expanded === profile.id ? null : profile.id)
                  if (expanded !== profile.id) { setEditingProfile(null); setStEditing(null); setStAdding(null) }
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-stone-800">{profile.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${profile.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                      {profile.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {profile.description && (
                    <p className="text-xs text-stone-400 mt-0.5 truncate">{profile.description}</p>
                  )}
                  <p className="text-xs text-stone-400 mt-0.5">
                    {profile.profile_service_types?.length ?? 0} service type{(profile.profile_service_types?.length ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); moveProfile(profile, -1) }}
                    disabled={idx === 0}
                    title="Move up"
                    className="p-1.5 text-stone-300 hover:text-stone-600 disabled:opacity-20 rounded hover:bg-stone-100"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); moveProfile(profile, 1) }}
                    disabled={idx === profiles.length - 1}
                    title="Move down"
                    className="p-1.5 text-stone-300 hover:text-stone-600 disabled:opacity-20 rounded hover:bg-stone-100"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <svg
                    className={`w-4 h-4 text-stone-400 transition-transform ml-1 ${expanded === profile.id ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded body */}
              {expanded === profile.id && (
                <div className="border-t border-stone-100 p-5 space-y-6">

                  {/* Profile details edit */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Profile Details</p>
                      {editingProfile !== profile.id ? (
                        <div className="flex gap-3">
                          <button
                            onClick={() => toggleProfileActive(profile)}
                            className={`text-xs font-medium hover:underline ${profile.is_active ? 'text-amber-600' : 'text-emerald-700'}`}
                          >
                            {profile.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => { setEditingProfile(profile.id); setEditForm({ name: profile.name, description: profile.description || '' }) }}
                            className="text-xs text-stone-500 font-medium hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteProfile(profile.id)}
                            className="text-xs text-red-500 font-medium hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {editingProfile === profile.id ? (
                      <div className="space-y-2">
                        <input
                          autoFocus
                          className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          value={editForm.name}
                          onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                          placeholder="Profile name"
                        />
                        <textarea
                          rows={2}
                          className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-none"
                          value={editForm.description}
                          onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                          placeholder="Description (optional)"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveProfile(profile.id)}
                            disabled={profSaving || !editForm.name?.trim()}
                            className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                          >
                            {profSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingProfile(null)}
                            className="px-3 py-1.5 border border-stone-200 text-stone-600 text-xs rounded-lg hover:bg-stone-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-stone-500">
                        {profile.description || <span className="italic text-stone-300">No description</span>}
                      </p>
                    )}
                  </div>

                  {/* Service types */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Service Types</p>
                      {stAdding !== profile.id && (
                        <button
                          onClick={() => {
                            setStAdding(profile.id)
                            setStNewForm({ name: '', description: '', default_duration_minutes: 120 })
                          }}
                          className="text-xs text-emerald-700 font-medium hover:underline"
                        >
                          + Add
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {profile.profile_service_types?.map((st, stIdx) => (
                        <div key={st.id} className="flex items-start gap-2 p-2.5 bg-stone-50 rounded-xl">
                          {stEditing === st.id ? (
                            <>
                              <div className="flex-1 space-y-1.5">
                                <input
                                  autoFocus
                                  className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs text-stone-800 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                                  value={stEditForm.name}
                                  onChange={e => setStEditForm(p => ({ ...p, name: e.target.value }))}
                                  placeholder="Name"
                                />
                                <input
                                  className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs text-stone-800 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                                  value={stEditForm.description}
                                  onChange={e => setStEditForm(p => ({ ...p, description: e.target.value }))}
                                  placeholder="Description (optional)"
                                />
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number" min="15" step="15"
                                    className="w-24 px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs text-stone-800 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                                    value={stEditForm.default_duration_minutes}
                                    onChange={e => setStEditForm(p => ({ ...p, default_duration_minutes: e.target.value }))}
                                  />
                                  <span className="text-xs text-stone-400">min</span>
                                </div>
                              </div>
                              <div className="flex flex-col gap-1 flex-shrink-0 mt-0.5">
                                <button
                                  onClick={() => saveServiceType(st.id)}
                                  disabled={stSaving}
                                  className="px-2.5 py-1 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setStEditing(null)}
                                  className="px-2.5 py-1 border border-stone-200 text-stone-600 text-xs rounded-lg hover:bg-stone-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex flex-col gap-0.5 flex-shrink-0 mt-1">
                                <button
                                  onClick={() => moveServiceType(profile.id, st, -1)}
                                  disabled={stIdx === 0}
                                  className="p-0.5 text-stone-300 hover:text-stone-500 disabled:opacity-20"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => moveServiceType(profile.id, st, 1)}
                                  disabled={stIdx === (profile.profile_service_types?.length ?? 1) - 1}
                                  className="p-0.5 text-stone-300 hover:text-stone-500 disabled:opacity-20"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-stone-800">{st.name}</div>
                                {st.description && (
                                  <div className="text-xs text-stone-400 mt-0.5">{st.description}</div>
                                )}
                                <div className="text-xs text-stone-400 mt-0.5">{st.default_duration_minutes} min</div>
                              </div>
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                <button
                                  onClick={() => {
                                    setStEditing(st.id)
                                    setStEditForm({ name: st.name, description: st.description || '', default_duration_minutes: st.default_duration_minutes })
                                  }}
                                  className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-white"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => deleteServiceType(st.id)}
                                  className="p-1.5 text-stone-400 hover:text-red-500 rounded-lg hover:bg-white"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}

                      {(profile.profile_service_types?.length ?? 0) === 0 && stAdding !== profile.id && (
                        <p className="text-xs text-stone-400 italic py-1">No service types yet.</p>
                      )}

                      {/* Add service type form */}
                      {stAdding === profile.id && (
                        <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 space-y-2 mt-1">
                          <input
                            autoFocus
                            className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs text-stone-800 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                            placeholder="Service type name"
                            value={stNewForm.name}
                            onChange={e => setStNewForm(p => ({ ...p, name: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') addServiceType(profile.id) }}
                          />
                          <input
                            className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs text-stone-800 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                            placeholder="Description (optional)"
                            value={stNewForm.description}
                            onChange={e => setStNewForm(p => ({ ...p, description: e.target.value }))}
                          />
                          <div className="flex items-center gap-2">
                            <input
                              type="number" min="15" step="15"
                              className="w-24 px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs text-stone-800 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
                              placeholder="120"
                              value={stNewForm.default_duration_minutes}
                              onChange={e => setStNewForm(p => ({ ...p, default_duration_minutes: e.target.value }))}
                            />
                            <span className="text-xs text-stone-400">min</span>
                            <div className="flex gap-1.5 ml-auto">
                              <button
                                onClick={() => addServiceType(profile.id)}
                                disabled={stSaving || !stNewForm.name.trim()}
                                className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                              >
                                Add
                              </button>
                              <button
                                onClick={() => setStAdding(null)}
                                className="px-3 py-1.5 border border-stone-200 text-stone-600 text-xs rounded-lg hover:bg-white"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
