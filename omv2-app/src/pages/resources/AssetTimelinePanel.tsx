/**
 * AssetTimelinePanel.tsx
 * Cross-project Gantt of SEA asset deployments across 2026.
 * Mirrors AvailabilityTimelinePanel but for physical assets.
 * Teal bars = active deployments. Free gaps = available for assignment.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

interface AssetRow {
  asset_id: string
  asset_tag: string
  name: string
  category: string | null
  calibration_due: string | null
  service_due: string | null
  weekly_rate: number | null
  daily_rate: number | null
  charge_unit: string | null
  bars: { label: string; start: string; end: string; projectId: string }[]
}

const WINDOW_START = '2026-01-01'
const WINDOW_END   = '2026-12-31'
const WINDOW_DAYS  = Math.round((new Date(WINDOW_END).getTime() - new Date(WINDOW_START).getTime()) / 86400000) + 1
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const NAME_W = 220

const CAT_COLORS: Record<string, string> = {
  'TOOLING CONTAINERS': '#0369a1', 'WORKSHOP CONTAINERS': '#7c3aed',
  'STORAGE CONTAINERS': '#059669', 'GANGBOXES & OTHER': '#d97706',
  'INDUCTION HEATERS': '#dc2626', 'TORQUE TOOLS': '#0891b2',
  'VIDEO SCOPES': '#4f46e5', 'BORESCOPES': '#6d28d9',
  'ALIGNMENT': '#15803d', 'ROLLER STANDS': '#92400e',
  'COM & TESTING': '#1d4ed8', 'ELECTRICAL / HV TESTING': '#9333ea',
  'OTHER BOLT HEATERS': '#be123c', 'MISC': '#64748b',
}

function dateToX(dateStr: string, w: number): number {
  const d = new Date(Math.max(new Date(WINDOW_START).getTime(), Math.min(new Date(WINDOW_END).getTime(), new Date(dateStr).getTime())))
  return ((Math.round((d.getTime() - new Date(WINDOW_START).getTime()) / 86400000)) / WINDOW_DAYS) * w
}

function dateWidth(start: string, end: string, w: number): number {
  const s = Math.max(new Date(WINDOW_START).getTime(), new Date(start).getTime())
  const e = Math.min(new Date(WINDOW_END).getTime(), new Date(end).getTime())
  return e <= s ? 0 : (Math.round((e - s) / 86400000) / WINDOW_DAYS) * w
}

function shortProjName(n: string) {
  return n.replace(/\d{4}\s*[-–]?\s*/g, '').replace(/Outage/i, '').trim().slice(0, 18)
}

export function AssetTimelinePanel() {
  const [rows, setRows] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [availOnly, setAvailOnly] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(800)

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setChartWidth(Math.max(500, e.contentRect.width - NAME_W - 20))
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [assetsData, deplData] = await Promise.all([
      supabase.from('sea_assets').select('id, asset_tag, name, category, calibration_due, service_due, weekly_rate, daily_rate, charge_unit').order('category').order('name'),
      supabase.from('sea_asset_deployments').select('sea_asset_id, start_date, end_date, project_id, projects:project_id(name)'),
    ])

    const deplMap = new Map<string, { label: string; start: string; end: string; projectId: string }[]>()
    for (const d of (deplData.data || []) as Record<string, unknown>[]) {
      const aid = d.sea_asset_id as string
      if (!deplMap.has(aid)) deplMap.set(aid, [])
      const proj = d.projects as { name: string } | null
      deplMap.get(aid)!.push({
        label: proj ? shortProjName(proj.name) : 'Project',
        start: d.start_date as string,
        end:   (d.end_date as string) ?? WINDOW_END,
        projectId: d.project_id as string,
      })
    }

    setRows(((assetsData.data || []) as Record<string, unknown>[]).map(a => ({
      asset_id:       a.id as string,
      asset_tag:      a.asset_tag as string,
      name:           a.name as string,
      category:       a.category as string | null,
      calibration_due: a.calibration_due as string | null,
      service_due:    a.service_due as string | null,
      weekly_rate:    a.weekly_rate as number | null,
      daily_rate:     a.daily_rate as number | null,
      charge_unit:    a.charge_unit as string | null,
      bars:           (deplMap.get(a.id as string) ?? []).sort((x, y) => x.start.localeCompare(y.start)),
    })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => [...new Set(rows.map(r => r.category).filter(Boolean))].sort() as string[], [rows])

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (catFilter !== 'all' && r.category !== catFilter) return false
      if (availOnly) {
        const onSiteNow = r.bars.some(b => b.start <= today && b.end >= today)
        if (onSiteNow) return false
      }
      if (!q) return true
      return r.name.toLowerCase().includes(q) || r.asset_tag.toLowerCase().includes(q)
    })
  }, [rows, search, catFilter, availOnly])

  const todayX = dateToX(new Date().toISOString().slice(0, 10), chartWidth)
  const monthMarkers = MONTHS.map((m, i) => ({ label: m, x: dateToX(`2026-${String(i+1).padStart(2,'0')}-01`, chartWidth) }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Asset Timeline</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{filtered.length} assets · Jan → Dec 2026</div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={load}>↻ Refresh</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="search" placeholder="Search name or tag…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 160px', minWidth: 140, fontSize: 12, border: '1px solid var(--border2)', borderRadius: 'var(--radius)', padding: '6px 10px', background: 'var(--bg3)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }} />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="btn btn-sm btn-secondary" style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
            <option value="all">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text2)', userSelect: 'none' }}>
            <input type="checkbox" checked={availOnly} onChange={e => setAvailOnly(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            Available now only
          </label>
          {(search || catFilter !== 'all' || availOnly) && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setSearch(''); setCatFilter('all'); setAvailOnly(false) }} style={{ color: 'var(--text3)' }}>✕ Clear</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /></div>
      ) : (
        <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {/* Month header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', flexShrink: 0 }}>
            <div style={{ width: NAME_W, minWidth: NAME_W, flexShrink: 0, padding: '7px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', borderRight: '1px solid var(--border)' }}>Asset</div>
            <div style={{ flex: 1, position: 'relative', height: 30 }}>
              {monthMarkers.map(({ label, x }) => (
                <div key={label} style={{ position: 'absolute', left: x, height: '100%', borderLeft: '1px solid var(--border)', paddingLeft: 4, display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{label}</span>
                </div>
              ))}
              <div style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2, background: 'var(--accent)', opacity: 0.8 }} />
            </div>
          </div>

          {/* Asset rows */}
          {filtered.length === 0 ? (
            <div className="empty-state"><div style={{ fontSize: 24, marginBottom: 8 }}>🧰</div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>No assets match</div></div>
          ) : (
            filtered.map((asset, idx) => {
              const catColor = CAT_COLORS[asset.category ?? ''] ?? 'var(--text3)'
              const today = new Date().toISOString().slice(0, 10)
              const isOnSite = asset.bars.some(b => b.start <= today && b.end >= today)
              const rowBg = idx % 2 === 0 ? 'var(--bg)' : 'var(--bg2)'

              return (
                <div key={asset.asset_id} style={{ display: 'flex', height: 32, borderBottom: '1px solid var(--border)', background: rowBg }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-light)')}
                  onMouseLeave={e => (e.currentTarget.style.background = rowBg)}>
                  <div style={{ width: NAME_W, minWidth: NAME_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: isOnSite ? 'var(--accent)' : 'var(--green)' }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</div>
                      <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: catColor }}>{asset.asset_tag}</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    {monthMarkers.map(({ label, x }) => (
                      <div key={label} style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1, background: 'var(--border)', opacity: 0.5 }} />
                    ))}
                    <div style={{ position: 'absolute', left: todayX, top: 2, bottom: 2, width: 2, background: 'var(--accent)', opacity: 0.6, borderRadius: 1, zIndex: 5 }} />
                    {asset.bars.map((bar, bi) => {
                      const x = dateToX(bar.start, chartWidth)
                      const w = Math.max(4, dateWidth(bar.start, bar.end, chartWidth))
                      if (w <= 0) return null
                      return (
                        <div key={bi} title={`${bar.label}\n${bar.start} → ${bar.end}`}
                          style={{ position: 'absolute', left: x, top: 5, bottom: 5, width: w, borderRadius: 3, background: 'var(--accent)', opacity: 0.8, display: 'flex', alignItems: 'center', paddingLeft: 4, overflow: 'hidden', zIndex: 4 }}>
                          {w > 35 && <span style={{ fontSize: 9, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: w - 8 }}>{bar.label}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
