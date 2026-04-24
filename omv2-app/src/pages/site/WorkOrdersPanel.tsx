import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { WorkOrder, WbsItem } from '../../types'

const STATUSES = ['open','in_progress','complete','on_hold','cancelled'] as const
const STATUS_COLORS: Record<string,{bg:string,color:string}> = {
  open:{bg:'#dbeafe',color:'#1e40af'}, in_progress:{bg:'#fef3c7',color:'#92400e'},
  complete:{bg:'#d1fae5',color:'#065f46'}, on_hold:{bg:'#f1f5f9',color:'#64748b'},
  cancelled:{bg:'#fee2e2',color:'#7f1d1d'},
}

const EMPTY = { wo_number:'', description:'', status:'open', wbs_code:'', budget_hours:'', actual_hours:0, notes:'' }

export function WorkOrdersPanel() {
  const { activeProject } = useAppStore()
  const [wos, setWos] = useState<WorkOrder[]>([])
  const [wbsList, setWbsList] = useState<WbsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|WorkOrder>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [woData, wbsData] = await Promise.all([
      supabase.from('work_orders').select('*').eq('project_id',pid).order('wo_number'),
      supabase.from('wbs_list').select('*').eq('project_id',pid).order('sort_order'),
    ])
    setWos((woData.data||[]) as WorkOrder[])
    setWbsList((wbsData.data||[]) as WbsItem[])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setModal('new') }
  function openEdit(wo: WorkOrder) {
    setForm({ wo_number:wo.wo_number, description:wo.description, status:wo.status,
      wbs_code:wo.wbs_code||'', budget_hours:wo.budget_hours?.toString()||'',
      actual_hours:wo.actual_hours, notes:wo.notes })
    setModal(wo)
  }

  async function save() {
    if (!form.wo_number.trim()) return toast('WO number required','error')
    setSaving(true)
    const payload = { project_id:activeProject!.id, wo_number:form.wo_number.trim(),
      description:form.description, status:form.status, wbs_code:form.wbs_code||null,
      budget_hours:form.budget_hours ? parseFloat(form.budget_hours) : null,
      actual_hours:form.actual_hours, notes:form.notes }
    if (modal==='new') {
      const { error } = await supabase.from('work_orders').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Work order created','success')
    } else {
      const { error } = await supabase.from('work_orders').update(payload).eq('id',(modal as WorkOrder).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(wo: WorkOrder) {
    if (!confirm(`Delete WO ${wo.wo_number}?`)) return
    await supabase.from('work_orders').delete().eq('id',wo.id)
    toast('Deleted','info'); load()
  }

  return (
    <div style={{ padding:'24px', maxWidth:'1000px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>Work Orders</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>{wos.length} work orders</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New WO</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : wos.length===0 ? (
        <div className="empty-state"><div className="icon">📋</div><h3>No work orders</h3><p>Add work orders to track job scope.</p></div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table>
            <thead><tr><th>WO #</th><th>Description</th><th>Status</th><th>WBS</th><th style={{textAlign:'right'}}>Budget Hrs</th><th style={{textAlign:'right'}}>Actual Hrs</th><th></th></tr></thead>
            <tbody>
              {wos.map(wo => {
                const sc = STATUS_COLORS[wo.status]||STATUS_COLORS.open
                const pct = wo.budget_hours && wo.actual_hours ? Math.round(wo.actual_hours/wo.budget_hours*100) : null
                return (
                  <tr key={wo.id}>
                    <td style={{ fontFamily:'var(--mono)', fontWeight:600 }}>{wo.wo_number}</td>
                    <td style={{ maxWidth:'240px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{wo.description||'—'}</td>
                    <td><span className="badge" style={sc}>{wo.status.replace('_',' ')}</span></td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'11px', color:'var(--text3)' }}>{wo.wbs_code||'—'}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontSize:'12px' }}>{wo.budget_hours??'—'}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontSize:'12px' }}>
                      {wo.actual_hours||0}
                      {pct!=null && <span style={{ fontSize:'10px', color: pct>100?'var(--red)':'var(--text3)', marginLeft:'4px' }}>({pct}%)</span>}
                    </td>
                    <td style={{ whiteSpace:'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => openEdit(wo)}>Edit</button>
                      <button className="btn btn-sm" style={{ marginLeft:'4px', color:'var(--red)' }} onClick={() => del(wo)}>✕</button>
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
          <div className="modal" style={{ maxWidth:'480px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new' ? 'New Work Order' : `Edit WO ${(modal as WorkOrder).wo_number}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg"><label>WO Number</label><input className="input" value={form.wo_number} onChange={e=>setForm(f=>({...f,wo_number:e.target.value}))} autoFocus /></div>
                <div className="fg"><label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {STATUSES.map(s=><option key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg"><label>Description</label><input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
              <div className="fg"><label>WBS Code</label>
                <select className="input" value={form.wbs_code} onChange={e=>setForm(f=>({...f,wbs_code:e.target.value}))}>
                  <option value="">— No WBS —</option>
                  {wbsList.map(w=><option key={w.id} value={w.code}>{w.code} {w.name?`— ${w.name}`:''}</option>)}
                </select>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Budget Hours</label><input type="number" className="input" value={form.budget_hours} onChange={e=>setForm(f=>({...f,budget_hours:e.target.value}))} placeholder="0" /></div>
                <div className="fg"><label>Actual Hours</label><input type="number" className="input" value={form.actual_hours} onChange={e=>setForm(f=>({...f,actual_hours:parseFloat(e.target.value)||0}))} /></div>
              </div>
              <div className="fg"><label>Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
