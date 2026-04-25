import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import type { NrgTceLine } from '../../types'

const SOURCES = ['overhead','skilled'] as const

const EMPTY = {
  wbs_code:'', description:'', category:'', source:'overhead' as 'overhead'|'skilled',
  tce_total:0, item_id:'', work_order:'', contract_scope:'', line_type:'', kpi_included:false, details:{} as Record<string,unknown>
}

export function NrgTcePanel() {
  const { activeProject } = useAppStore()
  const [lines, setLines] = useState<NrgTceLine[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|NrgTceLine>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('nrg_tce_lines').select('*')
      .eq('project_id', activeProject!.id).order('wbs_code')
    setLines((data||[]) as NrgTceLine[])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setModal('new') }
  function openEdit(l: NrgTceLine) {
    setForm({ wbs_code:l.wbs_code, description:l.description, category:l.category,
      source:l.source, tce_total:l.tce_total, item_id:l.item_id||'', details:l.details as Record<string,unknown>,
      work_order:l.work_order||'', contract_scope:l.contract_scope||'', line_type:l.line_type||'', kpi_included:!!l.kpi_included })
    setModal(l)
  }

  async function save() {
    if (!form.description.trim() && !form.wbs_code.trim()) return toast('Description or WBS required','error')
    setSaving(true)
    const payload = { project_id:activeProject!.id, wbs_code:form.wbs_code, description:form.description,
      category:form.category, source:form.source, tce_total:form.tce_total, item_id:form.item_id||null, work_order:form.work_order||null, contract_scope:form.contract_scope||null, line_type:form.line_type||null, kpi_included:form.kpi_included }
    if (modal==='new') {
      const { error } = await supabase.from('nrg_tce_lines').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('TCE line added','success')
    } else {
      const { error } = await supabase.from('nrg_tce_lines').update(payload).eq('id',(modal as NrgTceLine).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  function exportCSV() {
    downloadCSV(
      [['Item ID','Description','Source','WBS','TCE Total'],
       ...lines.map(l => [l.item_id||'', l.description||'', l.source||'', l.wbs_code||'', l.tce_total||0])],
      'nrg_tce_'+(activeProject?.name||'project')
    )
  }

  async function del(l: NrgTceLine) {
    if (!confirm(`Delete "${l.description}"?`)) return
    await supabase.from('nrg_tce_lines').delete().eq('id',l.id)
    toast('Deleted','info'); load()
  }

  const filtered = lines
    .filter(l => sourceFilter==='all' || l.source===sourceFilter)
    .filter(l => !search || l.description.toLowerCase().includes(search.toLowerCase()) || l.wbs_code.toLowerCase().includes(search.toLowerCase()))

  const totalTce = filtered.reduce((s,l) => s+(l.tce_total||0), 0)
  const fmt = (n:number) => '$'+n.toLocaleString('en-AU',{minimumFractionDigits:0})

  return (
    <div style={{padding:'24px',maxWidth:'1100px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>NRG TCE Register</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{lines.length} lines · Total {fmt(totalTce)}</p>
        </div>
        <div style={{display:"flex",gap:"8px"}}><button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button><button className="btn btn-primary" onClick={openNew}>+ Add Line</button></div>
      </div>

      <div style={{display:'flex',gap:'8px',marginBottom:'16px',flexWrap:'wrap',alignItems:'center'}}>
        <input className="input" style={{maxWidth:'240px'}} placeholder="Search description, WBS..." value={search} onChange={e=>setSearch(e.target.value)} />
        {(['all','overhead','skilled'] as string[]).map(s => (
          <button key={s} className="btn btn-sm"
            style={{background:sourceFilter===s?'var(--accent)':'var(--bg)',color:sourceFilter===s?'#fff':'var(--text)'}}
            onClick={()=>setSourceFilter(s)}>
            {s.charAt(0).toUpperCase()+s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length===0 ? (
        <div className="empty-state"><div className="icon">📋</div><h3>No TCE lines</h3><p>Add NRG TCE overhead and skilled labour lines.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>WBS</th><th>Description</th><th>Category</th><th>Source</th><th style={{textAlign:'right'}}>TCE Total</th><th></th></tr></thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id}>
                  <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{l.wbs_code||'—'}</td>
                  <td style={{fontWeight:500,maxWidth:'280px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.description||'—'}</td>
                  <td style={{fontSize:'12px',color:'var(--text2)'}}>{l.category||'—'}</td>
                  <td>
                    <span className="badge" style={l.source==='skilled'?{bg:'#dbeafe',color:'#1e40af'}:{bg:'#f1f5f9',color:'#64748b'} as {bg:string,color:string}}>
                      {l.source}
                    </span>
                  </td>
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',fontWeight:600}}>{fmt(l.tce_total||0)}</td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <button className="btn btn-sm" onClick={()=>openEdit(l)}>Edit</button>
                    <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>del(l)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" style={{maxWidth:'520px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'Add TCE Line':'Edit TCE Line'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg"><label>Item ID</label><input className="input" value={form.item_id} onChange={e=>setForm(f=>({...f,item_id:e.target.value}))} placeholder="TasTK ID" /></div>
                <div className="fg"><label>Source</label>
                  <select className="input" value={form.source} onChange={e=>setForm(f=>({...f,source:e.target.value as 'overhead'|'skilled'}))}>
                    {SOURCES.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg"><label>Description</label><input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} autoFocus /></div>
              <div className="fg-row">
                <div className="fg"><label>WBS Code</label><input className="input" value={form.wbs_code} onChange={e=>setForm(f=>({...f,wbs_code:e.target.value}))} /></div>
                <div className="fg"><label>Category</label><input className="input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} placeholder="e.g. Mechanical, Electrical" /></div>
              </div>
              <div className="fg"><label>TCE Total ($)</label><input type="number" className="input" value={form.tce_total||''} onChange={e=>setForm(f=>({...f,tce_total:parseFloat(e.target.value)||0}))} /></div><div className="fg-row"><div className="fg"><label>Work Order</label><input className="input" value={form.work_order} onChange={e=>setForm(f=>({...f,work_order:e.target.value}))} placeholder="WO number" /></div><div className="fg"><label>Contract Scope</label><input className="input" value={form.contract_scope} onChange={e=>setForm(f=>({...f,contract_scope:e.target.value}))} placeholder="Service order / scope ref" /></div></div><div className="fg-row"><div className="fg"><label>Line Type</label><input className="input" value={form.line_type} onChange={e=>setForm(f=>({...f,line_type:e.target.value}))} placeholder="e.g. Labour, Materials, Overhead" /></div><div className="fg" style={{display:'flex',alignItems:'center',gap:'8px',paddingTop:'20px'}}><label style={{marginBottom:0}}><input type="checkbox" checked={form.kpi_included} onChange={e=>setForm(f=>({...f,kpi_included:e.target.checked}))} style={{marginRight:'6px',accentColor:'var(--accent)'}}/>KPI Included</label></div></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
