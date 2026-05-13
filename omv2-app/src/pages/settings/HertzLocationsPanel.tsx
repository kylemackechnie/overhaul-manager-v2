/**
 * HertzLocationsPanel — admin editor for hertz_locations. Master list of
 * Hertz Australia locations with their applicable location fee (percentage
 * or fixed-daily) and metro/country/remote/high_remote classification.
 *
 * Read access: any authenticated user. Write access: is_admin() only.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { HelpButton } from '../../components/HelpButton'
import type { HertzLocation, HertzLocationFeeType, VehicleLocationType } from '../../types'
import { locationTypeLabel } from '../../lib/hertzPricing'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const
const LOCATION_TYPES: VehicleLocationType[] = ['metro', 'country', 'remote', 'high_remote']

type LocForm = {
  location_code: string
  location_name: string
  state: string
  address: string
  phone: string
  location_type: VehicleLocationType
  is_airport: boolean
  fee_type: HertzLocationFeeType
  fee_value: number
  is_active: boolean
  notes: string
}

const EMPTY_FORM: LocForm = {
  location_code: '', location_name: '', state: 'NSW',
  address: '', phone: '',
  location_type: 'metro', is_airport: false,
  fee_type: 'none', fee_value: 0,
  is_active: true, notes: '',
}

export function HertzLocationsPanel() {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'admin'
  const [locs, setLocs] = useState<HertzLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | 'new' | HertzLocation>(null)
  const [form, setForm] = useState<LocForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [stateFilter, setStateFilter] = useState<'all' | string>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | VehicleLocationType>('all')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('hertz_locations')
      .select('*').order('sort_order').order('location_name')
    if (error) toast(error.message, 'error')
    setLocs((data || []) as HertzLocation[])
    setLoading(false)
  }

  function openNew() {
    if (!isAdmin) return
    setForm(EMPTY_FORM)
    setModal('new')
  }

  function openEdit(l: HertzLocation) {
    if (!isAdmin) return
    setForm({
      location_code: l.location_code || '', location_name: l.location_name,
      state: l.state, address: l.address, phone: l.phone,
      location_type: l.location_type, is_airport: l.is_airport,
      fee_type: l.fee_type, fee_value: l.fee_value,
      is_active: l.is_active, notes: l.notes,
    })
    setModal(l)
  }

  async function save() {
    if (!isAdmin) { toast('Admin only', 'error'); return }
    if (!form.location_name.trim()) return toast('Location name required', 'error')
    if (!form.state.trim()) return toast('State required', 'error')
    setSaving(true)
    const payload = {
      ...form,
      location_code: form.location_code.trim() || null,
      location_name: form.location_name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      updated_at: new Date().toISOString(),
    }
    if (modal === 'new') {
      const { error } = await supabase.from('hertz_locations').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Location added', 'success')
    } else {
      const { error } = await supabase.from('hertz_locations').update(payload).eq('id', (modal as HertzLocation).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Location saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(l: HertzLocation) {
    if (!isAdmin) return
    if (!confirm(`Delete location "${l.location_name}"?\n\nExisting bookings that reference this location keep their snapshot values.`)) return
    const { error } = await supabase.from('hertz_locations').delete().eq('id', l.id)
    if (error) { toast(error.message, 'error'); return }
    toast('Deleted', 'info'); load()
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return locs.filter(l => {
      if (!showInactive && !l.is_active) return false
      if (stateFilter !== 'all' && l.state !== stateFilter) return false
      if (typeFilter !== 'all' && l.location_type !== typeFilter) return false
      if (q && !(
        l.location_name.toLowerCase().includes(q) ||
        (l.location_code || '').toLowerCase().includes(q) ||
        l.address.toLowerCase().includes(q)
      )) return false
      return true
    })
  }, [locs, stateFilter, typeFilter, search, showInactive])

  const stateCounts = useMemo(() => {
    const m: Record<string, number> = {}
    locs.forEach(l => { if (l.is_active || showInactive) m[l.state] = (m[l.state] || 0) + 1 })
    return m
  }, [locs, showInactive])

  const formatFee = (l: HertzLocation) => {
    if (l.fee_type === 'none' || l.fee_value === 0) return '—'
    if (l.fee_type === 'percentage') return `${l.fee_value}%`
    return `$${l.fee_value}/day`
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>📍 Hertz Locations</h1>
            <HelpButton panelId="hertz-locations" />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {locs.length} locations · Source: Hertz Australia Location Guide + Siemens Energy fee sheet
          </p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={openNew}>+ New Location</button>}
      </div>

      <div style={{
        background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)',
        borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: '14px', fontSize: '12px', color: 'var(--text2)',
      }}>
        <strong>How this works:</strong> When a Hertz booking selects a pickup location, the fee here auto-applies to the booking cost. Location type drives the daily surcharge and km allowance from the rate row. Mt Isa, Broken Hill, and Weipa are classified as high_remote (extra surcharge for 4WDs/Buses per Hertz rate sheet).
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${stateFilter === 'all' ? 'btn-primary' : ''}`} onClick={() => setStateFilter('all')}>
          All states ({locs.filter(l => l.is_active || showInactive).length})
        </button>
        {STATES.map(s => (
          <button key={s} className={`btn btn-sm ${stateFilter === s ? 'btn-primary' : ''}`} onClick={() => setStateFilter(s)}>
            {s} ({stateCounts[s] || 0})
          </button>
        ))}
        <select className="input" style={{ width: '160px' }} value={typeFilter} onChange={e => setTypeFilter(e.target.value as 'all' | VehicleLocationType)}>
          <option value="all">All types</option>
          {LOCATION_TYPES.map(t => <option key={t} value={t}>{locationTypeLabel(t)}</option>)}
        </select>
        <input
          className="input" style={{ width: '220px' }}
          placeholder="Search name / code / address..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>

      {loading ? (
        <div className="loading-center"><span className="spinner" /> Loading…</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>State</th>
                <th>Name</th>
                <th>Code</th>
                <th>Type</th>
                <th>Airport</th>
                <th style={{ textAlign: 'right' }}>Fee</th>
                <th>Address</th>
                <th>Phone</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} style={{ opacity: l.is_active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 600, fontSize: '11px' }}>{l.state}</td>
                  <td style={{ fontWeight: 500 }}>{l.location_name}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text2)' }}>{l.location_code || '—'}</td>
                  <td style={{ fontSize: '11px', color: 'var(--text2)' }}>{locationTypeLabel(l.location_type)}</td>
                  <td style={{ textAlign: 'center' }}>{l.is_airport ? '✈' : ''}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: l.fee_value > 0 ? 'var(--text)' : 'var(--text3)' }}>
                    {formatFee(l)}
                  </td>
                  <td style={{ fontSize: '11px', color: 'var(--text2)' }}>{l.address || '—'}</td>
                  <td style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{l.phone || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isAdmin && (
                      <>
                        <button className="btn btn-sm" onClick={() => openEdit(l)}>Edit</button>
                        <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(l)}>✕</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '20px', color: 'var(--text3)' }}>No locations match</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📍 {modal === 'new' ? 'New Location' : `Edit ${form.location_name}`}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg-row">
                <div className="fg" style={{ flex: 2 }}>
                  <label>Location Name *</label>
                  <input className="input" value={form.location_name} onChange={e => setForm(f => ({ ...f, location_name: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>Location Code</label>
                  <input className="input" value={form.location_code} onChange={e => setForm(f => ({ ...f, location_code: e.target.value.toUpperCase() }))} placeholder="e.g. SYDT50" />
                </div>
              </div>
              <div className="fg-row">
                <div className="fg">
                  <label>State *</label>
                  <select className="input" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Location Type</label>
                  <select className="input" value={form.location_type} onChange={e => setForm(f => ({ ...f, location_type: e.target.value as VehicleLocationType }))}>
                    {LOCATION_TYPES.map(t => <option key={t} value={t}>{locationTypeLabel(t)}</option>)}
                  </select>
                </div>
                <div className="fg" style={{ display: 'flex', alignItems: 'center', paddingTop: '20px', gap: '14px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.is_airport} onChange={e => setForm(f => ({ ...f, is_airport: e.target.checked }))} /> Airport
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} /> Active
                  </label>
                </div>
              </div>

              <div className="fg">
                <label>Address</label>
                <input className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="fg">
                <label>Phone</label>
                <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>

              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)', marginTop: '8px' }}>Location Fee</div>
              <div className="fg-row">
                <div className="fg">
                  <label>Fee Type</label>
                  <select className="input" value={form.fee_type} onChange={e => setForm(f => ({ ...f, fee_type: e.target.value as HertzLocationFeeType }))}>
                    <option value="none">None</option>
                    <option value="percentage">Percentage (of base + surcharge)</option>
                    <option value="fixed_daily">Fixed $/day</option>
                  </select>
                </div>
                <div className="fg">
                  <label>Fee Value {form.fee_type === 'percentage' ? '(%)' : form.fee_type === 'fixed_daily' ? '($/day)' : ''}</label>
                  <input type="number" step="0.01" className="input" value={form.fee_value}
                    disabled={form.fee_type === 'none'}
                    onChange={e => setForm(f => ({ ...f, fee_value: parseFloat(e.target.value) || 0 }))} />
                </div>
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
