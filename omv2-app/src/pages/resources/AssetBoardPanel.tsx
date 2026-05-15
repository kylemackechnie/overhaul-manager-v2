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
import { usePermissions } from '../../lib/permissions'
import { toast } from '../../components/ui/Toast'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Asset {
  id: string
  asset_tag: string
  name: string
  category: string | null
  status: string
  calibration_due: string | null
  service_due: string | null
  home_location: string | null
  weekly_rate: number | null
  daily_rate: number | null
  charge_unit: string | null
  notes: string | null
  lead_time_days: number
  // currently active deployment
  deployment?: {
    project_name: string
    project_id: string
    start_date: string
    end_date: string | null
  }
  // soonest upcoming future deployment
  nextDeployment?: {
    project_name: string
    start_date: string
    end_date: string | null
  }
}

type LiveStatus = 'available' | 'onsite' | 'departing_soon' | 'scheduled' | 'in_transit' | 'in_service'

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
  // Currently on site
  if (asset.deployment) {
    const { start_date, end_date } = asset.deployment
    if (start_date <= today && (!end_date || end_date >= today)) return 'onsite'
  }
  // Has a future deployment — check lead time threshold
  if (asset.nextDeployment) {
    const leadDays = asset.lead_time_days ?? 14
    const daysUntil = Math.round((new Date(asset.nextDeployment.start_date).getTime() - Date.now()) / 86400000)
    if (daysUntil <= leadDays) return 'departing_soon'
    return 'scheduled'
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
  const borderColor = calStatus === 'overdue' ? '#fca5a5' : calStatus === 'due' ? '#fcd34d' : liveStatus === 'departing_soon' ? '#fcd34d' : 'var(--border)'

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

      {/* Deployment info — varies by status */}
      {liveStatus === 'onsite' && asset.deployment && (
        <div style={{ fontSize: 10, marginBottom: 5 }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{shortProjName(asset.deployment.project_name)}</span>
          <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', marginLeft: 6 }}>→ {fmtDate(asset.deployment.end_date)}</span>
        </div>
      )}
      {(liveStatus === 'departing_soon' || liveStatus === 'scheduled') && asset.nextDeployment && (
        <div style={{ fontSize: 10, marginBottom: 5 }}>
          <span style={{ fontWeight: 600, color: liveStatus === 'departing_soon' ? 'var(--orange)' : 'var(--blue)' }}>
            {shortProjName(asset.nextDeployment.project_name)}
          </span>
          <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', marginLeft: 6 }}>
            from {fmtDate(asset.nextDeployment.start_date)}
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

// ── Deployment year bar (mini Gantt) ─────────────────────────────────────────

const WIN_MS    = new Date('2026-01-01').getTime()
const WIN_DAYS  = 365
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function pct(dateStr: string): number {
  const d = Math.max(0, Math.min(WIN_DAYS, Math.round((new Date(dateStr).getTime() - WIN_MS) / 86400000)))
  return (d / WIN_DAYS) * 100
}

function YearGantt({ deployments }: { deployments: { start: string; end: string; label: string; color: string }[] }) {
  const today = new Date().toISOString().slice(0, 10)
  const todayPct = pct(today)
  return (
    <div>
      {/* Month labels */}
      <div style={{ display: 'flex', marginBottom: 2 }}>
        {MONTH_LABELS.map(m => (
          <div key={m} style={{ flex: 1, textAlign: 'center', fontSize: 9, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.02em' }}>{m}</div>
        ))}
      </div>
      {/* Gantt area */}
      <div style={{ position: 'relative', height: deployments.length * 22 + 4, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
        {/* Month grid lines */}
        {MONTH_LABELS.map((_, i) => (
          <div key={i} style={{ position: 'absolute', left: `${(i/12)*100}%`, top: 0, bottom: 0, width: 1, background: 'var(--border)', opacity: 0.5 }} />
        ))}
        {/* Today line */}
        <div style={{ position: 'absolute', left: `${todayPct}%`, top: 0, bottom: 0, width: 2, background: 'var(--accent)', opacity: 0.7, zIndex: 5 }} />
        {/* Deployment bars */}
        {deployments.map((d, i) => {
          const l = pct(d.start)
          const w = Math.max(1, pct(d.end) - l)
          return (
            <div key={i} title={`${d.label}: ${d.start} → ${d.end}`}
              style={{ position: 'absolute', left: `${l}%`, width: `${w}%`, top: 2 + i * 22, height: 18, borderRadius: 3, background: d.color, display: 'flex', alignItems: 'center', paddingLeft: 4, overflow: 'hidden' }}>
              {w > 5 && <span style={{ fontSize: 9, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Asset Drawer ──────────────────────────────────────────────────────────────

const PROJ_COLORS = ['#00898a','#0369a1','#7c3aed','#d97706','#dc2626','#059669','#0891b2','#4f46e5']

function AssetDrawer({ asset, projects, onSave, onClose }: {
  asset: Asset; projects: Project[]
  onSave: (updates: Partial<Asset>, deploymentProjectId?: string, deploymentStart?: string, deploymentEnd?: string) => Promise<void>
  onClose: () => void
}) {
  const [allDeployments, setAllDeployments] = useState<{
    id: string; project_id: string; project_name: string; start_date: string; end_date: string | null; wbs: string | null; weekly_rate: number | null; daily_rate: number | null; charge_unit: string | null
  }[]>([])
  const [loadingDepls, setLoadingDepls] = useState(true)
  const [form, setForm] = useState({
    status:          asset.status,
    calibration_due: asset.calibration_due ?? '',
    service_due:     asset.service_due ?? '',
    home_location:   asset.home_location ?? '',
    notes:           asset.notes ?? '',
    weekly_rate:     asset.weekly_rate?.toString() ?? '',
    daily_rate:      asset.daily_rate?.toString() ?? '',
    charge_unit:     asset.charge_unit ?? 'weekly',
  })
  const [deployProj, setDeployProj] = useState('')
  const [deployStart, setDeployStart] = useState('')
  const [deployEnd, setDeployEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'plan' | 'edit'>('plan')
  const { canWrite } = usePermissions()
  const canEditRates = canWrite('resources')

  useEffect(() => {
    supabase
      .from('sea_asset_deployments')
      .select('id, project_id, start_date, end_date, wbs, weekly_rate, daily_rate, charge_unit, projects:project_id(name)')
      .eq('sea_asset_id', asset.id)
      .order('start_date')
      .then(({ data }) => {
        setAllDeployments(((data || []) as Record<string, unknown>[]).map(d => {
          const proj = d.projects as { name: string } | null
          return {
            id:           d.id as string,
            project_id:   d.project_id as string,
            project_name: proj?.name ?? 'Unknown',
            start_date:   d.start_date as string,
            end_date:     d.end_date as string | null,
            wbs:          d.wbs as string | null,
            weekly_rate:  d.weekly_rate as number | null,
            daily_rate:   d.daily_rate as number | null,
            charge_unit:  d.charge_unit as string | null,
          }
        }))
        setLoadingDepls(false)
      })
  }, [asset.id])

  async function handleSave() {
    setSaving(true)
    await onSave(
      { ...form, calibration_due: form.calibration_due || null, service_due: form.service_due || null, home_location: form.home_location || null, notes: form.notes || null } as unknown as Partial<Asset>,
      deployProj || undefined, deployStart || undefined, deployEnd || undefined,
    )
    setSaving(false)
  }

  function fmtDate(d: string | null) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
  }

  const catColor = CAT_COLORS[asset.category ?? ''] ?? 'var(--text3)'

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: (() => {
          const header = document.querySelector('.app-header')
          const ribbon = document.querySelector('.ribbon-nav')
          return (header?.getBoundingClientRect().height ?? 52) +
                 (ribbon?.getBoundingClientRect().height ?? 0)
        })(), right: 0, bottom: 0, width: 440,
        background: 'var(--bg)', borderLeft: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)', zIndex: 201,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{asset.name}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{asset.asset_tag}</span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: catColor + '22', color: catColor, border: `1px solid ${catColor}44` }}>
                  {(asset.category ?? '').split(' ')[0]}
                </span>
                {asset.weekly_rate && <span style={{ fontSize: 10, color: 'var(--text3)' }}>${asset.weekly_rate.toLocaleString()}/wk</span>}
              </div>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, marginTop: 12, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 2 }}>
            {([['plan', '📅 Year Plan'], ['edit', '⚙ Edit / Assign']] as [string, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setActiveTab(v as 'plan' | 'edit')}
                style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                  background: activeTab === v ? 'var(--bg2)' : 'transparent',
                  color: activeTab === v ? 'var(--accent)' : 'var(--text3)',
                  boxShadow: activeTab === v ? 'var(--shadow)' : 'none',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

          {activeTab === 'plan' ? (
            <>
              {/* Year plan */}
              {loadingDepls ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text3)', fontSize: 12 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} /> Loading deployments…
                </div>
              ) : allDeployments.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📅</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>No deployments in 2026</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>Use the Edit / Assign tab to assign to a project.</div>
                </div>
              ) : (
                <YearGantt
                  deployments={allDeployments.map((d, i) => ({
                    start: d.start_date,
                    end:   d.end_date ?? '2026-12-31',
                    label: d.project_name.replace(/\d{4}/g, '').replace(/Outage/i,'').trim().slice(0, 16),
                    color: PROJ_COLORS[i % PROJ_COLORS.length],
                  }))}
                />
              )}

              {/* Deployment table */}
              {!loadingDepls && allDeployments.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 8 }}>Deployment History</div>
                  <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                    {allDeployments.map((d, i) => {
                      const color = PROJ_COLORS[i % PROJ_COLORS.length]
                      const rate = d.weekly_rate ? `$${d.weekly_rate.toLocaleString()}/wk` : d.daily_rate ? `$${d.daily_rate.toLocaleString()}/day` : null
                      return (
                        <div key={d.id} style={{ padding: '10px 12px', borderBottom: i < allDeployments.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: color, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{d.project_name}</div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                                {fmtDate(d.start_date)} → {fmtDate(d.end_date)}
                              </span>
                              {rate && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{rate}</span>}
                              {d.wbs && <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{d.wbs}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Calibration status */}
              <div style={{ marginTop: 20, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 8 }}>Compliance</div>
                {[
                  { label: 'Calibration Due', val: asset.calibration_due },
                  { label: 'Service Due', val: asset.service_due },
                  { label: 'Home Location', val: asset.home_location },
                ].map(({ label, val }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <span style={{ color: 'var(--text2)' }}>{label}</span>
                    <span style={{ fontFamily: val && !label.includes('Location') ? 'var(--mono)' : undefined, color: 'var(--text3)' }}>{val || '—'}</span>
                  </div>
                ))}
                {asset.notes && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>{asset.notes}</div>
                )}
              </div>
            </>
          ) : (
            // ── Edit / Assign tab ─────────────────────────────────────────────
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              <div>
                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Status</label>
                <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="available">Available</option>
                  <option value="in_transit">In Transit</option>
                  <option value="in_service">In Service / Calibration</option>
                </select>
              </div>

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

              {/* Rates — read-only unless admin/resource manager */}
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 8 }}>
                  Rates {!canEditRates && <span style={{ fontWeight: 400, fontSize: 9, marginLeft: 4 }}>(read-only)</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Weekly Rate (AUD)</label>
                    {canEditRates
                      ? <input className="input" type="number" value={form.weekly_rate} onChange={e => setForm(f => ({ ...f, weekly_rate: e.target.value }))} placeholder="e.g. 4680" />
                      : <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', padding: '6px 0' }}>{asset.weekly_rate ? `$${asset.weekly_rate.toLocaleString()}/wk` : '—'}</div>
                    }
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Daily Rate (AUD)</label>
                    {canEditRates
                      ? <input className="input" type="number" value={form.daily_rate} onChange={e => setForm(f => ({ ...f, daily_rate: e.target.value }))} placeholder="e.g. 840" />
                      : <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', padding: '6px 0' }}>{asset.daily_rate ? `$${asset.daily_rate.toLocaleString()}/day` : '—'}</div>
                    }
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 }}>Charge Unit</label>
                  {canEditRates
                    ? <select className="input" value={form.charge_unit} onChange={e => setForm(f => ({ ...f, charge_unit: e.target.value }))}>
                        <option value="weekly">Weekly</option>
                        <option value="daily">Daily</option>
                      </select>
                    : <div style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 0', textTransform: 'capitalize' }}>{asset.charge_unit ?? '—'}</div>
                  }
                </div>
              </div>

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
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Creates a deployment record. PM sees it in Equipment → SEA Local Tooling.</div>
                </div>
              </div>

              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null} Save changes
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

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
      supabase.from('sea_assets').select('*, lead_time_days').order('category').order('name'),
      supabase.from('sea_asset_deployments')
        .select('sea_asset_id, start_date, end_date, project_id, projects:project_id(name)')
        .order('start_date'),
      supabase.from('projects').select('id, name').not('name', 'ilike', '%test%').neq('name', 'tet').order('start_date'),
    ])

    // Build deployment maps: current (active today) + next upcoming
    type DeplEntry = { project_name: string; project_id: string; start_date: string; end_date: string | null }
    const currentMap = new Map<string, DeplEntry>()
    const nextMap    = new Map<string, DeplEntry>()
    const allDepls   = (deploymentsData.data || []) as Record<string, unknown>[]

    for (const d of allDepls) {
      const aid  = d.sea_asset_id as string
      const proj = d.projects as { name: string } | null
      const sd   = d.start_date as string
      const ed   = d.end_date as string | null
      const entry: DeplEntry = { project_name: proj?.name ?? 'Unknown', project_id: d.project_id as string, start_date: sd, end_date: ed }

      // Active today
      if (sd <= today && (!ed || ed >= today)) {
        currentMap.set(aid, entry)
      }
      // Future — keep only the soonest upcoming per asset
      if (sd > today) {
        const existing = nextMap.get(aid)
        if (!existing || sd < existing.start_date) nextMap.set(aid, entry)
      }
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
      lead_time_days:   (a.lead_time_days as number) ?? 14,
      deployment:       currentMap.get(a.id as string),
      nextDeployment:   nextMap.get(a.id as string),
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
    const g: Record<LiveStatus, Asset[]> = { onsite: [], departing_soon: [], scheduled: [], in_transit: [], in_service: [], available: [] }
    for (const a of filtered) g[getLiveStatus(a)].push(a)
    return g
  }, [filtered])

  const stats = useMemo(() => ({
    available:      assets.filter(a => getLiveStatus(a) === 'available').length,
    onsite:         assets.filter(a => getLiveStatus(a) === 'onsite').length,
    departing_soon: assets.filter(a => getLiveStatus(a) === 'departing_soon').length,
    scheduled:      assets.filter(a => getLiveStatus(a) === 'scheduled').length,
    in_transit:     assets.filter(a => getLiveStatus(a) === 'in_transit').length,
    in_service:     assets.filter(a => getLiveStatus(a) === 'in_service').length,
  }), [assets])

  async function handleSave(updates: Partial<Asset>, deployProjectId?: string, deployStart?: string, deployEnd?: string) {
    if (!editAsset) return
    const payload: Record<string, unknown> = {
      status:          updates.status,
      calibration_due: updates.calibration_due ?? null,
      service_due:     updates.service_due ?? null,
      home_location:   updates.home_location ?? null,
      notes:           updates.notes ?? null,
    }
    if (updates.weekly_rate !== undefined) payload.weekly_rate = updates.weekly_rate ? Number(updates.weekly_rate) : null
    if (updates.daily_rate  !== undefined) payload.daily_rate  = updates.daily_rate  ? Number(updates.daily_rate)  : null
    if (updates.charge_unit !== undefined) payload.charge_unit = updates.charge_unit || null
    const { error } = await supabase.from('sea_assets').update(payload).eq('id', editAsset.id)

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
            { label: 'Available',      val: stats.available,      color: 'var(--green)'  },
            { label: 'On Site',        val: stats.onsite,         color: 'var(--accent)' },
            { label: 'Departing Soon', val: stats.departing_soon, color: 'var(--orange)' },
            { label: 'Scheduled',      val: stats.scheduled,      color: 'var(--blue)'   },
            { label: 'In Service',     val: stats.in_service,     color: stats.in_service > 0 ? 'var(--red)' : 'var(--text3)' },
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
              { key: 'onsite'         as LiveStatus, title: 'On Site',                  dot: 'var(--accent)' },
              { key: 'departing_soon' as LiveStatus, title: 'Departing Soon (≤lead time)', dot: 'var(--orange)' },
              { key: 'scheduled'      as LiveStatus, title: 'Scheduled',                dot: 'var(--blue)'   },
              { key: 'in_transit'     as LiveStatus, title: 'In Transit',               dot: 'var(--purple)' },
              { key: 'in_service'     as LiveStatus, title: 'In Service / Cal Due',     dot: 'var(--red)'    },
              { key: 'available'      as LiveStatus, title: 'Available',                dot: 'var(--green)'  },
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
        <AssetDrawer
          asset={editAsset}
          projects={projects}
          onSave={handleSave}
          onClose={() => setEditAsset(null)}
        />
      )}
    </div>
  )
}
