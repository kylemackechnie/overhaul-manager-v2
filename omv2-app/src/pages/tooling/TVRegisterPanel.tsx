import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { GlobalTV, GlobalDepartment, ToolingCosting } from '../../types'

export function TVRegisterPanel() {
  const { activeProject } = useAppStore()
  const [projectTVs, setProjectTVs] = useState<string[]>([])
  const [allTVs, setAllTVs] = useState<GlobalTV[]>([])
  const [costings, setCostings] = useState<ToolingCosting[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [addModal, setAddModal] = useState(false)
  const [newTvNo, setNewTvNo] = useState('')

  const [departments, setDepartments] = useState<GlobalDepartment[]>([])

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [ptData, tvData, costData, deptData] = await Promise.all([
      supabase.from('project_tvs').select('tv_no').eq('project_id',pid).eq('tv_type','tooling'),
      supabase.from('global_tvs').select('*,department:global_departments(*)').order('tv_no'),
      supabase.from('tooling_costings').select('*').eq('project_id',pid),
      supabase.from('global_departments').select('*').order('name'),
    ])
    setProjectTVs((ptData.data||[]).map(r => r.tv_no))
    setAllTVs((tvData.data||[]) as GlobalTV[])
    setCostings((costData.data||[]) as ToolingCosting[])
    setDepartments((deptData.data||[]) as GlobalDepartment[])
    setLoading(false)
  }

  async function setTVDept(tvNo: string, deptId: string) {
    const { error } = await supabase.from('global_tvs')
      .update({ department_id: deptId || null })
      .eq('tv_no', tvNo)
    if (error) { toast(error.message, 'error'); return }
    setAllTVs(tvs => tvs.map(tv => tv.tv_no === tvNo
      ? { ...tv, department_id: deptId || null, department: departments.find(d => d.id === deptId) ?? undefined } as GlobalTV
      : tv
    ))
  }

  async function addTV() {
    if (!newTvNo.trim()) return toast('TV number required','error')
    const tvNo = newTvNo.trim()
    // Ensure global_tv exists
    const siteId = (activeProject as typeof activeProject & {site_id?:string}).site_id || null
    const { error: tvErr } = await supabase.from('global_tvs').upsert({ tv_no: tvNo, header_name:'', site_id: siteId }, { onConflict:'site_id,tv_no', ignoreDuplicates:true })
    if (tvErr) { toast(tvErr.message,'error'); return }
    // Link to project
    const { error } = await supabase.from('project_tvs').upsert({ project_id:activeProject!.id, tv_no:tvNo, site_id: siteId, tv_type:'tooling' }, { onConflict:'project_id,tv_no', ignoreDuplicates:true })
    if (error) { toast(error.message,'error'); return }
    toast(`TV${tvNo} added to project`,'success')
    setNewTvNo(''); setAddModal(false); load()
  }

  async function removeTV(tvNo: string) {
    const hasCosting = costings.some(c => c.tv_no === tvNo)
    const msg = `Remove TV${tvNo} from this project?${hasCosting ? '\n\nThis will also delete the costing data and packages for this TV.' : ''}`
    if (!confirm(msg)) return
    const pid = activeProject!.id

    // Remove project link
    await supabase.from('project_tvs').delete().eq('project_id', pid).eq('tv_no', tvNo)
    // Remove costings for this TV on this project
    await supabase.from('tooling_costings').delete().eq('project_id', pid).eq('tv_no', tvNo)
    // Remove project kollos for this TV
    const { data: kolloLinks } = await supabase.from('project_kollos').select('kollo_id').eq('project_id', pid)
    const { data: tvKollos } = await supabase.from('global_kollos').select('kollo_id').eq('tv_no', tvNo)
    if (kolloLinks && tvKollos) {
      const tvKolloIds = new Set(tvKollos.map(k => k.kollo_id))
      const toDelete = kolloLinks.filter(k => tvKolloIds.has(k.kollo_id)).map(k => k.kollo_id)
      if (toDelete.length) {
        await supabase.from('project_kollos').delete().eq('project_id', pid).in('kollo_id', toDelete)
      }
    }
    toast(`TV${tvNo} removed from project`, 'info'); load()
  }

  const myTVs = allTVs.filter(tv => projectTVs.includes(tv.tv_no) && (!search || String(tv.tv_no).includes(search) || (tv.header_name||'').toLowerCase().includes(search.toLowerCase())))
  const availableTVs = allTVs.filter(tv => !projectTVs.includes(tv.tv_no))

  return (
    <div style={{ padding:'24px', maxWidth:'1000px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <h1 style={{ fontSize:'18px', fontWeight:700 }}>SE AG Tooling — TV Register</h1>
          <p style={{ fontSize:'12px', color:'var(--text3)', marginTop:'2px' }}>{projectTVs.length} TVs on this project</p>
        </div>
        <input className="input" style={{maxWidth:'200px',fontSize:'12px'}} placeholder="Search TVs..." value={search} onChange={e=>setSearch(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setAddModal(true)}>+ Add TV</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : myTVs.length === 0 ? (
        <div className="empty-state"><div className="icon">🧰</div><h3>No TVs on this project</h3><p>Add SE AG tool van numbers to track tooling.</p></div>
      ) : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table>
            <thead><tr><th>TV No.</th><th>Department</th><th>Charge Start</th><th>Charge End</th><th style={{textAlign:'right'}}>Cost (EUR)</th><th style={{textAlign:'right'}}>Sell (EUR)</th><th></th></tr></thead>
            <tbody>
              {myTVs.map(tv => {
                const costing = costings.find(c => c.tv_no === tv.tv_no)
                return (
                  <tr key={tv.tv_no}>
                    <td style={{ fontFamily:'var(--mono)', fontWeight:700, fontSize:'14px' }}>TV{tv.tv_no}</td>
                    <td>
                      <select
                        className="input"
                        style={{ fontSize:'11px', padding:'3px 6px', width:'140px' }}
                        value={(tv as typeof tv & { department_id?: string }).department_id || ''}
                        onChange={e => setTVDept(tv.tv_no, e.target.value)}
                      >
                        <option value="">— assign —</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'12px' }}>{costing?.charge_start || '—'}</td>
                    <td style={{ fontFamily:'var(--mono)', fontSize:'12px' }}>{costing?.charge_end || '—'}</td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontSize:'12px' }}>
                      {costing?.cost_eur ? `€${costing.cost_eur.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ textAlign:'right', fontFamily:'var(--mono)', fontSize:'12px', color:'var(--green)' }}>
                      {costing?.sell_eur ? `€${costing.sell_eur.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ whiteSpace:'nowrap' }}>
                      <button className="btn btn-sm" style={{ color:'var(--red)' }} onClick={() => removeTV(tv.tv_no)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add TV modal */}
      {addModal && (
        <div className="modal-overlay" onClick={() => setAddModal(false)}>
          <div className="modal" style={{ maxWidth:'400px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add TV to Project</h3>
              <button className="btn btn-sm" onClick={() => setAddModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>TV Number</label>
                <input className="input" value={newTvNo} onChange={e=>setNewTvNo(e.target.value)} placeholder="e.g. 482" list="tv-list" autoFocus />
                <datalist id="tv-list">{availableTVs.map(tv=><option key={tv.tv_no} value={tv.tv_no}/>)}</datalist>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addTV}>Add TV</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
