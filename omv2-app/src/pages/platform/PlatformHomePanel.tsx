/**
 * PlatformHomePanel.tsx
 * Platform home screen — lifecycle hierarchy + support functions.
 * Sales spans top, PM and Quality side by side below, Support at base.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

interface Stats {
  active_projects: number
  total_projects: number
  resources: number
  sea_assets: number
  persons: number
}

export function PlatformHomePanel({ onOpenPicker }: { onOpenPicker: () => void }) {
  const { setActivePanel } = useAppStore()
  const [stats, setStats] = useState<Stats>({ active_projects: 0, total_projects: 0, resources: 0, sea_assets: 0, persons: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id, start_date, end_date').not('name', 'ilike', '%test%').neq('name', 'tet'),
      supabase.from('resources').select('id', { count: 'exact', head: true }),
      supabase.from('sea_assets').select('id', { count: 'exact', head: true }),
      supabase.from('persons').select('id', { count: 'exact', head: true }).eq('active', true),
    ]).then(([projRes, resRes, assetRes, persRes]) => {
      const projs = projRes.data || []
      const today = new Date().toISOString().slice(0, 10)
      const active = projs.filter(p => p.start_date && p.start_date <= today && (!p.end_date || p.end_date >= today)).length
      setStats({
        active_projects: active,
        total_projects:  projs.length,
        resources:       resRes.count  ?? 0,
        sea_assets:      assetRes.count ?? 0,
        persons:         persRes.count  ?? 0,
      })
      setLoading(false)
    })
  }, [])

  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // ── colours (matching module ribbons) ──────────────────────────────────────
  const AMBER  = { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', sub: '#B45309', badge: '#D97706' }
  const TEAL   = { bg: '#D1FAE5', border: '#6EE7B7', text: '#065F46', sub: '#047857', active: '#059669' }
  const PURPLE = { bg: '#EDE9FE', border: '#C4B5FD', text: '#3730A3', sub: '#4338CA' }
  const BLUE   = { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A', sub: '#1D4ED8' }
  const ZONE   = { lifecycle: '#FFFBEB', support: '#EFF6FF' }

  function Card({
    children, bg, border, style = {},
  }: { children: React.ReactNode; bg: string; border: string; style?: React.CSSProperties }) {
    return (
      <div style={{
        background: bg, border: `1px solid ${border}`,
        borderRadius: 10, padding: '18px 20px',
        ...style,
      }}>
        {children}
      </div>
    )
  }

  function ZoneLabel({ text, color }: { text: string; color: string }) {
    return (
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
        textTransform: 'uppercase', color, marginBottom: 12,
      }}>{text}</div>
    )
  }

  function OpenLink({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
    return (
      <button onClick={onClick} style={{
        marginTop: 10, background: 'none', border: 'none', cursor: 'pointer',
        padding: 0, fontSize: 11, fontWeight: 600, color, display: 'flex', alignItems: 'center', gap: 4,
      }}>
        {label} <span style={{ fontSize: 13 }}>→</span>
      </button>
    )
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* ── App header strip ── */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '20px 36px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 900, color: '#fff', fontFamily: 'var(--mono)' }}>SE</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>Field Service Platform</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>Siemens Energy · Overhaul Manager</div>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text3)' }}>
            <div>{today}</div>
            {!loading && (
              <div style={{ marginTop: 4, display: 'flex', gap: 14, justifyContent: 'flex-end' }}>
                <span><strong style={{ color: 'var(--text)' }}>{stats.active_projects}</strong> active project{stats.active_projects !== 1 ? 's' : ''}</span>
                <span><strong style={{ color: 'var(--text)' }}>{stats.resources}</strong> deployed</span>
                <span><strong style={{ color: 'var(--text)' }}>{stats.sea_assets}</strong> assets</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main layout ── */}
      <div style={{ flex: 1, padding: '24px 36px 32px', maxWidth: 1000, width: '100%' }}>

        {/* ── LIFECYCLE ZONE ── */}
        <div style={{ background: ZONE.lifecycle, border: '1px solid #FDE68A', borderRadius: 14, padding: '18px 18px 20px', marginBottom: 16 }}>
          <ZoneLabel text="Project Lifecycle" color={AMBER.badge} />

          {/* Sales — full width */}
          <Card bg={AMBER.bg} border={AMBER.border} style={{ marginBottom: 14, opacity: 0.85 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}>📊</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: AMBER.text }}>Sales & Tendering</span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: AMBER.badge + '22', color: AMBER.badge, border: `1px solid ${AMBER.badge}44` }}>Coming soon</span>
                </div>
                <div style={{ fontSize: 11, color: AMBER.sub, marginTop: 3 }}>
                  Defines scope and requirements — feeds into Project Manager and Quality
                </div>
              </div>
            </div>
          </Card>

          {/* Drop arrows */}
          <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
              <div style={{ width: 1.5, height: 14, background: AMBER.badge, opacity: 0.5 }} />
              <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${AMBER.badge}`, opacity: 0.5 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
              <div style={{ width: 1.5, height: 14, background: AMBER.badge, opacity: 0.5 }} />
              <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${AMBER.badge}`, opacity: 0.5 }} />
            </div>
          </div>

          {/* PM + Quality side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

            {/* Project Manager */}
            <Card bg={TEAL.bg} border={TEAL.border} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: TEAL.active, borderRadius: 4, padding: '2px 8px', marginBottom: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>Active module</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 26 }}>🏗</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: TEAL.text }}>Project Manager</span>
              </div>
              <div style={{ fontSize: 11, color: TEAL.sub, lineHeight: 1.7 }}>
                Outage project management — cost tracking, timesheets, variations, logistics, procurement and reporting
              </div>
              <OpenLink label="Open project" color={TEAL.active} onClick={onOpenPicker} />
            </Card>

            {/* Quality */}
            <Card bg={PURPLE.bg} border={PURPLE.border} style={{ opacity: 0.75 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: PURPLE.sub + '22', borderRadius: 4, padding: '2px 8px', marginBottom: 10, border: `1px solid ${PURPLE.border}` }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: PURPLE.sub }}>Coming soon</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 26 }}>✅</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: PURPLE.text }}>Quality</span>
              </div>
              <div style={{ fontSize: 11, color: PURPLE.sub, lineHeight: 1.7 }}>
                Inspections, non-conformances, audit management and quality assurance records
              </div>
            </Card>
          </div>
        </div>

        {/* ── Support divider ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
            ↑ supports all lifecycle modules ↑
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        {/* ── SUPPORT ZONE ── */}
        <div style={{ background: ZONE.support, border: '1px solid #BFDBFE', borderRadius: 14, padding: '18px 18px 20px' }}>
          <ZoneLabel text="Business Support Functions" color={BLUE.sub} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

            {/* Resource Manager */}
            <Card bg={BLUE.bg} border={BLUE.border} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 24 }}>👥</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: BLUE.text }}>Resource Manager</span>
              </div>
              <div style={{ fontSize: 11, color: BLUE.sub, lineHeight: 1.7 }}>
                Resource board, crew confirmation, availability timeline, demand vs supply, people directory and induction register
              </div>
              <OpenLink label="Open" color={BLUE.sub} onClick={() => setActivePanel('resource-manager')} />
            </Card>

            {/* Tooling */}
            <Card bg={PURPLE.bg} border={PURPLE.border} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 24 }}>🧰</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: PURPLE.text }}>Tooling</span>
              </div>
              <div style={{ fontSize: 11, color: PURPLE.sub, lineHeight: 1.7 }}>
                Asset board, availability timeline, tooling demand planning and calibration tracking across the SEA fleet
              </div>
              <OpenLink label="Open" color={PURPLE.sub} onClick={() => setActivePanel('tooling-manager')} />
            </Card>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 20, fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>💡</span>
          <span>Individual panels are also accessible via the <strong style={{ color: 'var(--text2)' }}>Admin panel</strong> (⚙️ top right) or the module ribbons above.</span>
        </div>
      </div>
    </div>
  )
}
