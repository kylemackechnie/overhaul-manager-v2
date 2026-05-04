import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface GanttRow {
  id: string; label: string; section: string; color: string
  start: string|null; end: string|null; panel: string; sub?: string
}

const SECTION_COLORS: Record<string,string> = {
  'Personnel': '#6366f1', 'Equipment Hire': '#f97316', 'SE AG Tooling': '#0891b2',
  'Cars': '#be185d', 'Accommodation': '#7c3aed', 'Shipping': '#059669',
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

export function GanttPanel() {
  const { activeProject, setActivePanel } = useAppStore()
  const [rows, setRows] = useState<GanttRow[]>([])
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(60)

  const projStart = activeProject?.start_date || new Date().toISOString().slice(0,10)
  const today = new Date().toISOString().slice(0,10)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const ganttRows: GanttRow[] = []

    const [resData, hireData, tvData, carData, acData, shipData] = await Promise.all([
      supabase.from('resources').select('id,name,role,mob_in,mob_out,category').eq('project_id',pid).order('category').order('mob_in'),
      supabase.from('hire_items').select('id,name,hire_type,start_date,end_date').eq('project_id',pid).order('start_date'),
      supabase.from('tooling_costings').select('id,tv_no,charge_start,charge_end').eq('project_id',pid).order('charge_start'),
      supabase.from('cars').select('id,vehicle_type,vendor,start_date,end_date').eq('project_id',pid).order('start_date'),
      supabase.from('accommodation').select('id,property,room,check_in,check_out').eq('project_id',pid).order('check_in'),
      supabase.from('shipments').select('id,reference,direction,eta,shipped_date').eq('project_id',pid).order('eta'),
    ])

    // Personnel
    const byCategory: Record<string,typeof resData.data> = {}
    for (const r of resData.data||[]) {
      const cat = r.category||'trades'
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(r)
    }
    for (const [cat, people] of Object.entries(byCategory)) {
      for (const r of people||[]) {
        if (r.mob_in || r.mob_out) {
          ganttRows.push({ id:r.id, label:r.name, section:`Personnel — ${cat}`, color:SECTION_COLORS.Personnel, start:r.mob_in, end:r.mob_out, panel:'hr-resources', sub:r.role||'' })
        }
      }
    }

    // Hire items
    for (const h of hireData.data||[]) {
      if (h.start_date || h.end_date) {
        ganttRows.push({ id:h.id, label:h.name||'Hire item', section:'Equipment Hire', color:SECTION_COLORS['Equipment Hire'], start:h.start_date, end:h.end_date, panel:`hire-${h.hire_type}` })
      }
    }

    // Tooling
    for (const tv of tvData.data||[]) {
      if (tv.charge_start || tv.charge_end) {
        ganttRows.push({ id:tv.id, label:`TV${tv.tv_no}`, section:'SE AG Tooling', color:SECTION_COLORS['SE AG Tooling'], start:tv.charge_start, end:tv.charge_end, panel:'tooling-tvs' })
      }
    }

    // Cars
    for (const c of carData.data||[]) {
      if (c.start_date || c.end_date) {
        ganttRows.push({ id:c.id, label:`${c.vehicle_type||'Vehicle'} — ${c.vendor||''}`.trim(), section:'Cars', color:SECTION_COLORS.Cars, start:c.start_date, end:c.end_date, panel:'hr-cars' })
      }
    }

    // Accommodation
    for (const a of acData.data||[]) {
      if (a.check_in || a.check_out) {
        ganttRows.push({ id:a.id, label:`${a.property} — ${a.room||''}`.trim(), section:'Accommodation', color:SECTION_COLORS.Accommodation, start:a.check_in, end:a.check_out, panel:'hr-accommodation' })
      }
    }

    // Shipments
    for (const s of shipData.data||[]) {
      const d = s.direction==='import' ? s.eta : s.shipped_date
      if (d) ganttRows.push({ id:s.id, label:`${s.direction==='import'?'📦':'🚚'} ${s.reference||'Shipment'}`, section:'Shipping', color:SECTION_COLORS.Shipping, start:d, end:d, panel:s.direction==='import'?'shipping-inbound':'shipping-outbound' })
    }

    setRows(ganttRows)
    setLoading(false)
  }

  // Build day columns
  const startDate = new Date(projStart)
  const days = Array.from({length:zoom}, (_, i) => {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + i)
    return d.toISOString().slice(0,10)
  })

  const CELL_W = 20

  function barStyle(start: string|null, end: string|null): React.CSSProperties|null {
    const s = start || end
    const e = end || start
    if (!s || !e) return null
    const startIdx = daysBetween(projStart, s)
    const endIdx = daysBetween(projStart, e)
    const left = Math.max(0, startIdx) * CELL_W
    const width = Math.max(CELL_W, (Math.min(zoom, endIdx+1) - Math.max(0, startIdx)) * CELL_W)
    if (startIdx >= zoom || endIdx < 0) return null
    return { position:'absolute', left:`${left}px`, width:`${width}px`, height:'14px', top:'50%', transform:'translateY(-50%)', borderRadius:'3px' }
  }

  const sections = [...new Set(rows.map(r => r.section))]
  const todayOffset = daysBetween(projStart, today)

  // Build month headers
  const months: {label:string; span:number}[] = []
  let curMonth = '', curSpan = 0
  for (const d of days) {
    const m = new Date(d).toLocaleDateString('en-AU',{month:'short',year:'2-digit'})
    if (m !== curMonth) { if (curMonth) months.push({label:curMonth,span:curSpan}); curMonth=m; curSpan=1 }
    else curSpan++
  }
  if (curMonth) months.push({label:curMonth,span:curSpan})

  return (
    <div style={{padding:'24px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'20px',flexWrap:'wrap'}}>
        <h1 style={{fontSize:'18px',fontWeight:700}}>Gantt Chart</h1>
        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
          <span style={{fontSize:'12px',color:'var(--text3)'}}>Zoom:</span>
          {[30,60,90,120].map(z => (
            <button key={z} className="btn btn-sm" style={{background:zoom===z?'var(--accent)':'var(--bg)',color:zoom===z?'#fff':'var(--text)'}} onClick={()=>setZoom(z)}>{z}d</button>
          ))}
        </div>
        {loading && <span className="spinner"/>}
        <span style={{fontSize:'12px',color:'var(--text3)'}}>From: {projStart}</span>
      </div>

      {rows.length===0 && !loading ? (
        <div className="empty-state"><div className="icon">📋</div><h3>No timeline data</h3><p>Add resources with mob dates, hire items, and tooling to see the Gantt chart.</p></div>
      ) : (
        <div style={{overflowX:'auto'}}>
          <table style={{borderCollapse:'collapse',minWidth:`${200 + zoom*CELL_W}px`,fontSize:'11px'}}>
            <thead>
              {/* Month header */}
              <tr>
                <th style={{width:'200px',background:'var(--bg3)',padding:'4px 8px',textAlign:'left',borderBottom:'1px solid var(--border)',position:'sticky',left:0,zIndex:2}}>Item</th>
                {months.map((m,i) => (
                  <th key={i} colSpan={m.span} style={{background:'var(--bg3)',padding:'4px 6px',borderBottom:'1px solid var(--border)',borderLeft:'2px solid var(--border2)',color:'var(--text2)',fontWeight:600,textAlign:'left'}}>
                    {m.label}
                  </th>
                ))}
              </tr>
              {/* Day header */}
              <tr>
                <th style={{background:'var(--bg3)',position:'sticky',left:0,zIndex:2,borderBottom:'1px solid var(--border)'}}/>
                {days.map((d,i) => {
                  const dow = new Date(d).getDay()
                  const isWeekend = dow===0||dow===6
                  const isMon = dow===1
                  return (
                    <th key={i} style={{width:`${CELL_W}px`,minWidth:`${CELL_W}px`,background:d===today?'#fef9c3':isWeekend?'rgba(194,65,12,0.04)':'var(--bg3)',padding:'2px 0',textAlign:'center',color:'var(--text3)',fontFamily:'var(--mono)',borderBottom:'1px solid var(--border)',borderLeft:isMon?'2px solid var(--border2)':'1px solid var(--border)',fontSize:'9px'}}>
                      {new Date(d).getDate()===1||i===0 ? new Date(d).getDate() : i%5===0?new Date(d).getDate():''}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sections.map(section => {
                const sectionRows = rows.filter(r=>r.section===section)
                const color = sectionRows[0]?.color || 'var(--accent)'
                return [
                  // Section header
                  <tr key={`s-${section}`}>
                    <td colSpan={zoom+1} style={{background:'var(--bg3)',padding:'4px 8px',fontWeight:600,fontSize:'11px',color:'var(--text2)',borderTop:'2px solid var(--border)',position:'sticky',left:0}}>
                      {section} <span style={{fontWeight:400,color:'var(--text3)'}}>({sectionRows.length})</span>
                    </td>
                  </tr>,
                  // Rows
                  ...sectionRows.map(row => {
                    const bs = barStyle(row.start, row.end)
                    return (
                      <tr key={row.id} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'4px 8px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'200px',background:'var(--bg)',position:'sticky',left:0,zIndex:1,cursor:'pointer',borderRight:'1px solid var(--border)'}}
                          onClick={()=>setActivePanel(row.panel)}>
                          <div style={{fontWeight:500,overflow:'hidden',textOverflow:'ellipsis'}}>{row.label}</div>
                          {row.sub && <div style={{fontSize:'9px',color:'var(--text3)'}}>{row.sub}</div>}
                        </td>
                        {/* Timeline cells */}
                        <td colSpan={zoom} style={{padding:0,position:'relative',height:'30px'}}>
                          {/* Today line */}
                          {todayOffset>=0 && todayOffset<zoom && (
                            <div style={{position:'absolute',left:`${todayOffset*CELL_W}px`,top:0,bottom:0,width:'2px',background:'#fbbf24',zIndex:1,pointerEvents:'none'}}/>
                          )}
                          {/* Bar */}
                          {bs && (
                            <div style={{...bs,background:color,opacity:0.85,cursor:'pointer'}}
                              onClick={()=>setActivePanel(row.panel)}
                              title={`${row.label}: ${row.start||'?'} → ${row.end||'?'}`}
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })
                ]
              })}
            </tbody>
          </table>
          {/* Legend */}
          <div style={{display:'flex',gap:'12px',marginTop:'12px',flexWrap:'wrap'}}>
            {Object.entries(SECTION_COLORS).map(([label,color]) => (
              <div key={label} style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'var(--text3)'}}>
                <div style={{width:'12px',height:'6px',borderRadius:'2px',background:color}}/>
                {label}
              </div>
            ))}
            <div style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'var(--text3)'}}>
              <div style={{width:'2px',height:'12px',background:'#fbbf24'}}/>Today
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
