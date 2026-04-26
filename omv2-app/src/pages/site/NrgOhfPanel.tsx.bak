import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { NrgTceLine, Resource } from '../../types'

interface OhfLine extends NrgTceLine {
  forecastValue?: number
}

const FORECAST_TYPES = ['labour','hire','direct','tce'] as const
type ForecastType = typeof FORECAST_TYPES[number]

export function NrgOhfPanel() {
  const { activeProject } = useAppStore()
  const [allLines, setAllLines] = useState<NrgTceLine[]>([])
  const [ohfLines, setOhfLines] = useState<OhfLine[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editModal, setEditModal] = useState<OhfLine|null>(null)
  const [editForm, setEditForm] = useState({ forecast_type:'labour' as ForecastType, forecast_date_from:'', forecast_date_to:'', forecast_resources:[] as string[], forecast_enabled:true })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const nrgConfig = activeProject!.nrg_config as {kpiTarget:unknown;ohfLineIds:string[]}
    const ohfIds = nrgConfig?.ohfLineIds || []

    const [tceData, resData] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id',pid),
      supabase.from('resources').select('id,name,role').eq('project_id',pid).order('name'),
    ])
    const all = (tceData.data||[]) as NrgTceLine[]
    setAllLines(all)
    setOhfLines(all.filter(l=>ohfIds.includes(l.item_id||"")))
    setResources((resData.data||[]) as Resource[])
    setLoading(false)
  }

  async function addLines() {
    if (selectedIds.length===0) return
    const nrgConfig = activeProject!.nrg_config as {kpiTarget:unknown;ohfLineIds:string[]}
    const existing = nrgConfig?.ohfLineIds||[]
    // Store item_id strings (stable across re-imports), not UUIDs
    const newIds = [...new Set([...existing,...selectedIds])]
    const { data, error } = await supabase.from('projects').update({ nrg_config:{ ...nrgConfig, ohfLineIds:newIds } })
      .eq('id',activeProject!.id).select('*,site:sites(id,name)').single()
    if (error) { toast(error.message,'error'); return }
    toast(`${selectedIds.length} line(s) added to OHF`,'success')
    setSelectedIds([]); setPickerOpen(false)
    // Update active project in store
    const { useAppStore: s } = await import('../../store/appStore')
    s.getState().setActiveProject(data as typeof activeProject)
    load()
  }

  async function removeLine(id: string) {
    const nrgConfig = activeProject!.nrg_config as {kpiTarget:unknown;ohfLineIds:string[]}
    const newIds = (nrgConfig?.ohfLineIds||[]).filter((x: string)=>x!==id)
    const { data, error } = await supabase.from('projects').update({ nrg_config:{...nrgConfig,ohfLineIds:newIds} })
      .eq('id',activeProject!.id).select('*,site:sites(id,name)').single()
    if (error) { toast(error.message,'error'); return }
    const { useAppStore: s } = await import('../../store/appStore')
    s.getState().setActiveProject(data as typeof activeProject)
    load()
  }

  function openEdit(l: OhfLine) {
    setEditForm({
      forecast_type: (l.forecast_type as ForecastType)||'labour',
      forecast_date_from: l.forecast_date_from||'',
      forecast_date_to: l.forecast_date_to||'',
      forecast_resources: (l.forecast_resources as string[])||[],
      forecast_enabled: l.forecast_enabled,
    })
    setEditModal(l)
  }

  async function saveEdit() {
    if (!editModal) return
    setSaving(true)
    const { error } = await supabase.from('nrg_tce_lines').update({
      forecast_type: editForm.forecast_type,
      forecast_date_from: editForm.forecast_date_from||null,
      forecast_date_to: editForm.forecast_date_to||null,
      forecast_resources: editForm.forecast_resources,
      forecast_enabled: editForm.forecast_enabled,
    }).eq('id',editModal.id)
    if (error) { toast(error.message,'error'); setSaving(false); return }
    toast('Forecast config saved','success')
    setSaving(false); setEditModal(null); load()
  }

  function toggleResource(id: string) {
    setEditForm(f=>({
      ...f, forecast_resources: f.forecast_resources.includes(id)
        ? f.forecast_resources.filter(x=>x!==id)
        : [...f.forecast_resources,id]
    }))
  }

  const ohfLineIds = ((activeProject?.nrg_config as {ohfLineIds?:string[]})?.ohfLineIds || [])
  const notAdded = allLines.filter(l=>!ohfLineIds.includes(l.item_id||'')).filter(l=>l.source==='overhead')
  const filteredPicker = notAdded.filter(l=>!search||l.description.toLowerCase().includes(search.toLowerCase())||l.wbs_code.toLowerCase().includes(search.toLowerCase()))
  const totalTce = ohfLines.reduce((s,l)=>s+(l.tce_total||0),0)
  const fmt = (n:number) => '$'+n.toLocaleString('en-AU',{minimumFractionDigits:0})
  const resMap = Object.fromEntries(resources.map(r=>[r.id,r.name]))

  return (
    <div style={{padding:'24px',maxWidth:'1100px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>NRG Overhead Forecast</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{ohfLines.length} lines · TCE total {fmt(totalTce)}</p>
        </div>
        <button className="btn btn-primary" onClick={()=>setPickerOpen(true)}>+ Add Lines</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : ohfLines.length===0 ? (
        <div className="empty-state"><div className="icon">📈</div><h3>No OHF lines</h3><p>Add overhead TCE lines from the TCE register to configure forecasts.</p></div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead>
              <tr>
                <th>WBS</th><th>Description</th>
                <th style={{textAlign:'right'}}>TCE Total</th>
                <th>Forecast Type</th>
                <th>Date Range</th>
                <th>Resources</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ohfLines.map(l => {
                const assigned = (l.forecast_resources as string[])||[]
                return (
                  <tr key={l.id}>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{l.wbs_code||'—'}</td>
                    <td style={{fontWeight:500,maxWidth:'240px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.description||'—'}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'12px',fontWeight:600}}>{fmt(l.tce_total||0)}</td>
                    <td>
                      {l.forecast_type ? (
                        <span className="badge" style={{bg:'#dbeafe',color:'#1e40af'} as {bg:string,color:string}}>{l.forecast_type}</span>
                      ) : <span style={{color:'var(--text3)',fontSize:'12px'}}>Not set</span>}
                    </td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>
                      {l.forecast_date_from&&l.forecast_date_to ? `${l.forecast_date_from} → ${l.forecast_date_to}` : '—'}
                    </td>
                    <td style={{fontSize:'12px',color:'var(--text2)'}}>
                      {assigned.length>0 ? assigned.slice(0,2).map(id=>resMap[id]||id).join(', ')+(assigned.length>2?` +${assigned.length-2}`:'') : '—'}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={()=>openEdit(l)}>Config</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={()=>removeLine(l.item_id||'')}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Line picker modal */}
      {pickerOpen && (
        <div className="modal-overlay" onClick={()=>setPickerOpen(false)}>
          <div className="modal" style={{maxWidth:'680px',maxHeight:'80vh'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Lines to OHF</h3>
              <button className="btn btn-sm" onClick={()=>setPickerOpen(false)}>✕</button>
            </div>
            <div style={{padding:'12px 20px',borderBottom:'1px solid var(--border)'}}>
              <input className="input" placeholder="Search description or WBS..." value={search} onChange={e=>setSearch(e.target.value)} />
            </div>
            <div style={{maxHeight:'400px',overflowY:'auto'}}>
              {filteredPicker.length===0 ? <p style={{padding:'24px',textAlign:'center',color:'var(--text3)'}}>All overhead lines already added.</p>
              : filteredPicker.map(l => (
                <label key={l.id} style={{display:'flex',alignItems:'flex-start',gap:'10px',padding:'10px 20px',borderBottom:'1px solid var(--border)',cursor:'pointer'}}>
                  <input type="checkbox" style={{marginTop:'2px'}} checked={selectedIds.includes(l.item_id||'')} onChange={e=>setSelectedIds(ids=>e.target.checked?[...ids,l.item_id||'']:ids.filter(x=>x!==l.item_id))} />
                  <div style={{flex:1}}>
                    <div style={{fontWeight:500,fontSize:'13px'}}>{l.description||'—'}</div>
                    <div style={{display:'flex',gap:'12px',marginTop:'2px'}}>
                      <span style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{l.wbs_code||'—'}</span>
                      <span style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--accent)',fontWeight:600}}>{fmt(l.tce_total||0)}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="modal-footer">
              <span style={{fontSize:'12px',color:'var(--text3)'}}>{selectedIds.length} selected</span>
              <button className="btn" onClick={()=>setPickerOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addLines} disabled={selectedIds.length===0}>Add Selected</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit forecast config modal */}
      {editModal && (
        <div className="modal-overlay" onClick={()=>setEditModal(null)}>
          <div className="modal" style={{maxWidth:'520px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h3>Forecast Config: {editModal.description?.slice(0,40)}</h3>
              <button className="btn btn-sm" onClick={()=>setEditModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg">
                  <label>Forecast Type</label>
                  <select className="input" value={editForm.forecast_type} onChange={e=>setEditForm(f=>({...f,forecast_type:e.target.value as ForecastType}))}>
                    {FORECAST_TYPES.map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                  </select>
                </div>
                <label style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'13px',whiteSpace:'nowrap',paddingTop:'18px'}}>
                  <input type="checkbox" checked={editForm.forecast_enabled} onChange={e=>setEditForm(f=>({...f,forecast_enabled:e.target.checked}))} />
                  Enabled
                </label>
              </div>
              <div className="fg-row">
                <div className="fg"><label>Date From</label><input type="date" className="input" value={editForm.forecast_date_from} onChange={e=>setEditForm(f=>({...f,forecast_date_from:e.target.value}))} /></div>
                <div className="fg"><label>Date To</label><input type="date" className="input" value={editForm.forecast_date_to} onChange={e=>setEditForm(f=>({...f,forecast_date_to:e.target.value}))} /></div>
              </div>
              <div>
                <label style={{fontSize:'11px',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.04em'}}>Assigned Resources</label>
                <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginTop:'6px'}}>
                  {resources.map(r=>(
                    <label key={r.id} style={{display:'flex',alignItems:'center',gap:'4px',cursor:'pointer',fontSize:'12px',padding:'3px 8px',background:editForm.forecast_resources.includes(r.id)?'var(--accent)':'var(--bg3)',color:editForm.forecast_resources.includes(r.id)?'#fff':'var(--text)',borderRadius:'4px',border:'1px solid var(--border)'}}>
                      <input type="checkbox" style={{display:'none'}} checked={editForm.forecast_resources.includes(r.id)} onChange={()=>toggleResource(r.id)} />
                      {r.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setEditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
