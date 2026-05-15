/**
 * PlatformHomePanel.tsx — lifecycle hierarchy + support functions.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const AMBER  = { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E', sub: '#B45309', badge: '#D97706' }
const TEAL   = { bg: '#D1FAE5', border: '#6EE7B7', text: '#065F46', sub: '#047857', active: '#059669' }
const PURPLE = { bg: '#EDE9FE', border: '#C4B5FD', text: '#3730A3', sub: '#4338CA' }
const BLUE   = { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A', sub: '#1D4ED8' }

function ModuleCard({ bg, border, children, onClick, style = {} }: {
  bg: string; border: string; children: React.ReactNode
  onClick?: () => void; style?: React.CSSProperties
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onClick && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '18px 20px',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: hov && onClick ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
        transform: hov && onClick ? 'translateY(-1px)' : 'none',
        transition: 'box-shadow 0.15s, transform 0.15s',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function PlatformHomePanel({ onOpenPicker }: { onOpenPicker: () => void }) {
  const { setActivePanel } = useAppStore()
  const [stats, setStats] = useState({ active_projects: 0, resources: 0, sea_assets: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('start_date, end_date').not('name', 'ilike', '%test%').neq('name', 'tet'),
      supabase.from('resources').select('id', { count: 'exact', head: true }),
      supabase.from('sea_assets').select('id', { count: 'exact', head: true }),
    ]).then(([projRes, resRes, assetRes]) => {
      const today = new Date().toISOString().slice(0, 10)
      const active = (projRes.data || []).filter(p => p.start_date && p.start_date <= today && (!p.end_date || p.end_date >= today)).length
      setStats({ active_projects: active, resources: resRes.count ?? 0, sea_assets: assetRes.count ?? 0 })
      setLoading(false)
    })
  }, [])

  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const arrow = { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2, flex: 1 }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
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

      {/* Centred content */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '28px 36px 32px' }}>
        <div style={{ width: '100%', maxWidth: 860 }}>

          {/* LIFECYCLE ZONE */}
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 14, padding: '18px 18px 20px', marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: AMBER.badge, marginBottom: 12 }}>Project Lifecycle</div>

            {/* Sales */}
            <ModuleCard bg={AMBER.bg} border={AMBER.border} style={{ marginBottom: 14, opacity: 0.8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 22 }}>📊</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: AMBER.text }}>Sales & Tendering</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: AMBER.badge + '22', color: AMBER.badge, border: `1px solid ${AMBER.badge}55` }}>Coming soon</span>
                  </div>
                  <div style={{ fontSize: 11, color: AMBER.sub }}>Defines scope and requirements — feeds into Project Manager and Quality</div>
                </div>
              </div>
            </ModuleCard>

            {/* Arrows */}
            <div style={{ display: 'flex', marginBottom: 8 }}>
              <div style={arrow}><div style={{ width: 1.5, height: 12, background: AMBER.badge, opacity: 0.4 }} /><div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${AMBER.badge}`, opacity: 0.4 }} /></div>
              <div style={arrow}><div style={{ width: 1.5, height: 12, background: AMBER.badge, opacity: 0.4 }} /><div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${AMBER.badge}`, opacity: 0.4 }} /></div>
            </div>

            {/* PM + Quality */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ModuleCard bg={TEAL.bg} border={TEAL.border} onClick={onOpenPicker}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: TEAL.active, borderRadius: 4, padding: '2px 8px', marginBottom: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>Active module</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><span style={{ fontSize: 24 }}>🏗</span><span style={{ fontSize: 14, fontWeight: 700, color: TEAL.text }}>Project Manager</span></div>
                <div style={{ fontSize: 11, color: TEAL.sub, lineHeight: 1.7, marginBottom: 10 }}>Outage project management — cost tracking, timesheets, variations, logistics, procurement and reporting</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: TEAL.active }}>Open project →</span>
              </ModuleCard>

              <ModuleCard bg={PURPLE.bg} border={PURPLE.border} style={{ opacity: 0.75 }}>
                <div style={{ display: 'inline-flex', background: PURPLE.sub + '22', borderRadius: 4, padding: '2px 8px', marginBottom: 10, border: `1px solid ${PURPLE.border}` }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: PURPLE.sub }}>Coming soon</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><span style={{ fontSize: 24 }}>✅</span><span style={{ fontSize: 14, fontWeight: 700, color: PURPLE.text }}>Quality</span></div>
                <div style={{ fontSize: 11, color: PURPLE.sub, lineHeight: 1.7 }}>Inspections, non-conformances, audit management and quality assurance records</div>
              </ModuleCard>
            </div>
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text3)', whiteSpace: 'nowrap' }}>↑ supports all lifecycle modules ↑</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* SUPPORT ZONE */}
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 14, padding: '18px 18px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: BLUE.sub, marginBottom: 12 }}>Business Support Functions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ModuleCard bg={BLUE.bg} border={BLUE.border} onClick={() => setActivePanel('resource-manager')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><span style={{ fontSize: 22 }}>👥</span><span style={{ fontSize: 14, fontWeight: 700, color: BLUE.text }}>Resource Manager</span></div>
                <div style={{ fontSize: 11, color: BLUE.sub, lineHeight: 1.7, marginBottom: 10 }}>Resource board, crew confirmation, availability timeline, demand vs supply, people directory and induction register</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: BLUE.sub }}>Open →</span>
              </ModuleCard>

              <ModuleCard bg={PURPLE.bg} border={PURPLE.border} onClick={() => setActivePanel('tooling-manager')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}><span style={{ fontSize: 22 }}>🧰</span><span style={{ fontSize: 14, fontWeight: 700, color: PURPLE.text }}>Tooling</span></div>
                <div style={{ fontSize: 11, color: PURPLE.sub, lineHeight: 1.7, marginBottom: 10 }}>Asset board, availability timeline, tooling demand planning and calibration tracking across the fleet</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: PURPLE.sub }}>Open →</span>
              </ModuleCard>
            </div>
          </div>

          <div style={{ marginTop: 18, fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>💡</span>
            <span>Individual panels are also accessible via the <strong style={{ color: 'var(--text2)' }}>Admin panel</strong> (⚙️ top right) or the module ribbons.</span>
          </div>

        </div>
      </div>
    </div>
  )
}
