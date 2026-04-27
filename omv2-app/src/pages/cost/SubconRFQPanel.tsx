import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { PurchaseOrder } from '../../types'

interface SubconContract {
  id: string; project_id: string; vendor: string; status: string; value: number|null
  quoted_amount: number|null; response_notes: string; awarded: boolean
  details: Record<string,unknown>; created_at: string; updated_at: string
}

const CONTRACT_STATUSES = ['draft','sent','received','awarded','declined','cancelled'] as const
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  draft:{bg:'#f1f5f9',color:'#64748b'}, sent:{bg:'#dbeafe',color:'#1e40af'},
  received:{bg:'#fef3c7',color:'#92400e'}, awarded:{bg:'#d1fae5',color:'#065f46'},
  declined:{bg:'#fee2e2',color:'#7f1d1d'}, cancelled:{bg:'#e5e7eb',color:'#374151'},
}

const EMPTY_CONTRACT = { vendor:'', status:'draft', value:'', description:'', scope:'', start_date:'', end_date:'', notes:'', po_id:'', quoted_amount:'', response_notes:'', awarded:false }

interface EquipImportItem {
  desc: string; unit: string; rate: number; transport_in: number; transport_out: number
  start_date: string; end_date: string; selected: boolean
}

export function SubconRFQPanel() {
  const { activeProject } = useAppStore()
  const [contracts, setContracts] = useState<SubconContract[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|SubconContract>(null)
  const [form, setForm] = useState(EMPTY_CONTRACT)
  const [saving, setSaving] = useState(false)
  const [equipModal, setEquipModal] = useState<{rfqId:string; vendor:string; items:EquipImportItem[]} | null>(null)
  const [equipImporting, setEquipImporting] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [cData, pData] = await Promise.all([
      supabase.from('subcon_contracts').select('*').eq('project_id',pid).order('created_at',{ascending:false}),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id',pid).neq('status','cancelled'),
    ])
    setContracts((cData.data||[]) as SubconContract[])
    setPos((pData.data||[]) as PurchaseOrder[])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY_CONTRACT); setModal('new') }
  function openEdit(c: SubconContract) {
    const d = (c.details || {}) as Record<string,unknown>
    setForm({
      vendor: c.vendor,
      status: c.status,
      value: c.value?.toString() || '',
      // Real columns first, fall back to legacy details jsonb if column is empty
      description: (c as unknown as { description?: string }).description || String(d.description || ''),
      scope: (c as unknown as { scope?: string }).scope || String(d.scope || ''),
      start_date: (c as unknown as { start_date?: string }).start_date || String(d.start_date || ''),
      end_date: (c as unknown as { end_date?: string }).end_date || String(d.end_date || ''),
      notes: (c as unknown as { notes?: string }).notes || String(d.notes || ''),
      po_id: (c as unknown as { linked_po_id?: string }).linked_po_id || String(d.po_id || ''),
      quoted_amount: c.quoted_amount?.toString() || '',
      response_notes: c.response_notes || '',
      awarded: c.awarded || false,
    })
    setModal(c)
  }

  async function save() {
    if (!form.vendor.trim()) return toast('Vendor required','error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      vendor: form.vendor.trim(),
      status: form.status,
      value: form.value ? parseFloat(form.value) : null,
      description: form.description,
      scope: form.scope,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      notes: form.notes,
      linked_po_id: form.po_id || null,
      quoted_amount: form.quoted_amount ? parseFloat(form.quoted_amount) : null,
      response_notes: form.response_notes,
      awarded: form.awarded,
    }
    if (modal==='new') {
      const { error } = await supabase.from('subcon_contracts').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Contract added','success')
    } else {
      const { error } = await supabase.from('subcon_contracts').update(payload).eq('id',(modal as SubconContract).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(c: SubconContract) {
    if (!confirm(`Delete contract with ${c.vendor}?`)) return
    await supabase.from('subcon_contracts').delete().eq('id',c.id)
    toast('Deleted','info'); load()
  }

  const fmt = (n:number|null) => n!=null ? '$'+n.toLocaleString('en-AU',{minimumFractionDigits:0}) : '—'
  const totalAwarded = contracts.filter(c=>c.status==='awarded').reduce((s,c)=>s+(c.value||0),0)


  async function confirmEquipImport() {
    if (!equipModal || !activeProject) return
    setEquipImporting(true)
    const toImport = equipModal.items.filter(i => i.selected)
    if (!toImport.length) { toast('No items selected', 'info'); setEquipImporting(false); return }

    const inserts = toImport.map(i => ({
      project_id: activeProject.id,
      hire_type: 'dry',
      name: i.desc,
      vendor: equipModal.vendor,
      description: `Imported from RFQ — ${equipModal.vendor}`,
      start_date: i.start_date || null,
      end_date: i.end_date || null,
      daily_rate: i.rate || null,
      charge_unit: 'daily',
      transport_in: i.transport_in || 0,
      transport_out: i.transport_out || 0,
      hire_cost: i.rate && i.start_date && i.end_date
        ? i.rate * Math.max(0, Math.ceil((new Date(i.end_date).getTime() - new Date(i.start_date).getTime()) / 86400000))
        : 0,
      customer_total: 0, gm_pct: activeProject.default_gm || 15,
      currency: 'AUD', qty: 1, notes: '',
    }))

    const { error } = await supabase.from('hire_items').insert(inserts)
    if (error) { toast(error.message, 'error'); setEquipImporting(false); return }
    toast(`✅ ${toImport.length} equipment items imported to Dry Hire`, 'success')
    setEquipModal(null)
    setEquipImporting(false)
  }

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Subcontractor Register</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {contracts.length} contracts · {fmt(totalAwarded)} awarded
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Contract</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : contracts.length===0 ? (
        <div className="empty-state"><div className="icon">🤝</div><h3>No subcontractor contracts</h3><p>Track subcontractor RFQs, awards, and contracts here.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>Vendor</th><th>Description</th><th>Status</th><th style={{textAlign:'right'}}>Value</th><th>Start</th><th>End</th><th></th></tr></thead>
            <tbody>
              {contracts.map(c => {
                const d = (c.details || {}) as Record<string,unknown>
                const sc = STATUS_COLORS[c.status]||STATUS_COLORS.draft
                const cExt = c as unknown as { description?: string; start_date?: string; end_date?: string }
                const desc = cExt.description || String(d.description||'')
                const sd = cExt.start_date || String(d.start_date||'')
                const ed = cExt.end_date || String(d.end_date||'')

  return (
                  <tr key={c.id}>
                    <td style={{fontWeight:500}}>{c.vendor}</td>
                    <td style={{fontSize:'12px',color:'var(--text2)',maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{desc || '—'}</td>
                    <td><span className="badge" style={sc}>{c.status}</span></td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{fmt(c.value)}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{sd || '—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{ed || '—'}</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={()=>openEdit(c)}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>del(c)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'560px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'New Contract':'Edit Contract'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}><label>Vendor / Company</label><input className="input" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} autoFocus /></div>
                <div className="fg"><label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {CONTRACT_STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg"><label>Description</label><input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Scaffolding — GT12 Outage" /></div>
              <div className="fg"><label>Scope</label><textarea className="input" rows={2} value={form.scope} onChange={e=>setForm(f=>({...f,scope:e.target.value}))} style={{resize:'vertical'}} /></div>
              <div className="fg-row">
                <div className="fg"><label>Contract Value</label><input type="number" className="input" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} /></div>
                <div className="fg"><label>Start Date</label><input type="date" className="input" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))} /></div>
                <div className="fg"><label>End Date</label><input type="date" className="input" value={form.end_date} onChange={e=>setForm(f=>({...f,end_date:e.target.value}))} /></div>
              </div>
              <div className="fg"><label>Linked PO</label>
                <select className="input" value={form.po_id} onChange={e=>setForm(f=>({...f,po_id:e.target.value}))}>
                  <option value="">— No PO —</option>
                  {pos.map(po=><option key={po.id} value={po.id}>{po.po_number||'—'} {po.vendor}</option>)}
                </select>
              </div>
              <div className="fg"><label>Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} /></div>
              <div style={{marginTop:'12px',paddingTop:'12px',borderTop:'1px solid var(--border)'}}>
                <div style={{fontWeight:600,fontSize:'12px',color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'8px'}}>Vendor Response</div>
                <div className="fg-row">
                  <div className="fg"><label>Quoted Amount ($)</label><input type="number" className="input" value={(form as Record<string,unknown>).quoted_amount as string||''} onChange={e=>setForm(f=>({...f,quoted_amount:e.target.value}))} placeholder="Vendor quote value" /></div>
                  <div className="fg" style={{display:'flex',alignItems:'center',paddingTop:'20px'}}>
                    <label style={{display:'flex',gap:'8px',alignItems:'center',cursor:'pointer'}}>
                      <input type="checkbox" checked={(form as Record<string,unknown>).awarded as boolean||false} onChange={e=>setForm(f=>({...f,awarded:e.target.checked}))} style={{accentColor:'var(--green)'}}/>
                      <span style={{fontSize:'13px',fontWeight:500}}>Awarded</span>
                    </label>
                  </div>
                </div>
                <div className="fg"><label>Response Notes</label><textarea className="input" rows={2} value={(form as Record<string,unknown>).response_notes as string||''} onChange={e=>setForm(f=>({...f,response_notes:e.target.value}))} placeholder="Quote notes, conditions, exceptions..." style={{resize:'vertical'}} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Equipment Import Wizard Modal */}
      {equipModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'760px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>🚜 Import Equipment to Dry Hire</h3>
              <button className="btn btn-sm" onClick={() => setEquipModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'12px'}}>
                Vendor: <strong>{equipModal.vendor}</strong> · {equipModal.items.filter(i=>i.selected).length} of {equipModal.items.length} items selected.
                All items import as Dry Hire — adjust rates and dates below.
              </p>
              <table style={{fontSize:'12px',width:'100%'}}>
                <thead><tr>
                  <th style={{width:'28px'}}></th>
                  <th>Equipment</th>
                  <th style={{textAlign:'right'}}>Rate ($/day)</th>
                  <th>Start</th>
                  <th>End</th>
                  <th style={{textAlign:'right'}}>Trans. In</th>
                  <th style={{textAlign:'right'}}>Trans. Out</th>
                </tr></thead>
                <tbody>
                  {equipModal.items.map((item, i) => (
                    <tr key={i} style={{opacity:item.selected?1:0.4}}>
                      <td>
                        <input type="checkbox" checked={item.selected} style={{accentColor:'var(--accent)'}}
                          onChange={e => setEquipModal(m => m ? {...m, items: m.items.map((x,j) => j===i ? {...x,selected:e.target.checked} : x)} : null)} />
                      </td>
                      <td style={{fontWeight:500}}>{item.desc}</td>
                      <td style={{textAlign:'right'}}>
                        <input type="number" className="input" style={{width:'80px',textAlign:'right',padding:'2px 6px',fontSize:'11px'}}
                          value={item.rate||''} placeholder="0"
                          onChange={e => setEquipModal(m => m ? {...m, items: m.items.map((x,j) => j===i ? {...x,rate:parseFloat(e.target.value)||0} : x)} : null)} />
                      </td>
                      <td><input type="date" className="input" style={{padding:'2px 6px',fontSize:'11px'}} value={item.start_date}
                        onChange={e => setEquipModal(m => m ? {...m, items: m.items.map((x,j) => j===i ? {...x,start_date:e.target.value} : x)} : null)} /></td>
                      <td><input type="date" className="input" style={{padding:'2px 6px',fontSize:'11px'}} value={item.end_date}
                        onChange={e => setEquipModal(m => m ? {...m, items: m.items.map((x,j) => j===i ? {...x,end_date:e.target.value} : x)} : null)} /></td>
                      <td style={{textAlign:'right'}}>
                        <input type="number" className="input" style={{width:'70px',textAlign:'right',padding:'2px 6px',fontSize:'11px'}}
                          value={item.transport_in||''} placeholder="0"
                          onChange={e => setEquipModal(m => m ? {...m, items: m.items.map((x,j) => j===i ? {...x,transport_in:parseFloat(e.target.value)||0} : x)} : null)} />
                      </td>
                      <td style={{textAlign:'right'}}>
                        <input type="number" className="input" style={{width:'70px',textAlign:'right',padding:'2px 6px',fontSize:'11px'}}
                          value={item.transport_out||''} placeholder="0"
                          onChange={e => setEquipModal(m => m ? {...m, items: m.items.map((x,j) => j===i ? {...x,transport_out:parseFloat(e.target.value)||0} : x)} : null)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEquipModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => confirmEquipImport()} disabled={equipImporting}>
                {equipImporting ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : null}
                🚜 Import {equipModal.items.filter(i=>i.selected).length} Items to Dry Hire
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
