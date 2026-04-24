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

const EMPTY = { number:'', title:'', status:'draft' as const, value:'', scope:'', submitted_date:'', approved_date:'', notes:'' }

export function VariationsPanel() {
  const { activeProject } = useAppStore()
  const [variations, setVariations] = useState<Variation[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Variation>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('variations').select('*')
      .eq('project_id', activeProject!.id).order('number')
    setVariations((data || []) as Variation[])
    setLoading(false)
  }

  function openNew() { setForm({...EMPTY}); setModal('new') }
  function openEdit(v: Variation) {
    setForm({
      number: v.number, title: v.title, status: v.status as typeof EMPTY['status'],
      value: v.value?.toString() || '', scope: v.scope,
      submitted_date: v.submitted_date || '', approved_date: v.approved_date || '',
      notes: v.notes,
    })
    setModal(v)
  }

  async function save() {
    if (!form.number.trim()) return toast('Variation number required','error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      number: form.number.trim(), title: form.title.trim(),
      status: form.status, value: form.value ? parseFloat(form.value) : null,
      scope: form.scope, submitted_date: form.submitted_date || null,
      approved_date: form.approved_date || null, notes: form.notes,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('variations').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Variation created','success')
    } else {
      const { error } = await supabase.from('variations').update(payload).eq('id',(modal as Variation).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(v: Variation) {
    if (!confirm(`Delete variation ${v.number}?`)) return
    await supabase.from('variations').delete().eq('id', v.id)
    toast('Deleted','info'); load()
  }

  const totalApproved = variations.filter(v=>v.status==='approved').reduce((s,v)=>s+(v.value||0),0)
  const fmtMoney = (n: number|null) => n != null ? '$' + n.toLocaleString('en-AU',{minimumFractionDigits:0}) : '—'

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Contract Variations</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>
            {variations.length} variations · {fmtMoney(totalApproved)} approved
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Variation</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : variations.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📝</div>
          <h3>No variations</h3>
          <p>Track contract variations and change orders here.</p>
        </div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead>
              <tr><th>VN #</th><th>Title</th><th>Status</th><th style={{textAlign:'right'}}>Value</th><th>Submitted</th><th>Approved</th><th></th></tr>
            </thead>
            <tbody>
              {variations.map(v => {
                const sc = STATUS_COLORS[v.status] || STATUS_COLORS.draft
                return (
                  <tr key={v.id}>
                    <td style={{fontFamily:'var(--mono)',fontWeight:600}}>{v.number}</td>
                    <td style={{fontWeight:500}}>{v.title || '—'}</td>
                    <td><span className="badge" style={sc}>{v.status}</span></td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{fmtMoney(v.value)}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{v.submitted_date || '—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--text3)'}}>{v.approved_date || '—'}</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={() => openEdit(v)}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={() => del(v)}>✕</button>
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
          <div className="modal" style={{maxWidth:'560px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new' ? 'New Variation' : `Edit VN ${(modal as Variation).number}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg">
                  <label>VN Number</label>
                  <input className="input" value={form.number} onChange={e=>setForm(f=>({...f,number:e.target.value}))} placeholder="e.g. VN-021" autoFocus />
                </div>
                <div className="fg" style={{flex:2}}>
                  <label>Title</label>
                  <input className="input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Short description" />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Status</label>
                  <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value as typeof EMPTY['status']}))}>
                    {STATUSES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Value ($)</label>
                  <input type="number" className="input" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))} placeholder="0" />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Submitted Date</label>
                  <input type="date" className="input" value={form.submitted_date} onChange={e=>setForm(f=>({...f,submitted_date:e.target.value}))} />
                </div>
                <div className="fg">
                  <label>Approved Date</label>
                  <input type="date" className="input" value={form.approved_date} onChange={e=>setForm(f=>({...f,approved_date:e.target.value}))} />
                </div>
              </div>
              <div className="fg">
                <label>Scope Description</label>
                <textarea className="input" rows={3} value={form.scope} onChange={e=>setForm(f=>({...f,scope:e.target.value}))} placeholder="Describe the scope of this variation..." style={{resize:'vertical'}} />
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
    </div>
  )
}
