/**
 * NrgCreditNotesPanel
 * List of all credit notes issued for the project, with detail view and print.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { reverseCreditNote, type SourceLine } from '../../engines/creditNoteEngine'

interface CreditNote {
  id: string
  created_at: string
  created_by: string | null
  credit_type: 'reallocate' | 'credit_only' | 'adjust_timesheet'
  status: string
  reference: string
  reason: string
  source_lines: SourceLine[]
  reallocation_targets: {
    sourceLineIndex: number
    targets: { tceItemId: string | null; wo: string; hours: number; description: string }[]
  }[] | null
  credit_hours_per_line: Record<string, number> | null
  affected_timesheet_ids: string[]
}

const TYPE_LABEL = {
  reallocate:         'Scope Reallocation',
  credit_only:        'Credit Note Only',
  adjust_timesheet:   'Timesheet Adjustment',
}

const TYPE_STYLE = {
  reallocate:       { bg: '#dbeafe', color: '#1e40af' },
  credit_only:      { bg: '#fee2e2', color: '#991b1b' },
  adjust_timesheet: { bg: '#fef3c7', color: '#92400e' },
}

const PAY_CODE_STYLE: Record<string, { bg: string; color: string }> = {
  'DT1.0': { bg: '#dbeafe', color: '#1e40af' },
  'DT1.5': { bg: '#fef3c7', color: '#92400e' },
  'DT2.0': { bg: '#fce7f3', color: '#9d174d' },
  'NT2.0': { bg: '#f0fdf4', color: '#166534' },
}

function fmtDate(iso: string) {
  return new Date(iso.includes('T') ? iso : iso + 'T12:00:00')
    .toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function NrgCreditNotesPanel() {
  const { activeProject } = useAppStore()
  const pid = activeProject?.id || ''

  const [credits, setCredits] = useState<CreditNote[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CreditNote | null>(null)
  const [reversing, setReversing] = useState<string | null>(null)

  async function handleReverse(cn: CreditNote) {
    if (!window.confirm(`Reverse ${cn.reference}?\n\nThis will undo all cost line changes made by this credit note and delete the record. This cannot be undone.`)) return
    setReversing(cn.id)
    const result = await reverseCreditNote(cn.id, pid)
    setReversing(null)
    if (result.success) {
      if (result.warnings?.length) alert(`Reversed with warnings:\n${result.warnings.join('\n')}`)
      if (selected?.id === cn.id) setSelected(null)
      load()
    } else {
      alert(`Reversal failed: ${result.error}`)
    }
  }

  useEffect(() => { if (pid) load() }, [pid])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('nrg_credit_notes')
      .select('*')
      .eq('project_id', pid)
      .order('created_at', { ascending: false })
    setCredits((data || []) as CreditNote[])
    setLoading(false)
  }

  function printCreditNote(cn: CreditNote) {
    const typeLabel = TYPE_LABEL[cn.credit_type]
    const dateStr   = fmtDateTime(cn.created_at)

    const hoursForLine = (i: number): number => {
      if (!cn.credit_hours_per_line) return cn.source_lines[i]?.hours || 0
      const v = cn.credit_hours_per_line[i] ?? cn.credit_hours_per_line[String(i)]
      return v !== undefined ? Number(v) : cn.source_lines[i]?.hours || 0
    }

    const linesHTML = cn.source_lines.map((l, i) => {
      const ch = cn.credit_type !== 'reallocate' ? hoursForLine(i) : l.hours
      const pc = PAY_CODE_STYLE[l.payCode] || { bg: '#f3f4f6', color: '#374151' }
      return `<tr>
        <td style="padding:4px 8px;border:1px solid #e2e8f0">${l.personName}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0">${fmtDate(l.date)}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0"><span style="background:${pc.bg};color:${pc.color};padding:1px 5px;border-radius:3px;font-weight:700;font-family:monospace;font-size:9px">${l.payCode}</span></td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0;font-family:monospace;font-size:9px">${l.woTask || l.scopeKey || '—'}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0;max-width:180px">${l.description || '—'}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-family:monospace">${l.hours}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:700;color:#dc2626">${ch}</td>
      </tr>`
    }).join('')

    const totalCreditHours = cn.credit_type !== 'reallocate'
      ? cn.source_lines.reduce((s, _, i) => s + hoursForLine(i), 0)
      : cn.source_lines.reduce((s, l) => s + l.hours, 0)

    const reallocHTML = cn.credit_type === 'reallocate' && cn.reallocation_targets ? `
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#475569;margin:20px 0 8px">Reallocation Targets</h3>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:5px 8px;border:1px solid #cbd5e1;text-align:left">Person</th>
          <th style="padding:5px 8px;border:1px solid #cbd5e1;text-align:left">Date</th>
          <th style="padding:5px 8px;border:1px solid #cbd5e1;text-align:left">→ Target Scope</th>
          <th style="padding:5px 8px;border:1px solid #cbd5e1;text-align:right">Hours</th>
        </tr></thead>
        <tbody>
          ${cn.reallocation_targets.map(rt => (rt.targets || []).map(t =>
            `<tr>
              <td style="padding:4px 8px;border:1px solid #e2e8f0">${cn.source_lines[rt.sourceLineIndex]?.personName || '—'}</td>
              <td style="padding:4px 8px;border:1px solid #e2e8f0">${fmtDate(cn.source_lines[rt.sourceLineIndex]?.date || '')}</td>
              <td style="padding:4px 8px;border:1px solid #e2e8f0;font-family:monospace;font-size:9px">${t.wo || t.tceItemId || '—'} — ${t.description}</td>
              <td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:right;font-family:monospace">${t.hours}</td>
            </tr>`
          ).join('')).join('')}
        </tbody>
      </table>` : ''

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>${cn.reference} — ${typeLabel}</title>
      <style>
        body { font-family: -apple-system, Arial, sans-serif; margin: 0; padding: 24px; color: #0f172a; font-size: 12px; }
        @media print { button { display: none !important } @page { size: A4; margin: 12mm } }
        th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 9px; text-transform: uppercase; text-align: left; color: #475569; font-weight: 700; }
      </style>
    </head><body>
      <button onclick="window.print()" style="padding:6px 18px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;margin-bottom:20px">🖨 Print / Save PDF</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #e2e8f0">
        <div>
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">Siemens Energy · ${activeProject?.name || ''}</div>
          <h1 style="font-size:22px;font-weight:800;margin:0 0 4px">${cn.reference}</h1>
          <div style="font-size:13px;color:#475569">${typeLabel}</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#475569;line-height:1.6">
          <div><strong>Date issued:</strong> ${dateStr}</div>
          <div><strong>Status:</strong> ${cn.status.toUpperCase()}</div>
        </div>
      </div>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 16px;margin-bottom:20px">
        <div style="font-size:10px;font-weight:600;color:#991b1b;margin-bottom:2px;text-transform:uppercase">Reason</div>
        <div style="color:#7f1d1d">${cn.reason || '—'}</div>
      </div>

      <h3 style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#475569;margin:0 0 8px">Credited Lines</h3>
      <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:4px">
        <thead><tr>
          <th>Person</th><th>Date</th><th>Pay Code</th><th>WO / Task</th><th>Description</th>
          <th style="text-align:right">Original Hrs</th><th style="text-align:right">Credited Hrs</th>
        </tr></thead>
        <tbody>${linesHTML}</tbody>
        <tfoot><tr style="background:#f8fafc;font-weight:700">
          <td colspan="5" style="padding:5px 8px;border:1px solid #e2e8f0;text-align:right;font-size:10px">Total</td>
          <td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:right;font-family:monospace">${cn.source_lines.reduce((s, l) => s + l.hours, 0).toFixed(2)}</td>
          <td style="padding:5px 8px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;color:#dc2626">${totalCreditHours.toFixed(2)}</td>
        </tfoot>
      </table>
      ${reallocHTML}
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8">
        Overhaul Manager · Generated ${new Date().toISOString()}
      </div>
    </body></html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  const totalCreditedHours = credits.reduce((s, cn) => {
    if (cn.credit_type === 'reallocate') return s
    return s + cn.source_lines.reduce((ls, _, i) => {
      const v = cn.credit_hours_per_line?.[i] ?? cn.credit_hours_per_line?.[String(i)]
      return ls + (v !== undefined ? Number(v) : 0)
    }, 0)
  }, 0)

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ marginBottom: 14, flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Credit Notes</h1>
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>All credit notes issued for this project.</p>
        </div>
        <button className="btn btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* KPI strip */}
      {!loading && credits.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexShrink: 0 }}>
          {[
            { label: 'Total issued', value: String(credits.length) },
            { label: 'Hours credited', value: `${totalCreditedHours.toFixed(2)}h` },
            { label: 'Reallocs', value: String(credits.filter(c => c.credit_type === 'reallocate').length) },
            { label: 'Credit only', value: String(credits.filter(c => c.credit_type === 'credit_only').length) },
            { label: 'Timesheet adj.', value: String(credits.filter(c => c.credit_type === 'adjust_timesheet').length) },
          ].map(k => (
            <div key={k.label} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? <div className="loading-center"><span className="spinner" /></div> : credits.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📋</div>
          <h3>No credit notes yet</h3>
          <p>Issue credits from the Scope Allocations panel.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', gap: 16, flex: 1, minHeight: 0 }}>
          {/* List */}
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table style={{ fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  {['Reference', 'Type', 'Date', 'Lines', 'Hours Credited', 'Reason', ''].map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 10, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {credits.map((cn, i) => {
                  const ts = TYPE_STYLE[cn.credit_type] || { bg: 'var(--bg3)', color: 'var(--text2)' }
                  const creditedHours = cn.credit_type !== 'reallocate'
                    ? cn.source_lines.reduce((s, _, li) => {
                        const v = cn.credit_hours_per_line?.[li] ?? cn.credit_hours_per_line?.[String(li)]
                        return s + (v !== undefined ? Number(v) : 0)
                      }, 0)
                    : null

                  return (
                    <tr key={cn.id} onClick={() => setSelected(selected?.id === cn.id ? null : cn)}
                      style={{ background: selected?.id === cn.id ? 'var(--accent-bg)' : i % 2 === 0 ? 'transparent' : 'var(--bg2)', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{cn.reference}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: ts.bg, color: ts.color, whiteSpace: 'nowrap' }}>
                          {TYPE_LABEL[cn.credit_type]}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{fmtDateTime(cn.created_at)}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--mono)' }}>{cn.source_lines.length}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--mono)', color: creditedHours ? '#dc2626' : 'var(--text3)', fontWeight: creditedHours ? 700 : 400 }}>
                        {creditedHours !== null ? `${creditedHours.toFixed(2)}h` : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text2)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cn.reason}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" style={{ fontSize: 10 }} onClick={e => { e.stopPropagation(); printCreditNote(cn) }}>🖨 Print</button>
                          <button className="btn btn-sm" style={{ fontSize: 10, color: 'var(--red)' }}
                            disabled={reversing === cn.id}
                            onClick={e => { e.stopPropagation(); handleReverse(cn) }}>
                            {reversing === cn.id ? '…' : '↩ Reverse'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="card" style={{ overflow: 'auto', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, fontFamily: 'var(--mono)' }}>{selected.reference}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{fmtDateTime(selected.created_at)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => printCreditNote(selected)}>🖨 Print</button>
                  <button className="btn btn-sm" style={{ color: 'var(--red)' }}
                    disabled={reversing === selected.id}
                    onClick={() => handleReverse(selected)}>
                    {reversing === selected.id ? 'Reversing…' : '↩ Reverse'}
                  </button>
                  <button className="btn btn-sm" onClick={() => setSelected(null)}>✕</button>
                </div>
              </div>

              {/* Type badge */}
              {(() => { const ts = TYPE_STYLE[selected.credit_type]; return (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: ts.bg, color: ts.color, display: 'inline-block', marginBottom: 12 }}>
                  {TYPE_LABEL[selected.credit_type]}
                </span>
              )})()}

              {/* Reason */}
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 12px', marginBottom: 14, fontSize: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#991b1b', marginBottom: 2, textTransform: 'uppercase' }}>Reason</div>
                <div style={{ color: '#7f1d1d' }}>{selected.reason || '—'}</div>
              </div>

              {/* Source lines */}
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Credited lines</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {selected.source_lines.map((l, i) => {
                  const pc = PAY_CODE_STYLE[l.payCode] || { bg: 'var(--bg3)', color: 'var(--text2)' }
                  const ch = selected.credit_type !== 'reallocate'
                    ? (selected.credit_hours_per_line?.[i] ?? selected.credit_hours_per_line?.[String(i)] ?? l.hours)
                    : l.hours
                  return (
                    <div key={i} style={{ background: 'var(--bg2)', borderRadius: 6, padding: '8px 10px', fontSize: 11 }}>
                      <div style={{ fontWeight: 600, marginBottom: 3 }}>{l.personName}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: 'var(--text2)' }}>
                        <span>{fmtDate(l.date)}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)', padding: '1px 5px', borderRadius: 3, background: pc.bg, color: pc.color }}>{l.payCode}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{l.woTask || l.scopeKey}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 700, color: '#dc2626' }}>
                          {Number(ch).toFixed(2)}h credited
                        </span>
                      </div>
                      {l.description && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{l.description}</div>}
                    </div>
                  )
                })}
              </div>

              {/* Reallocation targets */}
              {selected.credit_type === 'reallocate' && selected.reallocation_targets && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>Reallocation targets</div>
                  {selected.reallocation_targets.map((rt, ri) => (
                    <div key={ri} style={{ marginBottom: 8 }}>
                      {(rt.targets || []).map((t, ti) => (
                        <div key={ti} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '5px 10px', background: '#dbeafe', borderRadius: 4, marginBottom: 4, color: '#1e40af' }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>→ {t.wo || t.tceItemId || '—'}</span>
                          <span style={{ flex: 1 }}>{t.description}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{t.hours}h</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
