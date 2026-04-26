import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface SparePart {
  id: string; part_number: string; description: string
  manufacturer: string | null; qty_on_hand: number; qty_reserved: number
  unit: string | null; location: string | null
}
interface Receipt { spare_part_id: string; qty: number; received_date: string; condition: string }
interface Issue   { spare_part_id: string; qty: number; issued_date: string }

export function PartsReportsPanel() {
  const { activeProject } = useAppStore()
  const [parts,    setParts]    = useState<SparePart[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [issues,   setIssues]   = useState<Issue[]>([])
  const [loading,  setLoading]  = useState(true)
  const [view,     setView]     = useState<'stock'|'movements'|'low'>('stock')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [pRes, rRes, iRes] = await Promise.all([
      supabase.from('spare_parts').select('*').eq('project_id', pid).order('part_number'),
      supabase.from('parts_receipts').select('spare_part_id,qty,received_date,condition').eq('project_id', pid),
      supabase.from('parts_issues').select('spare_part_id,qty,issued_date').eq('project_id', pid),
    ])
    setParts((pRes.data || []) as SparePart[])
    setReceipts((rRes.data || []) as Receipt[])
    setIssues((iRes.data || []) as Issue[])
    setLoading(false)
  }

  const totalReceived = (partId: string) => receipts.filter(r => r.spare_part_id === partId).reduce((s, r) => s + r.qty, 0)
  const totalIssued   = (partId: string) => issues.filter(i => i.spare_part_id === partId).reduce((s, i) => s + i.qty, 0)
  const available     = (p: SparePart) => (p.qty_on_hand || 0) - (p.qty_reserved || 0)
  const lowStock      = parts.filter(p => available(p) <= 0)

  const TABS = [
    { key: 'stock',     label: `Stock Levels (${parts.length})`    },
    { key: 'movements', label: 'Movements'                          },
    { key: 'low',       label: `Low / Out of Stock (${lowStock.length})` },
  ] as const

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>📄 Parts Reports</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>Stock levels, movements and alerts</p>
        </div>
        <button className="btn btn-secondary" onClick={load}>↻ Refresh</button>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total SKUs',    val: parts.length,                                    color: 'var(--accent)' },
          { label: 'Total On Hand', val: parts.reduce((s, p) => s + (p.qty_on_hand||0), 0), color: 'var(--text)' },
          { label: 'Total Issued',  val: issues.reduce((s, i) => s + i.qty, 0),            color: 'var(--text2)' },
          { label: 'Out of Stock',  val: lowStock.length,                                  color: lowStock.length > 0 ? 'var(--red)' : 'var(--green)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '12px' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        {TABS.map(t => (
          <button key={t.key} className="btn btn-sm"
            style={{ background: view === t.key ? 'var(--accent)' : 'var(--bg)', color: view === t.key ? '#fff' : 'var(--text)' }}
            onClick={() => setView(t.key)}>{t.label}</button>
        ))}
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /></div> : (
        <>
          {view === 'stock' && (
            <table className="data-table">
              <thead><tr><th>Part #</th><th>Description</th><th>Manufacturer</th><th style={{textAlign:'right'}}>On Hand</th><th style={{textAlign:'right'}}>Reserved</th><th style={{textAlign:'right'}}>Available</th><th style={{textAlign:'right'}}>Received</th><th style={{textAlign:'right'}}>Issued</th><th>Location</th></tr></thead>
              <tbody>
                {parts.map(p => {
                  const avail = available(p)
                  return (
                    <tr key={p.id}>
                      <td style={{fontFamily:'var(--mono)',fontSize:'11px',fontWeight:600}}>{p.part_number}</td>
                      <td style={{fontSize:'11px'}}>{p.description}</td>
                      <td style={{fontSize:'11px',color:'var(--text3)'}}>{p.manufacturer||'—'}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px'}}>{p.qty_on_hand}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{p.qty_reserved||0}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px',fontWeight:600,color:avail<=0?'var(--red)':avail<=2?'var(--orange,#f59e0b)':'var(--green)'}}>{avail}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{totalReceived(p.id)}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{totalIssued(p.id)}</td>
                      <td style={{fontSize:'11px',color:'var(--text3)'}}>{p.location||'—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {view === 'movements' && (() => {
            type Movement = { date: string; type: string; part_id: string; qty: number; detail: string }
            const movements: Movement[] = [
              ...receipts.map(r => ({ date: r.received_date, type: 'Receipt', part_id: r.spare_part_id, qty: r.qty, detail: r.condition })),
              ...issues.map(i => ({ date: i.issued_date, type: 'Issue', part_id: i.spare_part_id, qty: i.qty, detail: '' })),
            ].sort((a, b) => b.date.localeCompare(a.date))
            const partMap = Object.fromEntries(parts.map(p => [p.id, p]))
            return movements.length === 0 ? <p style={{color:'var(--text3)',fontSize:'12px'}}>No movements recorded yet.</p> : (
              <table className="data-table">
                <thead><tr><th>Date</th><th>Type</th><th>Part</th><th>Description</th><th style={{textAlign:'right'}}>Qty</th><th>Detail</th></tr></thead>
                <tbody>
                  {movements.map((m, i) => {
                    const p = partMap[m.part_id]
                    return (
                      <tr key={i}>
                        <td style={{fontSize:'11px',whiteSpace:'nowrap'}}>{m.date}</td>
                        <td><span className="badge" style={{background:m.type==='Receipt'?'#d1fae5':'#dbeafe',color:m.type==='Receipt'?'#065f46':'#1e40af',fontSize:'10px'}}>{m.type}</span></td>
                        <td style={{fontFamily:'var(--mono)',fontSize:'11px',fontWeight:600}}>{p?.part_number||'—'}</td>
                        <td style={{fontSize:'11px'}}>{p?.description||'—'}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px',color:m.type==='Issue'?'var(--red)':'var(--green)'}}>{m.type==='Issue'?'-':'+' }{m.qty}</td>
                        <td style={{fontSize:'11px',color:'var(--text3)'}}>{m.detail||'—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          })()}

          {view === 'low' && (
            lowStock.length === 0
              ? <div className="empty-state" style={{padding:'40px'}}><div className="icon">✅</div><h3>All parts in stock</h3><p>No parts are at zero or negative availability.</p></div>
              : <table className="data-table">
                  <thead><tr><th>Part #</th><th>Description</th><th style={{textAlign:'right'}}>On Hand</th><th style={{textAlign:'right'}}>Reserved</th><th style={{textAlign:'right'}}>Available</th><th>Location</th></tr></thead>
                  <tbody>
                    {lowStock.map(p => (
                      <tr key={p.id} style={{background:'rgba(239,68,68,0.04)'}}>
                        <td style={{fontFamily:'var(--mono)',fontSize:'11px',fontWeight:600}}>{p.part_number}</td>
                        <td style={{fontSize:'11px'}}>{p.description}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px'}}>{p.qty_on_hand}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{p.qty_reserved||0}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px',fontWeight:700,color:'var(--red)'}}>{available(p)}</td>
                        <td style={{fontSize:'11px',color:'var(--text3)'}}>{p.location||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
          )}
        </>
      )}
    </div>
  )
}
