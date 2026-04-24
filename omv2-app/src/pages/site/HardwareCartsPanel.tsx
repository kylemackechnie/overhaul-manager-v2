import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface Cart {
  id: string; name: string; description: string; totalCost: number; customerTotal: number; status: string; items: CartItem[]
}
interface CartItem { description: string; partNo: string; qty: number; unitCost: number; total: number }

export function HardwareCartsPanel() {
  const { activeProject, setActiveProject } = useAppStore()
  const [carts, setCarts] = useState<Cart[]>([])
  const [expanded, setExpanded] = useState<string|null>(null)
  const [modal, setModal] = useState<null|'new'|Cart>(null)
  const [form, setForm] = useState({ name:'', description:'', status:'pending' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const hw = activeProject?.hardware as {carts?:Cart[]}|null
    setCarts(hw?.carts||[])
  }, [activeProject?.id])

  async function saveCarts(newCarts: Cart[]) {
    const hw = { ...(activeProject!.hardware as unknown as Record<string,unknown>||{}), carts:newCarts }
    const { data, error } = await supabase.from('projects').update({ hardware:hw })
      .eq('id',activeProject!.id).select('*,site:sites(id,name)').single()
    if (error) { toast(error.message,'error'); return false }
    setActiveProject(data as typeof activeProject)
    return true
  }

  async function addCart() {
    if (!form.name.trim()) return toast('Cart name required','error')
    setSaving(true)
    const newCart: Cart = { id:`cart_${Date.now()}`, name:form.name.trim(), description:form.description, totalCost:0, customerTotal:0, status:form.status, items:[] }
    const newCarts = [...carts, newCart]
    if (await saveCarts(newCarts)) { setCarts(newCarts); toast('Cart added','success') }
    setSaving(false); setModal(null); setForm({name:'',description:'',status:'pending'})
  }

  async function delCart(id: string) {
    if (!confirm('Delete this cart?')) return
    const newCarts = carts.filter(c=>c.id!==id)
    if (await saveCarts(newCarts)) { setCarts(newCarts); toast('Deleted','info') }
  }

  const totalValue = carts.reduce((s,c)=>s+(c.customerTotal||c.totalCost||0),0)
  const fmt = (n:number) => '$'+n.toLocaleString('en-AU',{minimumFractionDigits:0})

  return (
    <div style={{padding:'24px',maxWidth:'900px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Hardware Carts</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{carts.length} carts · {fmt(totalValue)} total</p>
        </div>
        <button className="btn btn-primary" onClick={()=>setModal('new')}>+ New Cart</button>
      </div>

      {carts.length===0 ? (
        <div className="empty-state"><div className="icon">🛒</div><h3>No hardware carts</h3><p>Group hardware line items into carts for quotation tracking.</p></div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {carts.map(c => (
            <div key={c.id} className="card">
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600}}>{c.name}</div>
                  {c.description && <div style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{c.description}</div>}
                </div>
                <span className="badge" style={c.status==='approved'?{bg:'#d1fae5',color:'#065f46'} as {bg:string,color:string}:{bg:'#f1f5f9',color:'#64748b'}}>{c.status}</span>
                <div style={{fontFamily:'var(--mono)',fontSize:'12px',fontWeight:600}}>{fmt(c.customerTotal||c.totalCost||0)}</div>
                <div style={{fontSize:'12px',color:'var(--text3)'}}>{(c.items||[]).length} items</div>
                <button className="btn btn-sm" onClick={()=>setExpanded(expanded===c.id?null:c.id)}>{expanded===c.id?'▲':'▼'}</button>
                <button className="btn btn-sm" style={{color:'var(--red)'}} onClick={()=>delCart(c.id)}>✕</button>
              </div>
              {expanded===c.id && (c.items||[]).length>0 && (
                <div style={{marginTop:'12px',paddingTop:'12px',borderTop:'1px solid var(--border)'}}>
                  <table style={{fontSize:'12px'}}>
                    <thead><tr><th>Part No.</th><th>Description</th><th style={{textAlign:'right'}}>Qty</th><th style={{textAlign:'right'}}>Unit Cost</th><th style={{textAlign:'right'}}>Total</th></tr></thead>
                    <tbody>
                      {c.items.map((item,i)=>(
                        <tr key={i}>
                          <td style={{fontFamily:'var(--mono)'}}>{item.partNo||'—'}</td>
                          <td>{item.description||'—'}</td>
                          <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{item.qty||1}</td>
                          <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(item.unitCost||0)}</td>
                          <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:600}}>{fmt(item.total||0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" style={{maxWidth:'420px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Hardware Cart</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg"><label>Cart Name</label><input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. GT12 Combustion Parts" autoFocus /></div>
              <div className="fg"><label>Description</label><input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
              <div className="fg"><label>Status</label>
                <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                  {['pending','quoted','approved','ordered','delivered'].map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={addCart} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Create Cart</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
