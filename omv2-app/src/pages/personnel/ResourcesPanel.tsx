import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { Resource, RateCard, PurchaseOrder } from '../../types'

const CATEGORIES = ['trades','management','seag','subcontractor'] as const
const SHIFTS = ['day','night','both'] as const

const EMPTY: Partial<Resource> = {
  name:'', role:'', category:'trades', shift:'day',
  mob_in:null, mob_out:null, travel_days:0, wbs:'',
  allow_laha:false, allow_fsa:false, allow_meal:false,
  linked_po_id:null, rate_card_id:null, notes:'',
}

function fmt(d: string|null) { return d ? d.slice(0,10) : '' }

export function ResourcesPanel() {
  const { activeProject } = useAppStore()
  const [resources, setResources] = useState<Resource[]>([])
  const [rcs, setRcs] = useState<RateCard[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | Resource>(null)
  const [form, setForm] = useState<Partial<Resource>>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [catFilter, setCatFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [resData, rcData, poData] = await Promise.all([
      supabase.from('resources').select('*').eq('project_id', pid).order('category').order('name'),
      supabase.from('rate_cards').select('*').eq('project_id', pid).order('role'),
      supabase.from('purchase_orders').select('id,po_number,vendor,description').eq('project_id', pid).order('po_number'),
    ])
    setResources((resData.data || []) as Resource[])
    setRcs((rcData.data || []) as RateCard[])
    setPos((poData.data || []) as PurchaseOrder[])
    setLoading(false)
  }

  function openNew() { setForm({...EMPTY}); setModal('new') }
  function openEdit(r: Resource) { setForm({...r}); setModal(r) }

  async function save() {
    if (!form.name?.trim()) return toast('Name required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      name: form.name?.trim(),
      role: form.role || '',
      category: form.category || 'trades',
      shift: form.shift || 'day',
      mob_in: form.mob_in || null,
      mob_out: form.mob_out || null,
      travel_days: form.travel_days || 0,
      wbs: form.wbs || '',
      allow_laha: form.allow_laha || false,
      allow_fsa: form.allow_fsa || false,
      allow_meal: form.allow_meal || false,
      linked_po_id: form.linked_po_id || null,
      rate_card_id: form.rate_card_id || null,
      notes: form.notes || '',
    }
    if (modal === 'new') {
      const { error } = await supabase.from('resources').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Resource added', 'success')
    } else {
      const { error } = await supabase.from('resources').update(payload).eq('id', (modal as Resource).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(r: Resource) {
    if (!confirm(`Remove ${r.name}?`)) return
    await supabase.from('resources').delete().eq('id', r.id)
    toast('Removed', 'info'); load()
  }

  const subconPos = pos.filter(po => po.status !== 'cancelled')
  const filtered = resources
    .filter(r => catFilter === 'all' || r.category === catFilter)
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.role.toLowerCase().includes(search.toLowerCase()))

  const catColors: Record<string,{bg:string,color:string}> = {
    trades:{bg:'#dbeafe',color:'#1e40af'},
    management:{bg:'#d1fae5',color:'#065f46'},
    seag:{bg:'#fef3c7',color:'#92400e'},
    subcontractor:{bg:'#f3e8ff',color:'#6b21a8'},
  }
  const catCounts: Record<string, number> = {}
  resources.forEach(r => { catCounts[r.category] = (catCounts[r.category] || 0) + 1 })

  return (
    <div style={{padding:'24px',maxWidth:'1200px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Resources</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{resources.length} people on this project</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Resource</button>
      </div>

      <div style={{display:'flex',gap:'8px',marginBottom:'16px',flexWrap:'wrap',alignItems:'center'}}>
        <input className="input" style={{maxWidth:'220px'}} placeholder="Search name or role..." value={search} onChange={e=>setSearch(e.target.value)} />
        {(['all',...CATEGORIES] as string[]).map(cat => (
          <button key={cat} className="btn btn-sm"
            style={{background:catFilter===cat?'var(--accent)':'var(--bg)',color:catFilter===cat?'#fff':'var(--text)'}}
            onClick={() => setCatFilter(cat)}>
            {cat==='all'?`All (${resources.length})`:`${cat.charAt(0).toUpperCase()+cat.slice(1)} (${catCounts[cat]||0})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner"/> Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">👤</div>
          <h3>No resources</h3>
          <p>{search || catFilter !== 'all' ? 'No matches found.' : 'Add people to this project.'}</p>
        </div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Role</th><th>Category</th><th>Shift</th>
                <th>Mob In</th><th>Mob Out</th><th>WBS</th><th>Allowances</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const c = catColors[r.category] || {bg:'#f1f5f9',color:'#64748b'}
                return (
                  <tr key={r.id}>
                    <td style={{fontWeight:500}}>{r.name}</td>
                    <td style={{color:'var(--text2)',fontSize:'13px'}}>{r.role || '—'}</td>
                    <td><span className="badge" style={c}>{r.category}</span></td>
                    <td style={{fontSize:'12px',color:'var(--text3)'}}>{r.shift}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{r.mob_in ? fmt(r.mob_in) : '—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'12px'}}>{r.mob_out ? fmt(r.mob_out) : '—'}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--text3)'}}>{r.wbs || '—'}</td>
                    <td style={{fontSize:'11px',color:'var(--text3)'}}>
                      {[r.allow_laha&&'LAHA',r.allow_fsa&&'FSA',r.allow_meal&&'Meal'].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={() => del(r)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{maxWidth:'680px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'Add Resource' : `Edit: ${(modal as Resource).name}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Full Name</label>
                  <input className="input" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Kyle Mackechnie" autoFocus />
                </div>
                <div className="fg" style={{flex:2}}>
                  <label>Role</label>
                  <input className="input" value={form.role||''} onChange={e=>setForm(f=>({...f,role:e.target.value}))} placeholder="e.g. Fitter, Project Manager" list="rc-roles" />
                  <datalist id="rc-roles">{rcs.map(rc=><option key={rc.id} value={rc.role}/>)}</datalist>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Category</label>
                  <select className="input" value={form.category||'trades'} onChange={e=>setForm(f=>({...f,category:e.target.value as Resource['category']}))}>
                    {CATEGORIES.map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Shift</label>
                  <select className="input" value={form.shift||'day'} onChange={e=>setForm(f=>({...f,shift:e.target.value as Resource['shift']}))}>
                    {SHIFTS.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Rate Card</label>
                  <select className="input" value={form.rate_card_id||''} onChange={e=>setForm(f=>({...f,rate_card_id:e.target.value||null}))}>
                    <option value="">— None —</option>
                    {rcs.map(rc=><option key={rc.id} value={rc.id}>{rc.role}</option>)}
                  </select>
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>Mob In</label>
                  <input type="date" className="input" value={form.mob_in||''} onChange={e=>setForm(f=>({...f,mob_in:e.target.value||null}))} />
                </div>
                <div className="fg">
                  <label>Mob Out</label>
                  <input type="date" className="input" value={form.mob_out||''} onChange={e=>setForm(f=>({...f,mob_out:e.target.value||null}))} />
                </div>
                <div className="fg">
                  <label>Travel Days</label>
                  <input type="number" className="input" value={form.travel_days||0} onChange={e=>setForm(f=>({...f,travel_days:parseInt(e.target.value)||0}))} />
                </div>
              </div>
              <div className="fg">
                <label>WBS Code</label>
                <input className="input" value={form.wbs||''} onChange={e=>setForm(f=>({...f,wbs:e.target.value}))} placeholder="e.g. 50OP-00138.P.01.02.01" />
              </div>
              {(form.category === 'subcontractor') && (
                <div className="fg">
                  <label>Linked PO</label>
                  <select className="input" value={form.linked_po_id||''} onChange={e=>setForm(f=>({...f,linked_po_id:e.target.value||null}))}>
                    <option value="">— None —</option>
                    {subconPos.map(po=><option key={po.id} value={po.id}>{po.po_number || po.vendor} {po.description ? `— ${po.description}` : ''}</option>)}
                  </select>
                </div>
              )}
              <div>
                <div style={{fontSize:'12px',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'8px'}}>Allowances</div>
                <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
                  {[
                    {key:'allow_laha',label:'LAHA'},
                    {key:'allow_fsa',label:'FSA'},
                    {key:'allow_meal',label:'Meal'},
                  ].map(({key,label}) => (
                    <label key={key} style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'13px'}}>
                      <input type="checkbox" checked={!!(form as Record<string,unknown>)[key]}
                        onChange={e=>setForm(f=>({...f,[key]:e.target.checked}))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="fg">
                <label>Notes</label>
                <input className="input" value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Any notes..." />
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
