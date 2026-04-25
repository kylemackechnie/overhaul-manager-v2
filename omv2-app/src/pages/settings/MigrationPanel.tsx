import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'

const OLD_URL  = 'https://jjrrjwvooinlmetveazw.supabase.co'
const OLD_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqcnJqd3Zvb2lubG1ldHZlYXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMjQyNjIsImV4cCI6MjA5MDYwMDI2Mn0.30ZxYbi594r9-QZzd4iBtilcA1aN9MRUoND9IChChYg'
const oldDb = createClient(OLD_URL, OLD_ANON)

async function decompressB64Gzip(b64: string): Promise<unknown> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(bytes); writer.close()
  const chunks: Uint8Array[] = []
  const reader = ds.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return JSON.parse(new TextDecoder().decode(out))
}

type LogLine = { type: 'info' | 'ok' | 'warn' | 'error'; msg: string }

export function MigrationPanel() {
  const { activeProject } = useAppStore()
  const [log, setLog] = useState<LogLine[]>([])
  const [running, setRunning] = useState(false)
  const [projects, setProjects] = useState<{id: string; name: string}[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [rawData, setRawData] = useState<Record<string, unknown> | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loaded' | 'done'>('idle')

  function addLog(type: LogLine['type'], msg: string) {
    setLog(l => [...l, { type, msg }])
  }

  async function loadOldData() {
    setRunning(true)
    setLog([])
    addLog('info', 'Connecting to HTML app database...')
    try {
      const { data, error } = await oldDb.from('app_state').select('data_compressed').eq('id', 'overhaul_v3').single()
      if (error || !data?.data_compressed) throw new Error(error?.message || 'No data found')

      addLog('ok', `Compressed data loaded (${Math.round(data.data_compressed.length / 1024)}KB). Decompressing...`)
      const state = await decompressB64Gzip(data.data_compressed) as Record<string, unknown>
      setRawData(state)

      const topKeys = Object.keys(state)
      addLog('info', `Top-level keys: ${topKeys.join(', ')}`)

      // Find projects list
      const projs = (state.projects as {id:string;name:string}[] | null) || []
      if (!projs.length) {
        addLog('warn', 'No projects array found at top level — checking alternate structure...')
        // Check if it's nested differently
        for (const key of topKeys) {
          const val = state[key]
          if (Array.isArray(val) && (val as unknown[]).length > 0) {
            const first = (val as Record<string,unknown>[])[0]
            if (first?.name || first?.id) {
              addLog('info', `Found candidate array at key "${key}": ${(val as unknown[]).length} items, first item keys: ${Object.keys(first).slice(0,8).join(', ')}`)
            }
          }
        }
      } else {
        addLog('ok', `Found ${projs.length} projects: ${projs.map(p => p.name).join(', ')}`)
        setProjects(projs.map(p => ({ id: p.id, name: p.name })))
        setPhase('loaded')
      }
    } catch (e) {
      addLog('error', String(e))
    }
    setRunning(false)
  }

  async function migrateProject() {
    if (!rawData || !selectedProjectId || !activeProject) return
    setRunning(true)
    addLog('info', `Starting migration of project ${selectedProjectId} → ${activeProject.name}`)

    const state = rawData as Record<string, unknown>
    const projects = (state.projects as Record<string,unknown>[]) || []
    const proj = projects.find(p => p.id === selectedProjectId) as Record<string,unknown>
    if (!proj) { addLog('error', 'Project not found in state'); setRunning(false); return }

    const pid = activeProject.id

    try {
      // ── RATE CARDS ──────────────────────────────────────────────────────────
      const rateCards = ((proj.hr as Record<string,unknown>)?.rateCards || (proj as Record<string,unknown>).rateCards || []) as Record<string,unknown>[]
      if (rateCards.length) {
        addLog('info', `Migrating ${rateCards.length} rate cards...`)
        const rcRows = rateCards.map(rc => ({
          project_id: pid,
          role: rc.role || rc.name || '',
          category: rc.category || 'trades',
          subcon_vendor: rc.subconVendor || rc.vendor || null,
          rates: { cost: (rc.rates as {cost?:unknown})?.cost || {}, sell: (rc.rates as {sell?:unknown})?.sell || {} },
          regime: rc.regime || null,
          laha_cost: Number(rc.lahaCost || rc.laha_cost || 0),
          laha_sell: Number(rc.lahaSell || rc.laha_sell || 0),
          fsa_cost: Number(rc.fsaCost || rc.fsa_cost || 0),
          fsa_sell: Number(rc.fsaSell || rc.fsa_sell || 0),
          meal_cost: Number(rc.mealCost || rc.meal_cost || 0),
          meal_sell: Number(rc.mealSell || rc.meal_sell || 0),
          camp: Number(rc.camp || 0),
        }))
        const { error } = await supabase.from('rate_cards').insert(rcRows)
        if (error) addLog('warn', `Rate cards: ${error.message}`)
        else addLog('ok', `✓ ${rcRows.length} rate cards`)
      }

      // ── RESOURCES ────────────────────────────────────────────────────────────
      const resources = ((proj.hr as Record<string,unknown>)?.resources || (proj as Record<string,unknown>).resources || []) as Record<string,unknown>[]
      const resIdMap: Record<string, string> = {}
      if (resources.length) {
        addLog('info', `Migrating ${resources.length} resources...`)
        for (const r of resources) {
          const row = {
            project_id: pid,
            name: String(r.name || ''),
            role: String(r.role || ''),
            category: String(r.category || 'trades'),
            shift: String(r.shift || 'day'),
            mob_in: (r.mobIn || r.mob_in || null) as string | null,
            mob_out: (r.mobOut || r.mob_out || null) as string | null,
            travel_days: Number(r.travelDays || r.travel_days || 0),
            wbs: String(r.wbs || ''),
            allow_laha: Boolean(r.allowLaha || r.allow_laha || false),
            allow_fsa: Boolean(r.allowFsa || r.allow_fsa || false),
            allow_meal: Boolean(r.allowMeal || r.allow_meal || false),
            company: String(r.company || ''),
            phone: String(r.phone || ''),
            email: String(r.email || ''),
            home_city: String(r.homeCity || r.home_city || ''),
            transport_mode: String(r.transportMode || r.transport_mode || 'fly'),
            notes: String(r.notes || ''),
            meal_break_adj: Boolean(r.mealBreakAdj || r.meal_break_adj || false),
          }
          const { data, error } = await supabase.from('resources').insert(row).select('id').single()
          if (error) addLog('warn', `Resource ${row.name}: ${error.message}`)
          else if (data) resIdMap[String(r.id)] = data.id
        }
        addLog('ok', `✓ ${Object.keys(resIdMap).length} resources`)
      }

      // ── WEEKLY TIMESHEETS ────────────────────────────────────────────────────
      const sheets = ((proj.hr as Record<string,unknown>)?.weeklyTimesheets || (proj as Record<string,unknown>).weeklyTimesheets || []) as Record<string,unknown>[]
      if (sheets.length) {
        addLog('info', `Migrating ${sheets.length} timesheets...`)
        let ok = 0
        for (const s of sheets) {
          // Remap crew personIds to new resource IDs
          const crew = ((s.crew || []) as Record<string,unknown>[]).map(m => ({
            ...m,
            personId: resIdMap[String(m.personId)] || m.personId,
          }))
          const row = {
            project_id: pid,
            type: String(s.type || 'trades') as 'trades'|'mgmt'|'seag'|'subcon',
            week_start: String(s.weekStart || s.week_start || ''),
            regime: String(s.regime || 'lt12') as 'lt12'|'ge12',
            status: String(s.status || 'draft') as 'draft'|'submitted'|'approved',
            wbs: String(s.wbs || ''),
            notes: String(s.notes || ''),
            vendor: (s.vendor || null) as string | null,
            crew,
          }
          if (!row.week_start) continue
          const { error } = await supabase.from('weekly_timesheets').insert(row)
          if (error) addLog('warn', `Timesheet ${row.week_start} (${row.type}): ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok}/${sheets.length} timesheets`)
      }

      // ── PURCHASE ORDERS ──────────────────────────────────────────────────────
      const pos = ((proj as Record<string,unknown>).purchaseOrders || (proj as Record<string,unknown>).purchase_orders || []) as Record<string,unknown>[]
      const poIdMap: Record<string, string> = {}
      if (pos.length) {
        addLog('info', `Migrating ${pos.length} purchase orders...`)
        for (const po of pos) {
          const row = {
            project_id: pid,
            po_number: String(po.poNumber || po.po_number || ''),
            internal_ref: String(po.internalRef || po.internal_ref || ''),
            vendor: String(po.vendor || ''),
            description: String(po.description || ''),
            status: String(po.status || 'draft'),
            currency: String(po.currency || 'AUD'),
            po_value: po.poValue || po.po_value || null,
            raised_date: (po.raisedDate || po.raised_date || null) as string|null,
            notes: String(po.notes || ''),
            line_items: po.lines || po.line_items || [],
          }
          const { data, error } = await supabase.from('purchase_orders').insert(row).select('id').single()
          if (error) addLog('warn', `PO ${row.po_number}: ${error.message}`)
          else if (data) poIdMap[String(po.id)] = data.id
        }
        addLog('ok', `✓ ${Object.keys(poIdMap).length} POs`)
      }

      // ── VARIATIONS ───────────────────────────────────────────────────────────
      const vars = ((proj as Record<string,unknown>).variations || []) as Record<string,unknown>[]
      if (vars.length) {
        addLog('info', `Migrating ${vars.length} variations...`)
        let ok = 0
        for (const v of vars) {
          const row = {
            project_id: pid,
            number: String(v.number || v.vnNumber || ''),
            title: String(v.title || ''),
            status: String(v.status || 'draft'),
            value: v.sellTotal || v.value || null,
            scope: String(v.scope || ''),
            cause: String(v.cause || ''),
            raised_date: (v.raisedDate || v.raised_date || null) as string|null,
            submitted_date: (v.submittedDate || v.submitted_date || null) as string|null,
            approved_date: (v.approvedDate || v.approved_date || null) as string|null,
            customer_ref: String(v.clientRef || v.customer_ref || ''),
            assumptions: String(v.assumptions || ''),
            exclusions: String(v.exclusions || ''),
            notes: String(v.notes || ''),
            line_items: v.lines || v.line_items || [],
          }
          const { error } = await supabase.from('variations').insert(row)
          if (error) addLog('warn', `VN ${row.number}: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} variations`)
      }

      // ── HIRE ITEMS ───────────────────────────────────────────────────────────
      const hire = (proj as Record<string,unknown>).hire as Record<string,unknown[]> || {}
      const hireAll = [
        ...((hire.dry||[]) as Record<string,unknown>[]).map(h => ({...h, _type:'dry'})),
        ...((hire.wet||[]) as Record<string,unknown>[]).map(h => ({...h, _type:'wet'})),
        ...((hire.local||[]) as Record<string,unknown>[]).map(h => ({...h, _type:'local'})),
      ]
      if (hireAll.length) {
        addLog('info', `Migrating ${hireAll.length} hire items...`)
        let ok = 0
        for (const h of hireAll) {
          const row = {
            project_id: pid,
            hire_type: String(h._type) as 'dry'|'wet'|'local',
            name: String((h as Record<string,unknown>).name || ''),
            vendor: String(h.vendor || ''),
            description: String(h.description || ''),
            start_date: (h.startDate || h.start_date || null) as string|null,
            end_date: (h.endDate || h.end_date || null) as string|null,
            hire_cost: Number(h.hireCost || h.hire_cost || 0),
            customer_total: Number(h.customerTotal || h.customer_total || 0),
            gm_pct: Number(h.gmPct || h.gm_pct || 0),
            currency: String(h.currency || 'AUD'),
            transport_in: Number(h.transportIn || h.transport_in || 0),
            transport_out: Number(h.transportOut || h.transport_out || 0),
            linked_po_id: h.linkedPOId ? (poIdMap[String(h.linkedPOId)] || null) : null,
            rates: h.rates || {},
            calendar: h.calendar || [],
            crew: h.crew || [],
            daa_rate: Number(h.daaRate || h.daa_rate || 0),
            notes: String(h.notes || ''),
            wbs: String(h.wbs || ''),
            qty: Number(h.qty || 1),
          }
          const { error } = await supabase.from('hire_items').insert(row)
          if (error) addLog('warn', `Hire ${row.name}: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} hire items`)
      }

      // ── CARS ─────────────────────────────────────────────────────────────────
      const cars = ((proj.hr as Record<string,unknown>)?.cars || []) as Record<string,unknown>[]
      if (cars.length) {
        addLog('info', `Migrating ${cars.length} cars...`)
        let ok = 0
        for (const c of cars) {
          const row = {
            project_id: pid,
            vehicle_type: String(c.vehicleType || c.vehicle_type || ''),
            rego: String(c.rego || ''),
            vendor: String(c.vendor || ''),
            person_id: c.personId ? (resIdMap[String(c.personId)] || null) : null,
            start_date: (c.startDate || c.start_date || null) as string|null,
            end_date: (c.endDate || c.end_date || null) as string|null,
            total_cost: Number(c.totalCost || c.total_cost || 0),
            customer_total: Number(c.customerTotal || c.customer_total || 0),
            gm_pct: Number(c.gmPct || c.gm_pct || 0),
            daily_rate: Number(c.dailyRate || c.daily_rate || 0),
            linked_po_id: c.linkedPOId ? (poIdMap[String(c.linkedPOId)] || null) : null,
            notes: String(c.notes || ''),
            wbs: String(c.wbs || ''),
          }
          const { error } = await supabase.from('cars').insert(row)
          if (error) addLog('warn', `Car ${row.rego}: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} cars`)
      }

      // ── ACCOMMODATION ────────────────────────────────────────────────────────
      const accom = ((proj.hr as Record<string,unknown>)?.accommodation || []) as Record<string,unknown>[]
      if (accom.length) {
        addLog('info', `Migrating ${accom.length} accommodation bookings...`)
        let ok = 0
        for (const a of accom) {
          const row = {
            project_id: pid,
            property: String(a.property || ''),
            room: String(a.room || ''),
            vendor: String(a.vendor || ''),
            check_in: (a.checkIn || a.check_in || null) as string|null,
            check_out: (a.checkOut || a.check_out || null) as string|null,
            nights: Number(a.nights || 0),
            total_cost: Number(a.totalCost || a.total_cost || 0),
            customer_total: Number(a.customerTotal || a.customer_total || 0),
            gm_pct: Number(a.gmPct || a.gm_pct || 0),
            inclusive: Boolean(a.inclusive || false),
            linked_po_id: a.linkedPOId ? (poIdMap[String(a.linkedPOId)] || null) : null,
            occupants: a.occupants || [],
            notes: String(a.notes || ''),
            wbs: String(a.wbs || ''),
          }
          const { error } = await supabase.from('accommodation').insert(row)
          if (error) addLog('warn', `Accom ${row.property}: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} accommodation bookings`)
      }

      // ── EXPENSES ─────────────────────────────────────────────────────────────
      const expenses = ((proj as Record<string,unknown>).expenses || []) as Record<string,unknown>[]
      if (expenses.length) {
        addLog('info', `Migrating ${expenses.length} expenses...`)
        let ok = 0
        for (const e of expenses) {
          const row = {
            project_id: pid,
            resource_id: e.personId ? (resIdMap[String(e.personId)] || null) : null,
            category: String(e.category || ''),
            description: String(e.description || ''),
            vendor: String(e.vendor || ''),
            date: (e.date || null) as string|null,
            amount: Number(e.amount || e.receiptValue || 0),
            cost_ex_gst: Number(e.costExGst || e.cost_ex_gst || 0),
            sell_price: Number(e.sellPrice || e.sell_price || 0),
            currency: String(e.currency || 'AUD'),
            gm_pct: Number(e.gmPct || e.gm_pct || 0),
            chargeable: Boolean(e.chargeable !== false),
            wbs: String(e.wbs || ''),
            notes: String(e.notes || ''),
          }
          const { error } = await supabase.from('expenses').insert(row)
          if (error) addLog('warn', `Expense: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} expenses`)
      }

      // ── INVOICES ─────────────────────────────────────────────────────────────
      const invoices = ((proj as Record<string,unknown>).invoices || []) as Record<string,unknown>[]
      if (invoices.length) {
        addLog('info', `Migrating ${invoices.length} invoices...`)
        let ok = 0
        for (const inv of invoices) {
          const row = {
            project_id: pid,
            po_id: inv.poId ? (poIdMap[String(inv.poId)] || null) : null,
            invoice_number: String(inv.invoiceNumber || inv.invoice_number || ''),
            vendor_ref: String(inv.vendorRef || inv.vendor_ref || ''),
            status: String(inv.status || 'received'),
            amount: Number(inv.amount || 0),
            currency: String(inv.currency || 'AUD'),
            invoice_date: (inv.invoiceDate || inv.invoice_date || null) as string|null,
            due_date: (inv.dueDate || inv.due_date || null) as string|null,
            period_from: (inv.periodFrom || inv.period_from || null) as string|null,
            period_to: (inv.periodTo || inv.period_to || null) as string|null,
            notes: String(inv.notes || ''),
          }
          const { error } = await supabase.from('invoices').insert(row)
          if (error) addLog('warn', `Invoice ${row.invoice_number}: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} invoices`)
      }

      // ── WBS LIST ─────────────────────────────────────────────────────────────
      const wbsList = ((proj as Record<string,unknown>).wbsList || []) as Record<string,unknown>[]
      if (wbsList.length) {
        addLog('info', `Migrating ${wbsList.length} WBS items...`)
        const rows = wbsList.map((w, i) => ({
          project_id: pid,
          code: String(w.code || ''),
          name: String(w.name || w.description || ''),
          level: (w.level || null) as string|null,
          pm100: w.pm100 || null,
          pm80: w.pm80 || null,
          sort_order: i,
        }))
        const { error } = await supabase.from('wbs_list').insert(rows)
        if (error) addLog('warn', `WBS: ${error.message}`)
        else addLog('ok', `✓ ${rows.length} WBS items`)
      }

      // ── SHIPMENTS ────────────────────────────────────────────────────────────
      const shipments = ((proj as Record<string,unknown>).shipments || []) as Record<string,unknown>[]
      if (shipments.length) {
        addLog('info', `Migrating ${shipments.length} shipments...`)
        let ok = 0
        for (const s of shipments) {
          const row = {
            project_id: pid,
            direction: String(s.direction || 'import') as 'import'|'export',
            reference: String(s.reference || s.ref || ''),
            description: String(s.description || ''),
            status: String(s.status || 'pending'),
            carrier: String(s.carrier || ''),
            tracking: String(s.tracking || ''),
            eta: (s.eta || null) as string|null,
            shipped_date: (s.shippedDate || s.shipped_date || null) as string|null,
            origin: String(s.origin || ''),
            destination: String(s.destination || ''),
            agent: String(s.agent || ''),
            hawb: String(s.hawb || ''),
            mawb: String(s.mawb || ''),
            gross_kg: s.grossKg || s.gross_kg || null,
            notes: String(s.notes || ''),
          }
          const { error } = await supabase.from('shipments').insert(row)
          if (error) addLog('warn', `Shipment: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} shipments`)
      }

      // ── BACK OFFICE HOURS ────────────────────────────────────────────────────
      const bo = ((proj as Record<string,unknown>).backOfficeHours || []) as Record<string,unknown>[]
      if (bo.length) {
        addLog('info', `Migrating ${bo.length} back office hours...`)
        let ok = 0
        for (const b of bo) {
          const row = {
            project_id: pid,
            name: String(b.name || ''),
            role: String(b.role || ''),
            date: String(b.date || ''),
            hours: Number(b.hours || 0),
            cost: Number(b.cost || 0),
            sell: Number(b.sell || 0),
            wbs: String(b.wbs || ''),
            notes: String(b.notes || ''),
          }
          const { error } = await supabase.from('back_office_hours').insert(row)
          if (error) addLog('warn', `BO hours: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} back office hours`)
      }

      // ── WORK ORDERS ──────────────────────────────────────────────────────────
      const workOrders = ((proj as Record<string,unknown>).workOrders || []) as Record<string,unknown>[]
      if (workOrders.length) {
        addLog('info', `Migrating ${workOrders.length} work orders...`)
        let ok = 0
        for (const w of workOrders) {
          const row = {
            project_id: pid,
            wo_number: String(w.woNumber || w.wo_number || ''),
            description: String(w.description || ''),
            status: String(w.status || 'open'),
            wbs_code: (w.wbsCode || w.wbs_code || null) as string|null,
            budget_hours: w.budgetHours || w.budget_hours || null,
            notes: String(w.notes || ''),
            system: String(w.system || ''),
            planned_start: (w.plannedStart || w.planned_start || null) as string|null,
            planned_end: (w.plannedEnd || w.planned_end || null) as string|null,
            resources: w.resources || [],
            allocations: w.allocations || [],
          }
          const { error } = await supabase.from('work_orders').insert(row)
          if (error) addLog('warn', `WO ${row.wo_number}: ${error.message}`)
          else ok++
        }
        addLog('ok', `✓ ${ok} work orders`)
      }

      addLog('ok', '🎉 Migration complete!')
      setPhase('done')
    } catch (e) {
      addLog('error', `Migration failed: ${String(e)}`)
    }
    setRunning(false)
  }

  const logColors = { info: 'var(--text2)', ok: 'var(--green)', warn: 'var(--amber)', error: 'var(--red)' }
  const logIcons  = { info: 'ℹ', ok: '✓', warn: '⚠', error: '✕' }

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>Data Migration</h1>
      <p style={{ fontSize: '13px', color: 'var(--text3)', marginBottom: '20px' }}>
        Import project data from the HTML Overhaul Manager (v4.47) into this project.
        This reads directly from the old Supabase database and inserts into the current project.
      </p>

      {!activeProject && (
        <div style={{ padding: '12px 16px', background: '#fff7ed', borderLeft: '4px solid var(--amber)', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
          ⚠ Select a project first — data will be imported into the active project.
        </div>
      )}

      {activeProject && (
        <div style={{ padding: '10px 14px', background: 'var(--bg3)', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
          Importing into: <strong>{activeProject.name}</strong>
        </div>
      )}

      {phase === 'idle' && (
        <button className="btn btn-primary" onClick={loadOldData} disabled={running || !activeProject}>
          {running ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> Loading...</> : '① Load HTML App Data'}
        </button>
      )}

      {phase === 'loaded' && projects.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="fg">
            <label>Select project to migrate from HTML app</label>
            <select className="input" value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}>
              <option value="">— Select project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text3)', padding: '10px 14px', background: '#fff7ed', borderLeft: '4px solid var(--amber)', borderRadius: '6px' }}>
            ⚠ This will INSERT data into <strong>{activeProject?.name}</strong>. It won't delete existing data.
            Run on a fresh project or check for duplicates first.
          </div>
          <button className="btn btn-primary" onClick={migrateProject} disabled={running || !selectedProjectId}>
            {running ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> Migrating...</> : '② Run Migration'}
          </button>
          <button className="btn" onClick={() => { setPhase('idle'); setLog([]); setProjects([]) }}>Start Over</button>
        </div>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: '16px', background: 'var(--bg3)', borderRadius: '8px', padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: '12px', maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: logColors[l.type] }}>
              {logIcons[l.type]} {l.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
