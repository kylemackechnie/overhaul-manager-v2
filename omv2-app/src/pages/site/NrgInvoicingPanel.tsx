import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { downloadCSV } from '../../lib/csv'
import type { NrgTceLine } from '../../types'

interface InvoicingEntry {
  id: string
  tce_line_id: string
  week_start: string
  invoiced_amount: number
  status: string
  invoice_ref: string
  notes: string
}

function getMon(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay()
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return d.toISOString().slice(0, 10)
}

function weekLabel(w: string) {
  return new Date(w + 'T12:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  draft:    { bg: '#f1f5f9', color: '#64748b' },
  invoiced: { bg: '#dbeafe', color: '#1e40af' },
  paid:     { bg: '#d1fae5', color: '#065f46' },
  disputed: { bg: '#fee2e2', color: '#991b1b' },
}

export function NrgInvoicingPanel() {
  const { activeProject } = useAppStore()
  const [lines, setLines] = useState<NrgTceLine[]>([])
  const [entries, setEntries] = useState<InvoicingEntry[]>([])
  const [weeks, setWeeks] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [newWeek, setNewWeek] = useState(getMon(new Date().toISOString().slice(0, 10)))
  const [sourceFilter, setSourceFilter] = useState<'all' | 'overhead' | 'skilled'>('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [linesData, entriesData] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid)
        .eq('forecast_enabled', true).order('source').order('item_id'),
      supabase.from('nrg_invoicing').select('*').eq('project_id', pid).order('week_start'),
    ])
    const linesArr = (linesData.data || []) as NrgTceLine[]
    const entriesArr = (entriesData.data || []) as InvoicingEntry[]
    setLines(linesArr)
    setEntries(entriesArr)
    // Build week list from existing entries + any timesheet weeks
    const weekSet = new Set(entriesArr.map(e => e.week_start))
    const sortedWeeks = [...weekSet].sort()
    setWeeks(sortedWeeks)
    setLoading(false)
  }

  function getEntry(lineId: string, week: string): InvoicingEntry | undefined {
    return entries.find(e => e.tce_line_id === lineId && e.week_start === week)
  }

  function colTotal(week: string): number {
    return entries.filter(e => e.week_start === week).reduce((s, e) => s + (e.invoiced_amount || 0), 0)
  }

  function rowTotal(lineId: string): number {
    return entries.filter(e => e.tce_line_id === lineId).reduce((s, e) => s + (e.invoiced_amount || 0), 0)
  }

  function grandTotal(): number {
    return entries.reduce((s, e) => s + (e.invoiced_amount || 0), 0)
  }

  async function addWeek() {
    const ws = getMon(newWeek)
    if (weeks.includes(ws)) return toast('Week already exists', 'error')
    setWeeks(prev => [...prev, ws].sort())
    toast(`Week ${weekLabel(ws)} added`, 'success')
  }

  async function updateCell(lineId: string, week: string, amount: number, field: 'invoiced_amount' | 'status' | 'invoice_ref' = 'invoiced_amount', value: string | number = amount) {
    const existing = getEntry(lineId, week)
    setSaving(`${lineId}-${week}`)
    try {
      if (existing) {
        await supabase.from('nrg_invoicing').update({ [field]: value }).eq('id', existing.id)
        setEntries(prev => prev.map(e =>
          e.id === existing.id ? { ...e, [field]: value } : e
        ))
      } else if (field === 'invoiced_amount' && Number(value) > 0) {
        const { data, error } = await supabase.from('nrg_invoicing').insert({
          project_id: activeProject!.id,
          tce_line_id: lineId,
          week_start: week,
          invoiced_amount: Number(value),
          status: 'invoiced',
        }).select().single()
        if (error) throw error
        setEntries(prev => [...prev, data as InvoicingEntry])
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(null)
    }
  }

  function exportCSV() {
    const header = ['Item ID', 'Description', 'Source', 'Contract Scope', 'TCE Total', ...weeks.map(weekLabel), 'Total Invoiced', '% of TCE']
    const data = filteredLines.map(l => {
      const rowTot = rowTotal(l.id)
      const pct = l.tce_total > 0 ? (rowTot / l.tce_total * 100).toFixed(1) + '%' : '—'
      return [l.item_id || '', l.description, l.source, (l as NrgTceLine & { contract_scope?: string }).contract_scope || '', l.tce_total,
        ...weeks.map(w => getEntry(l.id, w)?.invoiced_amount || 0),
        rowTot, pct]
    })
    downloadCSV([header, ...data], `nrg_invoicing_${activeProject?.name || 'project'}`)
  }

  const filteredLines = lines.filter(l => sourceFilter === 'all' || l.source === sourceFilter)
  const fmt = (n: number) => n > 0 ? '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 }) : '—'
  const fmtPct = (a: number, b: number) => b > 0 ? (a / b * 100).toFixed(0) + '%' : '—'
  const totalTce = filteredLines.reduce((s, l) => s + (l.tce_total || 0), 0)

  return (
    <div style={{ padding: '24px', maxWidth: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>NRG Invoicing</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {lines.length} TCE lines · {weeks.length} weeks · {fmt(grandTotal())} invoiced of {fmt(totalTce)} TCE
            {totalTce > 0 && <span style={{ marginLeft: '8px', color: 'var(--accent)' }}>({fmtPct(grandTotal(), totalTce)})</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Source filter */}
        {(['all', 'overhead', 'skilled'] as const).map(s => (
          <button key={s} className="btn btn-sm"
            style={{ background: sourceFilter === s ? 'var(--accent)' : '', color: sourceFilter === s ? '#fff' : '' }}
            onClick={() => setSourceFilter(s)}>
            {s === 'all' ? `All (${lines.length})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${lines.filter(l => l.source === s).length})`}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input type="date" className="input" style={{ width: '150px', fontSize: '12px' }}
            value={newWeek} onChange={e => setNewWeek(e.target.value)} />
          <button className="btn btn-primary" onClick={addWeek}>+ Add Week</button>
        </div>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
      : lines.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📋</div>
          <h3>No TCE lines</h3>
          <p>Import the NRG TCE spreadsheet on the TCE Register tab first, then come here to track weekly billing.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: weeks.length > 0 ? `${400 + weeks.length * 110}px` : '600px', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', minWidth: '80px' }}>Item</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', minWidth: '180px' }}>Description</th>
                <th style={{ textAlign: 'left', padding: '8px 6px', width: '80px' }}>Source</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', width: '100px' }}>TCE Value</th>
                {weeks.map(w => (
                  <th key={w} style={{ textAlign: 'center', padding: '8px 4px', width: '100px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)' }}>
                    {weekLabel(w)}
                  </th>
                ))}
                <th style={{ textAlign: 'right', padding: '8px 10px', width: '100px' }}>Total</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', width: '70px' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {filteredLines.map(line => {
                const rowTot = rowTotal(line.id)
                const pct = line.tce_total > 0 ? rowTot / line.tce_total * 100 : 0
                return (
                  <tr key={line.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text3)' }}>
                      {line.item_id || '—'}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <div style={{ fontWeight: 500, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {line.description}
                      </div>
                      {(line as NrgTceLine & { contract_scope?: string }).contract_scope && (
                        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '1px' }}>
                          {(line as NrgTceLine & { contract_scope?: string }).contract_scope}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '6px 6px' }}>
                      <span style={{
                        fontSize: '9px', padding: '1px 5px', borderRadius: '3px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                        background: line.source === 'skilled' ? '#dbeafe' : '#f3f4f6',
                        color: line.source === 'skilled' ? '#1e40af' : '#64748b'
                      }}>{line.source}</span>
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                      {fmt(line.tce_total)}
                    </td>
                    {weeks.map(w => {
                      const entry = getEntry(line.id, w)
                      const isSaving = saving === `${line.id}-${w}`
                      const ss = entry ? (STATUS_COLORS[entry.status] || STATUS_COLORS.draft) : null
                      return (
                        <td key={w} style={{ padding: '3px 4px', textAlign: 'center' }}>
                          <div style={{ position: 'relative' }}>
                            <input
                              type="number" min="0" step="1000"
                              value={entry?.invoiced_amount || ''}
                              placeholder="—"
                              style={{
                                width: '92px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px',
                                padding: '3px 6px', border: '1px solid var(--border2)', borderRadius: '4px',
                                background: entry ? (ss?.bg || 'transparent') : 'transparent',
                                color: entry ? (ss?.color || 'var(--text)') : 'var(--text3)',
                              }}
                              onBlur={e => {
                                const val = parseFloat(e.target.value) || 0
                                if (val !== (entry?.invoiced_amount || 0)) {
                                  updateCell(line.id, w, val)
                                }
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            />
                            {isSaving && <span style={{ position: 'absolute', right: '4px', top: '4px' }}><span className="spinner" style={{ width: '10px', height: '10px' }} /></span>}
                          </div>
                        </td>
                      )
                    })}
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600, color: rowTot > 0 ? 'var(--green)' : 'var(--text3)' }}>
                      {fmt(rowTot)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: pct > 100 ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--text3)' }}>
                      {pct > 0 ? Math.round(pct) + '%' : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Footer totals */}
            <tfoot>
              <tr style={{ background: 'var(--bg3)', fontWeight: 700, borderTop: '2px solid var(--border2)' }}>
                <td colSpan={3} style={{ padding: '8px 10px' }}>TOTAL ({filteredLines.length} lines)</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(totalTce)}</td>
                {weeks.map(w => (
                  <td key={w} style={{ padding: '8px 4px', textAlign: 'center', fontFamily: 'var(--mono)', color: 'var(--green)' }}>
                    {fmt(colTotal(w))}
                  </td>
                ))}
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>
                  {fmt(grandTotal())}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                  {fmtPct(grandTotal(), totalTce)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {weeks.length === 0 && lines.length > 0 && (
        <div style={{ marginTop: '16px', padding: '12px 16px', background: '#eff6ff', borderLeft: '4px solid #0284c7', borderRadius: '4px', fontSize: '13px' }}>
          Use the date picker above and click <strong>+ Add Week</strong> to create billing columns.
        </div>
      )}
    </div>
  )
}
