/**
 * AttentionFeedTile
 *
 * The most action-oriented tile on the dashboard. Aggregates anything that
 * needs human action TODAY across every domain — uses the useAttentionItems
 * hook for the heavy cross-table joins.
 *
 * Replaces 5-10 individual alert tiles ("Subcons w/o PO", "Stale drafts",
 * "Mob in 7 days") with one prioritised feed.
 *
 * Defaults to size "full" — meant to sit across the top of the dashboard.
 */

import { useState } from 'react'
import { useAttentionItems } from '../../../../hooks/useAttentionItems'
import type { AttentionSeverity } from '../../../../hooks/useAttentionItems'
import { TileLoading, TileError, TileEmpty } from '../../primitives'
import type { TileComponent, DashboardContext } from '../../../../types/dashboard'

const SEV_COLOR: Record<AttentionSeverity, string> = {
  red: 'var(--red)',
  amber: 'var(--amber)',
  blue: '#0284c7',
}
const SEV_LABEL: Record<AttentionSeverity, string> = {
  red: 'Critical',
  amber: 'Warning',
  blue: 'Info',
}

function AttentionFeedComp({ ctx }: { ctx: DashboardContext }) {
  const { data, isLoading, error } = useAttentionItems(ctx.projectId)
  const [filter, setFilter] = useState<AttentionSeverity | 'all'>('all')
  const [showAll, setShowAll] = useState(false)

  if (isLoading) return <TileLoading />
  if (error) return <TileError />
  if (!data || data.length === 0) {
    return <TileEmpty icon="✅" label="Nothing needs attention — you're clear" />
  }

  const filtered = filter === 'all' ? data : data.filter(i => i.severity === filter)
  const visible = showAll ? filtered : filtered.slice(0, 6)
  const counts = {
    red: data.filter(i => i.severity === 'red').length,
    amber: data.filter(i => i.severity === 'amber').length,
    blue: data.filter(i => i.severity === 'blue').length,
  }

  return (
    <div className="card" style={{ padding: '14px 16px', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px' }}>🚨 Needs Attention</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
            {data.length} item{data.length === 1 ? '' : 's'} across every domain
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterPill label="All" count={data.length} active={filter === 'all'} color="var(--text3)" onClick={() => setFilter('all')} />
          {counts.red > 0 && <FilterPill label={SEV_LABEL.red} count={counts.red} active={filter === 'red'} color={SEV_COLOR.red} onClick={() => setFilter(filter === 'red' ? 'all' : 'red')} />}
          {counts.amber > 0 && <FilterPill label={SEV_LABEL.amber} count={counts.amber} active={filter === 'amber'} color={SEV_COLOR.amber} onClick={() => setFilter(filter === 'amber' ? 'all' : 'amber')} />}
          {counts.blue > 0 && <FilterPill label={SEV_LABEL.blue} count={counts.blue} active={filter === 'blue'} color={SEV_COLOR.blue} onClick={() => setFilter(filter === 'blue' ? 'all' : 'blue')} />}
        </div>
      </div>

      {/* Feed */}
      {filtered.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--text3)', padding: '12px 0' }}>No items at this severity.</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {visible.map(item => (
              <div key={item.id}
                onClick={() => item.panel && ctx.setActivePanel(item.panel)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '5px',
                  background: 'var(--bg3)',
                  borderLeft: `3px solid ${SEV_COLOR[item.severity]}`,
                  cursor: item.panel ? 'pointer' : 'default',
                }}
              >
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{item.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600 }}>{item.title}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.category} · {item.detail}
                  </div>
                </div>
                {item.panel && (
                  <span style={{ fontSize: '11px', color: SEV_COLOR[item.severity], flexShrink: 0 }}>→</span>
                )}
              </div>
            ))}
          </div>
          {filtered.length > 6 && (
            <button className="btn btn-sm" style={{ marginTop: '8px', width: '100%' }}
              onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show less' : `Show ${filtered.length - 6} more`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function FilterPill({ label, count, active, color, onClick }: { label: string; count: number; active: boolean; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? color : 'transparent',
        color: active ? 'white' : color,
        border: `1px solid ${color}`,
        borderRadius: '11px',
        padding: '2px 8px',
        fontSize: '10px',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}>
      {label} {count}
    </button>
  )
}

export const AttentionFeedTile: TileComponent = {
  def: { id: 'attention-feed', icon: '🚨', title: 'Needs Attention', description: 'Cross-domain feed of every blocker, gap, and overdue item that needs PM action', category: 'Health', defaultSize: 'full', defaultVisible: true },
  Component: AttentionFeedComp,
}
