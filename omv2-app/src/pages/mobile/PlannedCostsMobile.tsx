/**
 * PlannedCostsMobile
 *
 * Mobile view of planned costs (PM100 lines without receipts).
 *
 * Use case differs from Expenses mobile — there's no camera flow, no
 * receipt capture. These are office-managed line items. Mobile users
 * mainly need to:
 *
 *   - review what's on the books (e.g. before a customer meeting)
 *   - flip the "Actualised" toggle when a planned cost becomes real
 *     (e.g. financing cost hits SAP at month-end)
 *   - occasionally add or edit a line from the field
 *
 * Layout: list of cards grouped by category, tap to open an edit sheet.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { usePermissions } from '../../lib/permissions'
import { toast } from '../../components/ui/Toast'
import { MobilePanelHeader } from '../../components/mobile/MobilePanelHeader'
import { MobileBottomSheet } from '../../components/mobile/ui/MobileBottomSheet'
import { useRegisterRefresh } from '../../components/mobile/ui/RefreshContext'
import type {
  PlannedCost, PlannedCostCategory, PlannedCostAccrualMode, WbsItem,
} from '../../types'

const CATEGORY_LABELS: Record<PlannedCostCategory, string> = {
  fixed_cost:    'Fixed Cost',
  contingency:   'Contingency',
  warranty:      'Warranty',
  financing:     'Financing',
  forecast_only: 'Forecast Only',
  other:         'Other',
}

const ACCRUAL_LABELS: Record<PlannedCostAccrualMode, string> = {
  lump_sum:         'Lump sum',
  project_duration: 'Across project',
  date_range:       'Custom range',
  monthly:          'Monthly',
}

function fmtMoney(n: number): string {
  return '$' + (n || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })
}

export function PlannedCostsMobile() {
  const { activeProject } = useAppStore()
  const { canWrite } = usePermissions()
  const [rows, setRows] = useState<PlannedCost[]>([])
  const [wbsList, setWbsList] = useState<WbsItem[]>([])
  const [loading, setLoading] = useState(true)

  // Edit sheet — null = closed, 'new' = adding, PlannedCost = editing
  const [sheet, setSheet] = useState<null | 'new' | PlannedCost>(null)
  const [saving, setSaving] = useState(false)

  // Form fields — flat state for the sheet
  const [fTitle, setFTitle] = useState('')
  const [fCategory, setFCategory] = useState<PlannedCostCategory>('fixed_cost')
  const [fWbs, setFWbs] = useState('')
  const [fAmount, setFAmount] = useState(0)
  const [fAccrual, setFAccrual] = useState<PlannedCostAccrualMode>('project_duration')
  const [fStart, setFStart] = useState('')
  const [fEnd, setFEnd] = useState('')
  const [fActualised, setFActualised] = useState(false)
  const [fNotes, setFNotes] = useState('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])
  useRegisterRefresh(load)

  async function load() {
    if (!activeProject) return
    setLoading(true)
    const [pcR, wbsR] = await Promise.all([
      supabase.from('planned_costs').select('*').eq('project_id', activeProject.id).order('number'),
      supabase.from('wbs_list').select('*').eq('project_id', activeProject.id).order('sort_order'),
    ])
    setRows((pcR.data || []) as PlannedCost[])
    setWbsList((wbsR.data || []) as WbsItem[])
    setLoading(false)
  }

  function nextNumber(): string {
    const nums = rows
      .map(r => parseInt(r.number.replace(/[^0-9]/g, ''), 10))
      .filter(n => !isNaN(n))
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    return `PC-${String(next).padStart(4, '0')}`
  }

  function openNew() {
    setFTitle('')
    setFCategory('fixed_cost')
    setFWbs('')
    setFAmount(0)
    setFAccrual('project_duration')
    setFStart(activeProject?.start_date || '')
    setFEnd(activeProject?.end_date || '')
    setFActualised(false)
    setFNotes('')
    setSheet('new')
  }

  function openEdit(r: PlannedCost) {
    setFTitle(r.title)
    setFCategory(r.category)
    setFWbs(r.wbs)
    setFAmount(Number(r.amount) || 0)
    setFAccrual(r.accrual_mode)
    setFStart(r.start_date || '')
    setFEnd(r.end_date || '')
    setFActualised(r.actualised)
    setFNotes(r.notes)
    setSheet(r)
  }

  async function save() {
    if (!activeProject) return
    if (!fTitle.trim()) { toast('Title is required', 'error'); return }
    if (fAmount <= 0) { toast('Amount must be greater than 0', 'error'); return }
    if (fAccrual === 'lump_sum' && !fStart) {
      toast('Lump sum needs a date', 'error'); return
    }
    if (fAccrual === 'date_range' && (!fStart || !fEnd)) {
      toast('Custom range needs both start and end', 'error'); return
    }
    setSaving(true)
    const payload = {
      project_id: activeProject.id,
      title: fTitle.trim(),
      category: fCategory,
      wbs: fWbs,
      amount: fAmount,
      currency: 'AUD',
      accrual_mode: fAccrual,
      start_date: fStart || null,
      end_date: fAccrual === 'lump_sum' ? null : (fEnd || null),
      actualised: fActualised,
      notes: fNotes,
    }
    let error
    if (sheet === 'new') {
      ({ error } = await supabase.from('planned_costs').insert({ ...payload, number: nextNumber() }))
    } else if (sheet) {
      ({ error } = await supabase.from('planned_costs').update(payload).eq('id', sheet.id))
    }
    setSaving(false)
    if (error) { toast(`Save failed: ${error.message}`, 'error'); return }
    toast('Saved', 'success')
    setSheet(null)
    await load()
  }

  async function toggleActualised(r: PlannedCost) {
    const { error } = await supabase
      .from('planned_costs')
      .update({ actualised: !r.actualised })
      .eq('id', r.id)
    if (error) { toast(`Update failed: ${error.message}`, 'error'); return }
    toast(!r.actualised ? 'Marked actualised' : 'Back to forecast', 'success')
    await load()
  }

  async function remove() {
    if (!sheet || sheet === 'new') return
    if (!confirm('Delete this planned cost line?')) return
    const { error } = await supabase.from('planned_costs').delete().eq('id', sheet.id)
    if (error) { toast(`Delete failed: ${error.message}`, 'error'); return }
    toast('Deleted', 'success')
    setSheet(null)
    await load()
  }

  // Roll-up for top strip
  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows])
  const actualisedTotal = useMemo(
    () => rows.filter(r => r.actualised).reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows],
  )

  // Group rows by category for display
  const grouped = useMemo(() => {
    const map = new Map<PlannedCostCategory, PlannedCost[]>()
    for (const r of rows) {
      const list = map.get(r.category) ?? []
      list.push(r)
      map.set(r.category, list)
    }
    // Stable display order
    const order: PlannedCostCategory[] = ['fixed_cost', 'contingency', 'warranty', 'financing', 'forecast_only', 'other']
    return order
      .map(cat => ({ cat, items: map.get(cat) ?? [] }))
      .filter(g => g.items.length > 0)
  }, [rows])

  return (
    <div className="mobile-panel">
      <MobilePanelHeader
        title="Planned Costs"
        subtitle={`${rows.length} line${rows.length === 1 ? '' : 's'} · ${fmtMoney(total)}`}
        action={
          canWrite('cost_tracking') ? (
            <button className="btn btn-primary btn-sm" onClick={openNew}>+ Add</button>
          ) : null
        }
      />

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '12px' }}>
        <div className="card" style={{ padding: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{fmtMoney(total - actualisedTotal)}</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Forecast</div>
        </div>
        <div className="card" style={{ padding: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--green)' }}>{fmtMoney(actualisedTotal)}</div>
          <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Actualised</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center' }}><span className="spinner" /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ margin: '20px' }}>
          <div className="icon">💰</div>
          <h3>No planned costs yet</h3>
          <p style={{ fontSize: '12px' }}>For PM100 items without invoices — contingency, warranty, financing.</p>
        </div>
      ) : (
        <div style={{ padding: '0 12px 80px 12px' }}>
          {grouped.map(g => (
            <div key={g.cat} style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 4px 8px' }}>
                {CATEGORY_LABELS[g.cat]}
              </div>
              {g.items.map(r => (
                <div
                  key={r.id}
                  className="card"
                  style={{ padding: '12px', marginBottom: '8px', cursor: 'pointer' }}
                  onClick={() => openEdit(r)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '10px', color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{r.number}</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>{r.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '4px' }}>
                        {r.wbs ? <><span style={{ fontFamily: 'var(--mono)' }}>{r.wbs}</span> · </> : null}
                        {ACCRUAL_LABELS[r.accrual_mode]}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{fmtMoney(Number(r.amount) || 0)}</div>
                      <div
                        onClick={e => { e.stopPropagation(); if (canWrite('cost_tracking')) toggleActualised(r) }}
                        style={{
                          marginTop: '6px',
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '10px',
                          fontWeight: 600,
                          display: 'inline-block',
                          background: r.actualised ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)',
                          color: r.actualised ? 'var(--green)' : 'var(--text3)',
                        }}
                      >
                        {r.actualised ? '✓ Actual' : 'Forecast'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Edit / new sheet */}
      <MobileBottomSheet
        open={!!sheet}
        onClose={() => { if (!saving) setSheet(null) }}
        title={sheet === 'new' ? 'New Planned Cost' : (sheet ? `Edit ${sheet.number}` : '')}
      >
        <div style={{ display: 'grid', gap: '10px', padding: '4px 0' }}>
          <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Title
            <input className="input" style={{ marginTop: '4px' }} value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="e.g. Risk Contingency" />
          </label>

          <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Category
            <select className="input" style={{ marginTop: '4px' }} value={fCategory} onChange={e => setFCategory(e.target.value as PlannedCostCategory)}>
              {(Object.keys(CATEGORY_LABELS) as PlannedCostCategory[]).map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: '11px', color: 'var(--text3)' }}>WBS
            <select className="input" style={{ marginTop: '4px' }} value={fWbs} onChange={e => setFWbs(e.target.value)}>
              <option value="">— (no WBS)</option>
              {wbsList.map(w => (
                <option key={w.id} value={w.code}>{w.code}{w.name ? ` — ${w.name}` : ''}</option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Amount (AUD)
            <input
              className="input"
              style={{ marginTop: '4px' }}
              type="number"
              inputMode="decimal"
              step="0.01"
              value={fAmount || ''}
              onChange={e => setFAmount(parseFloat(e.target.value) || 0)}
            />
          </label>

          <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Accrual
            <select className="input" style={{ marginTop: '4px' }} value={fAccrual} onChange={e => setFAccrual(e.target.value as PlannedCostAccrualMode)}>
              {(Object.keys(ACCRUAL_LABELS) as PlannedCostAccrualMode[]).map(m => (
                <option key={m} value={m}>{ACCRUAL_LABELS[m]}</option>
              ))}
            </select>
          </label>

          {fAccrual === 'lump_sum' ? (
            <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Date
              <input className="input" style={{ marginTop: '4px' }} type="date" value={fStart} onChange={e => setFStart(e.target.value)} />
            </label>
          ) : fAccrual === 'project_duration' ? (
            <div style={{ fontSize: '11px', color: 'var(--text3)', padding: '6px 0' }}>
              Spreads across project ({activeProject?.start_date || '—'} → {activeProject?.end_date || '—'})
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Start
                <input className="input" style={{ marginTop: '4px' }} type="date" value={fStart} onChange={e => setFStart(e.target.value)} />
              </label>
              <label style={{ fontSize: '11px', color: 'var(--text3)' }}>End
                <input className="input" style={{ marginTop: '4px' }} type="date" value={fEnd} onChange={e => setFEnd(e.target.value)} />
              </label>
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
            <input type="checkbox" checked={fActualised} onChange={e => setFActualised(e.target.checked)} />
            <span style={{ fontSize: '12px' }}>Actualised (cost has occurred — counts as Actual)</span>
          </label>

          <label style={{ fontSize: '11px', color: 'var(--text3)' }}>Notes
            <textarea className="input" style={{ marginTop: '4px' }} rows={2} value={fNotes} onChange={e => setFNotes(e.target.value)} />
          </label>

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button className="btn btn-primary" onClick={save} disabled={saving || !canWrite('cost_tracking')} style={{ flex: 1 }}>
              {saving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save'}
            </button>
            {sheet && sheet !== 'new' && canWrite('cost_tracking') && (
              <button className="btn" style={{ color: 'var(--red)' }} onClick={remove} disabled={saving}>Delete</button>
            )}
          </div>
        </div>
      </MobileBottomSheet>
    </div>
  )
}
