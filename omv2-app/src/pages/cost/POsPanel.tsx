import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import type { PurchaseOrder } from '../../types'

const STATUSES = ['draft','quoted','raised','active','closed','cancelled'] as const
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  draft:{bg:'#f1f5f9',color:'#64748b'}, quoted:{bg:'#fef3c7',color:'#92400e'},
  raised:{bg:'#dbeafe',color:'#1e40af'}, active:{bg:'#d1fae5',color:'#065f46'},
  closed:{bg:'#e5e7eb',color:'#374151'}, cancelled:{bg:'#fee2e2',color:'#7f1d1d'},
}


interface PoLine { id: string; description: string; quantity: number; unit_price: number; total: number }
const mkPoLine = (): PoLine => ({ id: Math.random().toString(36).slice(2), description: '', quantity: 1, unit_price: 0, total: 0 })

const EMPTY = { po_number:'', internal_ref:'', vendor:'', description:'', status:'draft' as const, currency:'AUD', po_value:'', raised_date:'', notes:'', lines:[mkPoLine()] as PoLine[] }

export function POsPanel() {
  const { activeProject } = useAppStore()
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|PurchaseOrder>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('purchase_orders').select('*')
      .eq('project_id', activeProject!.id).order('created_at', { ascending: false })
    setPos((data || []) as PurchaseOrder[])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setModal('new') }
  function setPoLine(idx: number, field: keyof PoLine, value: string | number) {
    setForm(f => {
      const lines = f.lines.map((l, i) => {
        if (i !== idx) return l
        const updated = { ...l, [field]: value }
        updated.total = updated.quantity * updated.unit_price
        return updated
      })
      const totalVal = lines.reduce((s, l) => s + l.total, 0)
      return { ...f, lines, po_value: totalVal > 0 ? totalVal.toFixed(2) : f.po_value }
    })
  }

  function openEdit(po: PurchaseOrder) {
    setForm({
      po_number: po.po_number, internal_ref: po.internal_ref,
      vendor: po.vendor, description: po.description,
      status: po.status as typeof EMPTY['status'],
      currency: po.currency, po_value: po.po_value?.toString() || '',
      raised_date: po.raised_date || '', notes: po.notes,
      lines: ((po as PurchaseOrder & {line_items?: PoLine[]}).line_items || []).length ? (po as PurchaseOrder & {line_items?: PoLine[]}).line_items as PoLine[] : [mkPoLine()]
    })
    setModal(po)
  }

  async function save() {
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      po_number: form.po_number.trim(),
      internal_ref: form.internal_ref.trim(),
      vendor: form.vendor.trim(),
      description: form.description.trim(),
      status: form.status,
      currency: form.currency,
      po_value: form.po_value ? parseFloat(form.po_value) : null,
      raised_date: form.raised_date || null,
      notes: form.notes,
      line_items: form.lines.filter(l => l.description.trim()),
    }
    if (modal === 'new') {
      const { error } = await supabase.from('purchase_orders').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('PO created', 'success')
    } else {
      const { error } = await supabase.from('purchase_orders').update(payload).eq('id',(modal as PurchaseOrder).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('PO saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(po: PurchaseOrder) {
    if (!confirm(`Delete PO ${po.po_number || po.id.slice(0,8)}?`)) return
    await supabase.from('purchase_orders').delete().eq('id', po.id)
    toast('Deleted','info'); load()
  }

  const filtered = pos
    .filter(p => statusFilter === 'all' || p.status === statusFilter)
    .filter(p => !search || p.po_number.toLowerCase().includes(search.toLowerCase()) || p.vendor.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase()))

  function exportCSV() {
    downloadCSV(
      [
        ['PO Number','Vendor','Description','Status','Currency','PO Value','Invoiced Total','Notes'],
        ...pos.map(p => [p.po_number||'', p.vendor||'', p.description||'', p.status||'', p.currency||'AUD', p.po_value||0, p.invoiced_total||0, p.notes||''])
      ],
      'pos_'+(activeProject?.name||'project')
    )
  }

  const fmtMoney = (n: number|null) => n != null ? '$' + n.toLocaleString('en-AU', {minimumFractionDigits:0}) : '—'


  // Keyboard shortcut: N = New
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !(e.target as Element)?.closest('input,textarea,select')) {
        openNew()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div style={{padding:'24px',maxWidth:'1100px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Purchase Orders</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{pos.length} POs on this project</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New PO</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
      </div>

      <div style={{display:'flex',gap:'8px',marginBottom:'16px',flexWrap:'wrap',alignItems:'center'}}>
        <input className="input" style={{maxWidth:'220px'}} placeholder="Search PO, vendor..." value={search} onChange={e=>setSearch(e.target.value)} />
        {(['all',...STATUSES] as string[]).map(s => (
          <button key={s} className="btn btn-sm"
            style={{background:statusFilter===s?'var(--accent)':'var(--bg)',color:statusFilter===s?'#fff':'var(--text)'}}
            onClick={() => setStatusFilter(s)}>
            {s.charAt(0).toUpperCase()+s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📄</div>
          <h3>No purchase orders</h3>
          <p>{search || statusFilter !== 'all' ? 'No matches.' : 'Create POs to track vendor commitments.'}</p>
        </div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead>
              <tr><th>PO Number</th><th>Vendor</th><th>Description</th><th>Status</th><th style={{textAlign:'right'}}>PO Value</th>
                  <th style={{textAlign:'right'}}>Invoiced</th>
                  <th style={{textAlign:'right'}}>Remaining</th><th>Raised</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(po => {
                const sc = STATUS_COLORS[po.status] || STATUS_COLORS.draft
                return (
                  <tr key={po.id}>
                    <td style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:'12px'}}>{po.po_number || <span style={{color:'var(--text3)'}}>—</span>}</td>
                    <td style={{fontWeight:500}}>{po.vendor || '—'}</td>
                    <td style={{color:'var(--text2)',fontSize:'13px',maxWidth:'260px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{po.description || '—'}</td>
                    <td><span className="badge" style={sc}>{po.status}</span></td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{fmtMoney(po.po_value)}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{(po as PurchaseOrder & {invoiced_total?:number}).invoiced_total ? fmtMoney((po as PurchaseOrder & {invoiced_total?:number}).invoiced_total as number) : '—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:(() => {
                      const inv = (po as PurchaseOrder & {invoiced_total?:number}).invoiced_total || 0
                      const rem = (po.po_value||0) - inv
                      return rem < 0 ? 'var(--red)' : rem === 0 ? 'var(--text3)' : 'var(--green)'
                    })()}}>
                      {po.po_value ? fmtMoney((po.po_value||0) - ((po as PurchaseOrder & {invoiced_total?:number}).invoiced_total || 0)) : '—'}
                    </td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{po.raised_date || '—'}</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={() => openEdit(po)}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={() => del(po)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{maxWidth:'580px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'New Purchase Order' : `Edit PO: ${(modal as PurchaseOrder).po_number || '—'}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg">
                  <label>PO Number</label>
                  <input className="input" value={form.po_number} onChange={e=>setForm(f=>({...f,po_number:e.target.value}))} placeholder="e.g. 4500113131" />
                </div>
                <div className="fg">
                  <label>Internal Ref</label>
                  <input className="input" value={form.internal_ref} onChange={e=>setForm(f=>({...f,internal_ref:e.target.value}))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Vendor</label>
                  <input className="input" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} placeholder="Vendor name" autoFocus />
                </div>
                <div className="fg">
                  <label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value as typeof EMPTY['status']}))}>
                    {STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg">
                <label>Description</label>
                <input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="What this PO covers" />
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>PO Value</label>
                  <input type="number" className="input" value={form.po_value} onChange={e=>setForm(f=>({...f,po_value:e.target.value}))} placeholder="0" />
                </div>
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
                    {['AUD','EUR','USD','GBP'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Raised Date</label>
                  <input type="date" className="input" value={form.raised_date} onChange={e=>setForm(f=>({...f,raised_date:e.target.value}))} />
                </div>
              </div>
              <div style={{marginTop:'14px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                  <div style={{fontWeight:600,fontSize:'12px',color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Line Items</div>
                  <button className="btn btn-sm" onClick={()=>setForm(f=>({...f,lines:[...(f.lines||[]),mkPoLine()]}))}>+ Add Line</button>
                </div>
                <table style={{fontSize:'12px',width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr style={{background:'var(--bg3)'}}>
                    <th style={{padding:'5px 8px',textAlign:'left'}}>Description</th>
                    <th style={{padding:'5px 8px',width:'60px',textAlign:'right'}}>Qty</th>
                    <th style={{padding:'5px 8px',width:'110px',textAlign:'right'}}>Unit Price</th>
                    <th style={{padding:'5px 8px',width:'100px',textAlign:'right'}}>Total</th>
                    <th style={{width:'28px'}}></th>
                  </tr></thead>
                  <tbody>
                    {(form.lines||[]).map((l,i)=>(
                      <tr key={l.id}>
                        <td style={{padding:'2px 3px'}}><input className="input" style={{padding:'3px 6px',fontSize:'12px'}} value={l.description} onChange={e=>setPoLine(i,'description',e.target.value)} placeholder="Description" /></td>
                        <td style={{padding:'2px 3px'}}><input type="number" className="input" style={{padding:'3px 6px',fontSize:'12px',textAlign:'right'}} value={l.quantity||''} onChange={e=>setPoLine(i,'quantity',parseFloat(e.target.value)||0)} /></td>
                        <td style={{padding:'2px 3px'}}><input type="number" className="input" style={{padding:'3px 6px',fontSize:'12px',textAlign:'right'}} value={l.unit_price||''} onChange={e=>setPoLine(i,'unit_price',parseFloat(e.target.value)||0)} /></td>
                        <td style={{padding:'2px 3px',textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--green)'}}>{l.total>0?'$'+l.total.toLocaleString('en-AU',{maximumFractionDigits:0}):'—'}</td>
                        <td><button className="btn btn-sm" style={{color:'var(--red)',padding:'1px 4px'}} onClick={()=>setForm(f=>({...f,lines:(f.lines||[]).filter((_,j)=>j!==i)}))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                  {(form.lines||[]).some(l=>l.description) && (
                    <tfoot><tr style={{background:'var(--bg3)',fontWeight:600}}>
                      <td colSpan={3} style={{padding:'5px 8px'}}>Total</td>
                      <td style={{padding:'5px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>${(form.lines||[]).reduce((s,l)=>s+l.total,0).toLocaleString('en-AU',{maximumFractionDigits:0})}</td>
                      <td/>
                    </tr></tfoot>
                  )}
                </table>
              </div>
              <div className="fg" style={{marginTop:'12px'}}>
                <label>Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
