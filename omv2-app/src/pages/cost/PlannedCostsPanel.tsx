/**
 * PlannedCostsPanel
 *
 * PM100 cost lines that contribute to EAC without a vendor receipt.
 * Covers two distinct shapes:
 *
 *   1. Fixed-cost overheads (contingency / warranty / financing / bank
 *      guarantees) — exist in the cost plan by design, accrue with time,
 *      never have a receipt.
 *
 *   2. Placeholder forecasts (local tooling, planned consumables) — a
 *      forecast number now that will later convert to real expenses or
 *      POs. The "actualised" flag flips them from Forecast → Actual once
 *      their cost has occurred in reality.
 *
 * Single source of truth for these in EAC. Replaces the old workaround of
 * adding them to Expenses, which misused the receipt-based expense flow.
 */

import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { usePermissions } from '../../lib/permissions'
import { toast } from '../../components/ui/Toast'
import { HelpButton } from '../../components/HelpButton'
import { useIsMobile } from '../../hooks/useIsMobile'
import type {
  PlannedCost, PlannedCostCategory, PlannedCostAccrualMode, WbsItem,
} from '../../types'

const PlannedCostsMobile = lazy(() =>
  import('../mobile/PlannedCostsMobile').then(m => ({ default: m.PlannedCostsMobile }))
)

const CATEGORY_LABELS: Record<PlannedCostCategory, string> = {
  fixed_cost:    'Fixed Cost',
  contingency:   'Contingency',
  warranty:      'Warranty',
  financing:     'Financing',
  forecast_only: 'Forecast Only',
  other:         'Other',
}

const ACCRUAL_LABELS: Record<PlannedCostAccrualMode, string> = {
  lump_sum:         'Lump sum (single date)',
  project_duration: 'Spread across project',
  date_range:       'Spread across custom dates',
  monthly:          'Spread monthly',
}

type PCForm = {
  number: string
  title: string
  category: PlannedCostCategory
  wbs: string
  amount: number
  currency: string
  accrual_mode: PlannedCostAccrualMode
  start_date: string
  end_date: string
  actualised: boolean
  actualised_date: string
  notes: string
}

const EMPTY_FORM: PCForm = {
  number: '',
  title: '',
  category: 'fixed_cost',
  wbs: '',
  amount: 0,
  currency: 'AUD',
  accrual_mode: 'project_duration',
  start_date: '',
  end_date: '',
  actualised: false,
  actualised_date: '',
  notes: '',
}

const fmt = (v: number) =>
  '$' + (v || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })

export function PlannedCostsPanel() {
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <Suspense fallback={<div className="mobile-loading"><span className="spinner" /> Loading…</div>}>
        <PlannedCostsMobile />
      </Suspense>
    )
  }
  return <PlannedCostsPanelDesktop />
}

function PlannedCostsPanelDesktop() {
  const { activeProject } = useAppStore()
  const { canWrite } = usePermissions()
  const [rows, setRows] = useState<PlannedCost[]>([])
  const [wbsList, setWbsList] = useState<WbsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | PlannedCost>(null)
  const [form, setForm] = useState<PCForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState<'all' | PlannedCostCategory>('all')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [pcR, wbsR] = await Promise.all([
      supabase.from('planned_costs').select('*').eq('project_id', pid).order('number'),
      supabase.from('wbs_list').select('*').eq('project_id', pid).order('sort_order'),
    ])
    setRows((pcR.data || []) as PlannedCost[])
    setWbsList((wbsR.data || []) as WbsItem[])
    setLoading(false)
  }

  // Next PC number for this project: PC-NNNN, max+1
  function nextNumber(): string {
    const nums = rows
      .map(r => parseInt(r.number.replace(/[^0-9]/g, ''), 10))
      .filter(n => !isNaN(n))
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    return `PC-${String(next).padStart(4, '0')}`
  }

  function openNew() {
    setForm({
      ...EMPTY_FORM,
      number: nextNumber(),
      start_date: activeProject?.start_date || '',
      end_date: activeProject?.end_date || '',
    })
    setModal('new')
  }

  function openEdit(row: PlannedCost) {
    setForm({
      number: row.number,
      title: row.title,
      category: row.category,
      wbs: row.wbs,
      amount: Number(row.amount) || 0,
      currency: row.currency,
      accrual_mode: row.accrual_mode,
      start_date: row.start_date || '',
      end_date: row.end_date || '',
      actualised: row.actualised,
      actualised_date: row.actualised_date || '',
      notes: row.notes,
    })
    setModal(row)
  }

  async function save() {
    if (!activeProject) return
    if (!form.title.trim()) { toast('Title is required', 'error'); return }
    if (form.amount <= 0) { toast('Amount must be greater than 0', 'error'); return }
    if (form.accrual_mode === 'lump_sum' && !form.start_date) {
      toast('Lump sum needs a date', 'error'); return
    }
    if (form.accrual_mode === 'date_range' && (!form.start_date || !form.end_date)) {
      toast('Custom date range needs both start and end', 'error'); return
    }
    setSaving(true)
    const payload = {
      project_id: activeProject.id,
      number: form.number,
      title: form.title.trim(),
      category: form.category,
      wbs: form.wbs,
      amount: form.amount,
      currency: form.currency,
      accrual_mode: form.accrual_mode,
      start_date: form.start_date || null,
      end_date: form.accrual_mode === 'lump_sum' ? null : (form.end_date || null),
      actualised: form.actualised,
      // actualised_date is auto-stamped by the trigger when actualised flips
      // true, but allow user override if they're entering a historical date.
      actualised_date: form.actualised && form.actualised_date ? form.actualised_date : null,
      notes: form.notes,
    }

    let error
    if (modal === 'new') {
      ({ error } = await supabase.from('planned_costs').insert(payload))
    } else if (modal) {
      ({ error } = await supabase.from('planned_costs').update(payload).eq('id', modal.id))
    }

    if (error) {
      toast(`Save failed: ${error.message}`, 'error')
    } else {
      toast('Saved', 'success')
      setModal(null)
      await load()
    }
    setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this planned cost line? This cannot be undone.')) return
    const { error } = await supabase.from('planned_costs').delete().eq('id', id)
    if (error) { toast(`Delete failed: ${error.message}`, 'error'); return }
    toast('Deleted', 'success')
    await load()
  }

  async function toggleActualised(row: PlannedCost) {
    const next = !row.actualised
    const { error } = await supabase
      .from('planned_costs')
      .update({ actualised: next })
      .eq('id', row.id)
    if (error) { toast(`Update failed: ${error.message}`, 'error'); return }
    toast(next ? 'Marked actualised' : 'Marked back to forecast', 'success')
    await load()
  }

  // Derived
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filterCat !== 'all' && r.category !== filterCat) return false
      if (!q) return true
      return r.number.toLowerCase().includes(q)
        || r.title.toLowerCase().includes(q)
        || r.wbs.toLowerCase().includes(q)
    })
  }, [rows, search, filterCat])

  const kpis = useMemo(() => {
    let total = 0, actualised = 0, future = 0, active = 0
    const today = new Date().toISOString().slice(0, 10)
    for (const r of rows) {
      const amt = Number(r.amount) || 0
      total += amt
      if (r.actualised) {
        actualised += amt
      } else if (r.start_date && r.start_date > today) {
        future += amt
      } else {
        active += amt
      }
    }
    return { total, actualised, future, active }
  }, [rows])

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Planned Costs</h1>
            <HelpButton panelId="planned-costs" />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            PM100 lines without receipts — contingency, warranty, financing, planned tooling, etc.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew} disabled={!canWrite('cost_tracking')}>+ Add Planned Cost</button>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total Planned', val: kpis.total, color: '#3b82f6' },
          { label: 'Active', val: kpis.active, color: '#f59e0b' },
          { label: 'Future', val: kpis.future, color: 'var(--text3)' },
          { label: 'Actualised', val: kpis.actualised, color: 'var(--green)' },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: '12px', borderTop: `3px solid ${k.color}` }}>
            <div style={{ fontSize: '17px', fontWeight: 700, fontFamily: 'var(--mono)', color: k.color }}>{fmt(k.val)}</div>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <input className="input" style={{ width: '260px' }} placeholder="Search number, title, WBS…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input" style={{ width: '160px' }} value={filterCat} onChange={e => setFilterCat(e.target.value as 'all' | PlannedCostCategory)}>
          <option value="all">All categories</option>
          {(Object.keys(CATEGORY_LABELS) as PlannedCostCategory[]).map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <span style={{ fontSize: '12px', color: 'var(--text3)', marginLeft: 'auto', alignSelf: 'center' }}>{filtered.length} of {rows.length}</span>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">💰</div>
          <h3>No planned costs yet</h3>
          <p>Use this for PM100 items that don't have invoices — risk contingency, warranty allowance, financing, bank guarantees, or placeholder forecasts for items like local tooling that will become real expenses later.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', fontSize: '12px' }}>
            <thead>
              <tr>
                <th>Number</th>
                <th>Title</th>
                <th>Category</th>
                <th>WBS</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Accrual</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openEdit(r)}>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{r.number}</td>
                  <td style={{ fontWeight: 500 }}>{r.title}</td>
                  <td>{CATEGORY_LABELS[r.category] || r.category}</td>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{r.wbs || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                    {fmt(Number(r.amount) || 0)}
                    {r.currency !== 'AUD' && <span style={{ fontSize: '10px', color: 'var(--text3)', marginLeft: '4px' }}>{r.currency}</span>}
                  </td>
                  <td style={{ fontSize: '11px', color: 'var(--text3)' }}>{ACCRUAL_LABELS[r.accrual_mode]}</td>
                  <td onClick={e => { e.stopPropagation() }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: canWrite('cost_tracking') ? 'pointer' : 'default', fontSize: '11px' }}>
                      <input
                        type="checkbox"
                        checked={r.actualised}
                        disabled={!canWrite('cost_tracking')}
                        onChange={() => toggleActualised(r)}
                      />
                      {r.actualised
                        ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>Actualised</span>
                        : <span style={{ color: 'var(--text3)' }}>Forecast</span>
                      }
                    </label>
                  </td>
                  <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm" style={{ color: 'var(--red)' }} disabled={!canWrite('cost_tracking')} onClick={() => remove(r.id)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / new modal */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal === 'new' ? 'New Planned Cost' : `Edit ${form.number}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px', alignItems: 'center' }}>
                <label>Number</label>
                <input className="input" value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} />

                <label>Title</label>
                <input className="input" placeholder="e.g. Risk Contingency Execution" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />

                <label>Category</label>
                <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as PlannedCostCategory }))}>
                  {(Object.keys(CATEGORY_LABELS) as PlannedCostCategory[]).map(c => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>

                <label>WBS</label>
                <select className="input" value={form.wbs} onChange={e => setForm(f => ({ ...f, wbs: e.target.value }))}>
                  <option value="">— (no WBS)</option>
                  {wbsList.map(w => (
                    <option key={w.id} value={w.code}>{w.code}{w.name ? ` — ${w.name}` : ''}</option>
                  ))}
                </select>

                <label>Amount</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className="input" type="number" step="0.01" style={{ flex: 1 }} value={form.amount || ''} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} />
                  <select className="input" style={{ width: '80px' }} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    <option value="AUD">AUD</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>

                <label>Accrual</label>
                <select className="input" value={form.accrual_mode} onChange={e => setForm(f => ({ ...f, accrual_mode: e.target.value as PlannedCostAccrualMode }))}>
                  {(Object.keys(ACCRUAL_LABELS) as PlannedCostAccrualMode[]).map(m => (
                    <option key={m} value={m}>{ACCRUAL_LABELS[m]}</option>
                  ))}
                </select>

                {form.accrual_mode === 'lump_sum' ? (
                  <>
                    <label>Date</label>
                    <input className="input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                  </>
                ) : form.accrual_mode === 'project_duration' ? (
                  <>
                    <label>Window</label>
                    <div style={{ fontSize: '12px', color: 'var(--text3)' }}>
                      Spreads evenly across the project ({activeProject?.start_date || '—'} → {activeProject?.end_date || '—'})
                    </div>
                  </>
                ) : (
                  <>
                    <label>Start</label>
                    <input className="input" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                    <label>End</label>
                    <input className="input" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
                  </>
                )}

                <label>Actualised</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input type="checkbox" checked={form.actualised} onChange={e => setForm(f => ({ ...f, actualised: e.target.checked }))} />
                    <span style={{ fontSize: '12px' }}>Cost has occurred in reality (counts as Actual, not Forecast)</span>
                  </label>
                </div>

                {form.actualised && (
                  <>
                    <label>Actualised on</label>
                    <input className="input" type="date" value={form.actualised_date} onChange={e => setForm(f => ({ ...f, actualised_date: e.target.value }))} placeholder="Defaults to today" />
                  </>
                )}

                <label style={{ alignSelf: 'start', paddingTop: '8px' }}>Notes</label>
                <textarea className="input" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !canWrite('cost_tracking')}>
                {saving ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
