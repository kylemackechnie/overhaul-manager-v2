import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface CalEvent {
  date: string; label: string; module: string; color: string; panel: string; sub?: string
}

const MOD_COLORS: Record<string, string> = {
  resources: '#6366f1', hire: '#f97316', tooling: '#0891b2',
  cars: '#be185d', accom: '#7c3aed', shipping: '#059669',
  timesheets: '#0369a1', variations: '#d97706', invoices: '#1e40af',
}

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function CalendarPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [selectedDay, setSelectedDay] = useState<string|null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const ev: CalEvent[] = []

    const [resData, hireData, shipData, varData, invData] = await Promise.all([
      supabase.from('resources').select('name,mob_in,mob_out').eq('project_id',pid),
      supabase.from('hire_items').select('name,start_date,end_date,hire_type').eq('project_id',pid),
      supabase.from('shipments').select('reference,eta,shipped_date,direction').eq('project_id',pid),
      supabase.from('variations').select('number,title,submitted_date,approved_date').eq('project_id',pid),
      supabase.from('invoices').select('invoice_number,invoice_date').eq('project_id',pid),
    ])

    // Resources mob in/out
    for (const r of resData.data||[]) {
      if (r.mob_in) ev.push({ date:r.mob_in, label:`↑ ${r.name}`, module:'resources', color:MOD_COLORS.resources, panel:'hr-resources', sub:'Mob in' })
      if (r.mob_out) ev.push({ date:r.mob_out, label:`↓ ${r.name}`, module:'resources', color:'#94a3b8', panel:'hr-resources', sub:'Mob out' })
    }

    // Hire items
    for (const h of hireData.data||[]) {
      if (h.start_date) ev.push({ date:h.start_date, label:`${h.name||'Hire'}`, module:'hire', color:MOD_COLORS.hire, panel:`hire-${h.hire_type}`, sub:'Hire starts' })
      if (h.end_date) ev.push({ date:h.end_date, label:`${h.name||'Hire'} end`, module:'hire', color:'#fdba74', panel:`hire-${h.hire_type}`, sub:'Hire ends' })
    }

    // Shipments
    for (const s of shipData.data||[]) {
      const d = s.direction==='import' ? s.eta : s.shipped_date
      if (d) ev.push({ date:d, label:`${s.direction==='import'?'📦':'🚚'} ${s.reference||'Shipment'}`, module:'shipping', color:MOD_COLORS.shipping, panel:s.direction==='import'?'shipping-inbound':'shipping-outbound' })
    }

    // Variations
    for (const v of varData.data||[]) {
      if (v.submitted_date) ev.push({ date:v.submitted_date, label:`VN ${v.number}`, module:'variations', color:MOD_COLORS.variations, panel:'variations', sub:'Submitted' })
      if (v.approved_date) ev.push({ date:v.approved_date, label:`VN ${v.number} ✓`, module:'variations', color:'#059669', panel:'variations', sub:'Approved' })
    }

    // Invoices
    for (const i of invData.data||[]) {
      if (i.invoice_date) ev.push({ date:i.invoice_date, label:`INV ${i.invoice_number||'—'}`, module:'invoices', color:MOD_COLORS.invoices, panel:'invoices' })
    }

    // Public holidays
    if (activeProject?.public_holidays) {
      for (const ph of activeProject.public_holidays as {date:string;name:string}[]) {
        ev.push({ date:ph.date, label:`🗓 ${ph.name}`, module:'holiday', color:'#7c3aed', panel:'public-holidays' })
      }
    }

    setEvents(ev)
    setLoading(false)
  }

  function prevMonth() { if (month===0) { setMonth(11); setYear(y=>y-1) } else setMonth(m=>m-1) }
  function nextMonth() { if (month===11) { setMonth(0); setYear(y=>y+1) } else setMonth(m=>m+1) }
  function goToday() { setYear(new Date().getFullYear()); setMonth(new Date().getMonth()) }

  const today = new Date().toISOString().slice(0,10)
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7

  // Build event index by date
  const evByDate: Record<string,CalEvent[]> = {}
  events.forEach(e => {
    if (!evByDate[e.date]) evByDate[e.date] = []
    evByDate[e.date].push(e)
  })

  const selectedEvents = selectedDay ? (evByDate[selectedDay]||[]) : []

  const ds = (d: number) => `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

  return (
    <div style={{padding:'24px',maxWidth:'1100px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'20px',flexWrap:'wrap'}}>
        <h1 style={{fontSize:'18px',fontWeight:700}}>{MONTH_NAMES[month]} {year}</h1>
        <button className="btn btn-sm" onClick={prevMonth}>← Prev</button>
        <button className="btn btn-sm" onClick={goToday}>Today</button>
        <button className="btn btn-sm" onClick={nextMonth}>Next →</button>
        {loading && <span className="spinner"/>}
      </div>

      {/* Day headers */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'1px',background:'var(--border)',borderRadius:'8px 8px 0 0',overflow:'hidden',marginBottom:'1px'}}>
        {DAY_NAMES.map(d => (
          <div key={d} style={{background:'var(--bg3)',padding:'8px',textAlign:'center',fontSize:'11px',fontWeight:600,color:'var(--text3)',textTransform:'uppercase'}}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'1px',background:'var(--border)',borderRadius:'0 0 8px 8px',overflow:'hidden'}}>
        {/* Prev month filler */}
        {Array.from({length:firstDay}).map((_,i) => (
          <div key={`p${i}`} style={{background:'var(--bg2)',padding:'6px 8px',minHeight:'80px'}}>
            <div style={{fontSize:'12px',color:'var(--text3)'}}>{daysInPrev-firstDay+i+1}</div>
          </div>
        ))}

        {/* Current month */}
        {Array.from({length:daysInMonth}).map((_,i) => {
          const d = i+1
          const dateStr = ds(d)
          const dayEvents = evByDate[dateStr]||[]
          const isToday = dateStr === today
          const isSelected = dateStr === selectedDay
          const isSun = (firstDay+i)%7===0
          const isSat = (firstDay+i)%7===6

          return (
            <div key={d} onClick={() => setSelectedDay(isSelected?null:dateStr)}
              style={{
                background: isSelected ? '#eff6ff' : isToday ? '#fef9c3' : (isSat||isSun) ? 'rgba(194,65,12,0.03)' : 'var(--bg)',
                padding:'6px 8px', minHeight:'80px', cursor:'pointer', transition:'background 100ms',
                outline: isSelected ? '2px solid var(--accent)' : isToday ? '2px solid #fbbf24' : 'none',
              }}>
              <div style={{fontSize:'12px',fontWeight:isToday?700:500,color:isToday?'#92400e':(isSat||isSun)?'var(--amber)':'var(--text)',marginBottom:'4px'}}>
                {d}
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'2px'}}>
                {dayEvents.slice(0,3).map((e,ei) => (
                  <div key={ei} onClick={ev => {ev.stopPropagation();setActivePanel(e.panel)}}
                    style={{fontSize:'10px',background:e.color,color:'#fff',borderRadius:'3px',padding:'1px 5px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer',fontWeight:500}}>
                    {e.label}
                  </div>
                ))}
                {dayEvents.length>3 && <div style={{fontSize:'10px',color:'var(--text3)',paddingLeft:'4px'}}>+{dayEvents.length-3} more</div>}
              </div>
            </div>
          )
        })}

        {/* Next month filler */}
        {Array.from({length:totalCells-firstDay-daysInMonth}).map((_,i) => (
          <div key={`n${i}`} style={{background:'var(--bg2)',padding:'6px 8px',minHeight:'80px'}}>
            <div style={{fontSize:'12px',color:'var(--text3)'}}>{i+1}</div>
          </div>
        ))}
      </div>

      {/* Day detail popup */}
      {selectedDay && (
        <div className="card" style={{marginTop:'16px'}}>
          <div style={{fontWeight:600,marginBottom:'12px'}}>{new Date(selectedDay+'T12:00:00').toLocaleDateString('en-AU',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
          {selectedEvents.length===0 ? (
            <p style={{color:'var(--text3)',fontSize:'13px'}}>No events on this day.</p>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              {selectedEvents.map((e,i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 12px',background:'var(--bg2)',borderRadius:'6px',cursor:'pointer'}}
                  onClick={()=>setActivePanel(e.panel)}>
                  <div style={{width:'10px',height:'10px',borderRadius:'50%',background:e.color,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:500,fontSize:'13px'}}>{e.label}</div>
                    {e.sub && <div style={{fontSize:'11px',color:'var(--text3)'}}>{e.sub}</div>}
                  </div>
                  <div style={{fontSize:'11px',color:'var(--accent)'}}>→</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
