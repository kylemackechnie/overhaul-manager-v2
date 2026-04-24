import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'


// Since we don't have a dedicated audit table yet, show recent changes from status_history on invoices
// and recent inserts/updates across key tables

export function AuditTrailPanel() {
  const { activeProject } = useAppStore()
  const [events, setEvents] = useState<{time:string; who:string; what:string; detail:string}[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const allEvents: typeof events = []

    // Invoice status changes
    const { data: invData } = await supabase.from('invoices').select('invoice_number,status_history,updated_at').eq('project_id',pid)
    for (const inv of invData||[]) {
      const history = inv.status_history as {to:string;by:string;byEmail:string;at:string;note?:string}[]
      for (const h of history||[]) {
        allEvents.push({ time:h.at, who:h.by||h.byEmail||'System', what:`Invoice ${inv.invoice_number} → ${h.to}`, detail:h.note||'' })
      }
    }

    // Recent resource changes
    const { data: resData } = await supabase.from('resources').select('name,role,created_at,updated_at').eq('project_id',pid).order('updated_at',{ascending:false}).limit(20)
    for (const r of resData||[]) {
      allEvents.push({ time:r.updated_at, who:'—', what:`Resource: ${r.name}`, detail:r.role||'' })
    }

    // Recent PO changes
    const { data: poData } = await supabase.from('purchase_orders').select('po_number,vendor,status,updated_at').eq('project_id',pid).order('updated_at',{ascending:false}).limit(10)
    for (const po of poData||[]) {
      allEvents.push({ time:po.updated_at, who:'—', what:`PO ${po.po_number||'—'}: ${po.vendor}`, detail:po.status })
    }

    // Sort by time desc
    allEvents.sort((a,b) => (b.time||'').localeCompare(a.time||''))
    setEvents(allEvents.slice(0,100))
    setLoading(false)
  }

  function fmtTime(t: string) {
    try { return new Date(t).toLocaleString('en-AU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) }
    catch { return t }
  }

  return (
    <div style={{padding:'24px',maxWidth:'900px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Audit Trail</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>Recent activity on this project</p>
        </div>
        <button className="btn btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : events.length===0 ? (
        <div className="empty-state"><div className="icon">📋</div><h3>No activity yet</h3><p>Changes to invoices, resources, and POs will appear here.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>Time</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>
              {events.map((e,i) => (
                <tr key={i}>
                  <td style={{fontFamily:'var(--mono)',fontSize:'11px',whiteSpace:'nowrap',color:'var(--text3)'}}>{fmtTime(e.time)}</td>
                  <td style={{fontSize:'12px',color:'var(--text2)',whiteSpace:'nowrap'}}>{e.who||'—'}</td>
                  <td style={{fontWeight:500,fontSize:'13px'}}>{e.what}</td>
                  <td style={{fontSize:'12px',color:'var(--text3)'}}>{e.detail||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
