import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface HardwareContract {
  vendor: string; contractRef: string; value: number; currency: string
  startDate: string; endDate: string; description: string; notes: string
  status: string
}

export function HardwareContractPanel() {
  const { activeProject, setActiveProject } = useAppStore()
  const [contract, setContract] = useState<HardwareContract|null>(null)
  const [form, setForm] = useState<HardwareContract>({ vendor:'', contractRef:'', value:0, currency:'AUD', startDate:'', endDate:'', description:'', notes:'', status:'active' })
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (activeProject?.hardware) {
      const hw = activeProject.hardware as {contract?: HardwareContract}
      if (hw.contract) { setContract(hw.contract); setForm(hw.contract) }
    }
  }, [activeProject?.id])

  async function save() {
    setSaving(true)
    const hw = { ...((activeProject!.hardware as unknown as Record<string,unknown>)||{}), contract: form }
    const { data, error } = await supabase.from('projects').update({ hardware: hw })
      .eq('id', activeProject!.id).select('*,site:sites(id,name)').single()
    if (error) { toast(error.message,'error'); setSaving(false); return }
    setActiveProject(data as typeof activeProject)
    setContract(form)
    setEditing(false)
    toast('Hardware contract saved','success')
    setSaving(false)
  }

  const fmt = (n:number) => '$'+n.toLocaleString('en-AU',{minimumFractionDigits:0})

  if (!contract && !editing) {
    return (
      <div style={{padding:'24px',maxWidth:'700px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Hardware Contract</h1>
          <button className="btn btn-primary" onClick={()=>setEditing(true)}>+ Add Contract</button>
        </div>
        <div className="empty-state"><div className="icon">🔧</div><h3>No hardware contract</h3><p>Add hardware supply contract details for this project.</p></div>
      </div>
    )
  }

  return (
    <div style={{padding:'24px',maxWidth:'700px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <h1 style={{fontSize:'18px',fontWeight:700}}>Hardware Contract</h1>
        {!editing && <button className="btn" onClick={()=>setEditing(true)}>Edit</button>}
      </div>

      {!editing && contract ? (
        <div className="card">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
            {[
              ['Vendor',contract.vendor], ['Contract Ref',contract.contractRef],
              ['Value',fmt(contract.value)], ['Currency',contract.currency],
              ['Start',contract.startDate], ['End',contract.endDate],
              ['Status',contract.status],
            ].map(([label,value]) => (
              <div key={label}>
                <div style={{fontSize:'11px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'2px'}}>{label}</div>
                <div style={{fontWeight:500}}>{String(value)||'—'}</div>
              </div>
            ))}
          </div>
          {contract.description && <div style={{marginTop:'16px',paddingTop:'16px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'11px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'4px'}}>Description</div>
            <p style={{fontSize:'13px',color:'var(--text2)'}}>{contract.description}</p>
          </div>}
          {contract.notes && <div style={{marginTop:'12px'}}>
            <div style={{fontSize:'11px',color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'4px'}}>Notes</div>
            <p style={{fontSize:'13px',color:'var(--text2)'}}>{contract.notes}</p>
          </div>}
        </div>
      ) : (
        <div className="card">
          <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
            <div className="fg-row">
              <div className="fg" style={{flex:2}}><label>Vendor</label><input className="input" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} autoFocus /></div>
              <div className="fg"><label>Contract Ref</label><input className="input" value={form.contractRef} onChange={e=>setForm(f=>({...f,contractRef:e.target.value}))} /></div>
            </div>
            <div className="fg-row">
              <div className="fg"><label>Contract Value</label><input type="number" className="input" value={form.value||''} onChange={e=>setForm(f=>({...f,value:parseFloat(e.target.value)||0}))} /></div>
              <div className="fg"><label>Currency</label>
                <select className="input" value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}>
                  {['AUD','EUR','USD','GBP'].map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="fg"><label>Status</label>
                <select className="input" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                  {['active','pending','closed','cancelled'].map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="fg-row">
              <div className="fg"><label>Start Date</label><input type="date" className="input" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} /></div>
              <div className="fg"><label>End Date</label><input type="date" className="input" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))} /></div>
            </div>
            <div className="fg"><label>Description</label><textarea className="input" rows={2} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} style={{resize:'vertical'}} /></div>
            <div className="fg"><label>Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{resize:'vertical'}} /></div>
            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
              {contract && <button className="btn" onClick={()=>setEditing(false)}>Cancel</button>}
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save Contract</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
