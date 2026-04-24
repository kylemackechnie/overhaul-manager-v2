import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import type { ToolingCosting, GlobalTV, PurchaseOrder } from '../../types'

export function ToolingCostingsPanel() {
  const { activeProject } = useAppStore()
  const [costings, setCostings] = useState<(ToolingCosting & { tv?: GlobalTV; po?: PurchaseOrder })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [cData, tvData, poData] = await Promise.all([
      supabase.from('tooling_costings').select('*').eq('project_id',pid).order('tv_no'),
      supabase.from('global_tvs').select('*').order('tv_no'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id',pid),
    ])
    const tvMap = Object.fromEntries((tvData.data||[]).map(tv => [tv.tv_no, tv] as [string, GlobalTV]))
    const poMap = Object.fromEntries((poData.data||[]).map(po => [po.id, po] as [string, PurchaseOrder]))
    setCostings((cData.data||[]).map((c: ToolingCosting) => ({ ...c, tv: tvMap[c.tv_no], po: c.linked_po_id ? poMap[c.linked_po_id] : undefined })))
    setLoading(false)
  }

  const totalCostEur = costings.reduce((s,c)=>s+(c.cost_eur||0),0)
  const totalSellEur = costings.reduce((s,c)=>s+(c.sell_eur||0),0)

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Tooling Costings</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {costings.length} TVs costed · Cost €{totalCostEur.toLocaleString()} · Sell €{totalSellEur.toLocaleString()}
          </p>
        </div>
      </div>
      <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'16px'}}>
        Edit costings via TV Register → Costings button on each TV row.
      </p>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : costings.length===0 ? (
        <div className="empty-state"><div className="icon">💶</div><h3>No tooling costings</h3><p>Add TVs via the TV Register, then set costings using the Costings button.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead>
              <tr><th>TV</th><th>Charge Start</th><th>Charge End</th><th>Days</th><th style={{textAlign:'right'}}>Cost (EUR)</th><th style={{textAlign:'right'}}>Sell (EUR)</th><th>PO</th></tr>
            </thead>
            <tbody>
              {costings.map(c => {
                const days = c.charge_start && c.charge_end
                  ? Math.round((new Date(c.charge_end).getTime()-new Date(c.charge_start).getTime())/86400000)+1 : null
                return (
                  <tr key={c.id}>
                    <td style={{fontFamily:'var(--mono)',fontWeight:700}}>TV{c.tv_no}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{c.charge_start||'—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{c.charge_end||'—'}</td>
                    <td style={{textAlign:'center',fontFamily:'var(--mono)',fontSize:'12px'}}>{days??'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{c.cost_eur?`€${c.cost_eur.toLocaleString()}`:'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--green)'}}>{c.sell_eur?`€${c.sell_eur.toLocaleString()}`:'—'}</td>
                    <td style={{fontSize:'11px',color:'var(--text3)'}}>{c.po ? (c.po.po_number||c.po.vendor) : '—'}</td>
                  </tr>
                )
              })}
              <tr style={{borderTop:'2px solid var(--border)',background:'var(--bg3)'}}>
                <td colSpan={4} style={{padding:'8px 10px',fontWeight:600}}>Total</td>
                <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:700,padding:'8px 10px'}}>€{totalCostEur.toLocaleString()}</td>
                <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:700,color:'var(--green)',padding:'8px 10px'}}>€{totalSellEur.toLocaleString()}</td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
