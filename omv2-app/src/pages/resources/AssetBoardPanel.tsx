/**
 * AssetBoardPanel.tsx
 * The Resource Manager's view of all 131 SEA-owned assets.
 * Mirrors the Resource Board but for physical assets.
 * Groups by live status: Available / On Site / In Transit / In Service (cal/service due)
 *
 * Status is computed live:
 *   On Site    = has a deployment whose date range covers today
 *   In Transit = sea_assets.status = 'in_transit' (manually set)
 *   In Service = calibration_due or service_due < today
 *   Available  = everything else
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Asset {
  id: string
  asset_tag: string
  name: string
  category: string | null
  status: string         // from sea_assets.status column
  calibration_due: string | null
  service_due: string | null
  home_location: string | null
  weekly_rate: number | null
  daily_rate: number | null
  charge_unit: string | null
  notes: string | null
  // current deployment (if on site)
  deployment?: {
    project_name: string
    project_id: string
    start_date: string
    end_date: string | null
  }
}

type LiveStatus = 'available' | 'onsite' | 'in_transit' | 'in_service'

interface Project {
  id: string
  name: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  'TOOLING CONTAINERS':   '#0369a1',
  'WORKSHOP CONTAINERS':  '#7c3aed',
  'STORAGE CONTAINERS':   '#059669',
  'GANGBOXES & OTHER':    '#d97706',
  'INDUCTION HEATERS':    '#dc2626',
  'OTHER BOLT HEATERS':   '#be123c',
  'TORQUE TOOLS':         '#0891b2',
  'VIDEO SCOPES':         '#4f46e5',
  'BORESCOPES':           '#6d28d9',
  'ALIGNMENT':            '#15803d',
  'ROLLER STANDS':        '#92400e',
  'COM & TESTING':        '#1d4ed8',
  'ELECTRICAL / HV TESTING': '#9333ea',
  'MISC':                 '#64748b',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLiveStatus(asset: Asset): LiveStatus {
  const today = new Date().toISOString().slice(0, 10)
  if (asset.status === 'in_transit') return 'in_transit'
  const calExp = asset.calibration_due && asset.calibration_due < today
  const svcExp = asset.service_due && asset.service_due < today
  if (calExp || svcExp) return 'in_service'
  if (asset.deployment) {
    const { start_date, end_date } = asset.deployment
    if (start_date <= today && (!end_date || end_date >= today)) return 'onsite'
  }
  return 'available'
}

function calibrationStatus(asset: Asset): 'ok' | 'due' | 'overdue' | 'none' {
  const today = new Date().toISOString().slice(0, 10)
  const soon  = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  const d = asset.calibration_due || asset.service_due
  if (!d) return 'none'
  if (d < today) return 'overdue'
  if (d <= soon)  return 'due'
  return 'ok'
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

function shortProjName(name: string) {
  return name.replace(/\d{4}\s*[-–]?\s*/g, '').replace(/Outage/i, '').trim().slice(0, 20)
}

// ── Asset Card ────────────────────────────────────────────────────────────────

function AssetCard({
  asset, liveStatus, onEdit,
}: {
  asset: Asset
  liveStatus: LiveStatus
  onEdit: (asset: Asset) => void
}) {
  const calStatus = calibrationStatus(asset)
  const calDotColor = { ok: 'var(--green)', due: 'var(--orange)', overdue: 'var(--red)', none: 'var(--text3)' }[calStatus]
  const calLabel = {
    ok:      asset.calibration_due ? `Cal OK · ${fmtDate(asset.calibration_due)}` : `Service OK · ${fmtDate(asset.service_due)}`,
    due:     `${asset.calibration_due ? 'Cal' : 'Service'} due soon`,
    overdue: `${asset.calibration_due ? 'Cal' : 'Service'} OVERDUE`,
    none:    'No cal/service date',
  }[calStatus]

  const catColor = CAT_COLORS[asset.category ?? ''] ?? 'var(--text3)'
  const borderColor = calStatus === 'overdue' ? '#fca5a5' : calStatus === 'due' ? '#fcd34d' : 'var(--border)'

  return (
    <div
      onClick={() => onEdit(asset)}
      style={{
        background: 'var(--bg2)', border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius)', padding: '11px 13px', cursor: 'pointer',
        transition: 'border-color 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = borderColor}
    >
      {/* Tag + name */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 5 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {asset.name}
          </div>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', marginTop: 1 }}>
            {asset.asset_tag}
          </div>
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, flexShrink: 0, background: catColor + '22', color: catColor, border: `1px solid ${catColor}44` }}>
          {(asset.category ?? '').split(' ')[0]}
        </span>
      </div>

      {/* Deployment */}
      {asset.deployment && liveStatus === 'onsite' && (
        <div style={{ fontSize: 10, marginBottom: 5 }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>
            {shortProjName(asset.deployment.project_name)}
          </span>
          <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', marginLeft: 6 }}>
            → {fmtDate(asset.deployment.end_date)}
          </span>
        </div>
      )}

      {/* Rate */}
      {(asset.weekly_rate || asset.daily_rate) && (
        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 5 }}>
          ${asset.weekly_rate ? `${asset.weekly_rate.toLocaleString()}/wk` : `${asset.daily_rate?.toLocaleString()}/day`}
        </div>
      )}

      {/* Cal status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: calDotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: calDotColor }}>{calLabel}</span>
      </div>
    </div>
  )
}

// ── Board Section ─────────────────────────────────────────────────────────────

function BoardSection({ title, dot, count, children }: {
  title: string; dot: string; count: number; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ marginBottom: 20 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: open ? 10 : 0, cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)' }}>{title}</span>
        <span style={{ fontSize: 10, fontFamily: 'var(--mono)', padding: '1px 7px', borderRadius: 10, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)' }}>{count}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && children}
    </div>
  )
}

// ── Asset Edit Modal ──────────────────────────────────────────────────────────

function AssetModal({ asset, projects, onSave, onClose }: {
  asset: Asset; projects: Project[]
  onSave: (updates: Partial<Asset>, deploymentProjectId?: string, deploymentStart?: string, deploymentEnd?: string) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState({
    status:           asset.status,
    calibration_due:  asset.calibration_due ?? '',
    service_due:      asset.service_due ?? '',
    home_location:    asset.home_location ?? '',
    notes:            asset.notes ?? '',
  })
  const [deployProj, setDeployProj] = useState('')
  const [deployStart, setDeployStart] = useState('')
  const [deployEnd, setDeployEnd] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await onSave(
      { ...form, calibration_due: form.calibration_due || null, service_due: form.service_due || null, home_location: form.home_location || null, notes: form.notes || null } as Partial<Asset>,
      deployProj || undefined,
      deployStart || undefined,
      deployEnd || undefined,
    )
    setSaving(false)
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} onClick={onClose} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 480, maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', zIndex: 1001 }}>
        <div style={{ padding: '14px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{asset.name}</div>
            <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{asset.asset_tag}</div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Status */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Status</label>
            <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="available">Available</option>
              <option value="in_transit">In Transit</option>
              <option value="in_service">In Service / Calibration</option>
            </select>
          </div>

          {/* Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Calibration Due</label>
              <input className="input" type="date" value={form.calibration_due} onChange={e => setForm(f => ({ ...f, calibration_due: e.target.value }))} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Service Due</label>
              <input className="input" type="date" value={form.service_due} onChange={e => setForm(f => ({ ...f, service_due: e.target.value }))} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Home Location</label>
            <input className="input" value={form.home_location} onChange={e => setForm(f => ({ ...f, home_location: e.target.value }))} placeholder="e.g. Dandenong Warehouse Bay 3" />
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Notes</label>
            <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
          </div>

          {/* Assign to project */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>Assign to Project</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select className="input" value={deployProj} onChange={e => setDeployProj(e.target.value)}>
                <option value="">— Select project (optional) —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {deployProj && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Start Date</label>
                    <input className="input" type="date" value={deployStart} onChange={e => setDeployStart(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>End Date</label>
                    <input className="input" type="date" value={deployEnd} onChange={e => setDeployEnd(e.target.value)} />
                  </div>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>Creates a deployment record. The PM also sees it in their Equipment → SEA Local Tooling tab.</div>
            </div>
          </div>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null} Save
          </button>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function AssetBoardPanel() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [editAsset, setEditAsset] = useState<Asset | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)

    const [assetsData, deploymentsData, projData] = await Promise.all([
      supabase.from('sea_assets').select('*').order('category').order('name'),
      supabase.from('sea_asset_deployments')
        .select('sea_asset_id, start_date, end_date, project_id, projects:project_id(name)')
        .lte('start_date', today)
        .or(`end_date.gte.${today},end_date.is.null`),
      supabase.from('projects').select('id, name').not('name', 'ilike', '%test%').neq('name', 'tet').order('start_date'),
    ])

    // Build deployment map: asset_id → current deployment
    const deplMap = new Map<string, Asset['deployment']>()
    for (const d of (deploymentsData.data || []) as Record<string, unknown>[]) {
      const proj = d.projects as { name: string } | null
      deplMap.set(d.sea_asset_id as string, {
        project_name: proj?.name ?? 'Unknown',
        project_id:   d.project_id as string,
        start_date:   d.start_date as string,
        end_date:     d.end_date as string | null,
      })
    }

    const built: Asset[] = ((assetsData.data || []) as Record<string, unknown>[]).map(a => ({
      id:               a.id as string,
      asset_tag:        a.asset_tag as string,
      name:             a.name as string,
      category:         a.category as string | null,
      status:           a.status as string,
      calibration_due:  a.calibration_due as string | null,
      service_due:      a.service_due as string | null,
      home_location:    a.home_location as string | null,
      weekly_rate:      a.weekly_rate as number | null,
      daily_rate:       a.daily_rate as number | null,
      charge_unit:      a.charge_unit as string | null,
      notes:            a.notes as string | null,
      deployment:       deplMap.get(a.id as string),
    }))

    setAssets(built)
    setProjects((projData.data || []) as Project[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => [...new Set(assets.map(a => a.category).filter(Boolean))].sort(), [assets])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets.filter(a => {
      if (catFilter !== 'all' && a.category !== catFilter) return false
      if (!q) return true
      return a.name.toLowerCase().includes(q) || a.asset_tag.toLowerCase().includes(q)
    })
  }, [assets, search, catFilter])

  const groups = useMemo(() => {
    const g: Record<LiveStatus, Asset[]> = { onsite: [], in_transit: [], in_service: [], available: [] }
    for (const a of filtered) g[getLiveStatus(a)].push(a)
    return g
  }, [filtered])

  const stats = useMemo(() => ({
    available:  assets.filter(a => getLiveStatus(a) === 'available').length,
    onsite:     assets.filter(a => getLiveStatus(a) === 'onsite').length,
    in_transit: assets.filter(a => getLiveStatus(a) === 'in_transit').length,
    in_service: assets.filter(a => getLiveStatus(a) === 'in_service').length,
  }), [assets])

  async function handleSave(updates: Partial<Asset>, deployProjectId?: string, deployStart?: string, deployEnd?: string) {
    if (!editAsset) return
    const { error } = await supabase.from('sea_assets').update({
      status:          updates.status,
      calibration_due: updates.calibration_due ?? null,
      service_due:     updates.service_due ?? null,
      home_location:   updates.home_location ?? null,
      notes:           updates.notes ?? null,
    }).eq('id', editAsset.id)

    if (error) { toast(error.message, 'error'); return }

    if (deployProjectId && deployStart) {
      const { error: de } = await supabase.from('sea_asset_deployments').insert({
        sea_asset_id: editAsset.id,
        project_id:   deployProjectId,
        start_date:   deployStart,
        end_date:     deployEnd || null,
        weekly_rate:  editAsset.weekly_rate,
        daily_rate:   editAsset.daily_rate,
        charge_unit:  editAsset.charge_unit,
      })
      if (de) { toast(de.message, 'error'); return }
    }

    toast('Asset updated', 'success')
    setEditAsset(null)
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 20px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Asset Board</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>SEA-owned local tooling fleet · {assets.length} assets</div>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={load}>↻ Refresh</button>
        </div>

        {/* KPI */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {[
            { label: 'Available',   val: stats.available,  color: 'var(--green)'  },
            { label: 'On Site',     val: stats.onsite,     color: 'var(--accent)' },
            { label: 'In Transit',  val: stats.in_transit, color: 'var(--blue)'   },
            { label: 'In Service',  val: stats.in_service, color: stats.in_service > 0 ? 'var(--red)' : 'var(--text3)' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px', borderTop: `3px solid ${color}`, minWidth: 90 }}>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{val}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="search" placeholder="Search name or tag…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 180px', minWidth: 160, fontSize: 12, border: '1px solid var(--border2)', borderRadius: 'var(--radius)', padding: '6px 10px', background: 'var(--bg3)', color: 'var(--text)', outline: 'none', fontFamily: 'var(--sans)' }} />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="btn btn-sm btn-secondary" style={{ fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
            <option value="all">All categories</option>
            {categories.map(c => <option key={c!} value={c!}>{c}</option>)}
          </select>
          {(search || catFilter !== 'all') && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setSearch(''); setCatFilter('all') }} style={{ color: 'var(--text3)' }}>✕ Clear</button>
          )}
        </div>
      </div>

      {/* Board */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading ? (
          <div className="loading-center"><span className="spinner" /></div>
        ) : (
          <>
            {stats.in_service > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7ed', border: '1px solid #fbbf24', borderRadius: 'var(--radius)', fontSize: 12, color: '#78350f', display: 'flex', gap: 8, alignItems: 'center' }}>
                ⚠️ <strong>{stats.in_service} {stats.in_service === 1 ? 'asset' : 'assets'}</strong> with overdue calibration or service
              </div>
            )}
            {([
              { key: 'onsite'     as LiveStatus, title: 'On Site',        dot: 'var(--accent)' },
              { key: 'in_transit' as LiveStatus, title: 'In Transit',     dot: 'var(--blue)'   },
              { key: 'in_service' as LiveStatus, title: 'In Service / Cal Due', dot: 'var(--red)' },
              { key: 'available'  as LiveStatus, title: 'Available',      dot: 'var(--green)'  },
            ]).map(({ key, title, dot }) => (
              <BoardSection key={key} title={title} dot={dot} count={groups[key].length}>
                {groups[key].length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text3)', padding: '4px 0', fontStyle: 'italic' }}>None</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                    {groups[key].map(a => (
                      <AssetCard key={a.id} asset={a} liveStatus={key} onEdit={setEditAsset} />
                    ))}
                  </div>
                )}
              </BoardSection>
            ))}
          </>
        )}
      </div>

      {editAsset && (
        <AssetModal
          asset={editAsset}
          projects={projects}
          onSave={handleSave}
          onClose={() => setEditAsset(null)}
        />
      )}
    </div>
  )
}
