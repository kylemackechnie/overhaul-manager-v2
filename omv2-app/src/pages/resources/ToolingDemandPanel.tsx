/**
 * ToolingDemandPanel.tsx
 * Demand vs Supply for SEA local tooling — mirrors DemandSupplyPanel for people.
 * Shows crew_plan rows with slot_type='tooling' across projects.
 * Open slots show a red + OPEN chip — clicking opens asset picker.
 * Also shows a flat deployment view per project as fallback.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'

interface ToolingSlot {
  id: string
  project_id: string
  role: string          // used as tool type/name for tooling slots
  qty: number
  mob_in: string | null
  mob_out: string | null
  source: string
  sea_asset_id: string | null
  // assigned asset (if any)
  assigned?: { asset_tag: string; name: string }
}

interface Deployment {
  id: string
  asset_tag: string
  asset_name: string
  category: string | null
  start_date: string
  end_date: string | null
  weekly_rate: number | null
  daily_rate: number | null
  charge_unit: string | null
  wbs: string | null
}

interface Project {
  id: string
  name: string
  start_date: string | null
  end_date: string | null
}

interface SeaAsset {
  id: string
  asset_tag: string
  name: string
  category: string | null
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function AssetPicker({ onSelect, onClose }: {
  onSelect: (asset: SeaAsset) => void
  onClose: () => void
}) {
  const [assets, setAssets] = useState<SeaAsset[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.from('sea_assets').select('id, asset_tag, name, category').order('category').order('name')
      .then(({ data }) => setAssets((data || []) as SeaAsset[]))
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return assets.filter(a => !q || a.name.toLowerCase().includes(q) || a.asset_tag.toLowerCase().includes(q))
  }, [assets, search])

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} onClick={onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', zIndex: 1001, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Assign Asset</div>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
          <input type="search" placeholder="Search name or tag…" value={search} onChange={e => setSearch(e.target.value)} autoFocus
            style={{ width: '100%', fontSize: 12, border: '1px solid var(--border2)', borderRadius: 'var(--radius)', padding: '6px 10px', background: 'var(--bg3)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)', boxSizing: 'border-box' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map(a => (
            <button key={a.id} onClick={() => { onSelect(a); onClose() }}
              style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-light)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{a.name}</div>
                <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', marginTop: 1 }}>{a.asset_tag} · {a.category ?? ''}</div>
              </div>
              <span style={{ color: 'var(--accent)', fontSize: 16 }}>›</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

export function ToolingDemandPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [slots, setSlots] = useState<ToolingSlot[]>([])
  const [deployments, setDeployments] = useState<Map<string, Deployment[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [projFilter, setProjFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'plan' | 'deployments'>('deployments')
  const [pickerSlot, setPickerSlot] = useState<ToolingSlot | null>(null)

  const load = useCallback(async () => {
    setLoading(true)

    const [projData, slotsData, deplData] = await Promise.all([
      supabase.from('projects').select('id, name, start_date, end_date').not('name', 'ilike', '%test%').neq('name', 'tet').order('start_date'),
      supabase.from('crew_plan').select('id, project_id, role, qty, mob_in, mob_out, source, sea_asset_id, sea_assets:sea_asset_id(asset_tag, name)').eq('slot_type', 'tooling').order('role'),
      supabase.from('sea_asset_deployments')
        .select('id, project_id, start_date, end_date, wbs, weekly_rate, daily_rate, charge_unit, sea_assets:sea_asset_id(asset_tag, name, category)')
        .order('start_date'),
    ])

    // Build slots
    const builtSlots: ToolingSlot[] = ((slotsData.data || []) as Record<string, unknown>[]).map(s => {
      const a = s.sea_assets as { asset_tag: string; name: string } | null
      return {
        id: s.id as string,
        project_id: s.project_id as string,
        role: s.role as string,
        qty: s.qty as number,
        mob_in: s.mob_in as string | null,
        mob_out: s.mob_out as string | null,
        source: s.source as string,
        sea_asset_id: s.sea_asset_id as string | null,
        assigned: a ? { asset_tag: a.asset_tag, name: a.name } : undefined,
      }
    })

    // Build deployments map: project_id → deployments
    const deplMap = new Map<string, Deployment[]>()
    for (const d of (deplData.data || []) as Record<string, unknown>[]) {
      const pid = d.project_id as string
      const asset = d.sea_assets as { asset_tag: string; name: string; category: string | null } | null
      if (!deplMap.has(pid)) deplMap.set(pid, [])
      deplMap.get(pid)!.push({
        id:          d.id as string,
        asset_tag:   asset?.asset_tag ?? '',
        asset_name:  asset?.name ?? '',
        category:    asset?.category ?? null,
        start_date:  d.start_date as string,
        end_date:    d.end_date as string | null,
        weekly_rate: d.weekly_rate as number | null,
        daily_rate:  d.daily_rate as number | null,
        charge_unit: d.charge_unit as string | null,
        wbs:         d.wbs as string | null,
      })
    }

    setProjects((projData.data || []) as Project[])
    setSlots(builtSlots)
    setDeployments(deplMap)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAssignAsset(asset: SeaAsset) {
    if (!pickerSlot) return
    const { error } = await supabase.from('crew_plan').update({ sea_asset_id: asset.id }).eq('id', pickerSlot.id)
    if (error) { toast(error.message, 'error'); return }
    // Also create a deployment record
    const { error: de } = await supabase.from('sea_asset_deployments').insert({
      sea_asset_id: asset.id,
      project_id:   pickerSlot.project_id,
      start_date:   pickerSlot.mob_in || new Date().toISOString().slice(0, 10),
      end_date:     pickerSlot.mob_out || null,
    })
    if (de) { toast(de.message, 'error'); return }
    toast(`${asset.name} assigned`, 'success')
    setPickerSlot(null)
    load()
  }

  const filteredProjects = useMemo(() =>
    projects.filter(p => projFilter === 'all' || p.id === projFilter),
    [projects, projFilter]
  )

  const totalOpen = slots.filter(s => !s.sea_asset_id).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Tooling Demand vs Supply</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {totalOpen > 0 ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{totalOpen} open tooling slots</span> : 'All tooling slots assigned'}
            </div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={load}>↻ Refresh</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 2 }}>
            {([['deployments', '🧰 Deployments'], ['plan', '📋 Tooling Plan']] as [string, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setViewMode(v as 'plan' | 'deployments')}
                style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer', background: viewMode === v ? 'var(--bg2)' : 'transparent', color: viewMode === v ? 'var(--accent)' : 'var(--text3)', boxShadow: viewMode === v ? 'var(--shadow)' : 'none' }}>
                {label}
              </button>
            ))}
          </div>
          {viewMode === 'plan' && slots.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--orange)', fontStyle: 'italic' }}>No tooling plan slots — add via Projects → Resources → Crew Plan (set type to Tooling)</span>
          )}
        </div>

        <select value={projFilter} onChange={e => setProjFilter(e.target.value)}
          className="btn btn-sm btn-secondary" style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
          <option value="all">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <div className="loading-center"><span className="spinner" /></div>
        ) : viewMode === 'deployments' ? (
          // ── Deployments view ───────────────────────────────────────────────
          filteredProjects.map(proj => {
            const depls = (deployments.get(proj.id) || [])
            if (depls.length === 0) return null
            return (
              <div key={proj.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{proj.name}</div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', marginTop: 2 }}>{fmtDate(proj.start_date)} → {fmtDate(proj.end_date)} · {depls.length} assets</div>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                      {['Asset', 'Tag', 'Category', 'Start', 'End', 'Rate', 'WBS'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depls.map((d, i) => (
                      <tr key={d.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg)' }}>
                        <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{d.asset_name}</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{d.asset_tag}</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text2)' }}>{d.category ?? '—'}</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{fmtDate(d.start_date)}</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{fmtDate(d.end_date)}</td>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text2)' }}>
                          {d.weekly_rate ? `$${d.weekly_rate.toLocaleString()}/wk` : d.daily_rate ? `$${d.daily_rate.toLocaleString()}/day` : '—'}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{d.wbs ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })
        ) : (
          // ── Plan view ──────────────────────────────────────────────────────
          slots.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 32, marginBottom: 8 }}>🧰</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>No tooling plan slots defined</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', maxWidth: 360, textAlign: 'center' }}>
                Add tooling requirements via Projects → Resources → 🎯 Crew Plan, then set slot type to Tooling.
              </div>
            </div>
          ) : (
            filteredProjects.map(proj => {
              const projSlots = slots.filter(s => s.project_id === proj.id)
              if (projSlots.length === 0) return null
              const openCount = projSlots.filter(s => !s.sea_asset_id).length
              return (
                <div key={proj.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 16, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{proj.name}</div>
                    {openCount > 0 && <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>{openCount} open</span>}
                  </div>
                  {projSlots.map(slot => (
                    <div key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 160, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{slot.role}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDate(slot.mob_in)} → {fmtDate(slot.mob_out)}</div>
                      <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        {slot.assigned ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--accent-light)', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3 }}>
                            {slot.assigned.asset_tag} · {slot.assigned.name}
                          </span>
                        ) : (
                          Array.from({ length: slot.qty }).map((_, i) => (
                            <button key={i} onClick={() => setPickerSlot(slot)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff1f2', border: '1px dashed var(--red)', color: 'var(--red)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3, cursor: 'pointer' }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#ffe4e6')}
                              onMouseLeave={e => (e.currentTarget.style.background = '#fff1f2')}>
                              + OPEN
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })
          )
        )}
      </div>

      {pickerSlot && (
        <AssetPicker
          onSelect={handleAssignAsset}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  )
}
