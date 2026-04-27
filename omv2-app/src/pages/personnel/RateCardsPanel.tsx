import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { defaultCurrencyForCategory, getBaseCurrency, CURRENCY_SYMBOLS } from '../../lib/currency'
import type { RateCard } from '../../types'

const CATEGORIES = ['trades', 'management', 'seag', 'subcontractor'] as const
const RATE_BUCKETS = ['dnt','dt15','ddt','ddt15','nnt','ndt','ndt15'] as const
const BUCKET_LABELS: Record<string, string> = {
  dnt:'Day NT', dt15:'Day 1.5x', ddt:'Day 2x', ddt15:'Day 2.5x',
  nnt:'Night NT', ndt:'Night 2x', ndt15:'Night 2.5x'
}

type RateForm = {
  role: string; category: string; subcon_vendor: string
  /** Native currency for hourly rates */
  currency: string
  rates: { cost: Record<string,number>; sell: Record<string,number> }
  laha_cost: number; laha_sell: number; fsa_cost: number; fsa_sell: number
  meal_cost: number; meal_sell: number; camp: number
  regime: { wdNT: number; wdT15: number; satT15: number; nightNT: number; restNT: number }
}

const emptyRates = () => ({ dnt:0, dt15:0, ddt:0, ddt15:0, nnt:0, ndt:0, ndt15:0 })
const EMPTY_REGIME = { wdNT:7.2, wdT15:3.3, satT15:3.0, nightNT:7.2, restNT:7.2 }
const EMPTY_FORM: RateForm = {
  role:'', category:'trades', subcon_vendor:'', currency: 'AUD',
  rates:{ cost: emptyRates(), sell: emptyRates() },
  laha_cost:0, laha_sell:0, fsa_cost:0, fsa_sell:0, meal_cost:0, meal_sell:0, camp:0,
  regime: { ...EMPTY_REGIME },
}

export function RateCardsPanel() {
  const { activeProject } = useAppStore()
  const [rcs, setRcs] = useState<RateCard[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | RateCard>(null)
  const [form, setForm] = useState<RateForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [catFilter, setCatFilter] = useState('all')
  const [sched, setSched] = useState({
    dayBase:0, nightBase:0, shiftAllow:0,
    multOT1:1.5, multOT2:2.0, multSat:1.5, multSun:2.0,
    markupMode:'pct' as 'pct'|'fixed'|'none', markupVal:15
  })

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('rate_cards').select('*')
      .eq('project_id', activeProject!.id).order('category').order('role')
    setRcs((data || []) as RateCard[])
    setLoading(false)
  }

  function openNew() {
    const cur = defaultCurrencyForCategory('trades', activeProject)
    setForm({ ...EMPTY_FORM, currency: cur, rates: { cost: emptyRates(), sell: emptyRates() } })
    setModal('new')
  }

  function applySchedule() {
    const { dayBase, nightBase, shiftAllow, multOT1, multOT2, multSat, multSun, markupMode, markupVal } = sched
    if (!dayBase) return
    const nb = nightBase || dayBase
    const cost = {
      dnt: +dayBase.toFixed(2),
      dt15: +(dayBase * multOT1).toFixed(2),
      ddt: +(dayBase * multOT2).toFixed(2),
      ddt15: +(dayBase * multSun).toFixed(2),
      nnt: +(nb + shiftAllow).toFixed(2),
      ndt: +((nb + shiftAllow) * multSat).toFixed(2),
      ndt15: +((nb + shiftAllow) * multSun).toFixed(2),
    }
    function applySell(c: number) {
      if (markupMode === 'none') return c
      if (markupMode === 'fixed') return +(c + markupVal).toFixed(2)
      const gm = Math.min(markupVal, 99) / 100
      return gm > 0 ? +(c / (1 - gm)).toFixed(2) : c
    }
    const sell = Object.fromEntries(Object.entries(cost).map(([k,v]) => [k, applySell(v)])) as typeof cost
    setForm(f => ({ ...f, rates: { cost, sell } }))
  }

  function openEdit(rc: RateCard) {
    const cost = { ...emptyRates(), ...(rc.rates?.cost as Record<string,number> || {}) }
    const sell = { ...emptyRates(), ...(rc.rates?.sell as Record<string,number> || {}) }
    const rcAny = rc as unknown as { regime?: Partial<typeof EMPTY_REGIME> }
    const rcAny2 = rc as unknown as { currency?: string }
    setForm({
      role: rc.role, category: rc.category, subcon_vendor: rc.subcon_vendor || '',
      currency: rcAny2.currency || (rc.category === 'seag' ? 'EUR' : getBaseCurrency(activeProject)),
      rates: { cost, sell },
      laha_cost: rc.laha_cost, laha_sell: rc.laha_sell,
      fsa_cost: rc.fsa_cost, fsa_sell: rc.fsa_sell,
      meal_cost: rc.meal_cost, meal_sell: rc.meal_sell, camp: rc.camp,
      regime: { ...EMPTY_REGIME, ...(rcAny.regime || {}) },
    })
    setModal(rc)
  }

  async function save() {
    if (!form.role.trim()) return toast('Role name required', 'error')
    setSaving(true)
    const payload = {
      project_id: activeProject!.id,
      role: form.role.trim(), category: form.category,
      currency: form.currency,
      subcon_vendor: form.subcon_vendor || null,
      rates: form.rates,
      laha_cost: form.laha_cost, laha_sell: form.laha_sell,
      fsa_cost: form.fsa_cost, fsa_sell: form.fsa_sell,
      meal_cost: form.meal_cost, meal_sell: form.meal_sell, camp: form.camp,
      regime: form.regime,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('rate_cards').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Rate card created', 'success')
    } else {
      const { error } = await supabase.from('rate_cards').update(payload).eq('id', (modal as RateCard).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Rate card saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(rc: RateCard) {
    if (!confirm(`Delete rate card "${rc.role}"?`)) return
    await supabase.from('rate_cards').delete().eq('id', rc.id)
    toast('Deleted', 'info'); load()
  }

  async function duplicate(rc: RateCard) {
    const cost = { ...emptyRates(), ...(rc.rates?.cost as Record<string,number> || {}) }
    const sell = { ...emptyRates(), ...(rc.rates?.sell as Record<string,number> || {}) }
    const { error } = await supabase.from('rate_cards').insert({
      project_id: activeProject!.id,
      role: rc.role + ' (copy)', category: rc.category,
      subcon_vendor: rc.subcon_vendor || null,
      rates: { cost, sell },
      laha_cost: rc.laha_cost, laha_sell: rc.laha_sell,
      fsa_cost: rc.fsa_cost, fsa_sell: rc.fsa_sell,
      meal_cost: rc.meal_cost, meal_sell: rc.meal_sell, camp: rc.camp,
    })
    if (error) { toast(error.message, 'error'); return }
    toast('Duplicated', 'success'); load()
  }

  function setRate(mode: 'cost'|'sell', bucket: string, val: number) {
    setForm(f => ({
      ...f,
      rates: { ...f.rates, [mode]: { ...f.rates[mode], [bucket]: val } }
    }))
  }

  const filtered = catFilter === 'all' ? rcs : rcs.filter(r => r.category === catFilter)
  const catCounts: Record<string, number> = {}
  rcs.forEach(r => { catCounts[r.category] = (catCounts[r.category] || 0) + 1 })
  const isMgmtCat = (cat: string) => cat === 'management' || cat === 'seag'

  return (
    <div style={{padding:'24px', maxWidth:'1100px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
        <div>
          <h1 style={{fontSize:'18px',fontWeight:700}}>Rate Cards</h1>
          <p style={{fontSize:'12px',color:'var(--text3)',marginTop:'2px'}}>{rcs.length} roles defined</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Rate Card</button>
      </div>

      <div style={{display:'flex',gap:'4px',marginBottom:'16px',flexWrap:'wrap'}}>
        {(['all', ...CATEGORIES] as string[]).map(cat => (
          <button key={cat} className="btn btn-sm"
            style={{ background: catFilter===cat ? 'var(--accent)' : 'var(--bg)', color: catFilter===cat ? '#fff' : 'var(--text)' }}
            onClick={() => setCatFilter(cat)}>
            {cat === 'all' ? `All (${rcs.length})` : `${cat.charAt(0).toUpperCase()+cat.slice(1)} (${catCounts[cat]||0})`}
          </button>
        ))}
      </div>

      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">💲</div>
          <h3>No rate cards yet</h3>
          <p>Add rate cards to define labour costs for this project.</p>
        </div>
      ) : (
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <table>
            <thead>
              <tr>
                <th>Role</th><th>Category</th><th>Vendor</th>
                <th style={{textAlign:'right'}}>Day NT</th>
                <th style={{textAlign:'right'}}>Night NT</th>
                <th style={{textAlign:'right'}}>LAHA/FSA</th>
                <th style={{textAlign:'right'}}>Meal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(rc => {
                const catStyles: Record<string,{bg:string,color:string}> = {
                  trades:{bg:'#dbeafe',color:'#1e40af'}, management:{bg:'#d1fae5',color:'#065f46'},
                  seag:{bg:'#fef3c7',color:'#92400e'}, subcontractor:{bg:'#f3e8ff',color:'#6b21a8'},
                }
                const cs = catStyles[rc.category] || {bg:'#f1f5f9',color:'#64748b'}
                return (
                  <tr key={rc.id}>
                    <td style={{fontWeight:500}}>
                      {rc.role}
                      {rc.subcon_vendor&&<div style={{fontSize:'10px',color:'var(--text3)'}}>{rc.subcon_vendor}</div>}
                    </td>
                    <td>
                      <span className="badge" style={cs}>{rc.category.slice(0,4)}</span>
                      {rc.currency && rc.currency !== (activeProject?.currency||'AUD') && (
                        <span style={{marginLeft:'4px',fontSize:'9px',background:'#eff6ff',color:'#1d4ed8',padding:'1px 5px',borderRadius:'3px',fontFamily:'var(--mono)',fontWeight:700}}>
                          {rc.currency}
                        </span>
                      )}
                    </td>
                    {(['dnt','dt15','ddt','ddt15','nnt','ndt','ndt15'] as const).map(b=>{
                      const s=(rc.rates as {sell:Record<string,number>})?.sell?.[b]||0
                      const co=(rc.rates as {cost:Record<string,number>})?.cost?.[b]||0
                      const gm=s>0?((s-co)/s*100):null
                      const sym = rc.currency ? (CURRENCY_SYMBOLS[rc.currency]||'$') : '$'
                      return <td key={b} style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px'}}>
                        {s>0?<><div>{sym}{s.toFixed(2)}</div>{gm!==null&&<div style={{fontSize:'9px',color:'var(--green)'}}>{gm.toFixed(0)}%</div>}</>:'—'}
                      </td>
                    })}
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px'}}>{isMgmtCat(rc.category)?`$${(rc.fsa_sell||0).toFixed(0)}`:`$${(rc.laha_sell||0).toFixed(0)}`}</td>
                    <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'11px'}}>${(rc.meal_sell||0).toFixed(0)}</td>
                    <td style={{textAlign:'right',whiteSpace:'nowrap'}}>
                      <button className="btn btn-sm" onClick={() => openEdit(rc)}>Edit</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px'}} title="Duplicate" onClick={() => duplicate(rc)}>⧉</button>
                      <button className="btn btn-sm" style={{marginLeft:'4px',color:'var(--red)'}} onClick={() => del(rc)}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'720px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modal === 'new' ? 'New Rate Card' : `Edit: ${(modal as RateCard).role}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{flex:2}}>
                  <label>Role / Title</label>
                  <input className="input" value={form.role} onChange={e => setForm(f=>({...f,role:e.target.value}))} placeholder="e.g. Fitter, Plant Supervisor" autoFocus />
                </div>
                <div className="fg">
                  <label>Category</label>
                  <select className="input" value={form.category} onChange={e => { const cat = e.target.value; const cur = defaultCurrencyForCategory(cat, activeProject); setForm(f=>({...f,category:cat,currency:cur})) }}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
                  </select>
                </div>
                {form.category === 'subcontractor' && (
                  <div className="fg" style={{flex:2}}>
                    <label>Vendor / Company</label>
                    <input className="input" value={form.subcon_vendor} onChange={e => setForm(f=>({...f,subcon_vendor:e.target.value}))} placeholder="e.g. Acrow, Apave" />
                  </div>
                )}
                <div className="fg">
                  <label>Rate Currency</label>
                  <select className="input" value={form.currency} onChange={e => setForm(f=>({...f,currency:e.target.value}))}>
                    <option value="AUD">AUD $</option>
                    <option value="EUR">EUR €</option>
                    <option value="USD">USD US$</option>
                    <option value="GBP">GBP £</option>
                    <option value="NZD">NZD NZ$</option>
                  </select>
                  {form.currency === 'EUR' && (
                    <div style={{fontSize:'10px',color:'var(--accent)',marginTop:'3px'}}>
                      ⚠ SE AG rates — stored in EUR, converted to {getBaseCurrency(activeProject)} for cost totals
                    </div>
                  )}
                </div>
              </div>


              <details style={{marginBottom:'8px',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'}}>
                <summary style={{padding:'8px 12px',cursor:'pointer',fontSize:'12px',fontWeight:600,color:'var(--text2)',background:'var(--bg3)',userSelect:'none',listStyle:'none',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  ⚡ Auto-Calculate from Base Rate
                  <span style={{fontSize:'10px',fontWeight:400,color:'var(--text3)'}}>Enter base rate → fill all 7 buckets</span>
                </summary>
                <div style={{padding:'12px',background:'var(--bg2)'}}>
                  <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px'}}>
                          <div className="fg" style={{margin:0}}><label style={{fontSize:'10px'}}>Day Base ($/hr)</label><input type="number" className="input" placeholder="e.g. 58.50" min={0} step={0.5} value={sched.dayBase||''} onChange={e=>setSched(s=>({...s,dayBase:parseFloat(e.target.value)||0}))} /></div>
                          <div className="fg" style={{margin:0}}><label style={{fontSize:'10px'}}>Night Base ($/hr)</label><input type="number" className="input" placeholder="Same as day if blank" min={0} step={0.5} value={sched.nightBase||''} onChange={e=>setSched(s=>({...s,nightBase:parseFloat(e.target.value)||0}))} /></div>
                          <div className="fg" style={{margin:0}}><label style={{fontSize:'10px'}}>Night Shift Allow ($/hr)</label><input type="number" className="input" placeholder="0" min={0} step={0.5} value={sched.shiftAllow||''} onChange={e=>setSched(s=>({...s,shiftAllow:parseFloat(e.target.value)||0}))} /></div>
                          <div className="fg" style={{margin:0}}><label style={{fontSize:'10px'}}>OT1 Mult (×)</label><input type="number" className="input" min={1} max={3} step={0.25} value={sched.multOT1} onChange={e=>setSched(s=>({...s,multOT1:parseFloat(e.target.value)||1.5}))} /></div>
                          <div className="fg" style={{margin:0}}><label style={{fontSize:'10px'}}>DT Mult (×)</label><input type="number" className="input" min={1} max={4} step={0.25} value={sched.multOT2} onChange={e=>setSched(s=>({...s,multOT2:parseFloat(e.target.value)||2.0}))} /></div>
                          <div className="fg" style={{margin:0}}><label style={{fontSize:'10px'}}>Sat Mult (×)</label><input type="number" className="input" min={1} max={4} step={0.25} value={sched.multSat} onChange={e=>setSched(s=>({...s,multSat:parseFloat(e.target.value)||1.5}))} /></div>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                          <div className="fg" style={{margin:0}}><label style={{fontSize:'10px'}}>Sell Markup</label>
                            <select className="input" value={sched.markupMode} onChange={e=>setSched(s=>({...s,markupMode:e.target.value as 'pct'|'fixed'|'none'}))}>
                              <option value="pct">GM % (sell = cost ÷ (1−GM))</option>
                              <option value="fixed">Fixed $ markup per hour</option>
                              <option value="none">No markup (sell = cost)</option>
                            </select>
                          </div>
                          {sched.markupMode !== 'none' && <div className="fg" style={{margin:0}}><label style={{fontSize:'10px'}}>{sched.markupMode === 'pct' ? 'GM %' : 'Markup ($/hr)'}</label><input type="number" className="input" min={0} max={99} step={0.5} value={sched.markupVal} onChange={e=>setSched(s=>({...s,markupVal:parseFloat(e.target.value)||0}))} /></div>}
                        </div>
                        <button className="btn btn-sm" style={{background:'var(--accent)',color:'#fff',alignSelf:'flex-start'}} onClick={applySchedule} disabled={!sched.dayBase}>
                          ⚡ Apply — fill all 7 buckets
                        </button>
                      </div>
                </div>
              </details>

              <div>
                <div style={{fontSize:'12px',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'8px'}}>
                  Hourly Rates
                  {form.currency !== getBaseCurrency(activeProject) && (
                    <span style={{marginLeft:'8px',fontSize:'10px',fontWeight:400,color:'var(--orange)',background:'rgba(234,88,12,0.1)',padding:'1px 6px',borderRadius:'4px'}}>
                      {CURRENCY_SYMBOLS[form.currency] || form.currency} {form.currency} — converted at display
                    </span>
                  )}
                </div>
                <table style={{fontSize:'12px'}}>
                  <thead>
                    <tr><th>Bucket</th><th style={{textAlign:'right'}}>Cost ({CURRENCY_SYMBOLS[form.currency]||form.currency}/hr)</th><th style={{textAlign:'right'}}>Sell ({CURRENCY_SYMBOLS[form.currency]||form.currency}/hr)</th></tr>
                  </thead>
                  <tbody>
                    {RATE_BUCKETS.map(b => (
                      <tr key={b}>
                        <td style={{color:'var(--text2)'}}>{BUCKET_LABELS[b]}</td>
                        <td>
                          <input type="number" className="input" style={{textAlign:'right',padding:'3px 6px'}}
                            value={form.rates.cost[b] ?? 0}
                            onChange={e => setRate('cost', b, parseFloat(e.target.value)||0)} />
                        </td>
                        <td>
                          <input type="number" className="input" style={{textAlign:'right',padding:'3px 6px'}}
                            value={form.rates.sell[b] ?? 0}
                            onChange={e => setRate('sell', b, parseFloat(e.target.value)||0)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <div style={{fontSize:'12px',fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:'8px'}}>Allowances ($/day)</div>
                <div className="fg-row">
                  {isMgmtCat(form.category) ? (<>
                    <div className="fg"><label>FSA Cost</label><input type="number" className="input" value={form.fsa_cost} onChange={e=>setForm(f=>({...f,fsa_cost:parseFloat(e.target.value)||0}))} /></div>
                    <div className="fg"><label>FSA Sell</label><input type="number" className="input" value={form.fsa_sell} onChange={e=>setForm(f=>({...f,fsa_sell:parseFloat(e.target.value)||0}))} /></div>
                  </>) : (<>
                    <div className="fg"><label>LAHA Cost</label><input type="number" className="input" value={form.laha_cost} onChange={e=>setForm(f=>({...f,laha_cost:parseFloat(e.target.value)||0}))} /></div>
                    <div className="fg"><label>LAHA Sell</label><input type="number" className="input" value={form.laha_sell} onChange={e=>setForm(f=>({...f,laha_sell:parseFloat(e.target.value)||0}))} /></div>
                  </>)}
                  <div className="fg"><label>Meal Cost</label><input type="number" className="input" value={form.meal_cost} onChange={e=>setForm(f=>({...f,meal_cost:parseFloat(e.target.value)||0}))} /></div>
                  <div className="fg"><label>Meal Sell</label><input type="number" className="input" value={form.meal_sell} onChange={e=>setForm(f=>({...f,meal_sell:parseFloat(e.target.value)||0}))} /></div>
                  <div className="fg"><label>Camp ($/night)</label><input type="number" className="input" value={form.camp} onChange={e=>setForm(f=>({...f,camp:parseFloat(e.target.value)||0}))} /></div>
                </div>
              </div>
              <details style={{border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden',marginTop:'4px'}}>
                <summary style={{padding:'8px 12px',cursor:'pointer',fontSize:'12px',fontWeight:600,color:'var(--text2)',background:'var(--bg3)',userSelect:'none',listStyle:'none',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  ⚙️ Regime Config <span style={{fontSize:'10px',fontWeight:400,color:'var(--text3)'}}>Hour thresholds for NT/OT splits — defaults: WD NT 7.2h, T1.5 3.3h</span>
                </summary>
                <div style={{padding:'12px',background:'var(--bg2)'}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'8px'}}>
                    {([
                      ['wdNT',   'Weekday NT (hrs)', 7.2],
                      ['wdT15',  'Weekday T1.5 (hrs)', 3.3],
                      ['satT15', 'Sat T1.5 (hrs)', 3.0],
                      ['nightNT','Night NT (hrs)', 7.2],
                      ['restNT', 'Rest Day NT (hrs)', 7.2],
                    ] as [keyof typeof EMPTY_REGIME, string, number][]).map(([key, label, def]) => (
                      <div key={key} className="fg" style={{margin:0}}>
                        <label style={{fontSize:'10px'}}>{label}</label>
                        <input type="number" className="input" min={0} max={24} step={0.1}
                          value={form.regime[key] ?? def}
                          onChange={e => setForm(f => ({ ...f, regime: { ...f.regime, [key]: parseFloat(e.target.value) || 0 } }))} />
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:'10px',color:'var(--text3)',marginTop:'6px'}}>
                    Weekday day shift: first <b>wdNT</b> hrs = NT, next <b>wdT15</b> = T1.5, remainder = DT. Night: first <b>nightNT</b> = NT, remainder = DT. Sat T1.5 applies before DT on Saturday (lt12 regime).
                  </div>
                </div>
              </details>

              {modal !== 'new' && <button className="btn" style={{color:'var(--red)',marginRight:'auto'}} onClick={()=>{del(modal as RateCard);setModal(null)}}>Delete</button>}
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
