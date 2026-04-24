import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface HwContract {
  id: string; project_id: string; vendor: string; contract_ref: string; description: string
  value: number; currency: string; status: string; start_date: string | null; end_date: string | null
  po_id: string | null; line_items: LineItem[]; notes: string; created_at: string
}
interface LineItem { id: string; part_no: string; description: string; qty: number; transfer_price: number; customer_price: number }
const mkLine = (): LineItem => ({ id: Math.random().toString(36).slice(2), part_no: '', description: '', qty: 1, transfer_price: 0, customer_price: 0 })
const STATUSES = ['active','pending','complete','cancelled'] as const
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  active:{bg:'#d1fae5',color:'#065f46'}, pending:{bg:'#fef3c7',color:'#92400e'},
  complete:{bg:'#dbeafe',color:'#1e40af'}, cancelled:{bg:'#fee2e2',color:'#7f1d1d'},
}
const EMPTY = { vendor:'', contract_ref:'', description:'', value:0, currency:'EUR', status:'active', start_date:'', end_date:'', po_id:'', notes:'', lines:[mkLine()] }

export function HardwareContractPanel() {
  const { activeProject } = useAppStore()
  const [contracts, setContracts] = useState<HwContract[]>([])
  const [pos, setPos] = useState<{id:string;po_number:string;vendor:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|HwContract>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string|null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [cData, pData] = await Promise.all([
      supabase.from('hardware_contracts').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).order('po_number'),
    ])
    setContracts((cData.data||[]) as HwContract[])
    setPos((pData.data||[]) as {id:string;po_number:string;vendor:string}[])
    setLoading(false)
  }

  function openNew() { setForm({ ...EMPTY, lines:[mkLine()] }); setModal('new') }
  function openEdit(c: HwContract) {
    setForm({ vendor:c.vendor, contract_ref:c.contract_ref, description:c.description,
      value:c.value, currency:c.currency, status:c.status,
      start_date:c.start_date||'', end_date:c.end_date||'', po_id:c.po_id||'', notes:c.notes,
      lines:(c.line_items||[]).length ? c.line_items : [mkLine()] })
    setModal(c)
  }

  function setLine(idx: number, field: keyof LineItem, value: string | number) {
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }))
  }

  async function save() {
    if (!form.vendor.trim()) return toast('Vendor required', 'error')
    setSaving(true)
    const lines = form.lines.filter(l => l.description.trim())
    const totalValue = lines.reduce((s, l) => s + (l.customer_price * l.qty), 0) || form.value
    const payload = {
      project_id: activeProject!.id,
      vendor: form.vendor.trim(), contract_ref: form.contract_ref.trim(),
      description: form.description.trim(), value: totalValue, currency: form.currency,
      status: form.status, start_date: form.start_date||null, end_date: form.end_date||null,
      po_id: form.po_id||null, line_items: lines, notes: form.notes,
    }
    const isNew = modal === 'new'
    const { error } = isNew
      ? await supabase.from('hardware_contracts').insert(payload)
      : await supabase.from('hardware_contracts').update(payload).eq('id', (modal as HwContract).id)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(isNew ? 'Contract added' : 'Saved', 'success'); setSaving(false); setModal(null); load()
  }

  async function del(c: HwContract) {
    if (!confirm(`Delete contract from ${c.vendor}?`)) return
    await supabase.from('hardware_contracts').delete().eq('id', c.id)
    toast('Deleted', 'info'); load()
  }

  function exportCSV() {
    const rows = [['Vendor','Ref','Description','Currency','Value','Status','Start','End']]
    contracts.forEach(c => rows.push([c.vendor,c.contract_ref,c.description,c.currency,String(c.value),c.status,c.start_date||'',c.end_date||'']))
    const csv = rows.map(r=>r.map(c=>c.includes(',')?`"${c}"`:c).join(',')).join('\n')
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download='hardware_contracts.csv'; a.click()
  }

  const fmt = (n:number) => n > 0 ? n.toLocaleString('en-AU',{maximumFractionDigits:0}) : '—'
  const totalValue = contracts.filter(c=>c.status!=='cancelled').reduce((s,c)=>s+c.value,0)

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Hardware Contracts</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {contracts.length} contracts · Total {contracts[0]?.currency||'EUR'} {fmt(totalValue)}
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
          <button className="btn btn-primary" onClick={openNew}>+ Add Contract</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : contracts.length === 0 ? (
        <div className="empty-state"><div className="icon">⚙️</div><h3>No hardware contracts</h3><p>Add hardware supply contracts from vendors like Siemens Energy Germany.</p></div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {contracts.map(c => {
            const sc = STATUS_COLORS[c.status]||STATUS_COLORS.active
            const isExpanded = expandedId === c.id
            return (
              <div key={c.id} className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px 16px',cursor:'pointer'}} onClick={()=>setExpandedId(isExpanded?null:c.id)}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:'14px'}}>{c.vendor}</div>
                    <div style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{c.contract_ref}{c.description?` · ${c.description}`:''}</div>
                  </div>
                  <span className="badge" style={sc}>{c.status}</span>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontWeight:700,fontFamily:'var(--mono)',color:'var(--accent)'}}>{c.currency} {fmt(c.value)}</div>
                    <div style={{fontSize:'11px',color:'var(--text3)'}}>{c.start_date||'—'} → {c.end_date||'—'}</div>
                  </div>
                  <div style={{display:'flex',gap:'4px'}} onClick={e=>e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={()=>openEdit(c)}>Edit</button>
                    <button className="btn btn-sm" style={{color:'var(--red)'}} onClick={()=>del(c)}>✕</button>
                  </div>
                  <span style={{fontSize:'11px',color:'var(--text3)'}}>{isExpanded?'▲':'▼'}</span>
                </div>
                {isExpanded && (c.line_items||[]).length > 0 && (
                  <div style={{borderTop:'1px solid var(--border)',padding:'12px 16px',background:'var(--bg3)'}}>
                    <table style={{fontSize:'12px',width:'100%'}}>
                      <thead><tr><th>Part No</th><th>Description</th><th style={{textAlign:'right'}}>Qty</th><th style={{textAlign:'right'}}>Transfer Price</th><th style={{textAlign:'right'}}>Customer Price</th></tr></thead>
                      <tbody>
                        {(c.line_items||[]).map((l,i)=>(
                          <tr key={i}>
                            <td style={{fontFamily:'var(--mono)',fontSize:'11px'}}>{l.part_no||'—'}</td>
                            <td>{l.description}</td>
                            <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{l.qty}</td>
                            <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(l.transfer_price)}</td>
                            <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>{fmt(l.customer_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" style={{maxWidth:'700px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'Add Hardware Contract':'Edit Contract'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}><label>Vendor *</label><input className="input" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} placeholder="e.g. Siemens Energy Germany" autoFocus /></div>
                <div className="fg"><label>Contract Ref</label><input className="input" value={form.contract_ref} onChange={e=>setForm(f=>({...f,contract_ref:e.target.value}))} placeholder="e.g. OPSA-12345" /></div>
              </div>
              <div className="fg"><label>Description</label><input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Scope summary" /></div>
              <div className="fg-row">
                <div className="fg"><label>Currency</label>
                  <select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
                    {['EUR','AUD','USD','GBP'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Start Date</label><input type="date" className="input" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))} /></div>
                <div className="fg"><label>End Date</label><input type="date" className="input" value={form.end_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} /></div>
              </div>
              <div className="fg"><label>Linked PO</label>
                <select className="input" value={form.po_id} onChange={e=>setForm(f=>({...f,po_id:e.target.value}))}>
                  <option value="">— No PO —</option>
                  {pos.map(p=><option key={p.id} value={p.id}>{p.po_number} {p.vendor}</option>)}
                </select>
              </div>

              {/* Line items */}
              <div style={{marginTop:'14px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                  <div style={{fontWeight:600,fontSize:'12px',color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Line Items</div>
                  <button className="btn btn-sm" onClick={()=>setForm(f=>({...f,lines:[...f.lines,mkLine()]}))}>+ Add Line</button>
                </div>
                <table style={{fontSize:'12px',width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr style={{background:'var(--bg3)'}}>
                    <th style={{padding:'6px 8px',textAlign:'left',width:'120px'}}>Part No</th>
                    <th style={{padding:'6px 8px',textAlign:'left'}}>Description</th>
                    <th style={{padding:'6px 8px',width:'60px',textAlign:'right'}}>Qty</th>
                    <th style={{padding:'6px 8px',width:'120px',textAlign:'right'}}>Transfer Price</th>
                    <th style={{padding:'6px 8px',width:'120px',textAlign:'right'}}>Customer Price</th>
                    <th style={{width:'32px'}}></th>
                  </tr></thead>
                  <tbody>
                    {form.lines.map((l,i)=>(
                      <tr key={l.id}>
                        <td style={{padding:'3px 4px'}}><input className="input" style={{padding:'4px 6px',fontSize:'11px',fontFamily:'var(--mono)'}} value={l.part_no} onChange={e=>setLine(i,'part_no',e.target.value)} /></td>
                        <td style={{padding:'3px 4px'}}><input className="input" style={{padding:'4px 6px',fontSize:'12px'}} value={l.description} onChange={e=>setLine(i,'description',e.target.value)} placeholder="Description" /></td>
                        <td style={{padding:'3px 4px'}}><input type="number" className="input" style={{padding:'4px 6px',fontSize:'12px',textAlign:'right'}} value={l.qty} onChange={e=>setLine(i,'qty',parseInt(e.target.value)||1)} min={1} /></td>
                        <td style={{padding:'3px 4px'}}><input type="number" className="input" style={{padding:'4px 6px',fontSize:'12px',textAlign:'right'}} value={l.transfer_price||''} onChange={e=>setLine(i,'transfer_price',parseFloat(e.target.value)||0)} /></td>
                        <td style={{padding:'3px 4px'}}><input type="number" className="input" style={{padding:'4px 6px',fontSize:'12px',textAlign:'right'}} value={l.customer_price||''} onChange={e=>setLine(i,'customer_price',parseFloat(e.target.value)||0)} /></td>
                        <td style={{padding:'3px 4px'}}><button className="btn btn-sm" style={{color:'var(--red)',padding:'2px 6px'}} onClick={()=>setForm(f=>({...f,lines:f.lines.filter((_,j)=>j!==i)}))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                  {form.lines.some(l=>l.description) && (
                    <tfoot><tr style={{background:'var(--bg3)',fontWeight:600}}>
                      <td colSpan={4} style={{padding:'6px 8px'}}>Total Customer Value</td>
                      <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>
                        {fmt(form.lines.reduce((s,l)=>s+(l.customer_price*l.qty),0))}
                      </td>
                      <td/>
                    </tr></tfoot>
                  )}
                </table>
              </div>
              <div className="fg" style={{marginTop:'12px'}}><label>Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} /></div>
            </div>
            <div className="modal-footer">
              {modal!=='new'&&<button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{del(modal as HwContract);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
