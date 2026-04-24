import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { WbsItem } from '../../types'

export function WBSPanel() {
  const { activeProject } = useAppStore()
  const [items, setItems] = useState<WbsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | WbsItem>(null)
  const [form, setForm] = useState({ code:'', name:'' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('wbs_list').select('*')
      .eq('project_id', activeProject!.id).order('sort_order').order('code')
    setItems((data || []) as WbsItem[])
    setLoading(false)
  }

  async function save() {
    if (!form.code.trim()) return toast('WBS code required', 'error')
    setSaving(true)
    const payload = { project_id: activeProject!.id, code: form.code.trim(), name: form.name.trim(), sort_order: items.length }
    if (modal === 'new') {
      const { error } = await supabase.from('wbs_list').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('WBS added', 'success')
    } else {
      const { error } = await supabase.from('wbs_list').update({code:form.code.trim(),name:form.name.trim()}).eq('id',(modal as WbsItem).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(item: WbsItem) {
    if (!confirm(`Delete WBS "${item.code}"?`)) return
    await supabase.from('wbs_list').delete().eq('id', item.id)
    toast('Deleted', 'info'); load()
  }

  const filtered = items.filter(i => !search || i.code.toLowerCase().includes(search.toLowerCase()) || i.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{padding:'24px',maxWidth:'900px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>WBS List</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{items.length} WBS codes</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({code:'',name:''}); setModal('new') }}>+ Add WBS</button>
      </div>

      <input className="input" style={{maxWidth:'300px',marginBottom:'16px'}} placeholder="Search code or name..." value={search} onChange={e=>setSearch(e.target.value)} />

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📍</div>
          <h3>No WBS codes</h3>
          <p>Add WBS codes for cost allocation.</p>
        </div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>WBS Code</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id}>
                  <td style={{fontFamily:'var(--mono)',fontSize:'12px',fontWeight:500}}>{item.code}</td>
                  <td style={{color:'var(--text2)'}}>{item.name || '—'}</td>
                  <td style={{textAlign:'right',whiteSpace:'nowrap'}}>
                    <button className="btn btn-sm" onClick={() => { setForm({code:item.code,name:item.name}); setModal(item) }}>Edit</button>
                    <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={() => del(item)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{maxWidth:'480px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add WBS Code' : 'Edit WBS Code'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>WBS Code</label>
                <input className="input" value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value}))} placeholder="e.g. 50OP-00138.P.01.02.01" autoFocus />
              </div>
              <div className="fg">
                <label>Description</label>
                <input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. SEA Labour & Allowances" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" style={{width:'14px',height:'14px'}}/> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
