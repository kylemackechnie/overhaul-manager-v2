import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Variation } from '../../types'

const STATUSES = ['draft','submitted','approved','rejected','withdrawn'] as const
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  draft:{bg:'#f1f5f9',color:'#64748b'}, submitted:{bg:'#dbeafe',color:'#1e40af'},
  approved:{bg:'#d1fae5',color:'#065f46'}, rejected:{bg:'#fee2e2',color:'#7f1d1d'},
  withdrawn:{bg:'#e5e7eb',color:'#374151'},
}

interface LineItem { id: string; description: string; wbs: string; cost: number; sell: number }
const mkLine = (): LineItem => ({ id: Math.random().toString(36).slice(2), description: '', wbs: '', cost: 0, sell: 0 })
const EMPTY = { number:'', title:'', status:'draft' as const, scope:'', submitted_date:'', approved_date:'', customer_ref:'', notes:'', lines: [mkLine()] }

export function VariationsPanel() {
  const { activeProject } = useAppStore()
  const [variations, setVariations] = useState<Variation[]>([])
  const [wbsList, setWbsList] = useState<{code:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Variation>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string|null>(null)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const [varData, wbsData] = await Promise.all([
      supabase.from('variations').select('*').eq('project_id', activeProject!.id).order('number'),
      supabase.from('wbs_list').select('code').eq('project_id', activeProject!.id).order('code'),
    ])
    setVariations((varData.data || []) as Variation[])
    setWbsList((wbsData.data || []) as {code:string}[])
    setLoading(false)
  }

  async function cycleStatus(v: Variation) {
    const order = ['draft','submitted','approved','rejected']
    const cur = order.indexOf(v.status); const next = order[(cur + 1) % order.length]
    await supabase.from('variations').update({ status: next }).eq('id', v.id)
    load()
  }

  function openNew() {
    const nextNum = 'VN-' + String(variations.length + 1).padStart(3, '0')
    setForm({ ...EMPTY, number: nextNum, lines: [mkLine()] })
    setModal('new')
  }

  function openEdit(v: Variation) {
    const lines = (v.line_items as LineItem[] | null)
    setForm({
      number: v.number, title: v.title, status: v.status as typeof EMPTY['status'],
      scope: v.scope, submitted_date: v.submitted_date || '', approved_date: v.approved_date || '',
      customer_ref: (v as {customer_ref?:string}).customer_ref || '',
      notes: v.notes, lines: (lines && lines.length) ? lines : [mkLine()],
    })
    setModal(v)
  }

  function setLine(idx: number, field: keyof LineItem, value: string | number) {
    setForm(f => {
      const lines = f.lines.map((l, i) => {
        if (i !== idx) return l
        const updated = { ...l, [field]: value }
        if (field === 'cost' && l.sell === 0) {
          const gm = activeProject?.default_gm || 15
          updated.sell = parseFloat(((value as number) / (1 - gm / 100)).toFixed(2))
        }
        return updated
      })
      return { ...f, lines }
    })
  }

  const sumCost = (lines: LineItem[]) => lines.reduce((s, l) => s + (l.cost || 0), 0)
  const sumSell = (lines: LineItem[]) => lines.reduce((s, l) => s + (l.sell || 0), 0)

  async function save() {
    if (!form.number.trim()) return toast('Variation number required', 'error')
    setSaving(true)
    const lines = form.lines.filter(l => l.description.trim())
    const payload = {
      project_id: activeProject!.id,
      number: form.number.trim(), title: form.title.trim(), status: form.status,
      value: sumSell(lines) || null, scope: form.scope,
      submitted_date: form.submitted_date || null, approved_date: form.approved_date || null,
      notes: form.notes, line_items: lines,
    }
    const isNew = modal === 'new'
    const { error } = isNew
      ? await supabase.from('variations').insert(payload)
      : await supabase.from('variations').update(payload).eq('id', (modal as Variation).id)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast(isNew ? 'Variation created' : 'Saved', 'success')
    setSaving(false); setModal(null); load()
  }

  async function del(v: Variation) {
    if (!confirm(`Delete variation ${v.number}?`)) return
    await supabase.from('variations').delete().eq('id', v.id)
    toast('Deleted', 'info'); load()
  }

  function exportCSV() {
    const rows = [['VN #','Title','Status','Cost','Sell','Submitted','Approved']]
    variations.forEach(v => {
      const lines = (v.line_items as LineItem[] | null) || []
      rows.push([v.number, v.title||'', v.status, String(sumCost(lines)), String(sumSell(lines)), v.submitted_date||'', v.approved_date||''])
    })
    const csv = rows.map(r => r.map(c => c.includes(',') ? `"${c}"` : c).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = `variations_${activeProject?.name||'project'}.csv`; a.click()
  }

  const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'
  const totalApproved = variations.filter(v=>v.status==='approved').reduce((s,v)=>s+(v.value||0),0)
  const totalSubmitted = variations.filter(v=>v.status==='submitted').reduce((s,v)=>s+(v.value||0),0)

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Contract Variations</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {variations.length} variations · {fmt(totalApproved)} approved · {fmt(totalSubmitted)} pending
          </p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button className="btn btn-sm" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
          <button className="btn btn-primary" onClick={openNew}>+ New Variation</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : variations.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📝</div>
          <h3>No variations</h3>
          <p>Track contract variations and change orders here.</p>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {variations.map(v => {
            const sc = STATUS_COLORS[v.status] || STATUS_COLORS.draft
            const lines = (v.line_items as LineItem[] | null) || []
            const sell = sumSell(lines); const cost = sumCost(lines)
            const isExpanded = expandedId === v.id
            return (
              <div key={v.id} className="card" style={{padding:0,overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'12px 16px',cursor:'pointer'}} onClick={()=>setExpandedId(isExpanded?null:v.id)}>
                  <span style={{fontFamily:'var(--mono)',fontWeight:700,color:'var(--accent)',minWidth:'80px'}}>{v.number}</span>
                  <span style={{flex:1,fontWeight:500}}>{v.title||'—'}</span>
                  <span className="badge" style={{...sc,cursor:'pointer'}} title="Click to advance" onClick={()=>cycleStatus(v)}>{v.status}</span>
                  {sell > 0 && <span style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--green)'}}>{fmt(sell)}</span>}
                  {cost > 0 && cost !== sell && <span style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>cost {fmt(cost)}</span>}
                  <span style={{fontSize:'12px',color:'var(--text3)'}}>{v.submitted_date||'—'}</span>
                  <div style={{display:'flex',gap:'4px'}} onClick={e=>e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={()=>openEdit(v)}>Edit</button>
                    <button className="btn btn-sm" style={{color:'var(--red)'}} onClick={()=>del(v)}>✕</button>
                  </div>
                  <span style={{color:'var(--text3)',fontSize:'11px'}}>{isExpanded?'▲':'▼'}</span>
                </div>
                {isExpanded && (
                  <div style={{borderTop:'1px solid var(--border)',padding:'12px 16px',background:'var(--bg3)'}}>
                    {v.scope && <p style={{fontSize:'13px',color:'var(--text2)',marginBottom:'10px'}}>{v.scope}</p>}
                    {lines.length > 0 ? (
                      <table style={{fontSize:'12px',width:'100%'}}>
                        <thead><tr><th>Description</th><th>WBS</th><th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Sell</th></tr></thead>
                        <tbody>
                          {lines.map((l,i)=>(
                            <tr key={i}>
                              <td>{l.description}</td>
                              <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{l.wbs||'—'}</td>
                              <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(l.cost)}</td>
                              <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>{fmt(l.sell)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p style={{fontSize:'12px',color:'var(--text3)'}}>No line items</p>}
                    {v.notes && <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'8px',fontStyle:'italic'}}>{v.notes}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" style={{maxWidth:'720px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'New Variation':`Edit ${(modal as Variation).number}`}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg"><label>VN Number *</label><input className="input" value={form.number} onChange={e=>setForm(f=>({...f,number:e.target.value}))} autoFocus /></div>
                <div className="fg" style={{flex:2}}><label>Title</label><input className="input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Short description" /></div>
                <div className="fg"><label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value as typeof EMPTY['status']}))}>
                    {STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Submitted</label><input type="date" className="input" value={form.submitted_date} onChange={e=>setForm(f=>({...f,submitted_date:e.target.value}))} /></div>
                <div className="fg"><label>Approved</label><input type="date" className="input" value={form.approved_date} onChange={e=>setForm(f=>({...f,approved_date:e.target.value}))} /></div>
                <div className="fg"><label>Customer Ref #</label><input className="input" value={form.customer_ref} onChange={e=>setForm(f=>({...f,customer_ref:e.target.value}))} placeholder="Optional" /></div>
              </div>
              <div className="fg"><label>Scope</label><textarea className="input" rows={2} value={form.scope} onChange={e=>setForm(f=>({...f,scope:e.target.value}))} placeholder="Describe scope of work..." style={{resize:'vertical'}} /></div>

              <div style={{marginTop:'14px'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                  <div style={{fontWeight:600,fontSize:'12px',color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Line Items</div>
                  <button className="btn btn-sm" onClick={()=>setForm(f=>({...f,lines:[...f.lines,mkLine()]}))}>+ Add Line</button>
                </div>
                <table style={{fontSize:'12px',width:'100%',borderCollapse:'collapse'}}>
                  <thead><tr style={{background:'var(--bg3)'}}>
                    <th style={{padding:'6px 8px',textAlign:'left'}}>Description</th>
                    <th style={{padding:'6px 8px',width:'150px'}}>WBS</th>
                    <th style={{padding:'6px 8px',width:'110px',textAlign:'right'}}>Cost ($)</th>
                    <th style={{padding:'6px 8px',width:'110px',textAlign:'right'}}>Sell ($)</th>
                    <th style={{width:'32px'}}></th>
                  </tr></thead>
                  <tbody>
                    {form.lines.map((l,i)=>(
                      <tr key={l.id}>
                        <td style={{padding:'3px 4px'}}><input className="input" style={{padding:'4px 6px',fontSize:'12px'}} value={l.description} onChange={e=>setLine(i,'description',e.target.value)} placeholder="Description" /></td>
                        <td style={{padding:'3px 4px'}}>
                          <select className="input" style={{padding:'4px 6px',fontSize:'11px'}} value={l.wbs} onChange={e=>setLine(i,'wbs',e.target.value)}>
                            <option value="">— WBS —</option>
                            {wbsList.map(w=><option key={w.code} value={w.code}>{w.code}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'3px 4px'}}><input type="number" className="input" style={{padding:'4px 6px',fontSize:'12px',textAlign:'right'}} value={l.cost||''} onChange={e=>setLine(i,'cost',parseFloat(e.target.value)||0)} placeholder="0" /></td>
                        <td style={{padding:'3px 4px'}}><input type="number" className="input" style={{padding:'4px 6px',fontSize:'12px',textAlign:'right'}} value={l.sell||''} onChange={e=>setLine(i,'sell',parseFloat(e.target.value)||0)} placeholder="0" /></td>
                        <td style={{padding:'3px 4px',textAlign:'center'}}><button className="btn btn-sm" style={{color:'var(--red)',padding:'2px 6px'}} onClick={()=>setForm(f=>({...f,lines:f.lines.filter((_,j)=>j!==i)}))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                  {form.lines.some(l=>l.description) && (
                    <tfoot><tr style={{background:'var(--bg3)',fontWeight:600}}>
                      <td colSpan={2} style={{padding:'6px 8px'}}>Total</td>
                      <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'var(--mono)'}}>{fmt(sumCost(form.lines))}</td>
                      <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--green)'}}>{fmt(sumSell(form.lines))}</td>
                      <td/>
                    </tr></tfoot>
                  )}
                </table>
              </div>
              <div className="fg" style={{marginTop:'12px'}}><label>Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} /></div>
            </div>
            <div className="modal-footer">
              {modal!=='new' && <button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{del(modal as Variation);setModal(null)}}>Delete</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
