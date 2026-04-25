import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

interface Co2Entry { category: string; description: string; quantity: number; unit: string; factor: number; kgCo2: number }

// Default emission factors (kg CO2 per unit)
const DEFAULT_FACTORS: Record<string,{label:string,unit:string,factor:number}> = {
  air_short: { label:'Air travel < 3h (economy)', unit:'flight', factor:180 },
  air_long:  { label:'Air travel > 3h (economy)', unit:'flight', factor:520 },
  petrol_car: { label:'Petrol car (per km)', unit:'km', factor:0.192 },
  diesel_car: { label:'Diesel car (per km)', unit:'km', factor:0.171 },
  hotel:      { label:'Hotel night', unit:'night', factor:31.5 },
  electricity_qld: { label:'Grid electricity QLD (kWh)', unit:'kWh', factor:0.81 },
}

export function Co2TrackingPanel() {
  const { activeProject, setActiveProject } = useAppStore()
  const [entries, setEntries] = useState<Co2Entry[]>([])
  const [form, setForm] = useState({ category:'air_short', description:'', quantity:1 })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const cfg = activeProject?.co2_config as {entries?:Co2Entry[]}|null
    setEntries(cfg?.entries||[])
  }, [activeProject?.id])

  async function addEntry() {
    const preset = DEFAULT_FACTORS[form.category]
    if (!preset) return
    const kgCo2 = form.quantity * preset.factor
    const newEntry: Co2Entry = { category:form.category, description:form.description||preset.label, quantity:form.quantity, unit:preset.unit, factor:preset.factor, kgCo2 }
    const newEntries = [...entries, newEntry]
    setSaving(true)
    const { data, error } = await supabase.from('projects').update({ co2_config:{ entries:newEntries } })
      .eq('id',activeProject!.id).select('*,site:sites(id,name)').single()
    if (error) { toast(error.message,'error'); setSaving(false); return }
    setActiveProject(data as typeof activeProject)
    setEntries(newEntries)
    setForm(f=>({...f,description:'',quantity:1}))
    toast('CO₂ entry added','success')
    setSaving(false)
  }

  async function removeEntry(idx: number) {
    const newEntries = entries.filter((_,i)=>i!==idx)
    const { data, error } = await supabase.from('projects').update({ co2_config:{entries:newEntries} })
      .eq('id',activeProject!.id).select('*,site:sites(id,name)').single()
    if (error) { toast(error.message,'error'); return }
    setActiveProject(data as typeof activeProject)
    setEntries(newEntries)
  }

  // CO2 factors matching HTML CO2_DEFAULTS (kg per litre of fuel, or per km)
  const CO2_FACTORS = { diesel: 2.68, petrol: 2.31, lpg: 1.51, electric: 0, carPerKm: 0.21 }

  async function autoEstimate() {
    if (!activeProject) return
    setSaving(true)
    const pid = activeProject.id
    const [accomData, carData, hireData] = await Promise.all([
      supabase.from('accommodation').select('nights,total_cost').eq('project_id', pid),
      supabase.from('cars').select('start_date,end_date,flags').eq('project_id', pid),
      supabase.from('hire_items').select('start_date,end_date,flags').eq('project_id', pid),
    ])
    const newEntries: Co2Entry[] = [...entries]
    // Accommodation hotel nights
    const totalNights = (accomData.data || []).reduce((s: number, a: {nights: number}) => s + (a.nights || 0), 0)
    if (totalNights > 0) {
      const preset = DEFAULT_FACTORS.hotel
      newEntries.push({ category:'hotel', description:'Accommodation (from project data)', quantity:totalNights, unit:preset.unit, factor:preset.factor, kgCo2:totalNights*preset.factor })
    }
    // Car hire — estimate km from duration (assume 100km/day average)
    const carDays = (carData.data || []).reduce((s: number, c: {start_date:string|null;end_date:string|null}) => {
      if (!c.start_date || !c.end_date) return s
      return s + Math.ceil((new Date(c.end_date).getTime() - new Date(c.start_date).getTime()) / 86400000)
    }, 0)
    if (carDays > 0) {
      const km = carDays * 100
      const preset = DEFAULT_FACTORS.petrol_car
      newEntries.push({ category:'petrol_car', description:`Car hire ~${km}km estimate (${carDays} days × 100km/day)`, quantity:km, unit:preset.unit, factor:preset.factor, kgCo2:km*preset.factor })
    }
    // Equipment hire CO2 — from fuelType and fuelConsumptionPerDay stored in flags
    const hireItems = (hireData.data || []) as { start_date: string|null; end_date: string|null; flags: Record<string,unknown> }[]
    for (const h of hireItems) {
      const flags = h.flags || {}
      const fuelType = flags.fuel_type as string | undefined
      if (!fuelType || fuelType === 'none' || fuelType === 'electric') continue
      const factor = CO2_FACTORS[fuelType as keyof typeof CO2_FACTORS] || 0
      if (!factor) continue
      const litresPerDay = parseFloat(String(flags.fuel_consumption_per_day || 0)) || 0
      if (!litresPerDay) continue
      const days = h.start_date && h.end_date
        ? Math.ceil((new Date(h.end_date).getTime() - new Date(h.start_date).getTime()) / 86400000)
        : 0
      if (!days) continue
      const litres = litresPerDay * days
      const kgCo2 = litres * factor
      const tonneCo2 = kgCo2 / 1000
      newEntries.push({
        category: 'hire_equipment',
        description: `Equipment hire (${fuelType} ${litresPerDay}L/day × ${days} days)`,
        quantity: parseFloat(tonneCo2.toFixed(3)), unit: 'tonne CO₂', factor: 1, kgCo2,
      })
    }

    const { data, error } = await supabase.from('projects').update({ co2_config:{ entries:newEntries } })
      .eq('id', pid).select('*,site:sites(id,name)').single()
    if (error) { toast(error.message,'error'); setSaving(false); return }
    setActiveProject(data as typeof activeProject)
    setEntries(newEntries)
    toast(`Auto-estimated: ${totalNights} hotel nights, ~${carDays*100}km car hire added`, 'success')
    setSaving(false)
  }

  const totalKg = entries.reduce((s,e)=>s+(e.kgCo2||0),0)
  const totalT = totalKg / 1000

  return (
    <div style={{padding:'24px',maxWidth:'800px'}}>
      <h1 style={{fontSize:'18px',fontWeight:700,marginBottom:'4px'}}>CO₂ Tracking</h1>
      <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'20px'}}>Track carbon emissions for this project</p>

      {/* Summary */}
      {entries.length > 0 && (
        <div className="kpi-grid" style={{marginBottom:'20px'}}>
          <div className="kpi-card" style={{borderTopColor:'var(--green)'}}>
            <div className="kpi-val" style={{color:'var(--green)'}}>{totalT.toFixed(2)} t</div>
            <div className="kpi-lbl">Total CO₂e</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-val">{totalKg.toFixed(0)} kg</div>
            <div className="kpi-lbl">Total kg CO₂</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-val">{entries.length}</div>
            <div className="kpi-lbl">Entries</div>
          </div>
        </div>
      )}

      {/* Add entry */}
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'8px'}}>
        <button className="btn btn-sm" onClick={autoEstimate} disabled={saving}>✨ Auto-estimate from project data</button>
      </div>
      <div className="card" style={{marginBottom:'16px'}}>
        <div style={{fontWeight:600,marginBottom:'12px',fontSize:'13px'}}>Add Emission Entry</div>
        <div className="fg-row" style={{alignItems:'flex-end'}}>
          <div className="fg" style={{flex:2}}>
            <label>Category</label>
            <select className="input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
              {Object.entries(DEFAULT_FACTORS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="fg">
            <label>Quantity ({DEFAULT_FACTORS[form.category]?.unit})</label>
            <input type="number" min="0" step="0.5" className="input" value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:parseFloat(e.target.value)||0}))} />
          </div>
          <div className="fg" style={{flex:2}}>
            <label>Description (optional)</label>
            <input className="input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Brisbane to Rockhampton" />
          </div>
          <button className="btn btn-primary" onClick={addEntry} disabled={saving}>
            {saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Add
          </button>
        </div>
        {form.category && DEFAULT_FACTORS[form.category] && (
          <p style={{fontSize:'11px',color:'var(--text3)',marginTop:'6px'}}>
            Estimated: {(form.quantity * DEFAULT_FACTORS[form.category].factor).toFixed(1)} kg CO₂e
            (factor: {DEFAULT_FACTORS[form.category].factor} kg/{DEFAULT_FACTORS[form.category].unit})
          </p>
        )}
      </div>

      {entries.length===0 ? (
        <div className="empty-state"><div className="icon">🌿</div><h3>No emissions tracked</h3><p>Add entries to track the carbon footprint of this project.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead><tr><th>Category</th><th>Description</th><th style={{textAlign:'right'}}>Qty</th><th>Unit</th><th style={{textAlign:'right'}}>kg CO₂e</th><th></th></tr></thead>
            <tbody>
              {entries.map((e,i)=>(
                <tr key={i}>
                  <td style={{fontSize:'12px',color:'var(--text2)'}}>{DEFAULT_FACTORS[e.category]?.label||e.category}</td>
                  <td>{e.description||'—'}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px'}}>{e.quantity}</td>
                  <td style={{fontSize:'12px',color:'var(--text3)'}}>{e.unit}</td>
                  <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',fontWeight:600,color:'var(--green)'}}>{(e.kgCo2||0).toFixed(1)}</td>
                  <td><button className="btn btn-sm" style={{color:'var(--red)'}} onClick={()=>removeEntry(i)}>✕</button></td>
                </tr>
              ))}
              <tr style={{borderTop:'2px solid var(--border)',background:'var(--bg3)'}}>
                <td colSpan={4} style={{padding:'8px 10px',fontWeight:600}}>Total</td>
                <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:700,color:'var(--green)',padding:'8px 10px'}}>{totalKg.toFixed(1)} kg</td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
