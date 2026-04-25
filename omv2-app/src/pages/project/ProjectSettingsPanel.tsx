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
  const { activeProject, setActiveProject } = useAppStore()
  const [form, setForm] = useState({
    name: '', wbs: '', start_date: '', end_date: '',
    default_gm: 15, notes: '',
    unit: '', pm: '', site_contact: '', site_phone: '', client: '',
    currency: 'AUD', scope_tracking: 'none',
    std_hours_day: {} as Record<string,number>,
    std_hours_night: {} as Record<string,number>,
    site_id: '',
  })
  const [saving, setSaving] = useState(false)
  const [sites, setSites] = useState<{id:string,name:string}[]>([])

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
      scope_tracking: activeProject.scope_tracking || 'none',
      site_id: activeProject.site_id || '',
      std_hours_day: { ...(activeProject.std_hours?.day as Record<string,number> || {}) },
      std_hours_night: { ...(activeProject.std_hours?.night as Record<string,number> || {}) },
    })
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

      <div style={{display:'flex',justifyContent:'flex-end'}}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : null} Save Settings
        </button>
      </div>
    </div>
  )
}
