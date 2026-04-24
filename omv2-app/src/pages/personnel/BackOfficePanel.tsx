import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { BackOfficeHour, RateCard, WbsItem } from '../../types'

type BOForm = {
  name: string; role: string; date: string
  hours: number; cost: number; sell: number; wbs: string; notes: string
}

const EMPTY: BOForm = { name: '', role: '', date: new Date().toISOString().slice(0, 10), hours: 0, cost: 0, sell: 0, wbs: '', notes: '' }

export function BackOfficePanel() {
  const { activeProject } = useAppStore()
  const [entries, setEntries] = useState<BackOfficeHour[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [wbsList, setWbsList] = useState<WbsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|BackOfficeHour>(null)
  const [form, setForm] = useState<BOForm>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [monthFilter, setMonthFilter] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [boData, rcData, wbsData] = await Promise.all([
      supabase.from('back_office_hours').select('*').eq('project_id', pid).order('date', { ascending: false }),
      supabase.from('rate_cards').select('*').eq('project_id', pid).in('category', ['management','seag']).order('role'),
      supabase.from('wbs_list').select('*').eq('project_id', pid).order('sort_order'),
    ])
    setEntries((boData.data || []) as BackOfficeHour[])
    setRateCards((rcData.data || []) as RateCard[])
    setWbsList((wbsData.data || []) as WbsItem[])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setModal('new') }
  function openEdit(e: BackOfficeHour) {
    setForm({ name: e.name, role: e.role, date: e.date, hours: e.hours, cost: e.cost, sell: e.sell, wbs: e.wbs, notes: e.notes })
    setModal(e)
  }

  function calcRatesFromRC(role: string, hours: number) {
    const rc = rateCards.find(r => r.role.toLowerCase() === role.toLowerCase())
    if (!rc) return { cost: 0, sell: 0 }
    const rates = rc.rates as { cost: Record<string, number>; sell: Record<string, number> }
    const costRate = rates?.cost?.dnt || 0
    const sellRate = rates?.sell?.dnt || 0
    return { cost: parseFloat((hours * costRate).toFixed(2)), sell: parseFloat((hours * sellRate).toFixed(2)) }
  }

  function updateRole(role: string) {
    const { cost, sell } = calcRatesFromRC(role, form.hours)
    setForm(f => ({ ...f, role, cost, sell }))
  }

  function updateHours(hours: number) {
    const { cost, sell } = calcRatesFromRC(form.role, hours)
    setForm(f => ({ ...f, hours, cost, sell }))
  }

  async function save() {
    if (!form.name.trim()) return toast('Name required', 'error')
    if (!form.date) return toast('Date required', 'error')
    setSaving(true)
    const payload = { project_id: activeProject!.id, name: form.name.trim(), role: form.role, date: form.date, hours: form.hours, cost: form.cost, sell: form.sell, wbs: form.wbs, notes: form.notes }
    if (modal === 'new') {
      const { error } = await supabase.from('back_office_hours').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Entry added', 'success')
    } else {
      const { error } = await supabase.from('back_office_hours').update(payload).eq('id', (modal as BackOfficeHour).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(e: BackOfficeHour) {
    if (!confirm(`Delete entry for ${e.name}?`)) return
    await supabase.from('back_office_hours').delete().eq('id', e.id)
    toast('Deleted', 'info'); load()
  }

  const months = [...new Set(entries.map(e => e.date?.slice(0, 7)).filter(Boolean))].sort().reverse()
  const filtered = entries.filter(e => !monthFilter || e.date?.startsWith(monthFilter))
  const totalHours = filtered.reduce((s, e) => s + (e.hours || 0), 0)
  const totalCost = filtered.reduce((s, e) => s + (e.cost || 0), 0)
  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0 })

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Back Office Hours</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {entries.length} entries · {totalHours.toFixed(1)} hrs · Cost {fmt(totalCost)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Hours</button>
      </div>

      {/* Month filter */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button className="btn btn-sm" style={{ background: !monthFilter ? 'var(--accent)' : 'var(--bg)', color: !monthFilter ? '#fff' : 'var(--text)' }} onClick={() => setMonthFilter('')}>All</button>
        {months.map(m => (
          <button key={m} className="btn btn-sm"
            style={{ background: monthFilter === m ? 'var(--accent)' : 'var(--bg)', color: monthFilter === m ? '#fff' : 'var(--text)' }}
            onClick={() => setMonthFilter(m || '')}>
            {m}
          </button>
        ))}
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏢</div>
            <h3>No back office hours</h3>
            <p>Log office-based hours for project management and support staff.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr><th>Date</th><th>Name</th><th>Role</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Cost</th><th style={{ textAlign: 'right' }}>Sell</th><th>WBS</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{e.date}</td>
                    <td style={{ fontWeight: 500 }}>{e.name}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{e.role || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{(e.hours || 0).toFixed(1)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(e.cost || 0)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>{e.sell > 0 ? fmt(e.sell) : '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>{e.wbs || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => openEdit(e)}>Edit</button>
                      <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(e)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add Back Office Hours' : 'Edit Entry'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Name</label>
                  <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Person's name" autoFocus />
                </div>
                <div className="fg">
                  <label>Date</label>
                  <input type="date" className="input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Role</label>
                  <input className="input" value={form.role} onChange={e => updateRole(e.target.value)} placeholder="Role" list="bo-roles" />
                  <datalist id="bo-roles">{rateCards.map(rc => <option key={rc.id} value={rc.role} />)}</datalist>
                </div>
                <div className="fg">
                  <label>Hours</label>
                  <input type="number" step="0.5" min="0" className="input" value={form.hours || ''} onChange={e => updateHours(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Cost ($)</label>
                  <input type="number" className="input" value={form.cost || ''} onChange={e => setForm(f => ({ ...f, cost: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="fg">
                  <label>Sell ($)</label>
                  <input type="number" className="input" value={form.sell || ''} onChange={e => setForm(f => ({ ...f, sell: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="fg">
                <label>WBS Code</label>
                <select className="input" value={form.wbs} onChange={e => setForm(f => ({ ...f, wbs: e.target.value }))}>
                  <option value="">— No WBS —</option>
                  {wbsList.map(w => <option key={w.id} value={w.code}>{w.code} {w.name ? `— ${w.name}` : ''}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>Notes</label>
                <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
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
