import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { GlobalKollo } from '../../types'

const EMPTY = { kollo_id:'', vb_no:'', tv_no:'', crate_no:'', gross_kg:'', net_kg:'', pack_items:'' }

export function KollosPanel() {
  const { activeProject } = useAppStore()
  const [projectKollos, setProjectKollos] = useState<string[]>([])
  const [allKollos, setAllKollos] = useState<GlobalKollo[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|GlobalKollo>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [pkData, kolloData] = await Promise.all([
      supabase.from('project_kollos').select('kollo_id').eq('project_id',pid),
      supabase.from('global_kollos').select('*').order('kollo_id'),
    ])
    setProjectKollos((pkData.data||[]).map(r=>r.kollo_id))
    setAllKollos((kolloData.data||[]) as GlobalKollo[])
    setLoading(false)
  }

  async function save() {
    if (!form.kollo_id.trim()) return toast('Kollo ID required','error')
    setSaving(true)
    const kolloPayload = {
      kollo_id:form.kollo_id.trim(), vb_no:form.vb_no, tv_no:form.tv_no||null, crate_no:form.crate_no,
      gross_kg:form.gross_kg?parseFloat(form.gross_kg):null, net_kg:form.net_kg?parseFloat(form.net_kg):null,
      pack_items:form.pack_items, extra:{},
    }
    const { error:kErr } = await supabase.from('global_kollos').upsert(kolloPayload, {onConflict:'kollo_id'})
    if (kErr) { toast(kErr.message,'error'); setSaving(false); return }

    if (modal==='new') {
      const { error } = await supabase.from('project_kollos').upsert(
        { project_id:activeProject!.id, kollo_id:form.kollo_id.trim() }, { onConflict:'project_id,kollo_id', ignoreDuplicates:true }
      )
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Kollo added','success')
    } else {
      toast('Kollo updated','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function removeKollo(kolloId: string) {
    if (!confirm(`Remove kollo ${kolloId} from project?`)) return
    await supabase.from('project_kollos').delete().eq('project_id',activeProject!.id).eq('kollo_id',kolloId)
    toast('Removed','info'); load()
  }

  function openEdit(k: GlobalKollo) {
    setForm({ kollo_id:k.kollo_id, vb_no:k.vb_no, tv_no:k.tv_no||'', crate_no:k.crate_no,
      gross_kg:k.gross_kg?.toString()||'', net_kg:k.net_kg?.toString()||'', pack_items:k.pack_items||'' })
    setModal(k)
  }

  const myKollos = allKollos.filter(k=>projectKollos.includes(k.kollo_id))
  const filtered = myKollos.filter(k=>!search || k.kollo_id.toLowerCase().includes(search.toLowerCase()) || (k.tv_no||'').includes(search) || (k.vb_no||'').toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{padding:'24px',maxWidth:'1000px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Kollos (Packing Crates)</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{projectKollos.length} kollos on this project</p>
        </div>
        <button className="btn btn-primary" onClick={()=>{setForm(EMPTY);setModal('new')}}>+ Add Kollo</button>
      </div>

      <input className="input" style={{maxWidth:'240px',marginBottom:'16px'}} placeholder="Search kollo ID, TV, VB..." value={search} onChange={e=>setSearch(e.target.value)} />

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length===0 ? (
        <div className="empty-state"><div className="icon">📦</div><h3>No kollos</h3><p>Add packing crate records for SE AG tooling shipments.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>Kollo ID</th><th>VB No.</th><th>TV No.</th><th>Crate No.</th><th style={{textAlign:'right'}}>Gross kg</th><th style={{textAlign:'right'}}>Net kg</th><th>Contents</th><th></th></tr></thead>
            <tbody>
              {filtered.map(k=>(
                <tr key={k.kollo_id}>
                  <td style={{fontFamily:'var(--mono)',fontWeight:600}}>{k.kollo_id}</td>
                  <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{k.vb_no||'—'}</td>
                  <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{k.tv_no?`TV${k.tv_no}`:'—'}</td>
                  <td style={{fontSize:'12px'}}>{k.crate_no||'—'}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{k.gross_kg??'—'}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{k.net_kg??'—'}</td>
                  <td style={{fontSize:'11px',color:'var(--text3)',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.pack_items||'—'}</td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <button className="btn btn-sm" onClick={()=>openEdit(k)}>Edit</button>
                    <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>removeKollo(k.kollo_id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'480px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'Add Kollo':'Edit Kollo'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg"><label>Kollo ID</label><input className="input" value={form.kollo_id} onChange={e=>setForm(f=>({...f,kollo_id:e.target.value}))} placeholder="e.g. K-482-001" autoFocus disabled={modal!=='new'} /></div>
                <div className="fg"><label>VB No.</label><input className="input" value={form.vb_no} onChange={e=>setForm(f=>({...f,vb_no:e.target.value}))} /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>TV No.</label><input className="input" value={form.tv_no} onChange={e=>setForm(f=>({...f,tv_no:e.target.value}))} placeholder="e.g. 482" /></div>
                <div className="fg"><label>Crate No.</label><input className="input" value={form.crate_no} onChange={e=>setForm(f=>({...f,crate_no:e.target.value}))} /></div>
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
