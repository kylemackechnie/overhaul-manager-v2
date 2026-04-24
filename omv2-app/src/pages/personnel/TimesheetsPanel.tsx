import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { WeeklyTimesheet, Resource, PurchaseOrder } from '../../types'

type TsType = 'trades'|'mgmt'|'seag'|'subcon'

const TYPE_LABELS: Record<TsType,string> = { trades:'Trades', mgmt:'Management', seag:'SE AG', subcon:'Subcontractor' }
// regime options: lt12, ge12
const STATUS_FLOW = ['draft','submitted','approved'] as const
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  draft:{bg:'#f1f5f9',color:'#64748b'}, submitted:{bg:'#dbeafe',color:'#1e40af'}, approved:{bg:'#d1fae5',color:'#065f46'},
}

// Get monday of the week containing a date
function getMon(dateStr: string) {
  const d = new Date(dateStr)
  const dow = d.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function weekDays(weekStart: string): string[] {
  const days = []
  const d = new Date(weekStart)
  for (let i = 0; i < 7; i++) {
    days.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return days
}

const DOWLABEL = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

export function TimesheetsPanel({ type }: { type: TsType }) {
  const { activeProject } = useAppStore()
  const [sheets, setSheets] = useState<WeeklyTimesheet[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [activeWeek, setActiveWeek] = useState<WeeklyTimesheet|null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newForm, setNewForm] = useState({ week_start: getMon(new Date().toISOString().slice(0,10)), regime: 'lt12', wbs: '', vendor: '', po_id: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id, type])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const catMap: Record<TsType, string[]> = {
      trades: ['trades'], mgmt: ['management'], seag: ['seag'], subcon: ['subcontractor']
    }
    const [sheetData, resData, poData] = await Promise.all([
      supabase.from('weekly_timesheets').select('*').eq('project_id', pid).eq('type', type).order('week_start', { ascending: false }),
      supabase.from('resources').select('*').eq('project_id', pid).in('category', catMap[type]).order('name'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).order('po_number'),
    ])
    setSheets((sheetData.data || []) as WeeklyTimesheet[])
    setResources((resData.data || []) as Resource[])
    setPos((poData.data || []) as PurchaseOrder[])
    setLoading(false)
  }

  async function createWeek() {
    setSaving(true)
    const ws = getMon(newForm.week_start)
    // Check for duplicate
    const existing = sheets.find(s => s.week_start === ws)
    if (existing) { toast('A timesheet already exists for this week', 'error'); setSaving(false); return }

    // Default crew from resources
    const crew = resources.map(r => ({
      personId: r.id, name: r.name, role: r.role || '', wbs: r.wbs || newForm.wbs, days: {}
    }))

    const payload = {
      project_id: activeProject!.id, type, week_start: ws,
      regime: newForm.regime, status: 'draft', wbs: newForm.wbs,
      vendor: newForm.vendor || null, po_id: newForm.po_id || null, crew,
    }
    const { data, error } = await supabase.from('weekly_timesheets').insert(payload).select().single()
    if (error) { toast(error.message,'error'); setSaving(false); return }
    toast('Week created','success')
    setSaving(false); setShowNewModal(false)
    await load()
    setActiveWeek(data as WeeklyTimesheet)
  }

  async function saveHours(sheet: WeeklyTimesheet) {
    const { error } = await supabase.from('weekly_timesheets').update({ crew: sheet.crew }).eq('id', sheet.id)
    if (error) { toast(error.message,'error'); return }
    toast('Hours saved','success')
    load()
  }

  async function advanceStatus(sheet: WeeklyTimesheet) {
    const idx = STATUS_FLOW.indexOf(sheet.status as typeof STATUS_FLOW[number])
    if (idx >= STATUS_FLOW.length - 1) return
    const next = STATUS_FLOW[idx + 1]
    const { error } = await supabase.from('weekly_timesheets').update({ status: next }).eq('id', sheet.id)
    if (error) { toast(error.message,'error'); return }
    toast(`Marked as ${next}`,'success'); load()
    if (activeWeek?.id === sheet.id) setActiveWeek({ ...sheet, status: next })
  }

  async function del(sheet: WeeklyTimesheet) {
    if (!confirm(`Delete week ${sheet.week_start}?`)) return
    await supabase.from('weekly_timesheets').delete().eq('id', sheet.id)
    if (activeWeek?.id === sheet.id) setActiveWeek(null)
    toast('Deleted','info'); load()
  }

  // Mutate crew hours in the active week
  function setHours(personId: string, date: string, field: string, val: string | number | boolean) {
    if (!activeWeek) return
    const crew = activeWeek.crew.map(m => {
      if (m.personId !== personId) return m
      const day = m.days[date] || { dayType: 'weekday', shiftType: 'day', hours: 0 }
      return { ...m, days: { ...m.days, [date]: { ...day, [field]: val } } }
    })
    setActiveWeek({ ...activeWeek, crew })
  }

  function totalHoursForPerson(m: WeeklyTimesheet['crew'][0]) {
    return Object.values(m.days).reduce((s, d) => s + (d.hours || 0), 0)
  }

  const days = activeWeek ? weekDays(activeWeek.week_start) : []

  return (
    <div style={{padding:'24px',maxWidth:'100%'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>{TYPE_LABELS[type]} Timesheets</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{sheets.length} weeks · {resources.length} people</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          {activeWeek && <button className="btn" onClick={() => setActiveWeek(null)}>← All Weeks</button>}
          <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>+ New Week</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : !activeWeek ? (
        // Week list view
        sheets.length === 0 ? (
          <div className="empty-state">
            <div className="icon">⏱️</div>
            <h3>No timesheets yet</h3>
            <p>Create a week to start entering hours.</p>
          </div>
        ) : (
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <table>
              <thead>
                <tr><th>Week Starting</th><th>Regime</th><th>Status</th><th>Crew</th><th>Total Hrs</th><th>WBS</th><th></th></tr>
              </thead>
              <tbody>
                {sheets.map(s => {
                  const sc = STATUS_COLORS[s.status] || STATUS_COLORS.draft
                  const totalHrs = s.crew.reduce((sum, m) => sum + totalHoursForPerson(m), 0)
                  return (
                    <tr key={s.id} style={{cursor:'pointer'}} onClick={() => setActiveWeek(s)}>
                      <td style={{fontFamily:'var(--mono)',fontWeight:600}}>{s.week_start}</td>
                      <td style={{fontSize:'12px',color:'var(--text3)'}}>{s.regime === 'ge12' ? '≥12hr' : '<12hr'}</td>
                      <td><span className="badge" style={sc}>{s.status}</span></td>
                      <td style={{fontSize:'12px'}}>{s.crew.length} people</td>
                      <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{totalHrs.toFixed(1)} hrs</td>
                      <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{s.wbs || '—'}</td>
                      <td style={{whiteSpace:'nowrap'}} onClick={e => e.stopPropagation()}>
                        {s.status !== 'approved' && (
                          <button className="btn btn-sm btn-primary" style={{fontSize:'11px',padding:'3px 8px'}}
                            onClick={() => advanceStatus(s)}>
                            {s.status === 'draft' ? 'Submit' : 'Approve'}
                          </button>
                        )}
                        <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={() => del(s)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        // Active week grid view
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'12px',flexWrap:'wrap'}}>
            <span style={{fontWeight:600,fontFamily:'var(--mono)'}}>Week: {activeWeek.week_start}</span>
            <span className="badge" style={STATUS_COLORS[activeWeek.status] || STATUS_COLORS.draft}>{activeWeek.status}</span>
            <span style={{fontSize:'12px',color:'var(--text3)'}}>{activeWeek.regime === 'ge12' ? '≥12hr regime' : '<12hr regime'}</span>
            <div style={{marginLeft:'auto',display:'flex',gap:'8px'}}>
              {activeWeek.status !== 'approved' && (
                <button className="btn btn-sm btn-primary" onClick={() => advanceStatus(activeWeek)}>
                  {activeWeek.status === 'draft' ? 'Submit' : 'Approve'}
                </button>
              )}
              <button className="btn btn-sm btn-primary" onClick={() => saveHours(activeWeek)}>💾 Save Hours</button>
            </div>
          </div>

          <div style={{overflowX:'auto'}}>
            <table style={{minWidth:'900px',fontSize:'12px'}}>
              <thead>
                <tr>
                  <th style={{minWidth:'140px'}}>Person</th>
                  <th>Role</th>
                  {days.map((d, i) => (
                    <th key={d} style={{textAlign:'center',minWidth:'64px'}}>
                      {DOWLABEL[i]}<br/>
                      <span style={{fontFamily:'var(--mono)',fontSize:'10px',fontWeight:400}}>{d.slice(5)}</span>
                    </th>
                  ))}
                  <th style={{textAlign:'right'}}>Total</th>
                </tr>
              </thead>
              <tbody>
                {activeWeek.crew.map(m => (
                  <tr key={m.personId}>
                    <td style={{fontWeight:500,whiteSpace:'nowrap'}}>{m.name}</td>
                    <td style={{color:'var(--text3)',whiteSpace:'nowrap'}}>{m.role || '—'}</td>
                    {days.map(d => {
                      const day = m.days[d]
                      const hrs = day?.hours || 0
                      return (
                        <td key={d} style={{padding:'2px'}}>
                          <input type="number" min="0" max="24" step="0.5"
                            className="input"
                            style={{
                              textAlign:'center', padding:'3px 2px', fontSize:'12px',
                              minWidth:'56px',
                              background: hrs > 0 ? 'var(--bg)' : 'var(--bg2)',
                            }}
                            value={hrs || ''}
                            placeholder="—"
                            onChange={e => setHours(m.personId, d, 'hours', parseFloat(e.target.value)||0)}
                            disabled={activeWeek.status === 'approved'}
                          />
                        </td>
                      )
                    })}
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,paddingRight:'8px'}}>
                      {totalHoursForPerson(m).toFixed(1)}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr style={{borderTop:'2px solid var(--border)',background:'var(--bg3)'}}>
                  <td colSpan={2} style={{fontWeight:600,padding:'6px 8px'}}>Daily Total</td>
                  {days.map(d => {
                    const dayTotal = activeWeek.crew.reduce((s, m) => s + (m.days[d]?.hours || 0), 0)
                    return (
                      <td key={d} style={{textAlign:'center',fontFamily:'var(--mono)',fontWeight:600,fontSize:'12px'}}>
                        {dayTotal > 0 ? dayTotal.toFixed(1) : '—'}
                      </td>
                    )
                  })}
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:700,paddingRight:'8px'}}>
                    {activeWeek.crew.reduce((s,m) => s + totalHoursForPerson(m), 0).toFixed(1)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {activeWeek.crew.length === 0 && (
            <div className="empty-state" style={{padding:'32px'}}>
              <p>No crew on this timesheet. Add resources first.</p>
            </div>
          )}
        </div>
      )}

      {/* New week modal */}
      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" style={{maxWidth:'420px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New {TYPE_LABELS[type]} Week</h3>
              <button className="btn btn-sm" onClick={() => setShowNewModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>Week Starting (any date in the week)</label>
                <input type="date" className="input" value={newForm.week_start}
                  onChange={e => setNewForm(f=>({...f, week_start: e.target.value}))} autoFocus />
                <p style={{fontSize:'11px',color:'var(--text3)',marginTop:'4px'}}>Will be adjusted to Monday: {getMon(newForm.week_start)}</p>
              </div>
              <div className="fg">
                <label>Regime</label>
                <select className="input" value={newForm.regime} onChange={e=>setNewForm(f=>({...f,regime:e.target.value}))}>
                  <option value="lt12">Less than 12 hr shifts</option>
                  <option value="ge12">12 hr shifts or greater</option>
                </select>
              </div>
              <div className="fg">
                <label>WBS Code</label>
                <input className="input" value={newForm.wbs} onChange={e=>setNewForm(f=>({...f,wbs:e.target.value}))} placeholder="Default WBS for this week" />
              </div>
              {type === 'subcon' && (
                <>
                  <div className="fg">
                    <label>Vendor</label>
                    <input className="input" value={newForm.vendor} onChange={e=>setNewForm(f=>({...f,vendor:e.target.value}))} placeholder="Subcontractor company" />
                  </div>
                  <div className="fg">
                    <label>Purchase Order</label>
                    <select className="input" value={newForm.po_id} onChange={e=>setNewForm(f=>({...f,po_id:e.target.value}))}>
                      <option value="">— No PO —</option>
                      {pos.map(po=><option key={po.id} value={po.id}>{po.po_number||'—'} {po.vendor}</option>)}
                    </select>
                  </div>
                </>
              )}
              <p style={{fontSize:'12px',color:'var(--text3)'}}>
                Will auto-populate with {resources.length} {TYPE_LABELS[type].toLowerCase()} resources.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNewModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createWeek} disabled={saving}>
                {saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Create Week
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
