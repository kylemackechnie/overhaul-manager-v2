import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

const DAYS = ['mon','tue','wed','thu','fri','sat','sun']
const DAY_LABELS: Record<string,string> = { mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun' }
const CURRENCIES = ['AUD','USD','EUR','GBP','NZD','SGD']
const SCOPE_MODES = [
  { value:'none', label:'None — no scope tracking' },
  { value:'wo',   label:'Work Orders — allocate hours to WOs' },
  { value:'tce',  label:'NRG TCE — allocate hours to TCE scopes' },
]

export function ProjectSettingsPanel() {
  const { activeProject, setActiveProject, setActivePanel } = useAppStore()
  const [form, setForm] = useState({
    name: '', wbs: '', start_date: '', end_date: '',
    default_gm: 15, notes: '',
    unit: '', pm: '', site_contact: '', site_phone: '', client: '',
    currency: 'AUD', scope_tracking: 'none',
  currency_rates: [] as {code:string;name:string;rate:number}[],
    std_hours_day: {} as Record<string,number>,
    std_hours_night: {} as Record<string,number>,
    site_id: '',
  })
  const [saving, setSaving] = useState(false)
  const [sites, setSites] = useState<{id:string,name:string}[]>([])

  // Shift patterns for wet hire calendars (keyed by DOW 0-6)
  type WetHirePattern = { name: string; days: Record<number, Record<string,boolean>> }
  const [patterns, setPatterns] = useState<WetHirePattern[]>([])
  const [patternModal, setPatternModal] = useState<null | { idx: number | null; name: string; days: Record<number,Record<string,boolean>> }>(null)

  const SHIFT_KEYS = ['ds','ns','wds','wns','sdd','sdn'] as const
  type ShiftKey = typeof SHIFT_KEYS[number]
  const SHIFT_LABELS: Record<ShiftKey,string> = { ds:'Day Shift',ns:'Night Shift',wds:'Wknd Day',wns:'Wknd Night',sdd:'Stdwn DS',sdn:'Stdwn NS' }
  const SHIFT_COLORS: Record<ShiftKey,string> = { ds:'var(--accent)',ns:'#8b5cf6',wds:'var(--orange)',wns:'var(--red)',sdd:'#92400e',sdn:'#6b4c1e' }
  const DOW = [0,1,2,3,4,5,6]
  const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

  function emptyDays(): Record<number,Record<string,boolean>> {
    return Object.fromEntries(DOW.map(d => [d, {}]))
  }

  function openNewPattern() {
    setPatternModal({ idx: null, name: '', days: emptyDays() })
  }

  function openEditPattern(idx: number) {
    const p = patterns[idx]
    setPatternModal({ idx, name: p.name, days: JSON.parse(JSON.stringify(p.days)) })
  }

  function quickFill(preset: 'standard'|'dayonly'|'nightonly'|'clear') {
    if (!patternModal) return
    const configs: Record<string, Record<number, Partial<Record<ShiftKey,boolean>>>> = {
      standard: { 1:{ds:true,ns:true},2:{ds:true,ns:true},3:{ds:true,ns:true},4:{ds:true,ns:true},5:{ds:true,ns:true},6:{wds:true,sdn:true},0:{wns:true,sdd:true} },
      dayonly:  { 1:{ds:true},2:{ds:true},3:{ds:true},4:{ds:true},5:{ds:true},6:{wds:true} },
      nightonly:{ 0:{wns:true},1:{ns:true},2:{ns:true},3:{ns:true},4:{ns:true},5:{ns:true},6:{sdn:true} },
      clear:    {},
    }
    const cfg = configs[preset] || {}
    const days: Record<number,Record<string,boolean>> = {}
    DOW.forEach(d => { days[d] = {}; SHIFT_KEYS.forEach(k => { if (cfg[d]?.[k]) days[d][k] = true }) })
    setPatternModal(m => m ? { ...m, days } : m)
  }

  function togglePatternShift(dow: number, key: ShiftKey, checked: boolean) {
    setPatternModal(m => {
      if (!m) return m
      const days = JSON.parse(JSON.stringify(m.days))
      if (!days[dow]) days[dow] = {}
      if (checked) days[dow][key] = true; else delete days[dow][key]
      return { ...m, days }
    })
  }

  async function savePattern() {
    if (!patternModal || !activeProject) return
    if (!patternModal.name.trim()) { toast('Pattern name required','error'); return }
    const newPatterns = [...patterns]
    const pattern: WetHirePattern = { name: patternModal.name.trim(), days: patternModal.days }
    if (patternModal.idx !== null) newPatterns[patternModal.idx] = pattern
    else newPatterns.push(pattern)
    const { error } = await supabase.from('projects').update({ shift_patterns: newPatterns }).eq('id', activeProject.id)
    if (error) { toast(error.message,'error'); return }
    setPatterns(newPatterns)
    // Update store so HirePanel and other panels see the new patterns immediately
    setActiveProject({ ...activeProject, shift_patterns: newPatterns as unknown as typeof activeProject.shift_patterns })
    setPatternModal(null)
    toast(`Pattern "${pattern.name}" saved`,'success')
  }

  async function deletePattern(idx: number) {
    if (!activeProject || !confirm(`Delete "${patterns[idx].name}"?`)) return
    const newPatterns = patterns.filter((_,i) => i !== idx)
    const { error } = await supabase.from('projects').update({ shift_patterns: newPatterns }).eq('id', activeProject.id)
    if (error) { toast(error.message,'error'); return }
    setPatterns(newPatterns)
    setActiveProject({ ...activeProject, shift_patterns: newPatterns as unknown as typeof activeProject.shift_patterns })
    toast('Pattern deleted','info')
  }

  useEffect(() => {
    if (!activeProject) return
    supabase.from('sites').select('id,name').order('name').then(({data}) => setSites((data||[]) as {id:string,name:string}[]))
    setForm({
      name: activeProject.name || '',
      wbs: activeProject.wbs || '',
      start_date: activeProject.start_date || '',
      end_date: activeProject.end_date || '',
      default_gm: activeProject.default_gm || 15,
      notes: activeProject.notes || '',
      unit: activeProject.unit || '',
      pm: activeProject.pm || '',
      site_contact: activeProject.site_contact || '',
      site_phone: activeProject.site_phone || '',
      client: activeProject.client || '',
      currency: activeProject.currency || 'AUD',
    currency_rates: (activeProject.currency_rates as {code:string;name:string;rate:number}[] || []),
      scope_tracking: activeProject.scope_tracking || 'none',
      site_id: activeProject.site_id || '',
      std_hours_day: { ...(activeProject.std_hours?.day as Record<string,number> || {}) },
      std_hours_night: { ...(activeProject.std_hours?.night as Record<string,number> || {}) },
    })
    setPatterns((activeProject.shift_patterns as unknown as WetHirePattern[] || []))
  }, [activeProject?.id])

  async function save() {
    if (!form.name.trim()) return toast('Project name required', 'error')
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      wbs: form.wbs.trim(),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      default_gm: form.default_gm,
      notes: form.notes,
      site_id: form.site_id || null,
      unit: form.unit,
      pm: form.pm,
      site_contact: form.site_contact,
      site_phone: form.site_phone,
      client: form.client,
      currency: form.currency,
      currency_rates: form.currency_rates,
      scope_tracking: form.scope_tracking,
      std_hours: { day: form.std_hours_day, night: form.std_hours_night },
    }
    const { data, error } = await supabase.from('projects').update(payload)
      .eq('id', activeProject!.id).select('*,site:sites(id,name)').single()
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    setActiveProject(data as typeof activeProject)
    toast('Project settings saved', 'success')
    setSaving(false)
  }

  function setDayHours(shift: 'day'|'night', day: string, val: number) {
    if (shift === 'day') setForm(f => ({ ...f, std_hours_day: { ...f.std_hours_day, [day]: val } }))
    else setForm(f => ({ ...f, std_hours_night: { ...f.std_hours_night, [day]: val } }))
  }

  function setDefaultHours(hrs: number) {
    const weekday = Object.fromEntries(['mon','tue','wed','thu','fri'].map(d => [d, hrs]))
    setForm(f => ({ ...f, std_hours_day: { ...f.std_hours_day, ...weekday } }))
  }

  const section = (label: string) => (
    <div style={{fontWeight:600,marginBottom:'14px',fontSize:'13px',color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{label}</div>
  )

  async function deleteProject() {
    if (!activeProject) return
    if (!window.confirm(`Delete "${activeProject.name}" and ALL its data? This cannot be undone.`)) return
    if (!window.confirm(`Final confirmation — permanently delete "${activeProject.name}"?`)) return
    const { error } = await supabase.from('projects').delete().eq('id', activeProject.id)
    if (error) { toast(error.message, 'error'); return }
    setActiveProject(null)
    setActivePanel('dashboard')
    toast(`Project "${activeProject.name}" deleted`, 'info')
  }

  return (
    <div style={{padding:'24px',maxWidth:'760px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'24px'}}>
        <h1 style={{fontSize:'18px',fontWeight:700}}>Project Settings</h1>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : null} Save Settings
        </button>
      </div>

      {/* Core details */}
      <div className="card" style={{marginBottom:'16px'}}>
        {section('Project Details')}
        <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          <div className="fg">
            <label>Project Name *</label>
            <input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Laverton GT11 2025/26" />
          </div>
          <div className="fg-row">
            <div className="fg">
              <label>WBS Code</label>
              <input className="input" value={form.wbs} onChange={e=>setForm(f=>({...f,wbs:e.target.value}))} placeholder="e.g. 50OP-00138" />
            </div>
            <div className="fg">
              <label>Site</label>
              <select className="input" value={form.site_id} onChange={e=>setForm(f=>({...f,site_id:e.target.value}))}>
                <option value="">— No Site —</option>
                {sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="fg">
              <label>Unit / Machine</label>
              <input className="input" value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} placeholder="e.g. GT11, GT12, Steam Turbine A" />
            </div>
          </div>
          <div className="fg-row">
            <div className="fg">
              <label>Client</label>
              <input className="input" value={form.client} onChange={e=>setForm(f=>({...f,client:e.target.value}))} placeholder="e.g. AGL, Origin Energy" />
            </div>
            <div className="fg">
              <label>Project Manager</label>
              <input className="input" value={form.pm} onChange={e=>setForm(f=>({...f,pm:e.target.value}))} placeholder="Full name" />
            </div>
          </div>
          <div className="fg-row">
            <div className="fg">
              <label>Start Date</label>
              <input type="date" className="input" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))} />
            </div>
            <div className="fg">
              <label>End Date</label>
              <input type="date" className="input" value={form.end_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} />
            </div>
          </div>
          <div className="fg">
            <label>Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} />
          </div>
        </div>
      </div>

      {/* Site contact */}
      <div className="card" style={{marginBottom:'16px'}}>
        {section('Site Contact')}
        <div className="fg-row">
          <div className="fg">
            <label>On-site Contact Name</label>
            <input className="input" value={form.site_contact} onChange={e=>setForm(f=>({...f,site_contact:e.target.value}))} placeholder="e.g. John Smith" />
          </div>
          <div className="fg">
            <label>Contact Phone</label>
            <input className="input" value={form.site_phone} onChange={e=>setForm(f=>({...f,site_phone:e.target.value}))} placeholder="+61 4xx xxx xxx" />
          </div>
        </div>
      </div>

      {/* Commercial */}
      <div className="card" style={{marginBottom:'16px'}}>
        {section('Commercial Settings')}
        <div className="fg-row">
          <div className="fg">
            <label>Default GM %</label>
            <input type="number" className="input" value={form.default_gm} min={0} max={99} step={0.5}
              onChange={e=>setForm(f=>({...f,default_gm:parseFloat(e.target.value)||0}))} />
          </div>
          <div className="fg">
            <label>Currency</label>
            <select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* FX Rates */}
      <div className="card" style={{padding:'14px 16px',marginBottom:'12px'}}>
        <div style={{fontWeight:600,fontSize:'13px',marginBottom:'10px'}}>💱 Exchange Rates</div>
        <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'10px'}}>
          Set FX rates for converting foreign currency hire, tooling and subcon costs to base currency ({form.currency}).
        </p>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'8px'}}>
          {form.currency_rates.map((r,i) => (
            <div key={r.code} style={{display:'flex',alignItems:'center',gap:'6px',padding:'4px 8px',background:'var(--bg3)',borderRadius:'6px',border:'1px solid var(--border)'}}>
              <span style={{fontWeight:700,fontFamily:'var(--mono)',fontSize:'12px',color:'var(--accent)'}}>{r.code}</span>
              <span style={{fontSize:'11px',color:'var(--text3)'}}>1 {r.code} =</span>
              <input type="number" step="0.0001" className="input" style={{width:'80px',padding:'2px 6px',fontSize:'12px'}}
                value={r.rate}
                onChange={e => setForm(f => ({...f, currency_rates: f.currency_rates.map((x,j) => j===i ? {...x, rate: parseFloat(e.target.value)||1} : x)}))} />
              <span style={{fontSize:'11px',color:'var(--text3)'}}>{form.currency}</span>
              <button style={{border:'none',background:'none',cursor:'pointer',color:'var(--red)',fontSize:'12px',padding:'0 2px'}}
                onClick={() => setForm(f => ({...f, currency_rates: f.currency_rates.filter((_,j) => j!==i)}))}>✕</button>
            </div>
          ))}
          <select className="input" style={{fontSize:'12px',width:'auto'}}
            value="" onChange={e => {
              const code = e.target.value; if (!code) return
              if (form.currency_rates.find(r=>r.code===code)) return
              setForm(f => ({...f, currency_rates: [...f.currency_rates, {code, name: code, rate: 1}]}))
              e.target.value = ''
            }}>
            <option value="">+ Add currency...</option>
            {['AUD','USD','EUR','GBP','NZD','SGD','JPY','CAD'].filter(c => c !== form.currency && !form.currency_rates.find(r=>r.code===c)).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="card" style={{padding:'14px 16px',marginBottom:'12px'}}>
        <div style={{fontWeight:600,fontSize:'13px',marginBottom:'10px'}}>Scope Tracking</div>
        <div className="fg-row">
          <div className="fg" style={{flex:2}}>
            <label>Scope Tracking Mode</label>
            <select className="input" value={form.scope_tracking} onChange={e=>setForm(f=>({...f,scope_tracking:e.target.value}))}>
              {SCOPE_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <p style={{fontSize:'11px',color:'var(--text3)',marginTop:'4px'}}>
              Controls the allocation button in timesheet cells — Work Orders or NRG TCE scopes.
            </p>
          </div>
        </div>
      </div>

      {/* Standard hours */}
      <div className="card" style={{marginBottom:'16px'}}>
        {section('Standard Hours Per Day')}
        <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'10px'}}>
          Pre-fills timesheet cells when a person is added to a week. Set 0 for rest days.
        </p>
        <div style={{display:'flex',gap:'8px',marginBottom:'10px'}}>
          <button className="btn btn-sm" onClick={() => setDefaultHours(10)}>10h weekdays</button>
          <button className="btn btn-sm" onClick={() => setDefaultHours(12)}>12h weekdays</button>
          <button className="btn btn-sm" onClick={() => setDefaultHours(0)}>Clear all</button>
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{fontSize:'12px',borderCollapse:'collapse',width:'100%'}}>
            <thead>
              <tr style={{background:'var(--bg3)'}}>
                <th style={{padding:'7px 10px',textAlign:'left',fontSize:'10px',fontFamily:'var(--mono)',color:'var(--text3)',textTransform:'uppercase',width:'80px'}}>Shift</th>
                {DAYS.map(d => (
                  <th key={d} style={{padding:'7px 10px',textAlign:'center',fontSize:'10px',fontFamily:'var(--mono)',
                    color:['sat','sun'].includes(d)?'var(--amber)':'var(--text3)',textTransform:'uppercase'}}>
                    {DAY_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['day','night'] as const).map(shift => (
                <tr key={shift}>
                  <td style={{padding:'6px 10px',fontWeight:500,color:'var(--text2)',textTransform:'capitalize'}}>
                    {shift === 'day' ? '☀️ Day' : '🌙 Night'}
                  </td>
                  {DAYS.map(d => (
                    <td key={d} style={{padding:'4px'}}>
                      <input type="number" step="0.5" min="0" max="24"
                        className="input" style={{textAlign:'center',padding:'4px',width:'100%'}}
                        value={(shift === 'day' ? form.std_hours_day : form.std_hours_night)[d] ?? 0}
                        onChange={e => setDayHours(shift, d, parseFloat(e.target.value)||0)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Wet Hire Shift Patterns ── */}
      <div className="card" style={{marginBottom:'20px'}}>
        {section('Wet Hire Shift Patterns')}
        <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'14px'}}>
          Define reusable shift patterns here — they appear as preset buttons in every wet hire shift calendar.
        </p>
        {patterns.length === 0 ? (
          <div style={{fontSize:'12px',color:'var(--text3)',marginBottom:'10px'}}>No patterns defined yet. Add one below to use as presets in the shift calendar.</div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'6px',marginBottom:'12px'}}>
            {patterns.map((p, idx) => (
              <div key={idx} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 12px',border:'1px solid var(--border)',borderRadius:'6px',background:'var(--bg3)'}}>
                <div style={{fontWeight:600,fontSize:'13px',minWidth:'160px'}}>{p.name}</div>
                <div style={{display:'flex',gap:'4px',flex:1,flexWrap:'wrap'}}>
                  {SHIFT_KEYS.map(k => {
                    const dayCount = DOW.filter(d => p.days?.[d]?.[k]).length
                    return dayCount > 0 ? (
                      <span key={k} style={{fontSize:'10px',padding:'2px 6px',borderRadius:'3px',border:`1px solid ${SHIFT_COLORS[k]}`,color:SHIFT_COLORS[k],fontFamily:'var(--mono)',fontWeight:700}}>
                        {k.toUpperCase()} {dayCount}d
                      </span>
                    ) : null
                  })}
                </div>
                <button className="btn btn-sm" style={{fontSize:'11px'}} onClick={() => openEditPattern(idx)}>Edit</button>
                <button className="btn btn-sm" style={{fontSize:'11px',color:'var(--red)'}} onClick={() => deletePattern(idx)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <button className="btn btn-sm" style={{background:'var(--mod-hire,#f97316)',color:'#fff',border:'none'}} onClick={openNewPattern}>+ Add Pattern</button>
      </div>

      <div style={{display:'flex',justifyContent:'flex-end'}}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : null} Save Settings
        </button>
      </div>

      {/* Pattern modal */}
      {patternModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'620px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🗓 {patternModal.idx !== null ? 'Edit' : 'New'} Shift Pattern</h3>
              <button className="btn btn-sm" onClick={() => setPatternModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>Pattern Name *</label>
                <input className="input" value={patternModal.name} onChange={e => setPatternModal(m => m ? {...m, name: e.target.value} : m)} placeholder="e.g. Standard 12hr, Weekdays DS Only..." autoFocus />
              </div>
              <div style={{display:'flex',gap:'6px',marginBottom:'12px',flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:'11px',color:'var(--text3)'}}>Quick fill:</span>
                {(['standard','dayonly','nightonly','clear'] as const).map(p => (
                  <button key={p} className="btn btn-sm" style={{fontSize:'11px'}} onClick={() => quickFill(p)}>
                    {p === 'standard' ? 'Standard (DS+NS)' : p === 'dayonly' ? 'Day Only' : p === 'nightonly' ? 'Night Only' : 'Clear All'}
                  </button>
                ))}
              </div>
              <div style={{overflowX:'auto',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                  <thead>
                    <tr style={{background:'var(--bg3)'}}>
                      <th style={{padding:'6px 10px',textAlign:'left',fontSize:'11px',color:'var(--text3)'}}>Day</th>
                      {SHIFT_KEYS.map(k => (
                        <th key={k} style={{padding:'6px 8px',textAlign:'center',fontSize:'10px',fontFamily:'var(--mono)',color:SHIFT_COLORS[k],whiteSpace:'nowrap'}}>
                          {SHIFT_LABELS[k].split(' ')[0]}<br/>{SHIFT_LABELS[k].split(' ')[1]||''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DOW.map(d => {
                      const isWknd = d === 0 || d === 6
                      return (
                        <tr key={d} style={{borderTop:'1px solid var(--border)',background:isWknd?'rgba(234,179,8,0.04)':'transparent'}}>
                          <td style={{padding:'6px 10px',fontFamily:'var(--mono)',fontSize:'12px',fontWeight:isWknd?600:400,color:d===0?'var(--red)':isWknd?'var(--amber)':'var(--text2)'}}>
                            {DOW_LABELS[d]}
                          </td>
                          {SHIFT_KEYS.map(k => (
                            <td key={k} style={{padding:'6px 8px',textAlign:'center'}}>
                              <input type="checkbox" checked={!!patternModal.days?.[d]?.[k]} style={{accentColor:SHIFT_COLORS[k],width:'15px',height:'15px',cursor:'pointer'}}
                                onChange={e => togglePatternShift(d, k, e.target.checked)} />
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setPatternModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={savePattern}>Save Pattern</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Danger Zone ─────────────────────────────────────── */}
      <div style={{ marginTop: 32, border: '2px solid var(--red)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ background: '#fef2f2', padding: '12px 20px', borderBottom: '1px solid #fecaca' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#991b1b' }}>⚠ Danger Zone</div>
          <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>These actions are permanent and cannot be undone.</div>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Delete this project</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              Permanently deletes the project and all associated data — timesheets, resources, invoices, POs, variations, TCE lines, everything. No recovery.
            </div>
          </div>
          <button
            style={{ marginLeft: 24, padding: '8px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
            onClick={deleteProject}
          >
            🗑 Delete Project
          </button>
        </div>
      </div>
    </div>
  )
}
