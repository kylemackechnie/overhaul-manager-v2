import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type {
  Car, Resource, PurchaseOrder,
  Vendor, HertzVehicleRate, HertzLocation,
  HertzVehicleCategory, VehicleLocationType,
} from '../../types'
import { downloadCSV } from '../../lib/csv'
import { useIsMobile } from '../../hooks/useIsMobile'
import { HelpButton } from '../../components/HelpButton'
import {
  calculateHertzCost,
  locationTypeLabel,
} from '../../lib/hertzPricing'

// Lazy-loaded — only fetched when a phone user opens this panel. Desktop
// users never download the mobile bundle. Saves ~30 KB per panel + lets
// Vite split the bottom-sheet/scanner deps into their own chunk.
const CarsMobile = lazy(() =>
  import('../mobile/CarsMobile').then(m => ({ default: m.CarsMobile }))
)

type CarForm = {
  vehicle_type: string; rego: string; vendor: string
  person_id: string; start_date: string; end_date: string
  daily_rate: number; gm_pct: number; total_cost: number; customer_total: number
  location_fee_pct: number; one_way_fee: number
  pickup_loc: string; return_loc: string; reservation: string
  collected: boolean; dropped_off: boolean; fuel_type: string
  total_km: number
  wbs: string
  linked_po_id: string; notes: string
  // Vendor / Hertz auto-pricing
  vendor_id: string
  hertz_rate_id: string
  hertz_location_id: string
  location_type: VehicleLocationType | ''
  tier_applied: string
  sipp_code: string
  pricing_code: string
  vehicle_category: HertzVehicleCategory | ''
  vehicle_example: string
  ldl_amount: number | null
  daily_surcharge_rate: number
  location_fee_fixed_daily: number
  excess_km_estimate: number
  excess_km_rate: number | null
  ldw_daily_rate: number
  mdw_daily_rate: number
}

const EMPTY: CarForm = {
  vehicle_type:'', rego:'', vendor:'', person_id:'',
  start_date:'', end_date:'', daily_rate:0, gm_pct:15,
  total_cost:0, customer_total:0,
  location_fee_pct:0, one_way_fee:0,
  pickup_loc:'', return_loc:'', reservation:'',
  collected:false, dropped_off:false, fuel_type:'',
  total_km:0, wbs:'',
  linked_po_id:'', notes:'',
  vendor_id:'', hertz_rate_id:'', hertz_location_id:'',
  location_type:'', tier_applied:'',
  sipp_code:'', pricing_code:'', vehicle_category:'', vehicle_example:'',
  ldl_amount:null, daily_surcharge_rate:0,
  location_fee_fixed_daily:0, excess_km_estimate:0, excess_km_rate:null,
  ldw_daily_rate:0, mdw_daily_rate:0,
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0
  const d1 = new Date(a), d2 = new Date(b)
  return Math.max(0, Math.ceil((d2.getTime() - d1.getTime()) / 86400000))
}

function calcCustomerPrice(cost: number, gm: number): number {
  if (gm >= 100 || gm <= 0) return cost
  return parseFloat((cost / (1 - gm / 100)).toFixed(2))
}

export function CarsPanel() {
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <Suspense fallback={<div className="mobile-loading"><span className="spinner" /> Loading…</div>}>
        <CarsMobile />
      </Suspense>
    )
  }
  return <CarsPanelDesktop />
}

function CarsPanelDesktop() {
  const { activeProject } = useAppStore()
  const [cars, setCars] = useState<Car[]>([])
  const [resources, setResources] = useState<Resource[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|Car>(null)
  const [selCars, setSelCars] = useState<Set<string>>(new Set())
  const [bulkCarModal, setBulkCarModal] = useState(false)
  const [bulkCarForm, setBulkCarForm] = useState({ start_date:'', end_date:'' })
  const [form, setForm] = useState<CarForm>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [carSelected, setCarSelected] = useState<Set<string>>(new Set())
  const [carBulkModal, setCarBulkModal] = useState(false)
  const [carBulkForm, setCarBulkForm] = useState({ start_date:'', end_date:'', daily_rate:'', gm_pct:'' })
  const [wbsList, setWbsList] = useState<{ id: string; code: string; name: string }[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [hertzRates, setHertzRates] = useState<HertzVehicleRate[]>([])
  const [hertzLocations, setHertzLocations] = useState<HertzLocation[]>([])
  const [categoryFilter, setCategoryFilter] = useState<HertzVehicleCategory | ''>('')

  useEffect(() => { if (activeProject) load() }, [activeProject?.id])

  async function load() {
    setLoading(true)
    const pid = activeProject!.id
    const [carData, resData, poData, wbsRes, vendorRes, rateRes, locRes] = await Promise.all([
      supabase.from('cars').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('resources').select('id,name,role,mob_in,mob_out').eq('project_id', pid).order('name'),
      supabase.from('purchase_orders').select('id,po_number,vendor').eq('project_id', pid).neq('status','cancelled').order('po_number'),
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid).order('sort_order'),
      supabase.from('vendors').select('*').eq('is_active', true).order('name'),
      supabase.from('hertz_vehicle_rates').select('*').eq('is_active', true).order('sort_order').order('sipp_code'),
      supabase.from('hertz_locations').select('*').eq('is_active', true).order('sort_order').order('location_name'),
    ])
    setCars((carData.data || []) as Car[])
    setResources((resData.data || []) as Resource[])
    setPos((poData.data || []) as PurchaseOrder[])
    setWbsList((wbsRes.data || []) as { id: string; code: string; name: string }[])
    setVendors((vendorRes.data || []) as Vendor[])
    setHertzRates((rateRes.data || []) as HertzVehicleRate[])
    setHertzLocations((locRes.data || []) as HertzLocation[])
    setLoading(false)
  }

  function isHertzVendor(form: CarForm): boolean {
    const v = vendors.find(x => x.id === form.vendor_id)
    return !!v && v.name === 'Hertz' && v.has_managed_rates
  }

  function calcCosts(f: CarForm): CarForm {
    // Hertz auto-pricing: use the engine if a rate has been selected
    if (isHertzVendor(f) && f.hertz_rate_id && f.start_date && f.end_date && f.location_type) {
      const rate = hertzRates.find(r => r.id === f.hertz_rate_id)
      if (rate) {
        const loc = hertzLocations.find(l => l.id === f.hertz_location_id)
        const breakdown = calculateHertzCost({
          rate,
          pickupDate: f.start_date,
          returnDate: f.end_date,
          locationType: f.location_type as VehicleLocationType,
          locationFeeType: loc?.fee_type,
          locationFeeValue: loc?.fee_value,
          estimatedKm: f.excess_km_estimate,
          ldwDailyRate: f.ldw_daily_rate,
          mdwDailyRate: f.mdw_daily_rate,
          oneWayFee: f.one_way_fee,
        })
        const total_cost = breakdown.totalCostExGst
        const customer_total = calcCustomerPrice(total_cost, f.gm_pct)
        return {
          ...f,
          daily_rate: breakdown.dailyRate,
          tier_applied: breakdown.tier,
          daily_surcharge_rate: breakdown.dailySurcharge,
          excess_km_rate: rate.excess_km_rate,
          location_fee_pct: loc?.fee_type === 'percentage' ? (loc.fee_value || 0) : 0,
          location_fee_fixed_daily: loc?.fee_type === 'fixed_daily' ? (loc.fee_value || 0) : 0,
          ldl_amount: rate.ldl_amount,
          total_cost,
          customer_total,
        }
      }
    }
    // Manual / non-Hertz path: existing formula
    const days = daysBetween(f.start_date, f.end_date) || 1
    const base = f.daily_rate * days
    const withFees = base * (1 + (f.location_fee_pct || 0) / 100) + (f.one_way_fee || 0)
    const total_cost = parseFloat(withFees.toFixed(2))
    const customer_total = calcCustomerPrice(total_cost, f.gm_pct)
    return { ...f, total_cost, customer_total }
  }


  async function applyBulkCarEdit() {
    const ids = [...selCars]
    const updates: Record<string,unknown> = {}
    if (bulkCarForm.start_date) updates.start_date = bulkCarForm.start_date
    if (bulkCarForm.end_date) updates.end_date = bulkCarForm.end_date
    if (!Object.keys(updates).length) return
    const { error } = await supabase.from('cars').update(updates).in('id', ids)
    if (error) { toast(error.message, 'error'); return }
    toast(`Updated ${ids.length} cars`, 'success')
    setSelCars(new Set()); setBulkCarModal(false); load()
  }

  function openNew() {
    const hertzId = vendors.find(v => v.name === 'Hertz')?.id || ''
    setForm({
      ...EMPTY,
      gm_pct: activeProject?.default_gm || 15,
      vendor_id: hertzId,
      vendor: hertzId ? 'Hertz' : '',
    })
    setCategoryFilter('')
    setModal('new')
  }
  function openEdit(c: Car) {
    const flags = ((c as unknown as Record<string, unknown>).flags as Record<string, unknown>) || {}
    setForm({
      vehicle_type: c.vehicle_type, rego: c.rego, vendor: c.vendor,
      person_id: c.person_id || '', start_date: c.start_date || '', end_date: c.end_date || '',
      daily_rate: (flags.daily_rate as number) || c.daily_rate || 0,
      gm_pct: c.gm_pct, total_cost: c.total_cost, customer_total: c.customer_total,
      location_fee_pct: c.location_fee_pct || 0,
      one_way_fee: c.one_way_fee || 0,
      pickup_loc: c.pickup_loc || '',
      return_loc: c.return_loc || '',
      reservation: c.reservation || '',
      collected: !!c.collected,
      dropped_off: !!c.dropped_off,
      fuel_type: c.fuel_type || '',
      total_km: c.total_km || 0,
      wbs: c.wbs || '',
      linked_po_id: c.linked_po_id || '', notes: c.notes,
      vendor_id: c.vendor_id || '',
      hertz_rate_id: c.hertz_rate_id || '',
      hertz_location_id: c.hertz_location_id || '',
      location_type: c.location_type || '',
      tier_applied: c.tier_applied || '',
      sipp_code: c.sipp_code || '',
      pricing_code: c.pricing_code || '',
      vehicle_category: c.vehicle_category || '',
      vehicle_example: c.vehicle_example || '',
      ldl_amount: c.ldl_amount,
      daily_surcharge_rate: c.daily_surcharge_rate || 0,
      location_fee_fixed_daily: c.location_fee_fixed_daily || 0,
      excess_km_estimate: c.excess_km_estimate || 0,
      excess_km_rate: c.excess_km_rate,
      ldw_daily_rate: c.ldw_daily_rate || 0,
      mdw_daily_rate: c.mdw_daily_rate || 0,
    })
    setCategoryFilter(c.vehicle_category || '')
    setModal(c)
  }

  function update(field: keyof CarForm, val: string | number | boolean | null) {
    setForm(f => {
      const next = { ...f, [field]: val } as CarForm
      // Re-run cost calc whenever any input that feeds it changes.
      const recalcFields: Array<keyof CarForm> = [
        'daily_rate','gm_pct','start_date','end_date','location_fee_pct','one_way_fee',
        'hertz_rate_id','hertz_location_id','location_type','excess_km_estimate',
        'ldw_daily_rate','mdw_daily_rate','vendor_id','location_fee_fixed_daily',
      ]
      if (recalcFields.includes(field)) {
        return calcCosts(next)
      }
      return next
    })
  }

  async function save() {
    if (!form.vendor.trim()) return toast('Vendor required', 'error')
    if (!form.vehicle_type.trim()) return toast('Vehicle type required', 'error')
    setSaving(true)
    // NOT NULL text columns get '' when empty (matches DB defaults). The
    // `field || null` idiom coerces empty string to null and breaks the
    // constraint — same trap fixed in HirePanel.
    const payload = {
      project_id: activeProject!.id,
      vendor: form.vendor.trim(),
      vehicle_type: form.vehicle_type.trim(),
      rego: form.rego || '',
      person_id: form.person_id || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      daily_rate: form.daily_rate || 0,
      gm_pct: form.gm_pct || 0,
      total_cost: form.total_cost || 0,
      customer_total: form.customer_total || 0,
      location_fee_pct: form.location_fee_pct || 0,
      one_way_fee: form.one_way_fee || 0,
      pickup_loc: form.pickup_loc || '',
      return_loc: form.return_loc || '',
      reservation: form.reservation || '',
      collected: !!form.collected,
      dropped_off: !!form.dropped_off,
      fuel_type: form.fuel_type || '',
      total_km: form.total_km || 0,
      wbs: form.wbs || '',
      linked_po_id: form.linked_po_id || null,
      notes: form.notes || '',
      vendor_id: form.vendor_id || null,
      hertz_rate_id: form.hertz_rate_id || null,
      hertz_location_id: form.hertz_location_id || null,
      location_type: form.location_type || null,
      tier_applied: form.tier_applied || null,
      sipp_code: form.sipp_code || '',
      pricing_code: form.pricing_code || '',
      vehicle_category: form.vehicle_category || '',
      vehicle_example: form.vehicle_example || '',
      ldl_amount: form.ldl_amount,
      daily_surcharge_rate: form.daily_surcharge_rate || 0,
      location_fee_fixed_daily: form.location_fee_fixed_daily || 0,
      excess_km_estimate: form.excess_km_estimate || 0,
      excess_km_rate: form.excess_km_rate,
      ldw_daily_rate: form.ldw_daily_rate || 0,
      mdw_daily_rate: form.mdw_daily_rate || 0,
    }
    if (modal === 'new') {
      const { error } = await supabase.from('cars').insert(payload)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Vehicle added', 'success')
    } else {
      const { error } = await supabase.from('cars').update(payload).eq('id', (modal as Car).id)
      if (error) { toast(error.message, 'error'); setSaving(false); return }
      toast('Saved', 'success')
    }
    setSaving(false); setModal(null); load()
  }

  async function del(c: Car) {
    if (!confirm(`Delete car hire entry?`)) return
    await supabase.from('cars').delete().eq('id', c.id)
    toast('Deleted', 'info'); load()
  }

  const fmt = (n: number) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function exportCSV() {
    downloadCSV(
      [
        ['Vehicle Type', 'Rego', 'Vendor', 'Start', 'End', 'Cost', 'Sell', 'Notes'],
        ...cars.map(c => [c.vehicle_type||'', c.rego||'', c.vendor||'', c.start_date||'', c.end_date||'', c.total_cost||0, c.customer_total||0, c.notes||''])
      ],
      'cars_' + (activeProject?.name || 'project')
    )
  }
  const totalCost = cars.reduce((s, c) => s + (c.total_cost || 0), 0)
  const totalSell = cars.reduce((s, c) => s + (c.customer_total || 0), 0)
  const resMap = Object.fromEntries(resources.map(r => [r.id, r.name]))

  const previewDays = daysBetween(form.start_date, form.end_date) || 1


  async function applyCarBulkEdit() {
    if (!carSelected.size) return
    const updates: Record<string,unknown> = {}
    if (carBulkForm.start_date) updates.start_date = carBulkForm.start_date
    if (carBulkForm.end_date) updates.end_date = carBulkForm.end_date
    if (carBulkForm.daily_rate) updates.daily_rate = parseFloat(carBulkForm.daily_rate)
    if (carBulkForm.gm_pct) updates.gm_pct = parseFloat(carBulkForm.gm_pct)
    if (!Object.keys(updates).length) { toast('No fields to update', 'info'); return }
    setSaving(true)
    const { error } = await supabase.from('cars').update(updates).in('id', [...carSelected])
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast(`Updated ${carSelected.size} vehicle${carSelected.size>1?'s':''}`, 'success')
    setCarBulkModal(false); setCarSelected(new Set()); setCarBulkForm({ start_date:'', end_date:'', daily_rate:'', gm_pct:'' }); load()
  }

  // ── Hertz helpers ─────────────────────────────────────────────────────
  const isFormHertz = isHertzVendor(form)

  function selectHertzRate(rateId: string) {
    const r = hertzRates.find(x => x.id === rateId)
    if (!r) {
      setForm(f => calcCosts({ ...f, hertz_rate_id: '', sipp_code: '', pricing_code: '', vehicle_category: '', vehicle_example: '' }))
      return
    }
    // Default to the 7-29 day tier as the headline rate. Once dates are entered,
    // the engine snaps to whichever tier actually applies.
    setForm(f => calcCosts({
      ...f,
      hertz_rate_id: r.id,
      sipp_code: r.sipp_code,
      pricing_code: r.pricing_code,
      vehicle_category: r.vehicle_category,
      vehicle_type: r.vehicle_type,
      vehicle_example: r.vehicle_example,
      daily_rate: r.rate_7_29_days,
      tier_applied: '7-29',
      excess_km_rate: r.excess_km_rate,
      ldl_amount: r.ldl_amount,
    }))
  }

  function selectHertzLocation(locId: string) {
    const l = hertzLocations.find(x => x.id === locId)
    if (!l) return
    setForm(f => calcCosts({
      ...f,
      hertz_location_id: l.id,
      pickup_loc: l.location_name + (l.address ? ` — ${l.address}` : ''),
      location_type: l.location_type,
      location_fee_pct: l.fee_type === 'percentage' ? (l.fee_value || 0) : 0,
      location_fee_fixed_daily: l.fee_type === 'fixed_daily' ? (l.fee_value || 0) : 0,
    }))
  }

  function selectVendor(vendorId: string) {
    const v = vendors.find(x => x.id === vendorId)
    setForm(f => calcCosts({
      ...f,
      vendor_id: vendorId,
      vendor: v?.name || '',
      // Clear Hertz-specific fields when switching away from Hertz
      ...(v && v.name === 'Hertz' ? {} : {
        hertz_rate_id: '', sipp_code: '', pricing_code: '', vehicle_category: '',
        vehicle_example: '', hertz_location_id: '', tier_applied: '',
        daily_surcharge_rate: 0, location_fee_fixed_daily: 0,
        excess_km_estimate: 0, excess_km_rate: null,
        ldw_daily_rate: 0, mdw_daily_rate: 0,
        ldl_amount: null,
      } as Partial<CarForm>),
    }))
  }

  const filteredRates = useMemo(() => {
    if (!categoryFilter) return hertzRates
    return hertzRates.filter(r => r.vehicle_category === categoryFilter)
  }, [hertzRates, categoryFilter])

  const hertzBreakdown = useMemo(() => {
    if (!isFormHertz) return null
    const rate = hertzRates.find(r => r.id === form.hertz_rate_id)
    if (!rate || !form.start_date || !form.end_date || !form.location_type) return null
    const loc = hertzLocations.find(l => l.id === form.hertz_location_id)
    return calculateHertzCost({
      rate, pickupDate: form.start_date, returnDate: form.end_date,
      locationType: form.location_type as VehicleLocationType,
      locationFeeType: loc?.fee_type,
      locationFeeValue: loc?.fee_value,
      estimatedKm: form.excess_km_estimate,
      ldwDailyRate: form.ldw_daily_rate, mdwDailyRate: form.mdw_daily_rate,
      oneWayFee: form.one_way_fee,
    })
  }, [isFormHertz, form, hertzRates, hertzLocations])

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Car Hire</h1>
            <HelpButton panelId="hr-cars" />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {cars.length} vehicles · Cost {fmt(totalCost)} · Sell {fmt(totalSell)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Vehicle</button>
          <button className="btn btn-sm" onClick={exportCSV}>⬇ CSV</button>
      </div>

      {loading ? <div className="loading-center"><span className="spinner" /> Loading...</div>
        : cars.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🚗</div>
            <h3>No vehicles</h3>
            <p>Add car hire records for this project.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table>
              <thead>
                <tr><th style={{width:'32px'}}><input type="checkbox" onChange={e=>setCarSelected(e.target.checked?new Set(cars.map(c=>c.id)):new Set())} /></th>
                  <th>Type</th>
                  <th>SIPP</th>
                  <th>Example</th>
                  <th>Rego</th>
                  <th>Vendor</th>
                  <th>Person</th>
                  <th>Start</th><th>End</th>
                  <th style={{ textAlign: 'right' }}>Daily</th>
                  <th>Location Fee</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Sell</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cars.map(c => {
                  const lf = c.location_fee_fixed_daily > 0
                    ? `$${c.location_fee_fixed_daily}/d`
                    : c.location_fee_pct > 0
                    ? `${c.location_fee_pct}%`
                    : '—'
                  return (
                    <tr key={c.id}>
                      <td><input type="checkbox" checked={carSelected.has(c.id)} onChange={e=>setCarSelected(s=>{const n=new Set(s);e.target.checked?n.add(c.id):n.delete(c.id);return n})} /></td>
                      <td style={{ fontWeight: 500 }}>{c.vehicle_type || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{c.sipp_code || '—'}</td>
                      <td style={{ fontSize: '11px', color: 'var(--text2)' }}>{c.vehicle_example || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.rego || '—'}</td>
                      <td>{c.vendor || '—'}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text2)' }}>{c.person_id ? resMap[c.person_id] || '—' : '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.start_date || '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.end_date || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{c.daily_rate ? fmt(c.daily_rate) : '—'}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text2)' }}>{lf}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px' }}>{fmt(c.total_cost || 0)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--green)' }}>{fmt(c.customer_total || 0)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => openEdit(c)}>Edit</button>
                        <button className="btn btn-sm" style={{ marginLeft: '4px', color: 'var(--red)' }} onClick={() => del(c)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '720px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🚗 {modal === 'new' ? 'Add Vehicle' : 'Edit Vehicle'}</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Vendor / Vehicle Type */}
              <div className="fg-row">
                <div className="fg">
                  <label>Vendor *</label>
                  <select className="input" value={form.vendor_id} onChange={e => selectVendor(e.target.value)} autoFocus>
                    <option value="">— Select vendor —</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name}{v.has_managed_rates ? ' (auto-priced)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="fg">
                  <label>Vehicle Type *</label>
                  <input className="input" value={form.vehicle_type}
                    onChange={e => update('vehicle_type', e.target.value)}
                    placeholder={isFormHertz ? 'Auto-fills from SIPP selection' : 'Toyota HiLux, Corolla...'} />
                </div>
              </div>

              {/* Hertz auto-pricing section */}
              {isFormHertz && (
                <div style={{
                  padding: '10px 12px', background: 'rgba(255,193,7,.06)',
                  border: '1px solid rgba(255,193,7,.25)', borderRadius: '6px',
                  marginBottom: '12px',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: '8px' }}>
                    Hertz Auto-Pricing {hertzBreakdown ? `· Tier ${hertzBreakdown.tier} days @ $${hertzBreakdown.dailyRate}/day` : ''}
                  </div>
                  <div className="fg-row">
                    <div className="fg">
                      <label>Category</label>
                      <select className="input" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as HertzVehicleCategory | '')}>
                        <option value="">All categories</option>
                        <option value="electric_hybrid">Electric & Hybrid</option>
                        <option value="passenger">Passenger</option>
                        <option value="prestige">Prestige</option>
                        <option value="4wd">4WD</option>
                        <option value="bus">Bus</option>
                        <option value="commercial">Commercial</option>
                      </select>
                    </div>
                    <div className="fg" style={{ flex: 2 }}>
                      <label>SIPP / Vehicle *</label>
                      <select className="input" value={form.hertz_rate_id} onChange={e => selectHertzRate(e.target.value)}>
                        <option value="">— Select vehicle —</option>
                        {filteredRates.map(r => (
                          <option key={r.id} value={r.id}>
                            {r.class_code ? `${r.class_code} · ` : ''}{r.sipp_code} — {r.vehicle_type} ({r.vehicle_example})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {form.hertz_rate_id && (() => {
                    const r = hertzRates.find(x => x.id === form.hertz_rate_id)
                    if (!r) return null
                    const activeTier = hertzBreakdown?.tier || form.tier_applied || '7-29'
                    const tiers: Array<{ key: string; label: string; rate: number }> = [
                      { key: '1-2',  label: '1–2 d',  rate: r.rate_1_2_days },
                      { key: '3-6',  label: '3–6 d',  rate: r.rate_3_6_days },
                      { key: '7-29', label: '7–29 d', rate: r.rate_7_29_days },
                      { key: '30+',  label: '30+ d',  rate: r.rate_30_plus_days },
                    ]
                    return (
                      <div style={{ marginTop: '8px', fontSize: '11px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {tiers.map(t => {
                            const isActive = t.key === activeTier
                            return (
                              <div key={t.key} style={{
                                padding: '4px 8px',
                                border: '1px solid',
                                borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                                background: isActive ? 'rgba(99,102,241,.10)' : 'transparent',
                                borderRadius: '4px',
                                fontFamily: 'var(--mono)',
                                fontWeight: isActive ? 700 : 400,
                              }}>
                                {t.label} <strong>${t.rate.toFixed(2)}</strong>
                              </div>
                            )
                          })}
                        </div>
                        <div style={{ color: 'var(--text3)', marginTop: '4px' }}>
                          Pricing code <strong>{form.pricing_code}</strong>
                          {form.ldl_amount ? <> · LDL liability cap <strong>${form.ldl_amount.toLocaleString()}</strong></> : null}
                          {!form.start_date || !form.end_date ? <> · <em>Enter dates to lock in the tier</em></> : null}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Rego / Assigned To */}
              <div className="fg-row">
                <div className="fg">
                  <label>Rego / Asset No.</label>
                  <input className="input" value={form.rego} onChange={e => update('rego', e.target.value)} placeholder="ABC123" />
                </div>
                <div className="fg">
                  <label>Assigned To</label>
                  <select className="input" value={form.person_id} onChange={e => setForm(f => ({ ...f, person_id: e.target.value }))}>
                    <option value="">— Unassigned —</option>
                    {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Pickup / Return Date */}
              <div className="fg-row">
                <div className="fg">
                  <label>Pickup Date *</label>
                  <input type="date" className="input" value={form.start_date} onChange={e => update('start_date', e.target.value)} />
                </div>
                <div className="fg">
                  <label>Return Date</label>
                  <input type="date" className="input" value={form.end_date} onChange={e => update('end_date', e.target.value)} />
                  {form.person_id && (() => {
                    const person = resources.find(r => r.id === form.person_id)
                    return person?.mob_in ? (
                      <button className="btn btn-sm" style={{ marginTop: '4px', fontSize: '11px' }}
                        onClick={() => setForm(f => calcCosts({ ...f, start_date: person.mob_in || f.start_date, end_date: person.mob_out || f.end_date }))}
                        title={`Use ${person.name}'s mob dates`}>
                        ↕ Use {person.name.split(' ')[0]}'s dates
                      </button>
                    ) : null
                  })()}
                </div>
              </div>

              {/* Pickup / Return Location */}
              {isFormHertz ? (
                <>
                  <div className="fg-row">
                    <div className="fg" style={{ flex: 2 }}>
                      <label>Pickup Location</label>
                      <input
                        className="input" list="hertz-locations-datalist"
                        value={form.pickup_loc}
                        placeholder="Type to search Hertz locations..."
                        onChange={e => {
                          const val = e.target.value
                          // Try to find an exact match by formatted display string
                          const match = hertzLocations.find(l =>
                            val === (l.location_name + (l.address ? ` — ${l.address}` : '')) ||
                            val === l.location_name
                          )
                          if (match) {
                            selectHertzLocation(match.id)
                          } else {
                            // Free text — clear the snapshot link but keep typed value
                            setForm(f => calcCosts({ ...f, hertz_location_id: '', pickup_loc: val }))
                          }
                        }} />
                      <datalist id="hertz-locations-datalist">
                        {hertzLocations.map(l => (
                          <option key={l.id} value={l.location_name + (l.address ? ` — ${l.address}` : '')}>
                            {l.state} · {locationTypeLabel(l.location_type)}{l.fee_value > 0 ? ` · ${l.fee_type === 'percentage' ? l.fee_value + '%' : '$' + l.fee_value + '/day'}` : ''}
                          </option>
                        ))}
                      </datalist>
                    </div>
                    <div className="fg">
                      <label>Location Type</label>
                      <select className="input" value={form.location_type}
                        onChange={e => update('location_type', e.target.value)}>
                        <option value="">— Select —</option>
                        <option value="metro">Metropolitan</option>
                        <option value="country">Country</option>
                        <option value="remote">Remote</option>
                        <option value="high_remote">Remote (BH/MI/Weipa)</option>
                      </select>
                    </div>
                  </div>
                  <div className="fg-row">
                    <div className="fg">
                      <label>Return Location</label>
                      <input className="input" value={form.return_loc} onChange={e => setForm(f => ({ ...f, return_loc: e.target.value }))} placeholder="Same as pickup if blank" />
                    </div>
                    {form.location_type && form.location_type !== 'metro' && (
                      <div className="fg">
                        <label>Estimated km <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(for excess-km cost)</span></label>
                        <input type="number" className="input" min={0} step={10}
                          value={form.excess_km_estimate || ''}
                          placeholder={form.start_date && form.end_date ? `${(form.location_type === 'country' ? 200 : 150) * (daysBetween(form.start_date, form.end_date) || 1)} km included` : 'e.g. 1500'}
                          onChange={e => update('excess_km_estimate', parseInt(e.target.value) || 0)} />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="fg-row">
                  <div className="fg">
                    <label>Pickup Location</label>
                    <input className="input" value={form.pickup_loc} onChange={e => setForm(f => ({ ...f, pickup_loc: e.target.value }))} placeholder="Airport, depot address..." />
                  </div>
                  <div className="fg">
                    <label>Return Location</label>
                    <input className="input" value={form.return_loc} onChange={e => setForm(f => ({ ...f, return_loc: e.target.value }))} placeholder="Same or different" />
                  </div>
                </div>
              )}

              {/* Daily rate excl/incl + GM */}
              <div className="fg-row">
                <div className="fg">
                  <label>Daily Rate (Incl GST)</label>
                  <input type="number" className="input"
                    value={form.daily_rate ? parseFloat((form.daily_rate * 1.1).toFixed(2)) : ''}
                    placeholder="0.00"
                    onChange={e => update('daily_rate', parseFloat((parseFloat(e.target.value) / 1.1).toFixed(2)) || 0)} />
                </div>
                <div className="fg">
                  <label>Daily Rate (Excl GST)</label>
                  <input type="number" className="input" style={{ background: 'var(--bg3)' }}
                    value={form.daily_rate || ''} placeholder="0.00"
                    onChange={e => update('daily_rate', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="fg">
                  <label>GM %</label>
                  <input type="number" className="input" value={form.gm_pct} min={0} max={99}
                    onChange={e => update('gm_pct', parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              {/* PO link */}
              <div className="fg">
                <label>Link to Purchase Order <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: '10px' }}>— third-party car hire must have a PO</span></label>
                <select className="input" value={form.linked_po_id} onChange={e => setForm(f => ({ ...f, linked_po_id: e.target.value }))}>
                  <option value="">— No PO linked —</option>
                  {pos.map(po => <option key={po.id} value={po.id}>{po.po_number || '—'} {po.vendor}</option>)}
                </select>
              </div>

              {/* WBS */}
              <div className="fg">
                <label>WBS</label>
                <select className="input" value={form.wbs} onChange={e => setForm(f => ({ ...f, wbs: e.target.value }))}>
                  <option value="">— Select WBS —</option>
                  {wbsList.map(w => <option key={w.id} value={w.code}>{w.code} — {w.name}</option>)}
                </select>
              </div>

              {/* Loc fee + One-way */}
              <div className="fg-row">
                <div className="fg">
                  <label>Location Fee % {isFormHertz && <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(from location)</span>}</label>
                  <input type="number" className="input" value={form.location_fee_pct || ''} placeholder="0" min={0} step={0.1}
                    readOnly={isFormHertz && !!form.hertz_location_id}
                    title="Airport/depot surcharge applied as % on top of base + surcharge"
                    onChange={e => update('location_fee_pct', parseFloat(e.target.value) || 0)} />
                </div>
                {isFormHertz && form.location_fee_fixed_daily > 0 && (
                  <div className="fg">
                    <label>Location Fee $/day <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(from location)</span></label>
                    <input type="number" className="input" value={form.location_fee_fixed_daily} readOnly />
                  </div>
                )}
                <div className="fg">
                  <label>One-Way Fee ($)</label>
                  <input type="number" className="input" value={form.one_way_fee || ''} placeholder="0" min={0}
                    onChange={e => update('one_way_fee', parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              {/* Hertz optional waivers */}
              {isFormHertz && (
                <div className="fg-row">
                  <div className="fg">
                    <label>LDW $/day <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(optional)</span></label>
                    <input type="number" className="input" min={0} step={0.01}
                      value={form.ldw_daily_rate || ''}
                      placeholder="0"
                      onChange={e => update('ldw_daily_rate', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="fg">
                    <label>MDW $/day <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(optional)</span></label>
                    <input type="number" className="input" min={0} step={0.01}
                      value={form.mdw_daily_rate || ''}
                      placeholder="0"
                      onChange={e => update('mdw_daily_rate', parseFloat(e.target.value) || 0)} />
                  </div>
                </div>
              )}

              {/* Reservation + Collected/Dropped */}
              <div className="fg-row">
                <div className="fg">
                  <label>Reservation Number</label>
                  <input className="input" value={form.reservation} onChange={e => setForm(f => ({ ...f, reservation: e.target.value }))} placeholder="Booking / confirmation number" />
                </div>
                <div className="fg" style={{ display: 'flex', gap: '14px', alignItems: 'center', paddingTop: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.collected} onChange={e => setForm(f => ({ ...f, collected: e.target.checked }))} /> Collected
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                    <input type="checkbox" checked={form.dropped_off} onChange={e => setForm(f => ({ ...f, dropped_off: e.target.checked }))} /> Dropped Off
                  </label>
                </div>
              </div>

              {/* Cost preview */}
              <div style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px', fontSize: '12px' }}>
                {isFormHertz && hertzBreakdown ? (
                  <>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>DAYS / TIER</span><br /><strong>{hertzBreakdown.days} · {hertzBreakdown.tier}</strong></div>
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>DAILY RATE</span><br /><strong>{fmt(hertzBreakdown.dailyRate)}</strong></div>
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>BASE</span><br /><strong>{fmt(hertzBreakdown.baseCost)}</strong></div>
                      {hertzBreakdown.surchargeTotal > 0 && (
                        <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>SURCHARGE</span><br /><strong>+{fmt(hertzBreakdown.surchargeTotal)}</strong></div>
                      )}
                      {hertzBreakdown.locationFeeAmount > 0 && (
                        <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>LOC FEE</span><br /><strong>+{fmt(hertzBreakdown.locationFeeAmount)}</strong></div>
                      )}
                      {hertzBreakdown.excessKmCost > 0 && (
                        <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>EXCESS KM</span><br /><strong>+{fmt(hertzBreakdown.excessKmCost)}</strong></div>
                      )}
                      {hertzBreakdown.ldwTotal > 0 && (
                        <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>LDW</span><br /><strong>+{fmt(hertzBreakdown.ldwTotal)}</strong></div>
                      )}
                      {hertzBreakdown.mdwTotal > 0 && (
                        <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>MDW</span><br /><strong>+{fmt(hertzBreakdown.mdwTotal)}</strong></div>
                      )}
                      {hertzBreakdown.weekendSurcharge > 0 && (
                        <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>WEEKEND</span><br /><strong>+{fmt(hertzBreakdown.weekendSurcharge)}</strong></div>
                      )}
                      {hertzBreakdown.oneWayFee > 0 && (
                        <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>ONE-WAY</span><br /><strong>+{fmt(hertzBreakdown.oneWayFee)}</strong></div>
                      )}
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>EX GST</span><br /><strong style={{ color: 'var(--accent)' }}>{fmt(hertzBreakdown.totalCostExGst)}</strong></div>
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>INCL GST</span><br /><strong style={{ color: 'var(--accent)' }}>{fmt(hertzBreakdown.totalCostInclGst)}</strong></div>
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>CUSTOMER ({form.gm_pct}% GM)</span><br /><strong style={{ color: 'var(--green)' }}>{fmt(form.customer_total)}</strong></div>
                    </div>
                    {hertzBreakdown.warnings.length > 0 && (
                      <div style={{ marginTop: '8px', color: 'var(--orange)', fontSize: '11px' }}>
                        {hertzBreakdown.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                      </div>
                    )}
                  </>
                ) : form.daily_rate > 0 && form.start_date && form.end_date ? (
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>DAYS</span><br /><strong>{previewDays}</strong></div>
                    <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>BASE COST (EX GST)</span><br /><strong>{fmt(form.daily_rate * previewDays)}</strong></div>
                    {form.location_fee_pct > 0 && (
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>LOC FEE ({form.location_fee_pct}%)</span><br /><strong>+{fmt(form.daily_rate * previewDays * form.location_fee_pct / 100)}</strong></div>
                    )}
                    {form.one_way_fee > 0 && (
                      <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>ONE-WAY FEE</span><br /><strong>+{fmt(form.one_way_fee)}</strong></div>
                    )}
                    <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>TOTAL COST (EX GST)</span><br /><strong style={{ color: 'var(--accent)' }}>{fmt(form.total_cost)}</strong></div>
                    <div><span style={{ color: 'var(--text3)', fontSize: '10px' }}>CUSTOMER ({form.gm_pct}% GM)</span><br /><strong style={{ color: 'var(--green)' }}>{fmt(form.customer_total)}</strong></div>
                  </div>
                ) : (
                  <span style={{ color: 'var(--text3)' }}>{isFormHertz ? 'Pick a SIPP vehicle, location, and dates to see the auto-priced breakdown.' : 'Enter rate and dates to see cost preview.'}</span>
                )}
              </div>

              {/* Fuel + km (CO2) */}
              <div className="fg-row">
                <div className="fg">
                  <label>Fuel Type <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(CO2)</span></label>
                  <select className="input" value={form.fuel_type} onChange={e => setForm(f => ({ ...f, fuel_type: e.target.value }))}>
                    <option value="">— Unknown —</option>
                    <option value="petrol">Petrol</option>
                    <option value="diesel">Diesel</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="electric">Electric</option>
                  </select>
                </div>
                <div className="fg">
                  <label>Total km <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(CO2 — enter at end)</span></label>
                  <input type="number" className="input" value={form.total_km || ''} placeholder="e.g. 3200" step={1} min={0}
                    onChange={e => setForm(f => ({ ...f, total_km: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>

              {/* Notes */}
              <div className="fg">
                <label>Notes</label>
                <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {carBulkModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'380px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✏ Bulk Edit {carSelected.size} Vehicle{carSelected.size>1?'s':''}</h3><button className="btn btn-sm" onClick={()=>setCarBulkModal(false)}>✕</button></div>
            <div className="modal-body">
              <p style={{fontSize:'12px',color:'var(--text3)',marginBottom:'12px'}}>Leave blank to keep existing values.</p>
              <div style={{display:'grid',gap:'10px'}}>
                <div><label style={{fontSize:'11px',fontWeight:600}}>Pickup Date</label><input type="date" className="input" value={carBulkForm.start_date} onChange={e=>setCarBulkForm(f=>({...f,start_date:e.target.value}))} /></div>
                <div><label style={{fontSize:'11px',fontWeight:600}}>Return Date</label><input type="date" className="input" value={carBulkForm.end_date} onChange={e=>setCarBulkForm(f=>({...f,end_date:e.target.value}))} /></div>
                <div><label style={{fontSize:'11px',fontWeight:600}}>Daily Rate ($)</label><input type="number" className="input" value={carBulkForm.daily_rate} min={0} step={1} placeholder="— keep existing —" onChange={e=>setCarBulkForm(f=>({...f,daily_rate:e.target.value}))} /></div>
                <div><label style={{fontSize:'11px',fontWeight:600}}>GM%</label><input type="number" className="input" value={carBulkForm.gm_pct} min={0} max={99} step={0.5} placeholder="— keep existing —" onChange={e=>setCarBulkForm(f=>({...f,gm_pct:e.target.value}))} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setCarBulkModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyCarBulkEdit} disabled={saving}>{saving?'Saving…':'Apply'}</button>
            </div>
          </div>
        </div>
      )}
      {bulkCarModal && (
        <div className="modal-overlay">
          <div className="modal" style={{maxWidth:'340px'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h3>✏ Edit {selCars.size} Car Bookings</h3><button className="btn btn-sm" onClick={()=>setBulkCarModal(false)}>✕</button></div>
            <div className="modal-body">
              <div className="fg"><label>Start Date</label><input type="date" className="input" value={bulkCarForm.start_date} onChange={e=>setBulkCarForm(f=>({...f,start_date:e.target.value}))} /></div>
              <div className="fg"><label>End Date</label><input type="date" className="input" value={bulkCarForm.end_date} onChange={e=>setBulkCarForm(f=>({...f,end_date:e.target.value}))} /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setBulkCarModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={applyBulkCarEdit}>Apply</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
