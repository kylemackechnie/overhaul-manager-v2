/**
 * PlatformHomePanel.tsx
 * Top-level module navigation for the field service platform.
 * Renders when no project is active and no panel is selected.
 * Clicking a module navigates directly to its primary panel.
 * Projects tile opens the project picker.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  total_projects: number
  active_projects: number
  persons: number
  resources: number
  sea_assets: number
}

interface Module {
  icon: string
  label: string
  description: string
  panel: string | null      // null = opens project picker
  color: string
  accent: string
  stats: (s: Stats) => string
  subStats?: (s: Stats) => string
  available: boolean
  badge?: string
}

// ── Module definitions ────────────────────────────────────────────────────────

function buildModules(openPicker: () => void): (Module & { onClick: () => void })[] {
  return [
    {
      icon: '🏗',
      label: 'Projects',
      description: 'Manage outage projects — timesheets, cost tracking, variations, equipment, NRG reporting',
      panel: null,
      color: '#00898a',
      accent: '#00898a',
      stats: s => `${s.active_projects} active`,
      subStats: s => `${s.total_projects} total projects`,
      available: true,
      onClick: openPicker,
    },
    {
      icon: '👥',
      label: 'Resource Management',
      description: 'People directory, crew confirmation, availability timeline, demand vs supply, inductions',
      panel: 'resource-board',
      color: '#0369a1',
      accent: '#0369a1',
      stats: s => `${s.resources} deployed`,
      subStats: s => `${s.persons} people in directory`,
      available: true,
      onClick: () => {},
    },
    {
      icon: '🧰',
      label: 'Tooling',
      description: 'SEA-owned asset fleet — status board, year timeline, deployment planning, calibration tracking',
      panel: 'resource-assets',
      color: '#7c3aed',
      accent: '#7c3aed',
      stats: s => `${s.sea_assets} assets`,
      subStats: () => 'Asset board, timeline, demand',
      available: true,
      onClick: () => {},
    },
    {
      icon: '📊',
      label: 'Sales & Tendering',
      description: 'Tender management, crew planning from proposals, cost modelling, opportunity tracking',
      panel: null,
      color: '#d97706',
      accent: '#d97706',
      stats: () => 'Coming soon',
      available: false,
      badge: 'Planned',
      onClick: () => {},
    },
    {
      icon: '✅',
      label: 'Quality',
      description: 'Quality assurance, inspection records, non-conformance tracking, audit management',
      panel: null,
      color: '#059669',
      accent: '#059669',
      stats: () => 'Coming soon',
      available: false,
      badge: 'Planned',
      onClick: () => {},
    },
  ]
}

// ── Module tile ───────────────────────────────────────────────────────────────

function ModuleTile({ mod, statsStr, subStatsStr, setActivePanel }: {
  mod: ReturnType<typeof buildModules>[0]
  statsStr: string
  subStatsStr?: string
  setActivePanel: (p: string) => void
}) {
  const [hovered, setHovered] = useState(false)

  function handleClick() {
    if (!mod.available) return
    if (mod.panel) {
      setActivePanel(mod.panel)
    } else {
      mod.onClick()
    }
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        background: 'var(--bg2)',
        border: `1px solid ${hovered && mod.available ? mod.color : 'var(--border)'}`,
        borderTop: `3px solid ${mod.color}`,
        borderRadius: 'var(--radius)',
        padding: '20px 22px',
        cursor: mod.available ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
        boxShadow: hovered && mod.available ? `0 4px 16px ${mod.color}22` : 'none',
        transform: hovered && mod.available ? 'translateY(-2px)' : 'none',
        opacity: mod.available ? 1 : 0.6,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 160,
      }}
    >
      {/* Badge */}
      {mod.badge && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
          background: mod.color + '22', color: mod.color,
          border: `1px solid ${mod.color}44`,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {mod.badge}
        </div>
      )}

      {/* Icon + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: mod.color + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, flexShrink: 0,
        }}>
          {mod.icon}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            {mod.label}
          </div>
          {mod.available && (
            <div style={{ fontSize: 12, fontWeight: 600, color: mod.color, fontFamily: 'var(--mono)', marginTop: 2 }}>
              {statsStr}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, flex: 1 }}>
        {mod.description}
      </div>

      {/* Sub-stat + arrow */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
          {subStatsStr}
        </div>
        {mod.available && (
          <span style={{
            fontSize: 16, color: hovered ? mod.color : 'var(--text3)',
            transition: 'color 0.15s, transform 0.15s',
            transform: hovered ? 'translateX(3px)' : 'none',
            display: 'inline-block',
          }}>
            →
          </span>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PlatformHomePanel({ onOpenPicker }: { onOpenPicker: () => void }) {
  const { setActivePanel } = useAppStore()
  const [stats, setStats] = useState<Stats>({
    total_projects: 0, active_projects: 0,
    persons: 0, resources: 0, sea_assets: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id, start_date, end_date').not('name', 'ilike', '%test%').neq('name', 'tet'),
      supabase.from('persons').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('resources').select('id', { count: 'exact', head: true }),
      supabase.from('sea_assets').select('id', { count: 'exact', head: true }),
    ]).then(([projRes, persRes, resRes, assetRes]) => {
      const projs = projRes.data || []
      const today = new Date().toISOString().slice(0, 10)
      const active = projs.filter(p =>
        p.start_date && p.start_date <= today && (!p.end_date || p.end_date >= today)
      ).length
      setStats({
        total_projects:  projs.length,
        active_projects: active,
        persons:         persRes.count ?? 0,
        resources:       resRes.count  ?? 0,
        sea_assets:      assetRes.count ?? 0,
      })
      setLoading(false)
    })
  }, [])

  // Build modules with resolved stats strings
  const modules = buildModules(onOpenPicker)

  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{
      minHeight: '100%',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        background: 'var(--bg2)',
        borderBottom: '1px solid var(--border)',
        padding: '28px 40px 24px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              {/* SE logo mark */}
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: '-0.05em',
                fontFamily: 'var(--mono)',
              }}>
                SE
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                  Field Service Platform
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>Siemens Energy — Overhaul Manager</div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'right' }}>
            <div>{today}</div>
            {!loading && (
              <div style={{ marginTop: 4, display: 'flex', gap: 16, justifyContent: 'flex-end' }}>
                <span><strong style={{ color: 'var(--text)' }}>{stats.active_projects}</strong> active project{stats.active_projects !== 1 ? 's' : ''}</span>
                <span><strong style={{ color: 'var(--text)' }}>{stats.resources}</strong> deployed</span>
                <span><strong style={{ color: 'var(--text)' }}>{stats.sea_assets}</strong> assets</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Module grid */}
      <div style={{ flex: 1, padding: '32px 40px', maxWidth: 1100 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 16 }}>
          Modules
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {modules.map(mod => (
            <ModuleTile
              key={mod.label}
              mod={mod}
              statsStr={mod.stats(stats)}
              subStatsStr={mod.subStats ? mod.subStats(stats) : undefined}
              setActivePanel={setActivePanel}
            />
          ))}
        </div>

        {/* Footer note */}
        <div style={{
          marginTop: 40,
          padding: '12px 16px',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          fontSize: 11,
          color: 'var(--text3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: 600,
        }}>
          <span style={{ fontSize: 14 }}>💡</span>
          <span>You can also access individual panels via the <strong style={{ color: 'var(--text2)' }}>Admin panel</strong> (⚙️ top right) or by selecting a project and using the ribbon tabs.</span>
        </div>
      </div>
    </div>
  )
}
