import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Site } from '../../types'

const EMPTY = { name: '', client: '', address: '' }

export function SitesPanel() {
  const { currentUser } = useAppStore()
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | Site>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({})

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [siteData, projData] = await Promise.all([
      supabase.from('sites').select('*').order('name'),
      supabase.from('projects').select('site_id').not('site_id', 'is', null),
    ])
    setSites((siteData.data || []) as Site[])
    const counts: Record<string, number> = {}
    for (const p of (projData.data || [])) {
      if (p.site_id) counts[p.site_id] = (counts[p.site_id] || 0) + 1
    }
    setProjectCounts(counts)
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setModal('new') }
  function openEdit(s: Site) {
    setForm({ name: s.name, client: s.client || '', address: s.address || '' })
    setModal(s)
  }

  async function save() {
    if (!form.name.trim()) return toast('Site name required', 'error')
    setSaving(true)
    const payload = { name: form.name.trim(), client: form.client.trim(), address: form.address.trim() }
    const isNew = modal === 'new'
    const { error } = isNew
      ? await supabase.from('sites').insert(payload)
      : await supabase.from('sites').update(payload).eq('id', (modal as Site).id)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(isNew ? 'Site created' : 'Saved', 'success')
    setSaving(false); setModal(null); load()
  }

  async function del(s: Site) {
    const count = projectCounts[s.id] || 0
    if (count > 0) { toast(`Can't delete — ${count} project${count > 1 ? 's' : ''} linked to this site`, 'error'); return }
    if (!confirm(`Delete site "${s.name}"?`)) return
    await supabase.from('sites').delete().eq('id', s.id)
    toast('Deleted', 'info'); load()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '700px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Sites</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{sites.length} sites configured</p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={openNew}>+ Add Site</button>}
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /></div>
      : sites.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🏭</div>
          <h3>No sites yet</h3>
          <p>Sites group projects by physical location. Create a site, then assign projects to it.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sites.map(s => (
            <div key={s.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{s.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                  {s.client && <span style={{ marginRight: '12px' }}>👤 {s.client}</span>}
                  {s.address && <span>📍 {s.address}</span>}
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text3)', textAlign: 'right', minWidth: '80px' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{projectCounts[s.id] || 0}</div>
                <div>project{(projectCounts[s.id] || 0) !== 1 ? 's' : ''}</div>
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button className="btn btn-sm" onClick={() => openEdit(s)}>Edit</button>
                  <button className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => del(s)}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add Site' : `Edit: ${(modal as Site).name}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>Site Name *</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Gladstone Power Station" autoFocus />
              </div>
              <div className="fg">
                <label>Client / Owner</label>
                <input className="input" value={form.client} onChange={e => setForm(f => ({ ...f, client: e.target.value }))}
                  placeholder="e.g. NRG Energy, AGL" />
              </div>
              <div className="fg">
                <label>Address</label>
                <input className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="e.g. Gladstone QLD 4680" />
              </div>
            </div>
            <div className="modal-footer">
              {modal !== 'new' && (
                <button className="btn" style={{ color: 'var(--red)', marginRight: 'auto' }}
                  onClick={() => { del(modal as Site); setModal(null) }}>Delete</button>
              )}
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
