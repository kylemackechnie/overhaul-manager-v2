import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'

interface GlobalKit { id: string; name: string; machine_type: string; parts: {id:string;materialNo:string;description:string;qty:number}[]; created_at: string; updated_at: string }

export function GlobalKitsPanel() {
  const [kits, setKits] = useState<GlobalKit[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string|null>(null)
  const [modal, setModal] = useState<null|'new'|GlobalKit>(null)
  const [form, setForm] = useState({ name:'', machine_type:'' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('global_kits').select('*').order('name')
    setKits((data||[]) as GlobalKit[])
    setLoading(false)
  }

  async function save() {
    if (!form.name.trim()) return toast('Kit name required','error')
    setSaving(true)
    const payload = { name:form.name.trim(), machine_type:form.machine_type, parts:[] }
    if (modal==='new') {
      const { error } = await supabase.from('global_kits').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Kit added','success')
    } else {
      const { error } = await supabase.from('global_kits').update({name:form.name.trim(),machine_type:form.machine_type}).eq('id',(modal as GlobalKit).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(k: GlobalKit) {
    if (!confirm(`Delete kit "${k.name}"?`)) return
    await supabase.from('global_kits').delete().eq('id',k.id)
    toast('Deleted','info'); load()
  }

  const filtered = kits.filter(k=>!search || k.name.toLowerCase().includes(search.toLowerCase()) || (k.machine_type||'').toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{padding:'24px',maxWidth:'900px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Global Kits</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{kits.length} kits (global register)</p>
        </div>
        <button className="btn btn-primary" onClick={()=>{setForm({name:'',machine_type:''});setModal('new')}}>+ New Kit</button>
      </div>

      <input className="input" style={{maxWidth:'240px',marginBottom:'16px'}} placeholder="Search kit or machine type..." value={search} onChange={e=>setSearch(e.target.value)} />

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length===0 ? (
        <div className="empty-state"><div className="icon">📦</div><h3>No kits</h3><p>Kits are reusable spare parts sets shared across projects.</p></div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {filtered.map(k => (
            <div key={k.id} className="card">
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600}}>{k.name}</div>
                  {k.machine_type && <div style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{k.machine_type}</div>}
                </div>
                <div style={{fontSize:'12px',color:'var(--text3)'}}>{(k.parts||[]).length} parts</div>
                <button className="btn btn-sm" onClick={()=>setExpanded(expanded===k.id?null:k.id)}>
                  {expanded===k.id?'▲ Collapse':'▼ Parts'}
                </button>
                <button className="btn btn-sm" onClick={()=>{setForm({name:k.name,machine_type:k.machine_type});setModal(k)}}>Edit</button>
                <button className="btn btn-sm" style={{color:'var(--red)'}} onClick={()=>del(k)}>✕</button>
              </div>
              {expanded===k.id && (k.parts||[]).length>0 && (
                <div style={{marginTop:'12px',paddingTop:'12px',borderTop:'1px solid var(--border)'}}>
                  <table style={{fontSize:'12px'}}>
                    <thead><tr><th>Material No.</th><th>Description</th><th style={{textAlign:'right'}}>Qty</th></tr></thead>
                    <tbody>
                      {k.parts.map((p,i)=>(
                        <tr key={i}>
                          <td style={{fontFamily:'var(--mono)'}}>{p.materialNo||'—'}</td>
                          <td>{p.description||'—'}</td>
                          <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{p.qty||1}</td>
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
          <div className="modal" style={{maxWidth:'400px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'New Kit':'Edit Kit'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg"><label>Kit Name</label><input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} autoFocus /></div>
              <div className="fg"><label>Machine Type</label><input className="input" value={form.machine_type} onChange={e=>setForm(f=>({...f,machine_type:e.target.value}))} placeholder="e.g. SGT-700, SGT-800" /></div>
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
