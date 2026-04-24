import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface PHEntry { id: string; project_id: string; date: string; name: string; created_at: string }

const NSW_STANDARD = [
  { date:'2026-01-01', name:"New Year's Day" }, { date:'2026-01-26', name:'Australia Day' },
  { date:'2026-04-03', name:'Good Friday' }, { date:'2026-04-04', name:'Easter Saturday' },
  { date:'2026-04-06', name:'Easter Monday' }, { date:'2026-04-25', name:'Anzac Day' },
  { date:'2026-06-08', name:"King's Birthday (NSW)" }, { date:'2026-08-03', name:'Bank Holiday (NSW)' },
  { date:'2026-10-05', name:'Labour Day (NSW)' }, { date:'2026-12-25', name:'Christmas Day' },
  { date:'2026-12-26', name:'Boxing Day' },
]
const SA_STANDARD = [
  { date:'2026-01-01', name:"New Year's Day" }, { date:'2026-01-26', name:'Australia Day' },
  { date:'2026-03-09', name:'Adelaide Cup' }, { date:'2026-04-03', name:'Good Friday' },
  { date:'2026-04-06', name:'Easter Monday' }, { date:'2026-04-25', name:'Anzac Day' },
  { date:'2026-06-08', name:"King's Birthday (SA)" }, { date:'2026-10-05', name:'Labour Day (SA)' },
  { date:'2026-12-25', name:'Christmas Day' }, { date:'2026-12-26', name:'Proclamation Day' },
]
const WA_STANDARD = [
  { date:'2026-01-01', name:"New Year's Day" }, { date:'2026-01-26', name:'Australia Day' },
  { date:'2026-03-02', name:'Labour Day (WA)' }, { date:'2026-04-03', name:'Good Friday' },
  { date:'2026-04-25', name:'Anzac Day' }, { date:'2026-06-01', name:'Western Australia Day' },
  { date:'2026-09-28', name:"King's Birthday (WA)" }, { date:'2026-12-25', name:'Christmas Day' },
  { date:'2026-12-26', name:'Boxing Day' },
]
const TAS_STANDARD = [
  { date:'2026-01-01', name:"New Year's Day" }, { date:'2026-01-26', name:'Australia Day' },
  { date:'2026-03-09', name:'Eight Hours Day (TAS)' }, { date:'2026-04-03', name:'Good Friday' },
  { date:'2026-04-04', name:'Easter Saturday' }, { date:'2026-04-06', name:'Easter Monday' },
  { date:'2026-04-25', name:'Anzac Day' }, { date:'2026-06-08', name:"King's Birthday (TAS)" },
  { date:'2026-12-25', name:'Christmas Day' }, { date:'2026-12-26', name:'Boxing Day' },
]
const NT_STANDARD = [
  { date:'2026-01-01', name:"New Year's Day" }, { date:'2026-01-26', name:'Australia Day' },
  { date:'2026-04-03', name:'Good Friday' }, { date:'2026-04-04', name:'Easter Saturday' },
  { date:'2026-04-06', name:'Easter Monday' }, { date:'2026-04-25', name:'Anzac Day' },
  { date:'2026-05-04', name:'May Day (NT)' }, { date:'2026-06-08', name:"King's Birthday (NT)" },
  { date:'2026-08-10', name:'Picnic Day (NT)' }, { date:'2026-12-25', name:'Christmas Day' },
  { date:'2026-12-26', name:'Boxing Day' },
]
const ACT_STANDARD = [
  { date:'2026-01-01', name:"New Year's Day" }, { date:'2026-01-26', name:'Australia Day' },
  { date:'2026-03-09', name:'Canberra Day' }, { date:'2026-04-03', name:'Good Friday' },
  { date:'2026-04-04', name:'Easter Saturday' }, { date:'2026-04-06', name:'Easter Monday' },
  { date:'2026-04-25', name:'Anzac Day' }, { date:'2026-06-08', name:"King's Birthday (ACT)" },
  { date:'2026-08-03', name:'Family & Community Day' }, { date:'2026-10-05', name:'Labour Day (ACT)' },
  { date:'2026-12-25', name:'Christmas Day' }, { date:'2026-12-26', name:'Boxing Day' },
]
const QLD_STANDARD = [
  { date:'2026-01-01', name:"New Year's Day" }, { date:'2026-01-26', name:'Australia Day' },
  { date:'2026-04-03', name:'Good Friday' }, { date:'2026-04-04', name:'Easter Saturday' },
  { date:'2026-04-06', name:'Easter Monday' }, { date:'2026-04-25', name:'Anzac Day' },
  { date:'2026-05-04', name:'Labour Day (QLD)' }, { date:'2026-08-12', name:'Royal Queensland Show' },
  { date:'2026-10-05', name:'Queen\'s Birthday (QLD)' }, { date:'2026-12-25', name:'Christmas Day' },
  { date:'2026-12-26', name:'Boxing Day' }, { date:'2026-12-28', name:'Boxing Day (sub)' },
]

const VIC_STANDARD = [
  { date:'2026-01-01', name:"New Year's Day" }, { date:'2026-01-26', name:'Australia Day' },
  { date:'2026-03-09', name:'Labour Day (VIC)' }, { date:'2026-04-03', name:'Good Friday' },
  { date:'2026-04-04', name:'Easter Saturday' }, { date:'2026-04-06', name:'Easter Monday' },
  { date:'2026-04-25', name:'Anzac Day' }, { date:'2026-06-08', name:"King's Birthday (VIC)" },
  { date:'2026-11-03', name:'Melbourne Cup Day' }, { date:'2026-12-25', name:'Christmas Day' },
  { date:'2026-12-26', name:'Boxing Day' },
]

export function PublicHolidaysPanel() {
  const { activeProject } = useAppStore()
  const [holidays, setHolidays] = useState<PHEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('public_holidays').select('*')
      .eq('project_id', activeProject!.id).order('date')
    setHolidays((data || []) as PHEntry[])
    setLoading(false)
  }

  async function add() {
    if (!newDate) return toast('Date required','error')
    setAdding(true)
    const { error } = await supabase.from('public_holidays').insert({
      project_id: activeProject!.id, date: newDate, name: newName.trim() || 'Public Holiday'
    })
    if (error) { toast(error.message,'error'); setAdding(false); return }
    setNewDate(''); setNewName(''); setAdding(false); load()
  }

  async function del(id: string) {
    await supabase.from('public_holidays').delete().eq('id', id)
    load()
  }

  async function importPreset(preset: {date:string,name:string}[]) {
    const existing = new Set(holidays.map(h => h.date))
    const toAdd = preset.filter(p => !existing.has(p.date)).map(p => ({
      project_id: activeProject!.id, date: p.date, name: p.name
    }))
    if (toAdd.length === 0) { toast('All dates already exist','info'); return }
    const { error } = await supabase.from('public_holidays').insert(toAdd)
    if (error) { toast(error.message,'error'); return }
    toast(`Added ${toAdd.length} holidays`,'success'); load()
  }

  return (
    <div style={{ padding:'24px', maxWidth:'700px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>Public Holidays</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>{holidays.length} holidays configured</p>
        </div>
<div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
          {[
            { label:'QLD', data:QLD_STANDARD }, { label:'NSW', data:NSW_STANDARD },
            { label:'VIC', data:VIC_STANDARD }, { label:'SA',  data:SA_STANDARD  },
            { label:'WA',  data:WA_STANDARD  }, { label:'TAS', data:TAS_STANDARD },
            { label:'NT',  data:NT_STANDARD  }, { label:'ACT', data:ACT_STANDARD },
          ].map(({ label, data }) => (
            <button key={label} className="btn btn-sm" onClick={() => importPreset(data)}>
              {label} 2026
            </button>
          ))}
        </div>
      </div>

      {/* Add row */}
      <div className="card" style={{ marginBottom:'16px', padding:'12px 16px' }}>
        <div className="fg-row" style={{ alignItems:'flex-end' }}>
          <div className="fg"><label>Date</label><input type="date" className="input" value={newDate} onChange={e=>setNewDate(e.target.value)} /></div>
          <div className="fg" style={{ flex:2 }}><label>Name</label><input className="input" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Christmas Day" onKeyDown={e=>e.key==='Enter'&&add()} /></div>
          <button className="btn btn-primary" onClick={add} disabled={adding}>+ Add</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : holidays.length === 0 ? (
        <div className="empty-state"><div className="icon">🗓️</div><h3>No public holidays</h3><p>Add holidays or use the Import buttons above.</p></div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table>
            <thead><tr><th>Date</th><th>Day</th><th>Name</th><th></th></tr></thead>
            <tbody>
              {holidays.map(h => (
                <tr key={h.id}>
                  <td style={{ fontFamily:'var(--mono)', fontSize:'12px', fontWeight:500 }}>{h.date}</td>
                  <td style={{ fontSize:'12px', color:'var(--text3)' }}>{new Date(h.date+'T12:00:00').toLocaleDateString('en-AU',{weekday:'short'})}</td>
                  <td>{h.name}</td>
                  <td style={{ textAlign:'right' }}><button className="btn btn-sm" style={{ color:'var(--red)' }} onClick={() => del(h.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
