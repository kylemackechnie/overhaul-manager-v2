import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'
import type { GlobalTV, GlobalDepartment } from '../../types'

interface Site { id: string; name: string }

export function GlobalToolingPanel() {
  const [tvs, setTvs] = useState<GlobalTV[]>([])
  const [depts, setDepts] = useState<GlobalDepartment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sites, setSites] = useState<Site[]>([])
  const [siteFilter, setSiteFilter] = useState('')
  const [modal, setModal] = useState<null|'new'|GlobalTV>(null)
  const [form, setForm] = useState({ tv_no:'', header_name:'', department_id:'', gross_kg:'', net_kg:'', replacement_value_eur:'', pack_items:'', site_id:'' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [tvData, deptData, siteData] = await Promise.all([
      supabase.from('global_tvs').select('*,department:global_departments(id,name),site:sites(id,name)').order('tv_no'),
      supabase.from('global_departments').select('*').order('name'),
      supabase.from('sites').select('id,name').order('name'),
    ])
    setTvs((tvData.data||[]) as GlobalTV[])
    setDepts((deptData.data||[]) as GlobalDepartment[])
    setSites((siteData.data||[]) as Site[])
    setLoading(false)
  }

  function openEdit(tv: GlobalTV) {
    setForm({ tv_no:tv.tv_no, header_name:tv.header_name, department_id:tv.department_id||'', gross_kg:tv.gross_kg?.toString()||'', net_kg:tv.net_kg?.toString()||'', replacement_value_eur:(tv as typeof tv & {replacement_value_eur?:number}).replacement_value_eur?.toString()||'', pack_items:tv.pack_items||'', site_id:(tv as typeof tv & {site_id?:string}).site_id||'' })
    setModal(tv)
  }

  async function save() {
    if (!form.tv_no.trim()) return toast('TV number required','error')
    setSaving(true)
    const payload = { tv_no:form.tv_no.trim(), header_name:form.header_name, department_id:form.department_id||null, gross_kg:form.gross_kg?parseFloat(form.gross_kg):null, net_kg:form.net_kg?parseFloat(form.net_kg):null, replacement_value_eur:form.replacement_value_eur?parseFloat(form.replacement_value_eur):null, pack_items:form.pack_items, site_id:form.site_id||null, extra:{} }
    if (modal==='new') {
      const { error } = await supabase.from('global_tvs').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('TV added to global register','success')
    } else {
      const { error } = await supabase.from('global_tvs').update({ header_name:form.header_name, department_id:form.department_id||null, gross_kg:form.gross_kg?parseFloat(form.gross_kg):null, net_kg:form.net_kg?parseFloat(form.net_kg):null, replacement_value_eur:form.replacement_value_eur?parseFloat(form.replacement_value_eur):null, pack_items:form.pack_items }).eq('id',(modal as GlobalTV).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  const filtered = tvs.filter(tv=>(!search||tv.tv_no.includes(search)||(tv.header_name||'').toLowerCase().includes(search.toLowerCase()))&&(!siteFilter||(tv as typeof tv & {site_id?:string}).site_id===siteFilter))

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Global Tooling Register</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{tvs.length} TVs in global register</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <select className="input" style={{width:'180px'}} value={siteFilter} onChange={e=>setSiteFilter(e.target.value)}>
            <option value=''>All sites</option>
            {sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn btn-primary" onClick={()=>{setForm({tv_no:'',header_name:'',department_id:'',gross_kg:'',net_kg:'',replacement_value_eur:'',pack_items:'',site_id:''});setModal('new')}}>+ Add TV</button>
        </div>
      </div>

      <input className="input" style={{maxWidth:'240px',marginBottom:'16px'}} placeholder="Search TV no. or name..." value={search} onChange={e=>setSearch(e.target.value)} />

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length===0 ? (
        <div className="empty-state"><div className="icon">🧰</div><h3>No TVs in global register</h3><p>TVs are added automatically when linked to projects, or manually here.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>TV No.</th><th>Site</th><th>Name / Header</th><th>Department</th><th style={{textAlign:'right'}}>Gross kg</th><th style={{textAlign:'right'}}>Net kg</th><th>Contents</th><th></th></tr></thead>
            <tbody>
              {filtered.map(tv => {
                const dept = tv.department as unknown as GlobalDepartment|null
                return (
                  <tr key={tv.tv_no}>
                    <td style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:'14px'}}>TV{tv.tv_no}</td>
                    <td style={{fontSize:'11px',color:'var(--text3)'}}>{(tv as typeof tv & {site?:{name:string}}).site?.name||'—'}</td>
                    <td style={{fontWeight:500}}>{tv.header_name||'—'}</td>
                    <td style={{fontSize:'12px',color:'var(--text2)'}}>{dept?.name||'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{tv.gross_kg??'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{tv.net_kg??'—'}</td>
                    <td style={{fontSize:'11px',color:'var(--text3)',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tv.pack_items||'—'}</td>
                    <td><button className="btn btn-sm" onClick={()=>openEdit(tv)}>Edit</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" style={{maxWidth:'480px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'Add TV to Global Register':'Edit TV'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg"><label>TV Number</label><input className="input" value={form.tv_no} onChange={e=>setForm(f=>({...f,tv_no:e.target.value}))} disabled={modal!=='new'} autoFocus /></div>
                <div className="fg" style={{flex:2}}><label>Header Name</label><input className="input" value={form.header_name} onChange={e=>setForm(f=>({...f,header_name:e.target.value}))} /></div>
              </div>
              <div className="fg"><label>Site *</label>
                <select className="input" value={form.site_id} onChange={e=>setForm(f=>({...f,site_id:e.target.value}))}>
                  <option value="">— Select Site —</option>
                  {sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <div style={{fontSize:'10px',color:'var(--text3)',marginTop:'3px'}}>TV numbers are site-scoped — TV110 at NRG is different to TV110 at Stanwell</div>
              </div>
              <div className="fg"><label>Department</label>
                <select className="input" value={form.department_id} onChange={e=>setForm(f=>({...f,department_id:e.target.value}))}>
                  <option value="">— No Department —</option>
                  {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Gross kg</label><input type="number" className="input" value={form.gross_kg} onChange={e=>setForm(f=>({...f,gross_kg:e.target.value}))} /></div>
                <div className="fg"><label>Net kg</label><input type="number" className="input" value={form.net_kg} onChange={e=>setForm(f=>({...f,net_kg:e.target.value}))} /></div>
              </div>
              <div className="fg"><label>Pack Items / Contents</label><textarea className="input" rows={2} value={form.pack_items} onChange={e=>setForm(f=>({...f,pack_items:e.target.value}))} style={{resize:'vertical'}} /></div>
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
