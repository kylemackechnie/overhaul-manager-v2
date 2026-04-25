import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'

interface HSEEntry {
  id: string; project_id: string; date: string; person: string
  category: string; hours: number; description: string; notes: string; created_at: string
}

const CATEGORIES = [
  'Toolbox Talk', 'Safety Observation', 'Incident Investigation', 'Risk Assessment (JSA/SWMS)',
  'Safety Walk', 'Induction', 'Emergency Drill', 'First Aid', 'HSE Meeting', 'Environmental Check', 'Other'
]
const EMPTY = { date: new Date().toISOString().slice(0, 10), person: '', category: 'Toolbox Talk', hours: 0.5, description: '', notes: '' }

export function HSEHoursPanel() {
  const { activeProject } = useAppStore()
  const [entries, setEntries] = useState<HSEEntry[]>([])
  const [resources, setResources] = useState<{ name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | HSEEntry>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [monthFilter, setMonthFilter] = useState('')
  const [catFilter, setCatFilter] = useState('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [entData, resData] = await Promise.all([
      supabase.from('hse_hours').select('*').eq('project_id', pid).order('date', { ascending: false }),
      supabase.from('resources').select('name').eq('project_id', pid).order('name'),
    ])
    setEntries((entData.data || []) as HSEEntry[])
    setResources((resData.data || []) as { name: string }[])
    setLoading(false)
  }

  async function save() {
    if (!form.person.trim()) return toast('Person required', 'error')
    if (!form.category) return toast('Category required', 'error')
    setSaving(true)
    const payload = { project_id: activeProject!.id, ...form, person: form.person.trim() }
    const isNew = modal === 'new'
    const { error } = isNew
      ? await supabase.from('hse_hours').insert(payload)
      : await supabase.from('hse_hours').update(payload).eq('id', (modal as HSEEntry).id)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(isNew ? 'Added' : 'Saved', 'success'); setSaving(false); setModal(null); load()
  }

  async function del(e: HSEEntry) {
    if (!confirm('Delete this HSE entry?')) return
    await supabase.from('hse_hours').delete().eq('id', e.id)
    toast('Deleted', 'info'); load()
  }

  const months = [...new Set(entries.map(e => e.date?.slice(0, 7)).filter(Boolean))].sort().reverse()
  const cats = [...new Set(entries.map(e => e.category))]

  const filtered = entries
    .filter(e => !monthFilter || e.date?.startsWith(monthFilter))
    .filter(e => catFilter === 'all' || e.category === catFilter)

  const totalHours = filtered.reduce((s, e) => s + (e.hours || 0), 0)
  const byCategory = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = filtered.filter(e => e.category === cat).reduce((s, e) => s + (e.hours || 0), 0)
    return acc
  }, {} as Record<string, number>)

  function exportCSV() {
    downloadCSV(
      [['Date', 'Person', 'Category', 'Hours', 'Description', 'Notes'],
       ...filtered.map(e => [e.date, e.person, e.category, e.hours, e.description, e.notes])],
      `hse_hours_${activeProject?.name || 'project'}`
    )
  }

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>HSE Hours</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {filtered.length} entries · {totalHours.toFixed(1)} hours
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
          <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setModal('new') }}>+ Add Entry</button>
        </div>
      </div>

      {/* Summary by category */}
      {entries.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
          {CATEGORIES.filter(c => byCategory[c] > 0).slice(0, 4).map(cat => (
            <div key={cat} className="card" style={{ padding: '10px 12px', borderTop: '3px solid var(--accent)' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{byCategory[cat].toFixed(1)}h</div>
              <div style={{ fontSize: '11px', color: 'var(--text2)', marginTop: '2px' }}>{cat}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <button className="btn btn-sm" style={{ background: !monthFilter ? 'var(--accent)' : '', color: !monthFilter ? '#fff' : '' }} onClick={() => setMonthFilter('')}>All months</button>
        {months.map(m => <button key={m} className="btn btn-sm" style={{ background: monthFilter === m ? 'var(--accent)' : '', color: monthFilter === m ? '#fff' : '' }} onClick={() => setMonthFilter(m || '')}>{m}</button>)}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <button className="btn btn-sm" style={{ background: catFilter === 'all' ? 'var(--accent)' : '', color: catFilter === 'all' ? '#fff' : '' }} onClick={() => setCatFilter('all')}>All categories</button>
        {cats.map(c => <button key={c} className="btn btn-sm" style={{ background: catFilter === c ? 'var(--accent)' : '', color: catFilter === c ? '#fff' : '' }} onClick={() => setCatFilter(c)}>{c}</button>)}
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /></div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🦺</div>
          <h3>No HSE hours recorded</h3>
          <p>Log safety activities, toolbox talks, observations and drills here.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead><tr><th>Date</th><th>Person</th><th>Category</th><th style={{ textAlign: 'right' }}>Hours</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', whiteSpace: 'nowrap' }}>{e.date}</td>
                  <td style={{ fontWeight: 500 }}>{e.person}</td>
                  <td><span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '3px', background: 'var(--bg3)', color: 'var(--text2)' }}>{e.category}</span></td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{e.hours.toFixed(1)}</td>
                  <td style={{ fontSize: '12px', color: 'var(--text2)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => { setForm({ date: e.date, person: e.person, category: e.category, hours: e.hours, description: e.description, notes: e.notes }); setModal(e) }}>Edit</button>
                    <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(e)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg3)', fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: '8px 12px' }}>Total ({filtered.length})</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', padding: '8px 12px' }}>{totalHours.toFixed(1)}h</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add HSE Entry' : 'Edit HSE Entry'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg">
                  <label>Date</label>
                  <input type="date" className="input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div className="fg" style={{ flex: 2 }}>
                  <label>Person *</label>
                  <input className="input" value={form.person} onChange={e => setForm(f => ({ ...f, person: e.target.value }))} list="hse-people" autoFocus />
                  <datalist id="hse-people">{resources.map(r => <option key={r.name} value={r.name} />)}</datalist>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Category</label>
                  <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Hours</label>
                  <input type="number" step="0.25" min="0" className="input" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="fg">
                <label>Description</label>
                <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Pre-shift toolbox talk — lifting plan" />
              </div>
              <div className="fg">
                <label>Notes</label>
                <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              {modal !== 'new' && <button className="btn" style={{ color: 'var(--red)', marginRight: 'auto' }} onClick={() => { del(modal as HSEEntry); setModal(null) }}>Delete</button>}
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
