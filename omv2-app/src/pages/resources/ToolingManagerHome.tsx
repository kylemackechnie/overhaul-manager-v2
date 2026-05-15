/**
 * ToolingManagerHome.tsx
 * Landing page for the Tooling module.
 * Shown when clicking Tooling from the platform home.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface Stats {
  total_assets: number
  on_site: number
  departing_soon: number
  available: number
  cal_due: number
  deployments: number
}

const PANELS = [
  {
    icon: '🧰',
    label: 'Asset Board',
    description: 'All 131 SEA-owned assets grouped by live status — Available, Departing Soon, Scheduled, On Site, In Service.',
    panel: 'resource-assets',
    color: '#7c3aed',
    stat: (s: Stats) => `${s.available} available · ${s.on_site} on site`,
  },
  {
    icon: '📅',
    label: 'Asset Timeline',
    description: 'Cross-project Gantt of SEA asset deployments across 2026. Free gaps show available windows for assignment.',
    panel: 'resource-asset-timeline',
    color: '#0369a1',
    stat: (s: Stats) => `${s.deployments} active deployments`,
  },
  {
    icon: '🔧',
    label: 'Tooling Demand',
    description: 'Tooling requirements from the crew plan vs assigned assets. Open slots show a red chip — click to assign.',
    panel: 'resource-tooling-demand',
    color: '#d97706',
    stat: () => 'All projects',
  },
]

function NavCard({ item, stat, onClick }: {
  item: typeof PANELS[0]
  stat: string
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg2)',
        border: `1px solid ${hovered ? item.color : 'var(--border)'}`,
        borderTop: `3px solid ${item.color}`,
        borderRadius: 'var(--radius)',
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
        boxShadow: hovered ? `0 4px 16px ${item.color}22` : 'none',
        transform: hovered ? 'translateY(-2px)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8,
          background: item.color + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, flexShrink: 0,
        }}>
          {item.icon}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            {item.label}
          </div>
          <div style={{ fontSize: 11, color: item.color, fontFamily: 'var(--mono)', marginTop: 2, fontWeight: 600 }}>
            {stat}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
        {item.description}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{
          fontSize: 14, color: hovered ? item.color : 'var(--text3)',
          transition: 'color 0.15s, transform 0.15s',
          transform: hovered ? 'translateX(3px)' : 'none',
          display: 'inline-block',
        }}>→</span>
      </div>
    </div>
  )
}

export function ToolingManagerHome() {
  const { setActivePanel } = useAppStore()
  const [stats, setStats] = useState<Stats>({ total_assets: 0, on_site: 0, departing_soon: 0, available: 0, cal_due: 0, deployments: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([
      supabase.from('sea_assets').select('id, status, calibration_due, service_due, lead_time_days'),
      supabase.from('sea_asset_deployments')
        .select('sea_asset_id, start_date, end_date')
        .lte('start_date', today)
        .or(`end_date.gte.${today},end_date.is.null`),
      supabase.from('sea_asset_deployments').select('id', { count: 'exact', head: true }),
    ]).then(([assetsRes, activeDeplRes, allDeplRes]) => {
      const assets = (assetsRes.data || []) as { id: string; status: string; calibration_due: string | null; service_due: string | null; lead_time_days: number }[]
      const activeDeployedIds = new Set((activeDeplRes.data || []).map(d => d.sea_asset_id))

      // Fetch next upcoming deployments
      supabase.from('sea_asset_deployments')
        .select('sea_asset_id, start_date')
        .gt('start_date', today)
        .order('start_date')
        .then(({ data: futureDepls }) => {
          const nextMap = new Map<string, string>()
          for (const d of (futureDepls || [])) {
            if (!nextMap.has(d.sea_asset_id)) nextMap.set(d.sea_asset_id, d.start_date)
          }

          let onSite = 0, departingSoon = 0, available = 0, calDue = 0
          for (const a of assets) {
            const calExp = a.calibration_due && a.calibration_due < today
            const svcExp = a.service_due && a.service_due < today
            if (calExp || svcExp) { calDue++; continue }
            if (a.status === 'in_transit') continue
            if (activeDeployedIds.has(a.id)) { onSite++; continue }
            const next = nextMap.get(a.id)
            if (next) {
              const daysUntil = Math.round((new Date(next).getTime() - Date.now()) / 86400000)
              if (daysUntil <= (a.lead_time_days ?? 14)) { departingSoon++; continue }
            }
            available++
          }

          setStats({
            total_assets: assets.length,
            on_site: onSite,
            departing_soon: departingSoon,
            available,
            cal_due: calDue,
            deployments: allDeplRes.count ?? 0,
          })
          setLoading(false)
        })
    })
  }, [])

  const panels = PANELS.map(p => ({ ...p, _stat: loading ? '…' : p.stat(stats) }))

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '24px 40px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: '#7c3aed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>🧰</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              Tooling
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              SEA-owned asset fleet — status, deployment planning and calibration tracking
            </div>
          </div>
        </div>

        {/* Summary stats */}
        {!loading && (
          <div style={{ display: 'flex', gap: 20, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            {[
              { label: 'Total assets',    val: stats.total_assets,    color: 'var(--text)'   },
              { label: 'Available',       val: stats.available,        color: 'var(--green)'  },
              { label: 'On site',         val: stats.on_site,          color: 'var(--accent)' },
              { label: 'Departing soon',  val: stats.departing_soon,   color: 'var(--orange)' },
              { label: 'Cal/service due', val: stats.cal_due,          color: stats.cal_due > 0 ? 'var(--red)' : 'var(--text3)' },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color }}>{val}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Panel grid */}
      <div style={{ padding: '28px 40px', maxWidth: 900 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 14 }}>
          Panels
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 14,
        }}>
          {panels.map(p => (
            <NavCard
              key={p.panel}
              item={p}
              stat={p._stat ?? ''}
              onClick={() => setActivePanel(p.panel)}
            />
          ))}
        </div>

        <div style={{ marginTop: 32 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => setActivePanel(null)}>
            ← Platform Home
          </button>
        </div>
      </div>
    </div>
  )
}
