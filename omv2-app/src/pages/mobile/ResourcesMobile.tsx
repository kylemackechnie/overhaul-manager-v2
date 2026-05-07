import { useMemo } from 'react'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileFilterBar, type FilterChip } from '../../components/mobile/ui/MobileFilterBar'
import { MobileSearchBar, MobileFAB } from '../../components/mobile/ui/MobileSearchBar'
import { MobileCard } from '../../components/mobile/ui/MobileCard'
import type { Resource } from '../../types'

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  onsite:   { bg: '#d1fae5', color: '#065f46', label: 'On-site' },
  incoming: { bg: '#fef3c7', color: '#92400e', label: 'Incoming' },
  upcoming: { bg: '#dbeafe', color: '#1e40af', label: 'Upcoming' },
  departed: { bg: '#f1f5f9', color: '#64748b', label: 'Departed' },
  future:   { bg: '#f3e8ff', color: '#6b21a8', label: 'Future' },
  unknown:  { bg: '#f1f5f9', color: '#94a3b8', label: 'No dates' },
}

const STATUS_ACCENT: Record<string, string> = {
  onsite: '#10b981', incoming: '#f59e0b', upcoming: '#3b82f6',
  departed: '#94a3b8', future: '#a855f7', unknown: '#cbd5e1',
}

function resourceStatus(r: Resource): 'onsite'|'incoming'|'upcoming'|'departed'|'future'|'unknown' {
  const today = new Date().toISOString().slice(0,10)
  if (!r.mob_in) return 'unknown'
  if (r.mob_out && r.mob_out < today) return 'departed'
  if (r.mob_in <= today && (!r.mob_out || r.mob_out >= today)) return 'onsite'
  const daysOut = (new Date(r.mob_in).getTime() - new Date(today).getTime()) / 86400000
  if (daysOut <= 7) return 'incoming'
  if (daysOut <= 30) return 'upcoming'
  return 'future'
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

function categoryLabel(c: string): string {
  return c === 'management' ? 'Mgmt'
    : c === 'subcontractor' ? 'Subcon'
    : c === 'seag' ? 'SE AG'
    : c.charAt(0).toUpperCase() + c.slice(1)
}

interface Props {
  resources: Resource[]
  loading: boolean
  search: string
  onSearchChange: (v: string) => void
  catFilter: string
  onCatFilterChange: (v: string) => void
  statusFilter: string
  onStatusFilterChange: (v: string) => void
  onAddNew: () => void
  onEdit: (r: Resource) => void
  canWrite: boolean
}

export function ResourcesMobile({
  resources, loading, search, onSearchChange,
  catFilter, onCatFilterChange,
  statusFilter, onStatusFilterChange,
  onAddNew, onEdit, canWrite,
}: Props) {

  // Filter pipeline — must match desktop
  const filtered = useMemo(() => {
    return resources
      .filter(r => catFilter === 'all' || r.category === catFilter)
      .filter(r => statusFilter === 'all' || resourceStatus(r) === statusFilter)
      .filter(r => !search || [r.name, r.role, r.company || '', r.email || '']
        .some(f => f.toLowerCase().includes(search.toLowerCase())))
      .sort((a, b) => {
        // Default sort: status priority then name
        const order: Record<string, number> = {onsite:0, incoming:1, upcoming:2, future:3, departed:4, unknown:5}
        const sa = order[resourceStatus(a)] ?? 9
        const sb = order[resourceStatus(b)] ?? 9
        if (sa !== sb) return sa - sb
        return a.name.localeCompare(b.name)
      })
  }, [resources, catFilter, statusFilter, search])

  // Status chips with counts (counts before status filter applied)
  const statusChips: FilterChip[] = useMemo(() => {
    const baseFiltered = resources
      .filter(r => catFilter === 'all' || r.category === catFilter)
      .filter(r => !search || [r.name, r.role, r.company || '', r.email || '']
        .some(f => f.toLowerCase().includes(search.toLowerCase())))
    const counts: Record<string, number> = {}
    baseFiltered.forEach(r => {
      const s = resourceStatus(r)
      counts[s] = (counts[s] || 0) + 1
    })
    const chips: FilterChip[] = [
      { id: 'all', label: 'All', count: baseFiltered.length },
    ]
    ;['onsite','incoming','upcoming','future','departed','unknown'].forEach(s => {
      if (counts[s]) {
        chips.push({ id: s, label: STATUS_STYLE[s].label, count: counts[s] })
      }
    })
    return chips
  }, [resources, catFilter, search])

  // Category chips
  const catChips: FilterChip[] = useMemo(() => {
    const baseFiltered = resources
      .filter(r => statusFilter === 'all' || resourceStatus(r) === statusFilter)
      .filter(r => !search || [r.name, r.role, r.company || '', r.email || '']
        .some(f => f.toLowerCase().includes(search.toLowerCase())))
    const counts: Record<string, number> = {}
    baseFiltered.forEach(r => {
      counts[r.category || 'trades'] = (counts[r.category || 'trades'] || 0) + 1
    })
    const chips: FilterChip[] = [
      { id: 'all', label: 'All categories', count: baseFiltered.length },
    ]
    ;['trades','management','seag','subcontractor'].forEach(c => {
      if (counts[c]) {
        chips.push({ id: c, label: categoryLabel(c), count: counts[c] })
      }
    })
    return chips
  }, [resources, statusFilter, search])

  return (
    <>
      <MobilePanelHeader
        title="Resources"
        subtitle={`${resources.length} ${resources.length === 1 ? 'person' : 'people'}`}
      />

      {/* Status filter chips */}
      <MobileFilterBar
        chips={statusChips}
        active={statusFilter}
        onChange={onStatusFilterChange}
        showCounts
      />

      {/* Search */}
      <MobileSearchBar
        value={search}
        onChange={onSearchChange}
        placeholder="Name, role, company…"
        debounce={150}
      />

      {/* Category sub-filter */}
      <div style={{ padding: '0 12px 4px' }}>
        <MobileFilterBar
          chips={catChips}
          active={catFilter}
          onChange={onCatFilterChange}
          showCounts
        />
      </div>

      {loading ? (
        <div className="mobile-loading">
          <span className="spinner" /> Loading resources…
        </div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <div className="mobile-empty-icon">👤</div>
          <h3>No resources</h3>
          <p>
            {search || catFilter !== 'all' || statusFilter !== 'all'
              ? 'No matches for current filters.'
              : 'Tap + to add your first person.'}
          </p>
        </div>
      ) : (
        <div className="mobile-card-list">
          {filtered.map(r => {
            const status = resourceStatus(r)
            const sty = STATUS_STYLE[status]
            const accent = STATUS_ACCENT[status]
            const dateStr = r.mob_in || r.mob_out
              ? `${fmtDate(r.mob_in)} → ${fmtDate(r.mob_out)}`
              : 'No dates set'
            const allowFlags: string[] = []
            if (r.allow_laha) allowFlags.push('LAHA')
            if (r.allow_meal) allowFlags.push('Meal')
            if (r.allow_fsa)  allowFlags.push('FSA')

            return (
              <MobileCard
                key={r.id}
                accent={accent}
                title={r.name || '(no name)'}
                subtitle={
                  <>
                    {r.role || '—'}
                    {r.company && ` · ${r.company}`}
                    {r.shift && r.shift !== 'day' && ` · ${r.shift} shift`}
                  </>
                }
                meta={
                  <span
                    className="mobile-pill"
                    style={{ background: sty.bg, color: sty.color }}
                  >{sty.label}</span>
                }
                metaSub={dateStr}
                footer={allowFlags.length > 0 ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {allowFlags.map(f => (
                      <span
                        key={f}
                        style={{
                          fontSize: 10, padding: '2px 6px',
                          background: 'var(--bg3)', border: '1px solid var(--border)',
                          borderRadius: 4, color: 'var(--text2)', fontWeight: 500,
                        }}
                      >{f}</span>
                    ))}
                    {r.category && (
                      <span style={{
                        fontSize: 10, padding: '2px 6px',
                        background: 'var(--accent-light)', border: '1px solid var(--accent)',
                        borderRadius: 4, color: 'var(--accent2)', fontWeight: 500,
                      }}>{categoryLabel(r.category)}</span>
                    )}
                  </div>
                ) : (
                  r.category ? (
                    <div>
                      <span style={{
                        fontSize: 10, padding: '2px 6px',
                        background: 'var(--accent-light)', border: '1px solid var(--accent)',
                        borderRadius: 4, color: 'var(--accent2)', fontWeight: 500,
                      }}>{categoryLabel(r.category)}</span>
                    </div>
                  ) : undefined
                )}
                onClick={() => onEdit(r)}
              />
            )
          })}
        </div>
      )}

      {canWrite && <MobileFAB icon="+" label="Person" onClick={onAddNew} />}
    </>
  )
}
