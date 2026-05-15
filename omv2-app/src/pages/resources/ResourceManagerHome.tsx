/**
 * ResourceManagerHome.tsx
 * Landing page for the Resource Manager module.
 * Shown when clicking Resources from the platform home.
 * Provides navigation to all RM panels with live stat cards.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface Stats {
  total_people: number
  on_site: number
  incoming: number
  sea_assets: number
  register_records: number
}

const PANELS = [
  {
    icon: '👥',
    label: 'Resource Board',
    description: 'Cross-project view of all deployed people — On Site, Incoming, Free. Live from resources table.',
    panel: 'resource-board',
    color: '#00898a',
    stat: (s: Stats) => `${s.on_site} on site · ${s.incoming} incoming`,
  },
  {
    icon: '✅',
    label: 'Crew Confirmation',
    description: 'Per-project mob readiness — flights, accommodation, car, inductions and medical status.',
    panel: 'resource-crew-confirm',
    color: '#059669',
    stat: (s: Stats) => `${s.total_people} people across projects`,
  },
  {
    icon: '📅',
    label: 'Availability Timeline',
    description: 'Jan–Dec 2026 Gantt by person. Teal bars are OMV2 projects. Free gaps show available windows.',
    panel: 'resource-timeline',
    color: '#0369a1',
    stat: (s: Stats) => `${s.total_people} people`,
  },
  {
    icon: '📊',
    label: 'Demand vs Supply',
    description: 'Crew plan slots vs filled resources across all projects. Open slots show a red chip to fill.',
    panel: 'resource-demand',
    color: '#7c3aed',
    stat: () => 'All projects',
  },
  {
    icon: '📋',
    label: 'People Directory',
    description: 'Browse and edit all 572 personnel records — inductions, visa status, deployment history.',
    panel: 'hr-directory',
    color: '#d97706',
    stat: (s: Stats) => `${s.total_people} active people`,
  },
  {
    icon: '🪪',
    label: 'Induction Register',
    description: 'Upload SE Learning Courses and Lessons exports to update the global compliance register.',
    panel: 'resource-inductions',
    color: '#dc2626',
    stat: (s: Stats) => s.register_records > 0 ? `${s.register_records.toLocaleString()} records` : 'No uploads yet',
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

export function ResourceManagerHome() {
  const { setActivePanel } = useAppStore()
  const [stats, setStats] = useState<Stats>({ total_people: 0, on_site: 0, incoming: 0, sea_assets: 0, register_records: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const soon  = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    Promise.all([
      supabase.from('persons').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('resources').select('mob_in, mob_out').not('mob_in', 'is', null),
      supabase.from('induction_courses').select('id', { count: 'exact', head: true }),
    ]).then(([persRes, resRes, regRes]) => {
      const resources = (resRes.data || []) as { mob_in: string; mob_out: string | null }[]
      const onSite   = resources.filter(r => r.mob_in <= today && (!r.mob_out || r.mob_out >= today)).length
      const incoming = resources.filter(r => r.mob_in > today && r.mob_in <= soon).length
      setStats({
        total_people:    persRes.count ?? 0,
        on_site:         onSite,
        incoming:        incoming,
        sea_assets:      131,
        register_records: regRes.count ?? 0,
      })
      setLoading(false)
    })
  }, [])

  const panels = PANELS.map(p => ({ ...p, _stat: loading ? '…' : p.stat(stats) }))

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '24px 40px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: '#0369a1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>👥</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              Resource Management
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              People, inductions, availability and crew planning across all projects
            </div>
          </div>
        </div>

        {/* Summary stat strip */}
        {!loading && (
          <div style={{ display: 'flex', gap: 20, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            {[
              { label: 'Active people',  val: stats.total_people },
              { label: 'On site now',    val: stats.on_site },
              { label: 'Incoming ≤14d', val: stats.incoming },
              { label: 'Register records', val: stats.register_records },
            ].map(({ label, val }) => (
              <div key={label}>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{val.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Panel grid */}
      <div style={{ padding: '28px 40px', maxWidth: 1000 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 14 }}>
          Panels
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}>
          {panels.map(p => (
            <NavCard
              key={p.panel}
              item={p}
              stat={p._stat ?? ""}
              onClick={() => setActivePanel(p.panel)}
            />
          ))}
        </div>

        {/* Back to platform */}
        <div style={{ marginTop: 32 }}>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => { setActivePanel(null) }}
          >
            ← Platform Home
          </button>
        </div>
      </div>
    </div>
  )
}
