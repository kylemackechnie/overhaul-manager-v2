import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { aggregateByWbs } from '../../engines/forecastEngine'
import type { WbsCostRow } from '../../engines/forecastEngine'
import type { WbsItem } from '../../types'

export function WBSPanel() {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<WbsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [wbsActuals, setWbsActuals] = useState<Record<string,number>>({})
  const [modal, setModal] = useState<null | 'new' | WbsItem>(null)
  const [form, setForm] = useState({ code: '', name: '', pm100: '', pm80: '' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [mikaImporting, setMikaImporting] = useState(false)
  const [actuals, setActuals] = useState<Record<string, number>>({})

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('wbs_list').select('*')
      .eq('project_id', activeProject!.id).order('sort_order').order('code')
    setItems((data || []) as WbsItem[])
    // Load actuals per WBS
    const pid = activeProject!.id
    const [hireData, carData, acData, tsData, rcData, boData] = await Promise.all([
      supabase.from('hire_items').select('wbs,hire_cost').eq('project_id',pid),
      supabase.from('cars').select('wbs,total_cost').eq('project_id',pid),
      supabase.from('accommodation').select('wbs,total_cost').eq('project_id',pid),
      supabase.from('weekly_timesheets').select('*').eq('project_id',pid),
      supabase.from('rate_cards').select('*').eq('project_id',pid),
      supabase.from('back_office_hours').select('*').eq('project_id',pid),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = aggregateByWbs(data||[], (hireData.data||[]) as never[], (carData.data||[]) as never[], (acData.data||[]) as never[], (tsData.data||[]) as never[], (rcData.data||[]) as never[], (boData.data||[]) as never[], [], [], pid)
    const actualMap: Record<string,number> = {}
    for (const row of rows as WbsCostRow[]) { if (row.code && row.total) actualMap[row.code] = row.total }
    setActuals(actualMap)
    setWbsActuals(actualMap)
    setLoading(false)
  }

  async function save() {
    if (!form.code.trim()) return toast('WBS code required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      code: form.code.trim(), name: form.name.trim(),
      pm100: form.pm100 ? parseFloat(form.pm100) : null,
      pm80: form.pm80 ? parseFloat(form.pm80) : null,
      sort_order: modal === 'new' ? items.length : (modal as WbsItem).sort_order,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('wbs_list').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('WBS added', 'success')
    } else {
      const { error } = await supabase.from('wbs_list').update(payload).eq('id', (modal as WbsItem).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(item: WbsItem) {
    if (!confirm(`Delete WBS "${item.code}"?`)) return
    await supabase.from('wbs_list').delete().eq('id', item.id)
    toast('Deleted', 'info'); load()
  }

  async function bulkImport() {
    const lines = bulkText.trim().split('\n').filter(l => l.trim())
    if (!lines.length) return toast('No data to import', 'error')
    setBulkSaving(true)
    const existing = new Set(items.map(i => i.code))
    const toAdd = []
    let skipped = 0
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/\t|,/).map(p => p.trim())
      const code = parts[0]; const name = parts[1] || ''
      if (!code) continue
      if (existing.has(code)) { skipped++; continue }
      toAdd.push({ project_id: activeProject!.id, code, name, sort_order: items.length + i })
    }
    if (toAdd.length === 0) { toast(`Nothing new to add (${skipped} already exist)`, 'info'); setBulkSaving(false); return }
    const { error } = await supabase.from('wbs_list').insert(toAdd)
    if (error) { toast(error.message, 'error'); setBulkSaving(false); return }
    toast(`Added ${toAdd.length} WBS codes${skipped ? ` (${skipped} skipped — already exist)` : ''}`, 'success')
    setBulkSaving(false); setBulkText(''); setShowBulk(false); load()
  }

  async function handleMikaImport(file: File) {
    setMikaImporting(true)
    try {
      const text = await file.text()
      const rows = text.split('\n').map(l => l.split(',').map(c2 => c2.trim().replace(/^"|"$/g, '')))
      // Find WBS Element header row
      let headerIdx = rows.findIndex(r => r[0]?.trim() === 'WBS Element')
      if (headerIdx < 0) { toast('Could not find WBS Element header row — is this a MIKA CSV export?', 'error'); setMikaImporting(false); return }

      const existingCodes = new Set(items.map(i => i.code))
      let added = 0, updated = 0

      // Find PM80/PM100 columns
      const hdr = rows[headerIdx]
      const parentRow = headerIdx > 0 ? rows[headerIdx - 1] : []
      let iPM80 = -1, iPM100 = -1
      for (let i = 2; i < hdr.length; i++) {
        const p = (parentRow[i] || '').toLowerCase()
        const s = (hdr[i] || '').toLowerCase()
        if (iPM80 < 0 && (p.includes('pm80') || p.includes('pm080')) && s.includes('planned')) iPM80 = i
        else if (iPM100 < 0 && p.includes('pm100') && s.includes('planned')) iPM100 = i
      }
      if (iPM80 < 0) iPM80 = 2
      if (iPM100 < 0) iPM100 = 3

      const parseCur = (v: string) => { if (!v) return 0; const n = parseFloat(v.replace(/[,$]/g, '')); return isNaN(n) ? 0 : n }

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i]
        const wbs = r[0]?.trim()
        if (!wbs || !wbs.includes('OP-')) continue
        const desc = r[1]?.trim() || ''
        const pm80 = parseCur(r[iPM80])
        const pm100 = parseCur(r[iPM100])

        if (existingCodes.has(wbs)) {
          // Update PM80/PM100 on existing
          const existing = items.find(w => w.code === wbs)
          if (existing && (pm80 !== (existing.pm80 || 0) || pm100 !== (existing.pm100 || 0))) {
            await supabase.from('wbs_list').update({ pm80: pm80 || null, pm100: pm100 || null, name: desc || existing.name }).eq('id', existing.id)
            updated++
          }
        } else {
          await supabase.from('wbs_list').insert({ project_id: activeProject!.id, code: wbs, name: desc, pm80: pm80 || null, pm100: pm100 || null, sort_order: items.length + added })
          existingCodes.add(wbs)
          added++
        }
      }

      toast(`MIKA import: ${added} WBS added, ${updated} updated`, 'success')
      load()
    } catch (e) { toast((e as Error).message, 'error') }
    setMikaImporting(false)
  }

    function exportCSV() {
    const rows = [['Code', 'Description', 'PM80', 'PM100']]
    items.forEach(i => rows.push([i.code, i.name || '', String(i.pm80 ?? ''), String(i.pm100 ?? '')]))
    const csv = rows.map(r => r.map(c => c.includes(',') ? `"${c}"` : c).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `wbs_${activeProject?.name || 'project'}.csv`
    a.click()
  }

  const filtered = items.filter(i =>
    !search || i.code.toLowerCase().includes(search.toLowerCase()) || (i.name || '').toLowerCase().includes(search.toLowerCase())
  )
  const fmt = (n: number | null | undefined) => n ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'

  return (
    <div style={{ padding: '24px', maxWidth: '960px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>WBS List</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>{items.length} WBS codes for this project</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
          <button className="btn btn-sm" onClick={() => setShowBulk(b => !b)}>📋 Bulk Import</button>
          <label className="btn btn-sm" style={{cursor:"pointer"}}>{mikaImporting?<span className="spinner" style={{width:"14px",height:"14px"}}/>:"📊"} MIKA Import<input type="file" accept=".csv" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)handleMikaImport(f)}} /></label>
          <button className="btn btn-primary" onClick={() => { setForm({ code: '', name: '', pm100: '', pm80: '' }); setModal('new') }}>+ Add WBS</button>
        </div>
      </div>

      <input className="input" style={{ maxWidth: '300px', marginBottom: '16px' }} placeholder="Search code or name..." value={search} onChange={e => setSearch(e.target.value)} />

      {/* Bulk import */}
      {showBulk && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Bulk Import</div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '8px' }}>
            One WBS per line. Tab or comma separated: <code>50OP-00138.P.01.02.01, SEA Labour</code>
          </p>
          <textarea className="input" rows={8} value={bulkText} onChange={e => setBulkText(e.target.value)}
            placeholder={'50OP-00138.P.01.02.01\tSEA Labour & Allowances\n50OP-00138.P.01.02.02\tSEA Equipment Hire'} style={{ fontFamily: 'var(--mono)', fontSize: '12px', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button className="btn btn-primary" onClick={bulkImport} disabled={bulkSaving}>
              {bulkSaving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Import
            </button>
            <button className="btn" onClick={() => { setShowBulk(false); setBulkText('') }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📍</div>
            <h3>No WBS codes</h3>
            <p>Add WBS codes to allocate costs across this project. Use Bulk Import to add many at once.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>WBS Code</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>PM80 Budget</th>
                  <th style={{ textAlign: 'right' }}>PM100 Budget</th>
                  <th style={{ textAlign: 'right' }}>Actuals</th>
                  <th style={{ textAlign: 'right' }}>Variance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>{item.code}</td>
                    <td style={{ color: 'var(--text2)' }}>{item.name || '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text3)' }}>{fmt(item.pm80)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text2)', fontWeight: item.pm100 ? 600 : 400 }}>{fmt(item.pm100)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: actuals[item.code] ? 'var(--text)' : 'var(--text3)' }}>{actuals[item.code] ? fmt(actuals[item.code]) : '—'}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>
                      {item.pm100 && actuals[item.code] ? (() => { const v = item.pm100 - actuals[item.code]; return <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v >= 0 ? '+' : ''}{fmt(v)}</span> })() : '—'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => { setForm({ code: item.code, name: item.name, pm100: item.pm100?.toString() || '', pm80: item.pm80?.toString() || '' }); setModal(item) }}>Edit</button>
                      <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(item)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add WBS Code' : 'Edit WBS Code'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>WBS Code *</label>
                <input className="input" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. 50OP-00138.P.01.02.01" autoFocus style={{ fontFamily: 'var(--mono)' }} />
              </div>
              <div className="fg">
                <label>Description</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. SEA Labour & Allowances" />
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>PM80 Budget ($)</label>
                  <input type="number" className="input" value={form.pm80} onChange={e => setForm(f => ({ ...f, pm80: e.target.value }))} placeholder="0" />
                </div>
                <div className="fg">
                  <label>PM100 Budget ($)</label>
                  <input type="number" className="input" value={form.pm100} onChange={e => setForm(f => ({ ...f, pm100: e.target.value }))} placeholder="0" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {modal !== 'new' && <button className="btn" style={{ color: 'var(--red)', marginRight: 'auto' }} onClick={() => { del(modal as WbsItem); setModal(null) }}>Delete</button>}
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}
      {items.some(w => w.pm100 || w.pm80) && (
        <div className="card" style={{marginTop:'16px',padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 14px',fontWeight:600,fontSize:'13px',borderBottom:'1px solid var(--border)'}}>
            MIKA Budget vs Actuals
          </div>
          <table>
            <thead><tr>
              <th>WBS Code</th><th>Description</th>
              <th style={{textAlign:'right'}}>PM80</th>
              <th style={{textAlign:'right'}}>PM100</th>
              <th style={{textAlign:'right'}}>Actuals</th>
              <th style={{textAlign:'right'}}>Variance</th>
              <th style={{textAlign:'right'}}>% Spent</th>
            </tr></thead>
            <tbody>
              {items.filter(w=>w.pm100||w.pm80).map(w=>{
                const act = wbsActuals[w.code]||0
                const budget = w.pm100||w.pm80||0
                const variance = budget - act
                const pct = budget>0?(act/budget*100):null
                return (
                  <tr key={w.id}>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px',fontWeight:500}}>{w.code}</td>
                    <td style={{color:'var(--text2)'}}>{w.name}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{w.pm80?`$${Number(w.pm80).toLocaleString()}`:'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{w.pm100?`$${Number(w.pm100).toLocaleString()}`:'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--green)'}}>{act>0?`$${act.toLocaleString()}`:'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:variance<0?'var(--red)':'var(--green)'}}>{budget>0?(variance>=0?'+':'')+`$${Math.abs(variance).toLocaleString()}`:'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:pct===null?'var(--text3)':pct>100?'var(--red)':pct>85?'var(--amber)':'var(--text2)'}}>{pct!==null?pct.toFixed(1)+'%':'—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
