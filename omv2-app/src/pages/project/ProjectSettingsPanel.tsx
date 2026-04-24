import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

const DAYS = ['mon','tue','wed','thu','fri','sat','sun']
const DAY_LABELS: Record<string,string> = { mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun' }

export function ProjectSettingsPanel() {
  const { activeProject, setActiveProject } = useAppStore()
  const [form, setForm] = useState({
    name: '', wbs: '', start_date: '', end_date: '',
    default_gm: 15, notes: '',
    std_hours_day: {} as Record<string,number>,
    std_hours_night: {} as Record<string,number>,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!activeProject) return
    setForm({
      name: activeProject.name || '',
      wbs: activeProject.wbs || '',
      start_date: activeProject.start_date || '',
      end_date: activeProject.end_date || '',
      default_gm: activeProject.default_gm || 15,
      notes: activeProject.notes || '',
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

  return (
    <div style={{padding:'24px',maxWidth:'700px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'24px'}}>
        <h1 style={{fontSize:'18px',fontWeight:700}}>Project Settings</h1>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : null} Save Settings
        </button>
      </div>

      <div className="card" style={{marginBottom:'16px'}}>
        <div style={{fontWeight:600,marginBottom:'14px',fontSize:'13px',color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.04em'}}>Project Details</div>
        <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
          <div className="fg">
            <label>Project Name</label>
            <input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          </div>
          <div className="fg-row">
            <div className="fg">
              <label>WBS Code</label>
              <input className="input" value={form.wbs} onChange={e=>setForm(f=>({...f,wbs:e.target.value}))} placeholder="e.g. 50OP-00138" />
            </div>
            <div className="fg">
              <label>Default GM %</label>
              <input type="number" className="input" value={form.default_gm} onChange={e=>setForm(f=>({...f,default_gm:parseFloat(e.target.value)||0}))} />
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
            <textarea className="input" rows={3} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} />
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{fontWeight:600,marginBottom:'14px',fontSize:'13px',color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.04em'}}>Standard Hours Per Day</div>
        <table style={{fontSize:'12px'}}>
          <thead>
            <tr>
              <th>Day</th>
              {DAYS.map(d => <th key={d} style={{textAlign:'center',minWidth:'64px'}}>{DAY_LABELS[d]}</th>)}
            </tr>
          </thead>
          <tbody>
            {(['day','night'] as const).map(shift => (
              <tr key={shift}>
                <td style={{fontWeight:500,color:'var(--text2)',textTransform:'capitalize'}}>{shift}</td>
                {DAYS.map(d => (
                  <td key={d} style={{padding:'4px'}}>
                    <input type="number" step="0.5" min="0" max="24"
                      className="input" style={{textAlign:'center',padding:'4px',minWidth:'56px'}}
                      value={(shift === 'day' ? form.std_hours_day : form.std_hours_night)[d] ?? 0}
                      onChange={e => setDayHours(shift, d, parseFloat(e.target.value)||0)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{fontSize:'11px',color:'var(--text3)',marginTop:'8px'}}>
          Set 0 for rest days. These hours are used by the forecast engine.
        </p>
      </div>
    </div>
  )
}
