/**
 * HertzRatesPanel — admin editor for the global Hertz vehicle rate card
 * (hertz_vehicle_rates). One row per SIPP/vehicle. Annual rate updates land
 * here. Rows are global; projects read from this table when auto-pricing
 * a Hertz booking.
 *
 * Read access: any authenticated user. Write access: is_admin() only.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { HelpButton } from '../../components/HelpButton'
import type { HertzVehicleRate, HertzVehicleCategory } from '../../types'
import { vehicleCategoryLabel } from '../../lib/hertzPricing'

const CATEGORIES: HertzVehicleCategory[] = [
  'electric_hybrid', 'passenger', 'prestige', '4wd', 'bus', 'commercial',
]
const PRICING_CODES = ['C', 'P', 'V', 'F', 'L', 'H', 'P1'] as const

type RateForm = {
  sipp_code: string
  class_code: string
  pricing_code: string
  vehicle_category: HertzVehicleCategory
  vehicle_type: string
  vehicle_example: string
  rate_1_2_days: number
  rate_3_6_days: number
  rate_7_29_days: number
  rate_30_plus_days: number
  excess_km_rate: number | null
  km_included_country: number | null
  km_included_remote: number | null
  surcharge_country: number
  surcharge_remote: number
  surcharge_high_remote: number
  ldl_amount: number | null
  remote_available: boolean
  weekend_surcharge_amount: number | null
  weekend_surcharge_max_hours: number | null
  is_active: boolean
  notes: string
}

const EMPTY_FORM: RateForm = {
  sipp_code: '', class_code: '', pricing_code: 'C', vehicle_category: 'passenger',
  vehicle_type: '', vehicle_example: '',
  rate_1_2_days: 0, rate_3_6_days: 0, rate_7_29_days: 0, rate_30_plus_days: 0,
  excess_km_rate: 0.25, km_included_country: 200, km_included_remote: 100,
  surcharge_country: 5, surcharge_remote: 10, surcharge_high_remote: 10,
  ldl_amount: 3000, remote_available: true,
  weekend_surcharge_amount: null, weekend_surcharge_max_hours: null,
  is_active: true, notes: '',
}

export function HertzRatesPanel() {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'admin'
  const [rates, setRates] = useState<HertzVehicleRate[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | HertzVehicleRate>(null)
  const [form, setForm] = useState<RateForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [catFilter, setCatFilter] = useState<'all' | HertzVehicleCategory>('all')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('hertz_vehicle_rates')
      .select('*').order('sort_order').order('sipp_code')
    if (error) toast(error.message, 'error')
    setRates((data || []) as HertzVehicleRate[])
    setLoading(false)
  }

  function openNew() {
    if (!isAdmin) return
    setForm(EMPTY_FORM)
    setModal('new')
  }

  function openEdit(r: HertzVehicleRate) {
    if (!isAdmin) return
    setForm({
      sipp_code: r.sipp_code, class_code: r.class_code, pricing_code: r.pricing_code,
      vehicle_category: r.vehicle_category, vehicle_type: r.vehicle_type,
      vehicle_example: r.vehicle_example,
      rate_1_2_days: r.rate_1_2_days, rate_3_6_days: r.rate_3_6_days,
      rate_7_29_days: r.rate_7_29_days, rate_30_plus_days: r.rate_30_plus_days,
      excess_km_rate: r.excess_km_rate, km_included_country: r.km_included_country,
      km_included_remote: r.km_included_remote,
      surcharge_country: r.surcharge_country, surcharge_remote: r.surcharge_remote,
      surcharge_high_remote: r.surcharge_high_remote,
      ldl_amount: r.ldl_amount, remote_available: r.remote_available,
      weekend_surcharge_amount: r.weekend_surcharge_amount,
      weekend_surcharge_max_hours: r.weekend_surcharge_max_hours,
      is_active: r.is_active, notes: r.notes,
    })
    setModal(r)
  }

  async function save() {
    if (!isAdmin) { toast('Admin only', 'error'); return }
    if (!form.sipp_code.trim()) return toast('SIPP code required', 'error')
    if (!form.vehicle_type.trim()) return toast('Vehicle type required', 'error')
    setSaving(true)
    const payload = {
      ...form,
      sipp_code: form.sipp_code.trim().toUpperCase(),
      class_code: form.class_code.trim().toUpperCase(),
      vehicle_type: form.vehicle_type.trim(),
      vehicle_example: form.vehicle_example.trim(),
      notes: form.notes.trim(),
      updated_at: new Date().toISOString(),
    }
    if (modal === 'new') {
      const { error } = await supabase.from('hertz_vehicle_rates').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Rate added', 'success')
    } else {
      const { error } = await supabase.from('hertz_vehicle_rates').update(payload).eq('id', (modal as HertzVehicleRate).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Rate saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(r: HertzVehicleRate) {
    if (!isAdmin) return
    if (!confirm(`Delete rate ${r.sipp_code} — ${r.vehicle_type}?\n\nExisting bookings already snapshot the rate values, so they're unaffected. Future bookings won't be able to select this SIPP.`)) return
    const { error } = await supabase.from('hertz_vehicle_rates').delete().eq('id', r.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Deleted', 'info'); load()
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rates.filter(r => {
      if (catFilter !== 'all' && r.vehicle_category !== catFilter) return false
      if (q && !(
        r.sipp_code.toLowerCase().includes(q) ||
        r.vehicle_type.toLowerCase().includes(q) ||
        r.vehicle_example.toLowerCase().includes(q)
      )) return false
      return true
    })
  }, [rates, catFilter, search])

  const catCounts = useMemo(() => {
    const m: Record<string, number> = {}
    rates.forEach(r => { m[r.vehicle_category] = (m[r.vehicle_category] || 0) + 1 })
    return m
  }, [rates])

  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div style={{ padding: '24px', maxWidth: '1400px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>🚗 Hertz Vehicle Rates</h1>
            <HelpButton panelId="hertz-rates" />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {rates.length} rates · Source: Siemens Energy / Hertz Global Pricing Rate Sheet 2024–26
          </p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={openNew}>+ New Rate</button>}
      </div>

      <div style={{
        background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)',
        borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: '14px', fontSize: '12px', color: 'var(--text2)',
      }}>
        <strong>How this works:</strong> Rates auto-apply to Hertz bookings on the project car-hire page based on rental duration. Existing bookings keep the rate values that were live at booking time, so edits here only affect future bookings. Rates are GST-exclusive — GST is added at calc time.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${catFilter === 'all' ? 'btn-primary' : ''}`} onClick={() => setCatFilter('all')}>
          All ({rates.length})
        </button>
        {CATEGORIES.map(c => (
          <button key={c} className={`btn btn-sm ${catFilter === c ? 'btn-primary' : ''}`} onClick={() => setCatFilter(c)}>
            {vehicleCategoryLabel(c)} ({catCounts[c] || 0})
          </button>
        ))}
        <input
          className="input" style={{ width: '220px', marginLeft: 'auto' }}
          placeholder="Search SIPP / type / example..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading…</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Class</th>
                <th>SIPP</th>
                <th>Code</th>
                <th>Category</th>
                <th>Vehicle Type</th>
                <th>Example</th>
                <th style={{ textAlign: 'right' }}>1–2 d</th>
                <th style={{ textAlign: 'right' }}>3–6 d</th>
                <th style={{ textAlign: 'right' }}>7–29 d</th>
                <th style={{ textAlign: 'right' }}>30+ d</th>
                <th style={{ textAlign: 'right' }}>Excess km</th>
                <th style={{ textAlign: 'right' }}>LDL</th>
                <th>Conditions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--accent)' }}>{r.class_code || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{r.sipp_code}</td>
                  <td>{r.pricing_code}</td>
                  <td style={{ fontSize: '11px', color: 'var(--text2)' }}>{vehicleCategoryLabel(r.vehicle_category)}</td>
                  <td style={{ fontWeight: 500 }}>{r.vehicle_type}</td>
                  <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{r.vehicle_example}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.rate_1_2_days)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.rate_3_6_days)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.rate_7_29_days)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(r.rate_30_plus_days)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text2)' }}>
                    {r.excess_km_rate ? `$${r.excess_km_rate.toFixed(2)}/km` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text2)' }}>
                    {r.ldl_amount ? fmt(r.ldl_amount) : '—'}
                  </td>
                  <td style={{ fontSize: '11px', color: 'var(--text2)' }}>
                    Country ${r.surcharge_country}/d {r.km_included_country}km
                    <br />Remote ${r.surcharge_remote}/d {r.km_included_remote}km
                    {r.surcharge_high_remote > r.surcharge_remote ? <><br />High-remote ${r.surcharge_high_remote}/d</> : null}
                    {!r.remote_available ? <><br /><span style={{ color: 'var(--orange)' }}>No remote</span></> : null}
                    {r.weekend_surcharge_amount ? <><br />Weekend ${r.weekend_surcharge_amount}</> : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isAdmin && (
                      <>
                        <button className="btn btn-sm" onClick={() => openEdit(r)}>Edit</button>
                        <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(r)}>✕</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={14} style={{ textAlign: 'center', padding: '20px', color: 'var(--text3)' }}>No rates match</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '760px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🚗 {modal === 'new' ? 'New Rate' : `Edit ${form.class_code ? form.class_code + ' · ' : ''}${form.sipp_code} — ${form.vehicle_type}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Identity */}
              <div className="fg-row">
                <div className="fg">
                  <label>Class Code</label>
                  <input className="input" value={form.class_code} maxLength={4}
                    onChange={e => setForm(f => ({ ...f, class_code: e.target.value.toUpperCase() }))}
                    placeholder="J2, L6, D5..." />
                </div>
                <div className="fg">
                  <label>SIPP Code *</label>
                  <input className="input" value={form.sipp_code} maxLength={6}
                    onChange={e => setForm(f => ({ ...f, sipp_code: e.target.value.toUpperCase() }))} />
                </div>
                <div className="fg">
                  <label>Pricing Code</label>
                  <select className="input" value={form.pricing_code} onChange={e => setForm(f => ({ ...f, pricing_code: e.target.value }))}>
                    {PRICING_CODES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Category</label>
                  <select className="input" value={form.vehicle_category} onChange={e => setForm(f => ({ ...f, vehicle_category: e.target.value as HertzVehicleCategory }))}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{vehicleCategoryLabel(c)}</option>)}
                  </select>
                </div>
              </div>

              <div className="fg-row">
                <div className="fg">
                  <label>Vehicle Type *</label>
                  <input className="input" value={form.vehicle_type} onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>Example Vehicle</label>
                  <input className="input" value={form.vehicle_example} onChange={e => setForm(f => ({ ...f, vehicle_example: e.target.value }))} placeholder="Toyota Camry or similar" />
                </div>
              </div>

              {/* Tier rates */}
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)', marginTop: '8px' }}>Daily Rate by Tier (Ex GST)</div>
              <div className="fg-row">
                <div className="fg"><label>1–2 days</label><input type="number" step="0.01" className="input" value={form.rate_1_2_days} onChange={e => setForm(f => ({ ...f, rate_1_2_days: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="fg"><label>3–6 days</label><input type="number" step="0.01" className="input" value={form.rate_3_6_days} onChange={e => setForm(f => ({ ...f, rate_3_6_days: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="fg"><label>7–29 days</label><input type="number" step="0.01" className="input" value={form.rate_7_29_days} onChange={e => setForm(f => ({ ...f, rate_7_29_days: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="fg"><label>30+ days</label><input type="number" step="0.01" className="input" value={form.rate_30_plus_days} onChange={e => setForm(f => ({ ...f, rate_30_plus_days: parseFloat(e.target.value) || 0 }))} /></div>
              </div>

              {/* Surcharges and km */}
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)', marginTop: '8px' }}>Location Surcharges and km Allowances</div>
              <div className="fg-row">
                <div className="fg"><label>Country $/day</label><input type="number" step="0.01" className="input" value={form.surcharge_country} onChange={e => setForm(f => ({ ...f, surcharge_country: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="fg"><label>Remote $/day</label><input type="number" step="0.01" className="input" value={form.surcharge_remote} onChange={e => setForm(f => ({ ...f, surcharge_remote: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="fg"><label>High-Remote $/day</label><input type="number" step="0.01" className="input" value={form.surcharge_high_remote} onChange={e => setForm(f => ({ ...f, surcharge_high_remote: parseFloat(e.target.value) || 0 }))} /></div>
              </div>
              <div className="fg-row">
                <div className="fg"><label>km/day Country</label><input type="number" className="input" value={form.km_included_country ?? ''} onChange={e => setForm(f => ({ ...f, km_included_country: e.target.value ? parseInt(e.target.value) : null }))} /></div>
                <div className="fg"><label>km/day Remote</label><input type="number" className="input" value={form.km_included_remote ?? ''} onChange={e => setForm(f => ({ ...f, km_included_remote: e.target.value ? parseInt(e.target.value) : null }))} /></div>
                <div className="fg"><label>Excess km Rate ($)</label><input type="number" step="0.001" className="input" value={form.excess_km_rate ?? ''} onChange={e => setForm(f => ({ ...f, excess_km_rate: e.target.value ? parseFloat(e.target.value) : null }))} /></div>
              </div>

              {/* LDL and availability */}
              <div className="fg-row">
                <div className="fg"><label>LDL Liability Cap ($)</label><input type="number" step="1" className="input" value={form.ldl_amount ?? ''} onChange={e => setForm(f => ({ ...f, ldl_amount: e.target.value ? parseFloat(e.target.value) : null }))} /></div>
                <div className="fg" style={{ display: 'flex', alignItems: 'center', paddingTop: '20px', gap: '14px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.remote_available} onChange={e => setForm(f => ({ ...f, remote_available: e.target.checked }))} /> Available in remote
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /> Active
                  </label>
                </div>
              </div>

              {/* Weekend surcharge (rarely used — L6 only at present) */}
              <div className="fg-row">
                <div className="fg"><label>Weekend Surcharge $</label><input type="number" step="0.01" className="input" value={form.weekend_surcharge_amount ?? ''} onChange={e => setForm(f => ({ ...f, weekend_surcharge_amount: e.target.value ? parseFloat(e.target.value) : null }))} placeholder="Leave blank if none" /></div>
                <div className="fg"><label>Weekend Max Hours</label><input type="number" className="input" value={form.weekend_surcharge_max_hours ?? ''} onChange={e => setForm(f => ({ ...f, weekend_surcharge_max_hours: e.target.value ? parseInt(e.target.value) : null }))} placeholder="e.g. 24" /></div>
              </div>

              <div className="fg">
                <label>Notes</label>
                <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              {isAdmin && (
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
