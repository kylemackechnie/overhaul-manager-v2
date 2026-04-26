import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { calcOhfLineForecast } from '../../lib/calculations'
import type { NrgTceLine, Resource, RateCard } from '../../types'

// ── Types ──────────────────────────────────────────────────────────────────

type OhfLine = NrgTceLine

const NRG_OHF_TYPES = [
  { value: 'labour',     label: 'Labour Hours'     },
  { value: 'allowances', label: 'Allowances'        },
  { value: 'travel',     label: 'Travel Time'       },
  { value: 'tce',        label: 'TCE Value (fixed)' },
] as const

const NRG_OHF_SUBTYPES = [
  { value: 'accommodation', label: 'Accommodation'    },
  { value: 'laha',          label: 'LAHA'             },
  { value: 'travel_allow',  label: 'Travel Allowance' },
  { value: 'meal',          label: 'Meal Allowance'   },
] as const

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return '$' + Math.round(n).toLocaleString('en-AU')
}

function vc(fc: number, tce: number): string {
  if (!fc) return 'var(--text3)'
  return (fc - tce) > 0 ? 'var(--red)' : (fc - tce) < 0 ? 'var(--green)' : 'var(--text)'
}

// ── Component ──────────────────────────────────────────────────────────────

export function NrgOhfPanel() {
  const { activeProject } = useAppStore()

  const [allLines,  setAllLines]  = useState<OhfLine[]>([])
  const [ohfLines,  setOhfLines]  = useState<OhfLine[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)

  // picker
  const [pickerOpen,   setPickerOpen]   = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerSel,    setPickerSel]    = useState<string[]>([])   // item_ids

  // row selection
  const [checked,    setChecked]    = useState<string[]>([])        // line UUIDs
  const [allChecked, setAllChecked] = useState(false)

  // bulk dates modal
  const [datesOpen, setDatesOpen] = useState(false)
  const [bulkFrom,  setBulkFrom]  = useState('')
  const [bulkTo,    setBulkTo]    = useState('')

  // bulk type modal
  const [typeOpen,    setTypeOpen]    = useState(false)
  const [bulkType,    setBulkType]    = useState('')
  const [bulkSubtype, setBulkSubtype] = useState('')

  // assign people modal
  const [assignOpen,    setAssignOpen]    = useState(false)
  const [assignDesc,    setAssignDesc]    = useState('')
  const [assignLineIds, setAssignLineIds] = useState<string[]>([])  // UUIDs
  const [assignSel,     setAssignSel]     = useState<string[]>([])  // resource UUIDs

  // ── load ────────────────────────────────────────────────────────────────

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid    = activeProject!.id
    const ohfIds = getOhfIds()
    const [tceRes, resRes, rcRes] = await Promise.all([
      supabase.from('nrg_tce_lines').select('*').eq('project_id', pid),
      supabase.from('resources')
        .select('id,name,role,mob_in,mob_out,shift,travel_days')
        .eq('project_id', pid).order('name'),
      supabase.from('rate_cards').select('*').eq('project_id', pid),
    ])
    const all = (tceRes.data || []) as OhfLine[]
    setAllLines(all)
    setOhfLines(all.filter(l => l.source === 'overhead' && ohfIds.includes(l.item_id || '')))
    setResources((resRes.data || []) as Resource[])
    setRateCards((rcRes.data || []) as RateCard[])
    setLoading(false)
    setChecked([]); setAllChecked(false)
  }

  function getOhfIds(): string[] {
    return ((activeProject?.nrg_config as { ohfLineIds?: string[] })?.ohfLineIds) || []
  }

  // ── persist ohfLineIds ───────────────────────────────────────────────────

  async function persistOhfIds(newIds: string[]): Promise<boolean> {
    const cfg = (activeProject?.nrg_config || {}) as Record<string, unknown>
    const { data, error } = await supabase
      .from('projects')
      .update({ nrg_config: { ...cfg, ohfLineIds: newIds } })
      .eq('id', activeProject!.id)
      .select('*,site:sites(id,name)')
      .single()
    if (error) { toast(error.message, 'error'); return false }
    const { useAppStore: s } = await import('../../store/appStore')
    s.getState().setActiveProject(data as typeof activeProject)
    return true
  }

  // ── patch DB rows ────────────────────────────────────────────────────────

  async function patchLines(ids: string[], patch: Record<string, unknown>) {
    setSaving(true)
    const results = await Promise.all(
      ids.map(id => supabase.from('nrg_tce_lines').update(patch).eq('id', id))
    )
    const errs = results.filter(r => r.error)
    if (errs.length) toast(`${errs.length} update(s) failed`, 'error')
    setSaving(false)
    await load()
  }

  // ── grouping helper ──────────────────────────────────────────────────────

  function groupBySection(lines: OhfLine[]) {
    const map = new Map<string, { label: string; lines: OhfLine[] }>()
    for (const l of lines) {
      const pid = (l.item_id || '').split('.').slice(0, 3).join('.')
      if (!map.has(pid)) {
        const hdr = allLines.find(x => x.item_id === pid)
        map.set(pid, { label: hdr?.description || pid, lines: [] })
      }
      map.get(pid)!.lines.push(l)
    }
    return [...map.entries()].map(([parentId, v]) => ({ parentId, ...v }))
  }

  // ── picker ───────────────────────────────────────────────────────────────

  const overheadLeaves = allLines.filter(l => l.source === 'overhead')
  const addedIds       = new Set(getOhfIds())

  const pickerLeaves = overheadLeaves.filter(l => {
    if (!pickerSearch) return true
    const q = pickerSearch.toLowerCase()
    return (l.item_id || '').toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
  })

  async function doAddLines() {
    if (!pickerSel.length) return
    const newIds = [...new Set([...getOhfIds(), ...pickerSel])]
    if (await persistOhfIds(newIds)) {
      toast(`${pickerSel.length} line(s) added to OHF`, 'success')
      setPickerSel([]); setPickerOpen(false); setPickerSearch('')
      load()
    }
  }

  // ── selection ────────────────────────────────────────────────────────────

  function toggleRow(id: string) {
    setChecked(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id])
  }
  function toggleAll(v: boolean) {
    setAllChecked(v); setChecked(v ? ohfLines.map(l => l.id) : [])
  }

  // ── remove ───────────────────────────────────────────────────────────────

  async function removeLines(ids: string[]) {
    const itemIds = ohfLines.filter(l => ids.includes(l.id)).map(l => l.item_id || '')
    const newIds  = getOhfIds().filter(id => !itemIds.includes(id))
    if (await persistOhfIds(newIds)) {
      toast(`${ids.length} line(s) removed`, 'success'); load()
    }
  }

  // ── bulk dates ───────────────────────────────────────────────────────────

  async function applyDates() {
    if (!bulkFrom && !bulkTo) { toast('Enter at least one date', 'error'); return }
    const patch: Record<string, unknown> = {}
    if (bulkFrom) patch.forecast_date_from = bulkFrom
    if (bulkTo)   patch.forecast_date_to   = bulkTo
    await patchLines(checked, patch)
    toast(`Dates applied to ${checked.length} line(s)`, 'success'); setDatesOpen(false)
  }

  // ── bulk type ────────────────────────────────────────────────────────────

  async function applyType() {
    if (!bulkType && !bulkSubtype) { toast('Select a type', 'error'); return }
    const patch: Record<string, unknown> = {}
    if (bulkType)    { patch.forecast_type = bulkType; patch.forecast_enabled = true }
    if (bulkSubtype) patch.forecast_subtype = bulkSubtype
    await patchLines(checked, patch)
    toast(`Type applied to ${checked.length} line(s)`, 'success'); setTypeOpen(false)
  }

  // ── assign ───────────────────────────────────────────────────────────────

  function openAssign(lineIds: string[], desc: string) {
    setAssignLineIds(lineIds); setAssignDesc(desc)
    const union = new Set<string>()
    ohfLines.filter(l => lineIds.includes(l.id))
      .forEach(l => (l.forecast_resources as string[] || []).forEach(id => union.add(id)))
    setAssignSel([...union]); setAssignOpen(true)
  }

  async function saveAssign() {
    await patchLines(assignLineIds, { forecast_resources: assignSel, forecast_enabled: true })
    toast(`${assignSel.length} people assigned to ${assignLineIds.length} line(s)`, 'success')
    setAssignOpen(false)
  }

  // ── derived ──────────────────────────────────────────────────────────────

  const resMap    = Object.fromEntries(resources.map(r => [r.id, r.name]))
  const sections  = groupBySection(ohfLines)
  const stdHours  = (activeProject?.std_hours as { day: Record<string,number>; night: Record<string,number> } | undefined)
  const publicHolidays = (activeProject as unknown as { public_holidays?: { date: string }[] })?.public_holidays || []
  const aliases   = (activeProject as unknown as { role_aliases?: { from: string; to: string }[] })?.role_aliases || []

  function calcForecast(l: OhfLine): number {
    return calcOhfLineForecast({
      forecastType:        l.forecast_type,
      forecastSubtype:     l.forecast_subtype,
      forecastEnabled:     l.forecast_enabled,
      forecastDateFrom:    l.forecast_date_from,
      forecastDateTo:      l.forecast_date_to,
      forecastResourceIds: (l.forecast_resources as string[]) || [],
      tceTotal:            l.tce_total || 0,
      resources,
      rateCards:           rateCards,
      aliases,
      stdHours:            stdHours || undefined,
      publicHolidays,
    })
  }

  let grandTce = 0, grandFc = 0, enabledCount = 0
  for (const l of ohfLines) {
    if (!l.forecast_enabled) continue
    grandTce += l.tce_total || 0; grandFc += calcForecast(l); enabledCount++
  }
  const grandVar = grandFc - grandTce
  const NRG      = 'var(--mod-nrg, #3730a3)'

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>

      {/* Header */}
      <div style={{ borderTop: `3px solid ${NRG}`, paddingTop: '14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700 }}>📊 TCE Overhead Forecast</h1>
            <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
              Compare TCE estimated value against your system&apos;s forecast for overhead lines
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary"
              onClick={() => { setPickerOpen(true); setPickerSearch(''); setPickerSel([]) }}>
              ＋ Add Lines
            </button>
            <button className="btn btn-secondary" onClick={load}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* Bulk bar */}
      {checked.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
          padding: '8px 12px', marginBottom: '10px',
          background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)',
          borderRadius: 'var(--radius)',
        }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: NRG }}>{checked.length} selected</span>
          <button className="btn btn-secondary btn-sm" onClick={() => { setBulkFrom(''); setBulkTo(''); setDatesOpen(true) }}>📅 Set Dates</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setBulkType(''); setBulkSubtype(''); setTypeOpen(true) }}>🏷 Set Type</button>
          <button className="btn btn-secondary btn-sm"
            onClick={() => openAssign(checked, `Assign people to ${checked.length} selected line${checked.length > 1 ? 's' : ''}`)}>
            👥 Assign People
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => removeLines(checked)}>✕ Remove Lines</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setChecked([]); setAllChecked(false) }}>Clear Selection</button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading...</div>

      /* Empty */
      ) : ohfLines.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 40px', color: 'var(--text3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>📊</div>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text2)', marginBottom: '6px' }}>
            {overheadLeaves.length === 0 ? 'No TCE overhead lines available' : 'No lines added yet'}
          </h3>
          <p style={{ fontSize: '13px', marginBottom: '20px' }}>
            {overheadLeaves.length === 0
              ? 'Import a TCE spreadsheet first to populate overhead lines.'
              : 'Use the + Add Lines button to choose which overhead TCE lines to forecast.'}
          </p>
          {overheadLeaves.length > 0 && (
            <button className="btn btn-primary" onClick={() => setPickerOpen(true)}>＋ Add Lines</button>
          )}
        </div>

      /* Main table */
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={allChecked}
                    onChange={e => toggleAll(e.target.checked)}
                    style={{ accentColor: NRG }} />
                </th>
                <th style={{ width: 80  }}>Item ID</th>
                <th style={{ width: 36, textAlign: 'center' }}>On</th>
                <th style={{ width: 160 }}>Description</th>
                <th style={{ width: 120 }}>Type</th>
                <th style={{ width: 100 }}>Date From</th>
                <th style={{ width: 100 }}>Date To</th>
                <th style={{ width: 120 }}>Assigned</th>
                <th style={{ width: 90,  textAlign: 'right' }}>TCE Estimate</th>
                <th style={{ width: 90,  textAlign: 'right' }}>Sys Forecast</th>
                <th style={{ width: 80,  textAlign: 'right' }}>Variance</th>
                <th style={{ width: 46,  textAlign: 'right' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {sections.map(({ parentId, label, lines }) => {
                const sTce = lines.filter(l => l.forecast_enabled).reduce((s, l) => s + (l.tce_total || 0), 0)
                const sFc  = lines.filter(l => l.forecast_enabled).reduce((s, l) => s + calcForecast(l), 0)
                const sVar = sFc - sTce
                return [
                  <tr key={`s-${parentId}`} style={{ background: '#e0e7ff', color: '#3730a3', borderBottom: '1px solid #c7d2fe' }}>
                    <td />
                    <td colSpan={7} style={{ fontSize: '11px', fontWeight: 700, padding: '6px' }}>
                      {parentId} — {label}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '11px', fontWeight: 700 }}>{sTce ? fmt(sTce) : ''}</td>
                    <td style={{ textAlign: 'right', fontSize: '11px', fontWeight: 700 }}>{sFc ? fmt(sFc) : '—'}</td>
                    <td style={{ textAlign: 'right', fontSize: '11px', fontWeight: 700, color: vc(sFc, sTce) }}>{sFc ? fmt(sVar) : '—'}</td>
                    <td style={{ textAlign: 'right', fontSize: '11px', color: vc(sFc, sTce) }}>
                      {sTce > 0 && sFc ? (sVar / sTce * 100).toFixed(1) + '%' : '—'}
                    </td>
                  </tr>,
                  ...lines.map(l => {
                    const tce  = l.tce_total || 0
                    const fc   = calcForecast(l)
                    const varV = fc - tce
                    const pct  = tce > 0 && fc ? (varV / tce * 100) : null
                    const assigned = (l.forecast_resources as string[]) || []
                    const names    = assigned.map(id => resMap[id]).filter(Boolean)
                    const showSub  = l.forecast_type === 'allowances'

                    return (
                      <tr key={l.id} style={{ opacity: l.forecast_enabled ? 1 : 0.5 }}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={checked.includes(l.id)}
                            onChange={() => toggleRow(l.id)} style={{ accentColor: NRG }} />
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.item_id || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!l.forecast_enabled}
                            title="Include in forecast" style={{ accentColor: NRG }}
                            onChange={e => patchLines([l.id], { forecast_enabled: e.target.checked })} />
                        </td>
                        <td style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={l.description}>{l.description}</td>
                        <td>
                          <select className="select"
                            style={{ fontSize: '10px', padding: '2px 4px', height: '24px', width: '100%' }}
                            value={l.forecast_type || ''}
                            onChange={e => patchLines([l.id], { forecast_type: e.target.value || null, forecast_enabled: !!e.target.value })}>
                            <option value="">— Set type —</option>
                            {NRG_OHF_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          {showSub && (
                            <select className="select"
                              style={{ fontSize: '10px', padding: '2px 4px', height: '24px', width: '100%', marginTop: '2px' }}
                              value={l.forecast_subtype || ''}
                              onChange={e => patchLines([l.id], { forecast_subtype: e.target.value || null })}>
                              <option value="">— Subtype —</option>
                              {NRG_OHF_SUBTYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          <input type="date" className="input"
                            style={{ fontSize: '10px', padding: '2px 4px', height: '24px', width: '100%' }}
                            value={l.forecast_date_from || ''}
                            onChange={e => patchLines([l.id], { forecast_date_from: e.target.value || null })} />
                        </td>
                        <td>
                          <input type="date" className="input"
                            style={{ fontSize: '10px', padding: '2px 4px', height: '24px', width: '100%' }}
                            value={l.forecast_date_to || ''}
                            onChange={e => patchLines([l.id], { forecast_date_to: e.target.value || null })} />
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}>
                            {names.length > 0 ? (
                              <>
                                {names.slice(0, 2).map(n => (
                                  <span key={n} title={n} style={{
                                    display: 'inline-block', background: 'var(--bg3)',
                                    border: '1px solid var(--border)', borderRadius: '3px',
                                    padding: '0 4px', fontSize: '10px', maxWidth: '55px',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>{n}</span>
                                ))}
                                {names.length > 2 && <span style={{ fontSize: '10px', color: 'var(--text3)' }}>+{names.length - 2}</span>}
                              </>
                            ) : <span style={{ color: 'var(--text3)', fontSize: '10px' }}>—</span>}
                            <button className="btn btn-secondary"
                              style={{ fontSize: '9px', padding: '1px 5px', height: '20px', flexShrink: 0 }}
                              onClick={() => openAssign([l.id], `${l.item_id} — ${l.description}`)}>✏</button>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontSize: '11px', fontWeight: 600 }}>{fmt(tce)}</td>
                        <td style={{ textAlign: 'right', fontSize: '11px', fontWeight: 600, color: fc ? 'var(--text)' : 'var(--text3)' }}>
                          {fc ? fmt(fc) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: '11px', color: vc(fc, tce) }}>{fc ? fmt(varV) : '—'}</td>
                        <td style={{ textAlign: 'right', fontSize: '11px', color: vc(fc, tce) }}>
                          {pct !== null ? pct.toFixed(1) + '%' : '—'}
                        </td>
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, background: 'var(--bg3)', fontSize: '12px' }}>
                <td colSpan={8} style={{ padding: '8px 6px' }}>TOTAL — {enabledCount} enabled lines</td>
                <td style={{ textAlign: 'right' }}>{fmt(grandTce)}</td>
                <td style={{ textAlign: 'right', color: vc(grandFc, grandTce) }}>{grandFc ? fmt(grandFc) : '—'}</td>
                <td style={{ textAlign: 'right', color: vc(grandFc, grandTce) }}>{grandFc ? fmt(grandVar) : '—'}</td>
                <td style={{ textAlign: 'right', color: vc(grandFc, grandTce) }}>
                  {grandTce > 0 && grandFc ? (grandVar / grandTce * 100).toFixed(1) + '%' : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Picker modal ─────────────────────────────────────────────────── */}
      {pickerOpen && (
        <div className="modal-overlay open" onClick={() => setPickerOpen(false)}>
          <div className="modal modal-lg" style={{ maxWidth: '700px', maxHeight: '92vh', overflowY: 'auto' }}
               onClick={e => e.stopPropagation()}>
            <div className="modal-title">＋ Add Forecast Lines</div>
            <p className="text-muted mb-14">
              Select the overhead TCE lines you want to track. Already-added lines are shown but greyed out.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <button className="btn btn-secondary btn-xs"
                onClick={() => setPickerSel(overheadLeaves.filter(l => !addedIds.has(l.item_id || '')).map(l => l.item_id || ''))}>
                Select All
              </button>
              <button className="btn btn-secondary btn-xs" onClick={() => setPickerSel([])}>None</button>
              <input className="input" style={{ flex: 1, fontSize: '12px', height: '28px', padding: '2px 8px' }}
                placeholder="Filter lines..."
                value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '440px', overflowY: 'auto', padding: '2px' }}>
              {groupBySection(pickerLeaves).map(({ parentId, label, lines }) => (
                <div key={parentId}>
                  <div style={{
                    padding: '6px 8px 2px', fontSize: '10px', fontWeight: 700,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: '#3730a3', background: '#e0e7ff', borderRadius: '4px', marginTop: '4px',
                  }}>{parentId} — {label}</div>
                  {lines.map(l => {
                    const isAdded   = addedIds.has(l.item_id || '')
                    const isChecked = pickerSel.includes(l.item_id || '')
                    return (
                      <label key={l.id} style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '6px 10px', border: '1px solid var(--border)', borderRadius: '5px',
                        cursor: isAdded ? 'default' : 'pointer',
                        background: isAdded ? 'var(--bg3)' : 'var(--bg2)', opacity: isAdded ? 0.5 : 1,
                      }}>
                        <input type="checkbox"
                          checked={isAdded || isChecked} disabled={isAdded}
                          style={{ accentColor: NRG, flexShrink: 0 }}
                          onChange={() => {
                            if (isAdded) return
                            setPickerSel(s => s.includes(l.item_id || '')
                              ? s.filter(x => x !== l.item_id)
                              : [...s, l.item_id || ''])
                          }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text3)', marginRight: '6px' }}>
                            {l.item_id}
                          </span>
                          <span style={{ fontSize: '12px', fontWeight: isAdded ? 400 : 600 }}>{l.description}</span>
                          {isAdded && <span style={{ fontSize: '10px', color: NRG, marginLeft: '6px' }}>✓ added</span>}
                        </div>
                        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text3)', flexShrink: 0 }}>
                          {fmt(l.tce_total || 0)}
                        </span>
                      </label>
                    )
                  })}
                </div>
              ))}
              {pickerLeaves.length === 0 && (
                <p style={{ color: 'var(--text3)', fontSize: '13px', padding: '12px' }}>
                  {overheadLeaves.length === 0
                    ? 'Import a TCE spreadsheet first to populate overhead lines.'
                    : 'No lines match your filter.'}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPickerOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!pickerSel.length} onClick={doAddLines}>Add Selected</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk: Set Dates ───────────────────────────────────────────────── */}
      {datesOpen && (
        <div className="modal-overlay open" onClick={() => setDatesOpen(false)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">📅 Set Dates</div>
            <p className="text-muted mb-14">
              Set dates for {checked.length} line{checked.length > 1 ? 's' : ''}. Leave blank to keep existing.
            </p>
            <div className="fg-row">
              <div className="fg"><label>Date From</label>
                <input type="date" className="input" value={bulkFrom} onChange={e => setBulkFrom(e.target.value)} />
              </div>
              <div className="fg"><label>Date To</label>
                <input type="date" className="input" value={bulkTo} onChange={e => setBulkTo(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDatesOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyDates} disabled={saving}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk: Set Type ────────────────────────────────────────────────── */}
      {typeOpen && (
        <div className="modal-overlay open" onClick={() => setTypeOpen(false)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">🏷 Set Type</div>
            <p className="text-muted mb-14">
              Set type for {checked.length} line{checked.length > 1 ? 's' : ''}.
            </p>
            <div className="fg">
              <label>Forecast Type</label>
              <select className="select" value={bulkType} onChange={e => setBulkType(e.target.value)}>
                <option value="">— Select type —</option>
                {NRG_OHF_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {bulkType === 'allowances' && (
              <div className="fg" style={{ marginTop: '12px' }}>
                <label>Allowance Subtype</label>
                <select className="select" value={bulkSubtype} onChange={e => setBulkSubtype(e.target.value)}>
                  <option value="">—</option>
                  {NRG_OHF_SUBTYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setTypeOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyType} disabled={saving}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign People modal ───────────────────────────────────────────── */}
      {assignOpen && (
        <div className="modal-overlay open" onClick={() => setAssignOpen(false)}>
          <div className="modal" style={{ maxWidth: '560px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">👥 Assign People</div>
            <p className="text-muted mb-14">{assignDesc}</p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <button className="btn btn-secondary btn-xs" onClick={() => setAssignSel(resources.map(r => r.id))}>Select All</button>
              <button className="btn btn-secondary btn-xs" onClick={() => setAssignSel([])}>None</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', maxHeight: '340px', overflowY: 'auto', padding: '2px' }}>
              {resources.length === 0
                ? <p style={{ color: 'var(--text3)', fontSize: '13px', padding: '8px' }}>No resources in this project.</p>
                : resources.map(r => {
                    const sel = assignSel.includes(r.id)
                    const res = r as Resource & { mob_in?: string; mob_out?: string; travel_days?: number }
                    return (
                      <label key={r.id} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '7px 10px', border: '1px solid var(--border)', borderRadius: '6px',
                        cursor: 'pointer', background: sel ? 'rgba(67,56,202,.08)' : 'var(--bg2)',
                      }}>
                        <input type="checkbox" checked={sel} style={{ accentColor: NRG }}
                          onChange={() => setAssignSel(s => s.includes(r.id) ? s.filter(x => x !== r.id) : [...s, r.id])} />
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 600 }}>{r.name}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text3)' }}>
                            {r.role || '—'}
                            {res.mob_in ? ` · ${res.mob_in} → ${res.mob_out || '?'}` : ''}
                            {typeof res.travel_days === 'number' ? ` · ✈ ${res.travel_days}d each way` : ''}
                          </div>
                        </div>
                      </label>
                    )
                  })
              }
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setAssignOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAssign} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
