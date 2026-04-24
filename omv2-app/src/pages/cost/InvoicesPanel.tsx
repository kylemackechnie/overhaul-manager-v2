import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import type { Invoice, PurchaseOrder, InvoiceStatus } from '../../types'

const STATUS_FLOW: InvoiceStatus[] = ['received','checked','approved','paid']
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  received:{bg:'#dbeafe',color:'#1e40af'}, checked:{bg:'#fef3c7',color:'#92400e'},
  approved:{bg:'#d1fae5',color:'#065f46'}, paid:{bg:'#e5e7eb',color:'#374151'},
  disputed:{bg:'#fee2e2',color:'#7f1d1d'},
}

const EMPTY = { po_id:'', invoice_number:'', vendor_ref:'', amount:'', currency:'AUD', invoice_date:'', period_from:'', period_to:'', notes:'' }

export function InvoicesPanel() {
  const { activeProject, currentUser } = useAppStore()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Invoice>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [historyModal, setHistoryModal] = useState<Invoice|null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [invData, poData] = await Promise.all([
      supabase.from('invoices').select('*,po:purchase_orders(id,po_number,vendor)').eq('project_id',pid).order('invoice_date',{ascending:false}),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id',pid).order('po_number'),
    ])
    setInvoices((invData.data || []) as Invoice[])
    setPos((poData.data || []) as PurchaseOrder[])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setModal('new') }
  function openEdit(inv: Invoice) {
    setForm({
      po_id: inv.po_id || '', invoice_number: inv.invoice_number,
      vendor_ref: inv.vendor_ref, amount: inv.amount.toString(),
      currency: inv.currency, invoice_date: inv.invoice_date || '',
      period_from: inv.period_from || '', period_to: inv.period_to || '',
      notes: inv.notes,
    })
    setModal(inv)
  }

  async function save() {
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      po_id: form.po_id || null,
      invoice_number: form.invoice_number.trim(),
      vendor_ref: form.vendor_ref.trim(),
      amount: parseFloat(form.amount) || 0,
      currency: form.currency,
      invoice_date: form.invoice_date || null,
      period_from: form.period_from || null,
      period_to: form.period_to || null,
      notes: form.notes,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('invoices').insert({
        ...payload, status: 'received',
        status_history: [{ to:'received', by: currentUser?.name||'', byEmail: currentUser?.email||'', at: new Date().toISOString() }]
      })
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Invoice added','success')
    } else {
      const { error } = await supabase.from('invoices').update(payload).eq('id',(modal as Invoice).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Invoice saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function transition(inv: Invoice, to: InvoiceStatus) {
    const history = [...(inv.status_history || []), {
      from: inv.status, to, by: currentUser?.name||'', byEmail: currentUser?.email||'',
      at: new Date().toISOString()
    }]
    const { error } = await supabase.from('invoices').update({ status: to, status_history: history }).eq('id', inv.id)
    if (error) { toast(error.message,'error'); return }
    toast(`Moved to ${to}`, 'success'); load()
  }

  async function del(inv: Invoice) {
    if (!confirm(`Delete invoice ${inv.invoice_number || inv.id.slice(0,8)}?`)) return
    await supabase.from('invoices').delete().eq('id', inv.id)
    toast('Deleted','info'); load()
  }

  const filtered = invoices.filter(i => statusFilter === 'all' || i.status === statusFilter)
  const totalValue = filtered.reduce((s, i) => s + (i.amount || 0), 0)
  function exportCSV() {
    downloadCSV(
      [
        ['Invoice #','Vendor','Date','Due Date','Amount','Currency','Status','Notes'],
        ...invoices.map(i => [i.invoice_number||'', i.vendor_ref||'', i.invoice_date||'', i.due_date||'', i.amount||0, i.currency||'AUD', i.status||'', i.notes||''])
      ],
      'invoices_'+(activeProject?.name||'project')
    )
  }

  const fmtMoney = (n: number) => '$' + n.toLocaleString('en-AU', {minimumFractionDigits:0,maximumFractionDigits:0})

  function nextStatus(status: InvoiceStatus): InvoiceStatus|null {
    const idx = STATUS_FLOW.indexOf(status)
    return idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx+1] : null
  }

  return (
    <div style={{padding:'24px',maxWidth:'1200px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Invoices</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{invoices.length} invoices · {fmtMoney(invoices.reduce((s,i)=>s+(i.amount||0),0))} total</p>
        </div>
        <div style={{display:"flex",gap:"8px"}}><button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button><button className="btn btn-primary" onClick={openNew}>+ New Invoice</button></div>
      </div>

      {/* Status filter + summary */}
      <div style={{display:'flex',gap:'8px',marginBottom:'16px',flexWrap:'wrap',alignItems:'center'}}>
        {(['all','received','checked','approved','paid','disputed'] as string[]).map(s => {
          const count = s === 'all' ? invoices.length : invoices.filter(i=>i.status===s).length
          return (
            <button key={s} className="btn btn-sm"
              style={{background:statusFilter===s?'var(--accent)':'var(--bg)',color:statusFilter===s?'#fff':'var(--text)'}}
              onClick={() => setStatusFilter(s)}>
              {s.charAt(0).toUpperCase()+s.slice(1)} ({count})
            </button>
          )
        })}
        {statusFilter !== 'all' && <span style={{fontSize:'12px',color:'var(--text3)',marginLeft:'8px'}}>{fmtMoney(totalValue)}</span>}
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">💳</div>
          <h3>No invoices</h3>
          <p>Add invoices to track costs against this project.</p>
        </div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead>
              <tr>
                <th>Invoice #</th><th>PO</th><th>Status</th>
                <th style={{textAlign:'right'}}>Amount</th>
                <th>Date</th><th>Period</th><th>Actions</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const sc = STATUS_COLORS[inv.status] || STATUS_COLORS.received
                const next = nextStatus(inv.status as InvoiceStatus)
                const po = inv.po as unknown as {po_number:string,vendor:string}|null
                return (
                  <tr key={inv.id}>
                    <td style={{fontFamily:'var(--mono)',fontWeight:500,fontSize:'12px'}}>{inv.invoice_number || '—'}</td>
                    <td style={{fontSize:'12px',color:'var(--text2)'}}>{po ? `${po.po_number||''} ${po.vendor||''}`.trim() : '—'}</td>
                    <td><span className="badge" style={sc}>{inv.status}</span></td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',fontWeight:600}}>{fmtMoney(inv.amount)}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{inv.invoice_date || '—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>
                      {inv.period_from && inv.period_to ? `${inv.period_from} → ${inv.period_to}` : '—'}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      {next && inv.status !== 'disputed' && (
                        <button className="btn btn-sm btn-primary" style={{fontSize:'11px',padding:'3px 8px'}} onClick={() => transition(inv, next)}>
                          → {next}
                        </button>
                      )}
                      {inv.status !== 'disputed' && inv.status !== 'paid' && (
                        <button className="btn btn-sm" style={{fontSize:'11px',padding:'3px 8px',marginLeft:'4px',color:'var(--red)'}}
                          onClick={() => transition(inv, 'disputed')}>Dispute</button>
                      )}
                      <button className="btn btn-sm" style={{fontSize:'11px',padding:'3px 8px',marginLeft:'4px'}}
                        onClick={() => setHistoryModal(inv)}>History</button>
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={() => openEdit(inv)}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={() => del(inv)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{maxWidth:'580px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'New Invoice' : 'Edit Invoice'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Invoice Number</label>
                  <input className="input" value={form.invoice_number} onChange={e=>setForm(f=>({...f,invoice_number:e.target.value}))} placeholder="e.g. INV-2026-001" autoFocus />
                </div>
                <div className="fg">
                  <label>Vendor Ref</label>
                  <input className="input" value={form.vendor_ref} onChange={e=>setForm(f=>({...f,vendor_ref:e.target.value}))} />
                </div>
              </div>
              <div className="fg">
                <label>Linked PO</label>
                <select className="input" value={form.po_id} onChange={e=>setForm(f=>({...f,po_id:e.target.value}))}>
                  <option value="">— No PO —</option>
                  {pos.map(po=><option key={po.id} value={po.id}>{po.po_number||'No PO#'} — {po.vendor}</option>)}
                </select>
              </div>
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Amount</label>
                  <input type="number" className="input" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0" />
                </div>
                <div className="fg">
                  <label>Currency</label>
                  <select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
                    {['AUD','EUR','USD','GBP'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Invoice Date</label>
                  <input type="date" className="input" value={form.invoice_date} onChange={e=>setForm(f=>({...f,invoice_date:e.target.value}))} />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Period From</label>
                  <input type="date" className="input" value={form.period_from} onChange={e=>setForm(f=>({...f,period_from:e.target.value}))} />
                </div>
                <div className="fg">
                  <label>Period To</label>
                  <input type="date" className="input" value={form.period_to} onChange={e=>setForm(f=>({...f,period_to:e.target.value}))} />
                </div>
              </div>
              <div className="fg">
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

      {/* History modal */}
      {historyModal && (
        <div className="modal-overlay" onClick={() => setHistoryModal(null)}>
          <div className="modal" style={{maxWidth:'480px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Invoice History: {historyModal.invoice_number}</h3>
              <button className="btn btn-sm" onClick={() => setHistoryModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {(historyModal.status_history || []).length === 0 ? (
                <p style={{color:'var(--text3)',fontSize:'13px'}}>No history recorded.</p>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                  {[...(historyModal.status_history || [])].reverse().map((h, i) => (
                    <div key={i} style={{display:'flex',gap:'12px',alignItems:'flex-start',padding:'8px',background:'var(--bg2)',borderRadius:'6px'}}>
                      <span className="badge" style={STATUS_COLORS[h.to] || STATUS_COLORS.received}>{h.to}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:'12px',fontWeight:500}}>{h.by || h.byEmail || 'System'}</div>
                        <div style={{fontSize:'11px',color:'var(--text3)'}}>{h.at ? new Date(h.at).toLocaleString() : ''}</div>
                        {h.note && <div style={{fontSize:'12px',color:'var(--text2)',marginTop:'2px'}}>{h.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
