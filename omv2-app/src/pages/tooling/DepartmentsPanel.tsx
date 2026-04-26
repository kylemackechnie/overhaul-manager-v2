import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'
import type { GlobalDepartment } from '../../types'

const EMPTY = { name:'', rates:{ rentalPct: 2, rateUnit: 'weekly' as 'weekly'|'daily'|'monthly', gmPct: 15 } }

export function DepartmentsPanel() {
  const [depts, setDepts] = useState<GlobalDepartment[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|GlobalDepartment>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('global_departments').select('*').order('name')
    setDepts((data||[]) as GlobalDepartment[])
    setLoading(false)
  }

  function openNew() { setForm(EMPTY); setModal('new') }
  function openEdit(d: GlobalDepartment) {
    const rates = d.rates as Record<string,unknown>
    setForm({ name:d.name, rates:{ rentalPct: Number(rates.rentalPct)||2, rateUnit: (String(rates.rateUnit||'weekly')) as 'weekly'|'daily'|'monthly', gmPct: Number(rates.gmPct)||15 } })
    setModal(d)
  }

  async function save() {
    if (!form.name.trim()) return toast('Department name required','error')
    setSaving(true)
    const payload = { name:form.name.trim(), rates:form.rates }
    if (modal==='new') {
      const { error } = await supabase.from('global_departments').insert(payload)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Department added','success')
    } else {
      const { error } = await supabase.from('global_departments').update(payload).eq('id',(modal as GlobalDepartment).id)
      if (error) { toast(error.message,'error'); setSaving(false); return }
      toast('Saved','success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(d: GlobalDepartment) {
    if (!confirm(`Delete department "${d.name}"?`)) return
    await supabase.from('global_departments').delete().eq('id',d.id)
    toast('Deleted','info'); load()
  }

  return (
    <div style={{padding:'24px',maxWidth:'800px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>SE AG Departments</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{depts.length} departments (global)</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Department</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : depts.length===0 ? (
        <div className="empty-state"><div className="icon">🏢</div><h3>No departments</h3><p>Add SE AG tooling departments with day rates.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>Department</th><th style={{textAlign:'right'}}>Rental %</th><th>Rate Unit</th><th style={{textAlign:'right'}}>GM %</th><th></th></tr></thead>
            <tbody>
              {depts.map(d => {
                const r = d.rates as Record<string,unknown>
                return (
                  <tr key={d.id}>
                    <td style={{fontWeight:500}}>{d.name}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{Number(r.rentalPct||0)}%</td>
                    <td style={{fontSize:'12px',color:'var(--text3)'}}>{String(r.rateUnit||'weekly')}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{Number(r.gmPct||0)}%</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={()=>openEdit(d)}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>del(d)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" style={{maxWidth:'420px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal==='new'?'Add Department':'Edit Department'}</h3>
              <button className="btn btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg"><label>Department Name</label><input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Balancing Tools" autoFocus /></div>
              <div className="fg-row">
                <div className="fg"><label>Rental % Factor</label><input type="number" className="input" value={form.rates.rentalPct||''} step={0.1} min={0} onChange={e=>setForm(f=>({...f,rates:{...f.rates,rentalPct:parseFloat(e.target.value)||0}}))} /></div>
                <div className="fg"><label>Rate Unit</label>
                  <select className="input" value={form.rates.rateUnit} onChange={e=>setForm(f=>({...f,rates:{...f.rates,rateUnit:e.target.value as 'weekly'|'daily'|'monthly'}}))}>
                    {['weekly','daily','monthly'].map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="fg"><label>GM %</label><input type="number" className="input" value={form.rates.gmPct||''} step={0.5} min={0} onChange={e=>setForm(f=>({...f,rates:{...f.rates,gmPct:parseFloat(e.target.value)||0}}))} /></div>
              </div>
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
