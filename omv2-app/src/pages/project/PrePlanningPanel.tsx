import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChecklistItem {
  id: string
  category: string
  item: string
  owner: string
  due_date: string
  status: 'pending' | 'in_progress' | 'complete' | 'na'
  notes: string
  priority: 'critical' | 'standard' | 'optional'
  is_international: boolean
  smart_key: string | null
}

interface SmartContext {
  resources:      { id: string; name: string; category: string; rate_card_id: string | null; mob_in: string | null; mob_out: string | null }[]
  seagResources:  { id: string; name: string }[]
  subconVendors:  { id: string; vendor: string; linked_po_id: string | null }[]
  pos:            { id: string; vendor: string; status: string }[]
  variations:     { id: string; number: string; title: string; status: string }[]
  workOrders:     { id: string; wo_number: string; status: string }[]
  tvCostings:     { id: string; tv_no: string; import_cost_eur: number | null; charge_start: string | null }[]
  inductionNames: string[]
  accomBookings:  { check_in: string | null; check_out: string | null }[]
  cars:           { person_id: string | null; start_date: string | null; end_date: string | null }[]
}

interface SmartResult {
  status: 'ok' | 'warn' | 'error' | 'info'
  summary: string
  detail: string[]
}

interface LibraryItem {
  text: string
  owner: string
  priority: 'critical' | 'standard' | 'optional'
  isIntl?: boolean
  smartKey?: string
}

interface LibraryCategory {
  name: string
  items: LibraryItem[]
}

// ─── Smart Evaluators ─────────────────────────────────────────────────────────

type Evaluator = (ctx: SmartContext) => SmartResult

const SMART_EVALUATORS: Record<string, Evaluator> = {
  subcon_po_coverage: (ctx) => {
    const awarded = ctx.subconVendors
    if (awarded.length === 0) return { status: 'info', summary: 'No awarded subcon contracts on project', detail: [] }
    const missing = awarded.filter(v => !v.linked_po_id)
    if (missing.length === 0) return { status: 'ok', summary: `All ${awarded.length} vendor(s) have a linked PO`, detail: [] }
    return { status: 'warn', summary: `${missing.length} of ${awarded.length} vendor(s) missing a PO`, detail: missing.map(v => `${v.vendor} — no PO linked`) }
  },
  pos_approved: (ctx) => {
    const drafts = ctx.pos.filter(p => p.status === 'draft')
    if (ctx.pos.length === 0) return { status: 'info', summary: 'No POs raised yet', detail: [] }
    if (drafts.length === 0) return { status: 'ok', summary: `All ${ctx.pos.length} PO(s) approved or active`, detail: [] }
    return { status: 'warn', summary: `${drafts.length} PO(s) still in draft`, detail: drafts.map(p => `${p.vendor} — ${p.status}`) }
  },
  crew_inductions: (ctx) => {
    if (ctx.resources.length === 0) return { status: 'info', summary: 'No crew on roster', detail: [] }
    const inducted = new Set(ctx.inductionNames.map(n => n.toLowerCase().trim()))
    const missing = ctx.resources.filter(r => !inducted.has(r.name.toLowerCase().trim()))
    if (missing.length === 0) return { status: 'ok', summary: `All ${ctx.resources.length} crew are inducted`, detail: [] }
    return { status: missing.length > 2 ? 'error' : 'warn', summary: `${missing.length} of ${ctx.resources.length} crew not yet inducted`, detail: missing.map(r => r.name) }
  },
  seag_visas: (ctx) => {
    if (ctx.seagResources.length === 0) return { status: 'info', summary: 'No SE AG (European) crew on roster', detail: [] }
    return { status: 'warn', summary: `${ctx.seagResources.length} SE AG crew — confirm visas/work permits for each`, detail: ctx.seagResources.map(r => r.name) }
  },
  tv_customs_import: (ctx) => {
    const tvs = ctx.tvCostings
    if (tvs.length === 0) return { status: 'info', summary: 'No tooling vehicles on project', detail: [] }
    const noImport = tvs.filter(t => t.import_cost_eur === null)
    if (noImport.length === 0) return { status: 'ok', summary: `Import costs entered for all ${tvs.length} TV(s)`, detail: [] }
    return { status: 'warn', summary: `${noImport.length} of ${tvs.length} TV(s) have no import cost/clearance entered`, detail: noImport.map(t => `${t.tv_no} — no import cost`) }
  },
  work_orders_created: (ctx) => {
    if (ctx.workOrders.length === 0) return { status: 'error', summary: 'No work orders created', detail: [] }
    const open = ctx.workOrders.filter(w => w.status !== 'closed' && w.status !== 'cancelled')
    return { status: 'ok', summary: `${ctx.workOrders.length} WO(s) on project (${open.length} open)`, detail: [] }
  },
  variations_approved: (ctx) => {
    if (ctx.variations.length === 0) return { status: 'info', summary: 'No variations raised', detail: [] }
    const pending = ctx.variations.filter(v => v.status !== 'approved' && v.status !== 'na')
    if (pending.length === 0) return { status: 'ok', summary: `All ${ctx.variations.length} variation(s) approved`, detail: [] }
    return { status: 'warn', summary: `${pending.length} variation(s) not yet approved`, detail: pending.map(v => `VN ${v.number} — ${v.title} (${v.status})`) }
  },
  accom_coverage: (ctx) => {
    const onSite = ctx.resources.filter(r => r.mob_in)
    if (onSite.length === 0) return { status: 'info', summary: 'No crew have mob dates set yet', detail: [] }
    if (ctx.accomBookings.length === 0) return { status: 'warn', summary: `${onSite.length} crew mobilising — no accommodation booked`, detail: [] }
    return { status: 'ok', summary: `${ctx.accomBookings.length} accommodation booking(s) on file`, detail: [] }
  },
  car_coverage: (ctx) => {
    const onSite = ctx.resources.filter(r => r.mob_in)
    if (onSite.length === 0) return { status: 'info', summary: 'No crew have mob dates set yet', detail: [] }
    if (ctx.cars.length === 0) return { status: 'warn', summary: `${onSite.length} crew mobilising — no car hire booked`, detail: [] }
    return { status: 'ok', summary: `${ctx.cars.length} car(s) on file`, detail: [] }
  },
  resources_rate_cards: (ctx) => {
    const needsCard = ctx.resources.filter(r => r.category !== 'seag')
    if (needsCard.length === 0) return { status: 'info', summary: 'No local crew on roster', detail: [] }
    const missing = needsCard.filter(r => !r.rate_card_id)
    if (missing.length === 0) return { status: 'ok', summary: `All ${needsCard.length} crew have rate cards assigned`, detail: [] }
    return { status: 'warn', summary: `${missing.length} crew missing a rate card`, detail: missing.map(r => r.name) }
  },
  tv_costings_entered: (ctx) => {
    const tvs = ctx.tvCostings
    if (tvs.length === 0) return { status: 'info', summary: 'No tooling vehicles on project', detail: [] }
    const noCost = tvs.filter(t => !t.charge_start)
    if (noCost.length === 0) return { status: 'ok', summary: `Charge dates entered for all ${tvs.length} TV(s)`, detail: [] }
    return { status: 'warn', summary: `${noCost.length} of ${tvs.length} TV(s) have no charge start date`, detail: noCost.map(t => t.tv_no) }
  },
}

// ─── Item Library ─────────────────────────────────────────────────────────────

const ITEM_LIBRARY: LibraryCategory[] = [
  { name: 'Commercial & Contract', items: [
    { text: 'Contract signed and fully executed', owner: 'PM', priority: 'critical' },
    { text: 'Scope freeze confirmed in writing with client', owner: 'PM', priority: 'critical' },
    { text: 'Scope of work document issued to team', owner: 'PM', priority: 'critical' },
    { text: 'PM100 budget approved', owner: 'PM', priority: 'critical' },
    { text: 'PM80 estimate reviewed vs PM100', owner: 'PM', priority: 'standard' },
    { text: 'Variation / scope change process agreed with client', owner: 'PM', priority: 'standard' },
    { text: 'Variation notices submitted and approved', owner: 'PM', priority: 'standard', smartKey: 'variations_approved' },
    { text: 'Revenue recognition milestones confirmed', owner: 'PM', priority: 'standard' },
    { text: 'Billing schedule agreed (milestone vs T&M)', owner: 'PM', priority: 'standard' },
    { text: 'Customer cost report format agreed', owner: 'PM', priority: 'standard' },
    { text: 'Customer cost report issued', owner: 'PM', priority: 'standard' },
    { text: 'Client representative / point of contact confirmed', owner: 'PM', priority: 'standard' },
    { text: 'NDA / confidentiality obligations checked', owner: 'PM', priority: 'optional' },
    { text: 'Back-charge / contra-charge clauses reviewed', owner: 'PM', priority: 'optional' },
    { text: 'SE insurance and contractor registration current', owner: 'PM', priority: 'critical' },
  ]},
  { name: 'Procurement & Purchase Orders', items: [
    { text: 'Purchase orders raised for all subcontractors', owner: 'PM', priority: 'critical', smartKey: 'subcon_po_coverage' },
    { text: 'All POs approved or active (none in draft)', owner: 'PM', priority: 'critical', smartKey: 'pos_approved' },
    { text: 'SAP cost codes active and confirmed', owner: 'PM', priority: 'critical' },
    { text: 'WBS structure aligned to SAP / MIKA', owner: 'PM', priority: 'critical' },
    { text: 'PO numbers communicated to all vendors', owner: 'PM', priority: 'standard' },
    { text: 'PO for accommodation confirmed', owner: 'Admin', priority: 'standard' },
    { text: 'PO for car hire confirmed', owner: 'Admin', priority: 'standard' },
    { text: 'PO for freight / logistics confirmed', owner: 'Admin', priority: 'standard' },
    { text: 'Subcontractor rate cards loaded in system', owner: 'PM', priority: 'standard', smartKey: 'resources_rate_cards' },
  ]},
  { name: 'Crew & Resourcing', items: [
    { text: 'All crew confirmed and on roster', owner: 'PM', priority: 'critical' },
    { text: 'Supervision ratio adequate for scope', owner: 'PM', priority: 'critical' },
    { text: 'Day/night shift roster finalised', owner: 'Supervisor', priority: 'critical' },
    { text: 'Crew acceptance / offer letters signed', owner: 'Admin', priority: 'critical' },
    { text: 'LAHA / allowance settings confirmed', owner: 'PM', priority: 'critical' },
    { text: 'Payroll regime confirmed per person (trades / mgmt / subcon)', owner: 'Admin', priority: 'critical' },
    { text: 'Standby / on-call coverage identified', owner: 'Supervisor', priority: 'standard' },
    { text: 'First shift briefing time and location confirmed', owner: 'Supervisor', priority: 'standard' },
    { text: 'Crew contact list and emergency contacts compiled', owner: 'Admin', priority: 'standard' },
    { text: 'Overtime and call-back rules agreed', owner: 'PM', priority: 'standard' },
    { text: 'Crew fitness-for-duty policy communicated', owner: 'Supervisor', priority: 'standard' },
    { text: 'Technical advisor role and authority defined', owner: 'PM', priority: 'standard' },
  ]},
  { name: 'International Mobilisation', items: [
    { text: 'SE AG (European) crew visas / work permits confirmed', owner: 'Admin', priority: 'critical', isIntl: true, smartKey: 'seag_visas' },
    { text: 'Passports valid (>6 months beyond outage end)', owner: 'Admin', priority: 'critical', isIntl: true },
    { text: 'Visa approval confirmed before flights booked', owner: 'Admin', priority: 'critical', isIntl: true },
    { text: 'Work permits / work authorisation obtained', owner: 'Admin', priority: 'critical', isIntl: true },
    { text: 'Flights booked (international legs)', owner: 'Admin', priority: 'critical', isIntl: true },
    { text: 'Connecting domestic flights booked', owner: 'Admin', priority: 'standard', isIntl: true },
    { text: 'Arrival / departure transfers arranged', owner: 'Admin', priority: 'standard', isIntl: true },
    { text: 'Travel insurance confirmed (medical, evacuation)', owner: 'Admin', priority: 'critical', isIntl: true },
    { text: 'International SIM cards / roaming plans arranged', owner: 'Admin', priority: 'standard', isIntl: true },
    { text: 'Per diem / foreign currency arranged', owner: 'Admin', priority: 'standard', isIntl: true },
    { text: 'Medical clearance for international crew', owner: 'Admin', priority: 'standard', isIntl: true },
    { text: 'Vaccination requirements checked and met', owner: 'Admin', priority: 'critical', isIntl: true },
    { text: 'Emergency contact protocol for overseas crew briefed', owner: 'Admin', priority: 'standard', isIntl: true },
    { text: 'Local emergency numbers and hospital identified', owner: 'Admin', priority: 'standard', isIntl: true },
  ]},
  { name: 'Tooling & Equipment', items: [
    { text: 'WOSIT / TV export received from Kanlog', owner: 'PM', priority: 'critical' },
    { text: 'TV charge dates and costings entered', owner: 'PM', priority: 'critical', smartKey: 'tv_costings_entered' },
    { text: 'Kollo manifest reviewed', owner: 'PM', priority: 'standard' },
    { text: 'All tooling inspected and functional-tested pre-ship', owner: 'Supervisor', priority: 'critical' },
    { text: 'Torque tools calibrated and certs current', owner: 'Engineer', priority: 'critical' },
    { text: 'Alignment kit checked and complete', owner: 'Engineer', priority: 'critical' },
    { text: 'Jacking and lifting equipment certified', owner: 'Engineer', priority: 'critical' },
    { text: 'NDT equipment calibrated', owner: 'Engineer', priority: 'critical' },
    { text: 'Borescope / inspection camera serviceable', owner: 'Engineer', priority: 'standard' },
    { text: 'Communication equipment (radios) tested', owner: 'Supervisor', priority: 'standard' },
    { text: 'PPE quantities checked vs crew headcount', owner: 'Supervisor', priority: 'standard' },
    { text: 'Consumables list confirmed (gaskets, fasteners, seals)', owner: 'Engineer', priority: 'standard' },
    { text: 'Packing list complete and matched to manifest', owner: 'Logistics', priority: 'standard' },
    { text: 'Serial / asset numbers recorded pre-despatch', owner: 'Logistics', priority: 'standard' },
    { text: 'Tooling insurance / ATA Carnet arranged', owner: 'Logistics', priority: 'critical', isIntl: true },
  ]},
  { name: 'Shipping & Customs', items: [
    { text: 'SLI documents generated', owner: 'Logistics', priority: 'critical' },
    { text: 'DG (Dangerous Goods) declaration completed', owner: 'Logistics', priority: 'critical' },
    { text: 'Freight forwarder engaged and briefed', owner: 'Logistics', priority: 'critical' },
    { text: 'Shipping method confirmed (air / sea / road)', owner: 'Logistics', priority: 'critical' },
    { text: 'Expected arrival window confirmed vs outage start', owner: 'Logistics', priority: 'critical' },
    { text: 'Tracking / AWB numbers distributed to team', owner: 'Logistics', priority: 'standard' },
    { text: 'Site unloading / materials receiving contact confirmed', owner: 'Logistics', priority: 'standard' },
    { text: 'Packing cases / crates serviceable for return journey', owner: 'Logistics', priority: 'optional' },
    { text: 'Contingency plan if tooling delayed (air freight escalation)', owner: 'PM', priority: 'standard' },
    { text: 'Customs import clearance organised for tooling vehicles', owner: 'Logistics', priority: 'critical', isIntl: true, smartKey: 'tv_customs_import' },
    { text: 'Export clearance obtained (origin country)', owner: 'Logistics', priority: 'critical', isIntl: true },
    { text: 'HS codes confirmed for all tooling and parts', owner: 'Logistics', priority: 'critical', isIntl: true },
    { text: 'ATA Carnet prepared for temporary import of tools', owner: 'Logistics', priority: 'critical', isIntl: true },
    { text: 'Customs broker engaged at destination port', owner: 'Logistics', priority: 'critical', isIntl: true },
    { text: 'Estimated duty / import taxes budgeted', owner: 'PM', priority: 'standard', isIntl: true },
    { text: 'CITES / restricted material declarations (if applicable)', owner: 'Logistics', priority: 'optional', isIntl: true },
  ]},
  { name: 'Spare Parts & Hardware', items: [
    { text: 'Parts list finalised against scope', owner: 'Engineer', priority: 'critical' },
    { text: 'OEM parts vs non-OEM decision documented', owner: 'Engineer', priority: 'critical' },
    { text: 'Parts on order and confirmed with ETA', owner: 'PM', priority: 'critical' },
    { text: 'Long-lead items identified and expedited', owner: 'PM', priority: 'critical' },
    { text: 'Parts received and inspected at warehouse', owner: 'Logistics', priority: 'critical' },
    { text: 'Certificate of conformance / traceability docs on file', owner: 'Engineer', priority: 'critical' },
    { text: 'Balance weights / special hardware approved', owner: 'Engineer', priority: 'critical' },
    { text: 'Rotor blade parts kitted and labelled by stage', owner: 'Engineer', priority: 'standard' },
    { text: 'Seals and gaskets matched to as-built drawings', owner: 'Engineer', priority: 'standard' },
    { text: 'Consumable hardware quantities confirmed (bolts, pins, lockwire)', owner: 'Engineer', priority: 'standard' },
    { text: 'Hardware shipped and tracking confirmed', owner: 'Logistics', priority: 'standard' },
    { text: 'Site receiving process confirmed (who signs, where stored)', owner: 'Logistics', priority: 'standard' },
  ]},
  { name: 'HSE & Compliance', items: [
    { text: 'SWMS / JSAs prepared', owner: 'HSE', priority: 'critical' },
    { text: 'SWMS submitted to and approved by client', owner: 'HSE', priority: 'critical' },
    { text: 'Site inductions completed by each crew member', owner: 'Admin', priority: 'critical', smartKey: 'crew_inductions' },
    { text: 'Permit to work types identified (HV isolation, confined space, hot work, heights)', owner: 'Supervisor', priority: 'critical' },
    { text: 'HV / LV isolation competency confirmed for crew', owner: 'Supervisor', priority: 'critical' },
    { text: 'Confined space entry requirements confirmed', owner: 'HSE', priority: 'critical' },
    { text: 'Heights / working at heights assessment complete', owner: 'HSE', priority: 'standard' },
    { text: 'Site-specific HSE rules briefed to crew', owner: 'Supervisor', priority: 'standard' },
    { text: 'Emergency evacuation plan obtained from site', owner: 'HSE', priority: 'standard' },
    { text: 'Emergency muster point and warden confirmed', owner: 'HSE', priority: 'standard' },
    { text: 'First aid officer on crew confirmed', owner: 'Supervisor', priority: 'standard' },
    { text: 'Nearest hospital / medical facility confirmed', owner: 'Admin', priority: 'standard' },
    { text: 'Drug and alcohol testing requirements noted', owner: 'HSE', priority: 'standard' },
    { text: 'Crew fatigue management plan in place', owner: 'Supervisor', priority: 'standard' },
    { text: 'Environmental controls confirmed (spill kits, waste disposal)', owner: 'HSE', priority: 'standard' },
    { text: 'Incident reporting process briefed', owner: 'Supervisor', priority: 'standard' },
  ]},
  { name: 'Technical Readiness', items: [
    { text: 'Work orders created and assigned', owner: 'Engineer', priority: 'critical', smartKey: 'work_orders_created' },
    { text: 'Inspection and Test Plan (ITP) prepared', owner: 'Engineer', priority: 'critical' },
    { text: 'Maintenance procedures / work instructions issued', owner: 'Engineer', priority: 'critical' },
    { text: 'Hold points and witness points confirmed with client QA', owner: 'Engineer', priority: 'critical' },
    { text: 'As-built drawings available on site', owner: 'Engineer', priority: 'critical' },
    { text: 'Alignment records from previous outage reviewed', owner: 'Engineer', priority: 'critical' },
    { text: 'Test equipment calibration current', owner: 'Engineer', priority: 'critical' },
    { text: 'As-found data sheets prepared (blank, ready to fill)', owner: 'Engineer', priority: 'standard' },
    { text: 'Thermal / performance baseline data reviewed', owner: 'Engineer', priority: 'standard' },
    { text: 'Vibration / historical condition monitoring data reviewed', owner: 'Engineer', priority: 'standard' },
    { text: 'Rotor dynamics / balance criteria confirmed', owner: 'Engineer', priority: 'standard' },
    { text: 'OEM technical bulletins / service notices reviewed', owner: 'Engineer', priority: 'standard' },
    { text: 'Non-conformance report (NCR) process briefed', owner: 'Engineer', priority: 'standard' },
    { text: 'Technical derogation / concession process agreed', owner: 'Engineer', priority: 'optional' },
    { text: 'Scaffold design / access plan approved', owner: 'Engineer', priority: 'standard' },
    { text: 'Hydraulic torquing requirements and sequence confirmed', owner: 'Engineer', priority: 'standard' },
  ]},
  { name: 'Site Readiness', items: [
    { text: 'Unit isolation / shutdown confirmed by operations', owner: 'Site Contact', priority: 'critical' },
    { text: 'Clearance / zero energy state confirmed', owner: 'Site Contact', priority: 'critical' },
    { text: 'Site access approved for all crew', owner: 'Site Contact', priority: 'critical' },
    { text: 'Crane / overhead lifting equipment booked', owner: 'Site Contact', priority: 'critical' },
    { text: 'Crane operator certified and confirmed', owner: 'Site Contact', priority: 'critical' },
    { text: 'Scaffolding erected and certified before crew arrival', owner: 'Site Contact', priority: 'critical' },
    { text: 'Lifting plan reviewed and approved', owner: 'Engineer', priority: 'critical' },
    { text: 'Laydown / work area allocated and confirmed', owner: 'Site Contact', priority: 'standard' },
    { text: 'LOTO hardware available on site', owner: 'Site Contact', priority: 'standard' },
    { text: 'Temporary power / compressed air available', owner: 'Site Contact', priority: 'standard' },
    { text: 'Lighting for night shift adequate', owner: 'Site Contact', priority: 'standard' },
    { text: 'Site facilities confirmed (amenities, lunch room, change room)', owner: 'Site Contact', priority: 'standard' },
    { text: 'Parking / crew transport to site gate confirmed', owner: 'Admin', priority: 'optional' },
    { text: 'Waste / hazmat disposal route confirmed', owner: 'Site Contact', priority: 'standard' },
    { text: 'Toolbox talk agenda prepared', owner: 'Supervisor', priority: 'standard' },
  ]},
  { name: 'Accommodation & Travel', items: [
    { text: 'Accommodation booked', owner: 'Admin', priority: 'critical', smartKey: 'accom_coverage' },
    { text: 'Accommodation booking confirmation on file', owner: 'Admin', priority: 'critical' },
    { text: 'Accommodation meets site / client minimum standards', owner: 'Admin', priority: 'standard' },
    { text: 'Backup accommodation option identified', owner: 'Admin', priority: 'optional' },
    { text: 'Car hire booked', owner: 'Admin', priority: 'critical', smartKey: 'car_coverage' },
    { text: 'Car hire confirmation and pickup details confirmed', owner: 'Admin', priority: 'standard' },
    { text: 'Domestic flights booked', owner: 'Admin', priority: 'critical' },
    { text: 'Crew aware of full travel itinerary', owner: 'Admin', priority: 'standard' },
    { text: 'Meal allowance process confirmed (claim vs provided)', owner: 'Admin', priority: 'standard' },
    { text: 'Fuel card / petty cash process confirmed for site', owner: 'Admin', priority: 'optional' },
  ]},
  { name: 'Subcontractors', items: [
    { text: 'All subcontractors identified and engaged', owner: 'PM', priority: 'critical' },
    { text: 'Subcontractor contracts executed', owner: 'PM', priority: 'critical' },
    { text: 'Subcontractor insurance certificates on file', owner: 'PM', priority: 'critical' },
    { text: 'Subcontractor HSE prequalification approved by client', owner: 'PM', priority: 'critical' },
    { text: 'Subcontractor inductions submitted to site', owner: 'Admin', priority: 'critical' },
    { text: 'Subcontractor RFQs issued and responses received', owner: 'PM', priority: 'standard' },
    { text: 'Subcontractor scope and deliverables agreed in writing', owner: 'PM', priority: 'standard' },
    { text: 'Scaffolding contractor engaged and schedule confirmed', owner: 'PM', priority: 'standard' },
    { text: 'NDT subcontractor confirmed with method approval', owner: 'Engineer', priority: 'standard' },
    { text: 'Crane / rigging subcontractor confirmed', owner: 'PM', priority: 'standard' },
    { text: 'Subcontractor payment terms and invoice process briefed', owner: 'PM', priority: 'standard' },
  ]},
  { name: 'Client & Stakeholder', items: [
    { text: 'Client kickoff meeting scheduled and held', owner: 'PM', priority: 'critical' },
    { text: 'Unit shutdown timeline confirmed and agreed in writing', owner: 'PM', priority: 'critical' },
    { text: 'Client QA representative identified', owner: 'PM', priority: 'standard' },
    { text: 'Client operations representative (unit owner) confirmed', owner: 'PM', priority: 'standard' },
    { text: 'Client HSE site rules received and distributed to crew', owner: 'PM', priority: 'standard' },
    { text: 'Client permit-to-work system briefing held', owner: 'PM', priority: 'standard' },
    { text: 'Client decision authority for scope changes confirmed', owner: 'PM', priority: 'standard' },
    { text: 'Escalation path agreed (site level → management level)', owner: 'PM', priority: 'standard' },
    { text: 'SE management briefed on project risks', owner: 'PM', priority: 'standard' },
  ]},
  { name: 'IT & Admin Setup', items: [
    { text: 'Project code active in cost management system', owner: 'Admin', priority: 'critical' },
    { text: 'Timesheet templates set up and distributed', owner: 'Admin', priority: 'standard' },
    { text: 'Weekly reporting cadence agreed with client', owner: 'PM', priority: 'standard' },
    { text: 'Daily / weekly report template prepared', owner: 'Admin', priority: 'standard' },
    { text: 'Crew added to project roster in system', owner: 'Admin', priority: 'standard' },
    { text: 'Photo / documentation process briefed to crew', owner: 'Supervisor', priority: 'optional' },
    { text: 'Cloud file storage / share location set up for project', owner: 'Admin', priority: 'optional' },
    { text: 'Customer portal access granted (if applicable)', owner: 'Admin', priority: 'optional' },
  ]},
]

// ─── UI Config ────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending:     { label: 'Pending',     bg: 'var(--bg3)', color: 'var(--text3)', icon: '○' },
  in_progress: { label: 'In Progress', bg: '#fef3c7',    color: '#92400e',     icon: '◑' },
  complete:    { label: 'Complete',    bg: '#d1fae5',    color: '#065f46',     icon: '●' },
  na:          { label: 'N/A',         bg: 'var(--bg2)', color: 'var(--text3)', icon: '–' },
} as const

const PRIORITY_CONFIG = {
  critical: { label: 'Critical', color: '#dc2626', bg: '#fee2e2', dot: '●', border: '#dc2626' },
  standard: { label: 'Standard', color: 'var(--accent)', bg: 'var(--bg3)', dot: '●', border: 'var(--accent)' },
  optional: { label: 'Optional', color: 'var(--text3)', bg: 'var(--bg2)', dot: '●', border: 'var(--border2)' },
} as const

const SMART_STYLE = {
  ok:    { color: '#065f46', bg: '#d1fae5', icon: '✓' },
  warn:  { color: '#92400e', bg: '#fef3c7', icon: '!' },
  error: { color: '#991b1b', bg: '#fee2e2', icon: '✕' },
  info:  { color: 'var(--text3)', bg: 'var(--bg3)', icon: 'i' },
} as const

const STATUS_ORDER: ChecklistItem['status'][]   = ['pending', 'in_progress', 'complete', 'na']
const PRIORITY_ORDER: ChecklistItem['priority'][] = ['critical', 'standard', 'optional']

// ─── Component ────────────────────────────────────────────────────────────────

export function PrePlanningPanel() {
  const { activeProject } = useAppStore()

  const [items, setItems]                     = useState<ChecklistItem[]>([])
  const [loading, setLoading]                 = useState(true)
  const [saving, setSaving]                   = useState<string | null>(null)
  const [editingId, setEditingId]             = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId]     = useState<string | null>(null)
  const [smartCtx, setSmartCtx]               = useState<SmartContext | null>(null)
  const [smartLoading, setSmartLoading]       = useState(false)
  const [showPicker, setShowPicker]           = useState(false)
  const [pickerSearch, setPickerSearch]       = useState('')
  const [pickerFilter, setPickerFilter]       = useState<'all' | 'critical' | 'intl'>('all')
  const [selected, setSelected]               = useState<Set<string>>(new Set())
  const [viewFilter, setViewFilter]           = useState<'all' | 'critical' | 'incomplete'>('all')

  useEffect(() => {
    if (activeProject) { load(); loadSmartContext() }
  }, [activeProject?.id])

  // ─── Loaders ────────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('pre_planning').select('*')
      .eq('project_id', activeProject!.id)
      .order('category').order('created_at')
    setItems((data ?? []) as ChecklistItem[])
    setLoading(false)
  }

  async function loadSmartContext() {
    if (!activeProject) return
    setSmartLoading(true)
    const pid = activeProject.id
    const [resData, subconData, poData, varData, woData, tvData, accomData, carData, projData] = await Promise.all([
      supabase.from('resources').select('id,name,category,rate_card_id,mob_in,mob_out').eq('project_id', pid),
      supabase.from('subcon_contracts').select('id,vendor,linked_po_id').eq('project_id', pid).eq('awarded', true),
      supabase.from('purchase_orders').select('id,vendor,status').eq('project_id', pid),
      supabase.from('variations').select('id,number,title,status').eq('project_id', pid),
      supabase.from('work_orders').select('id,wo_number,status').eq('project_id', pid),
      supabase.from('tooling_costings').select('id,tv_no,import_cost_eur,charge_start').eq('project_id', pid),
      supabase.from('accommodation').select('check_in,check_out').eq('project_id', pid),
      supabase.from('cars').select('person_id,start_date,end_date').eq('project_id', pid),
      supabase.from('projects').select('induction_data').eq('id', pid).single(),
    ])
    const resources = (resData.data ?? []) as SmartContext['resources']
    const inductionData = ((projData.data?.induction_data ?? []) as { name: string }[])
    setSmartCtx({
      resources,
      seagResources: resources.filter(r => r.category === 'seag'),
      subconVendors: (subconData.data ?? []) as SmartContext['subconVendors'],
      pos: (poData.data ?? []) as SmartContext['pos'],
      variations: (varData.data ?? []) as SmartContext['variations'],
      workOrders: (woData.data ?? []) as SmartContext['workOrders'],
      tvCostings: (tvData.data ?? []) as SmartContext['tvCostings'],
      inductionNames: inductionData.map(p => p.name),
      accomBookings: (accomData.data ?? []) as SmartContext['accomBookings'],
      cars: (carData.data ?? []) as SmartContext['cars'],
    })
    setSmartLoading(false)
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  async function ensureSaved(item: ChecklistItem): Promise<string> {
    if (!item.id.startsWith('temp-')) return item.id
    const { data, error } = await supabase.from('pre_planning').insert({
      project_id: activeProject!.id,
      category: item.category, item: item.item, owner: item.owner,
      due_date: item.due_date || null, status: item.status, notes: item.notes,
      priority: item.priority, is_international: item.is_international, smart_key: item.smart_key,
    }).select('id').single()
    if (error) throw error
    return (data as { id: string }).id
  }

  async function updateField(item: ChecklistItem, field: keyof ChecklistItem, value: string | boolean) {
    setSaving(item.id)
    try {
      const realId = await ensureSaved(item)
      await supabase.from('pre_planning').update({ [field]: value }).eq('id', realId)
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, id: realId, [field]: value } : i))
    } catch (e) { toast((e as Error).message, 'error') }
    setSaving(null)
  }

  async function cycleStatus(item: ChecklistItem) {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(item.status) + 1) % STATUS_ORDER.length]
    await updateField(item, 'status', next)
  }

  async function cyclePriority(item: ChecklistItem) {
    const cur = item.priority ?? 'standard'
    const next = PRIORITY_ORDER[(PRIORITY_ORDER.indexOf(cur) + 1) % PRIORITY_ORDER.length]
    await updateField(item, 'priority', next)
  }

  async function deleteItem(item: ChecklistItem) {
    if (!item.id.startsWith('temp-')) await supabase.from('pre_planning').delete().eq('id', item.id)
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  async function addBlankItem() {
    const newItem: ChecklistItem = {
      id: `temp-${Date.now()}`, category: 'Custom', item: 'New checklist item',
      owner: '', due_date: '', status: 'pending', notes: '',
      priority: 'standard', is_international: false, smart_key: null,
    }
    setItems(prev => [...prev, newItem])
    setEditingId(newItem.id)
  }

  // ─── Picker ─────────────────────────────────────────────────────────────────

  const existingTexts = useMemo(() => new Set(items.map(i => i.item)), [items])

  // ─── Templates ──────────────────────────────────────────────────────────────
  // Each template is a Set of "Category||Item text" keys that maps to a curated
  // starting point. Users can then add/remove freely from there.

  const TEMPLATES: Record<string, { label: string; description: string; icon: string; keys: string[] }> = {
    domestic_major: {
      label: 'Domestic Major Overhaul',
      description: 'ST or GT major — domestic crew, Kollos shipped locally',
      icon: '🏭',
      keys: [
        // Commercial
        'Commercial & Contract||Contract signed and fully executed',
        'Commercial & Contract||Scope freeze confirmed in writing with client',
        'Commercial & Contract||Scope of work document issued to team',
        'Commercial & Contract||PM100 budget approved',
        'Commercial & Contract||SE insurance and contractor registration current',
        'Commercial & Contract||Variation / scope change process agreed with client',
        'Commercial & Contract||Variation notices submitted and approved',
        'Commercial & Contract||Customer cost report issued',
        'Commercial & Contract||Client representative / point of contact confirmed',
        // POs
        'Procurement & Purchase Orders||Purchase orders raised for all subcontractors',
        'Procurement & Purchase Orders||All POs approved or active (none in draft)',
        'Procurement & Purchase Orders||SAP cost codes active and confirmed',
        'Procurement & Purchase Orders||WBS structure aligned to SAP / MIKA',
        'Procurement & Purchase Orders||PO for accommodation confirmed',
        'Procurement & Purchase Orders||PO for car hire confirmed',
        'Procurement & Purchase Orders||Subcontractor rate cards loaded in system',
        // Crew
        'Crew & Resourcing||All crew confirmed and on roster',
        'Crew & Resourcing||Supervision ratio adequate for scope',
        'Crew & Resourcing||Day/night shift roster finalised',
        'Crew & Resourcing||Crew acceptance / offer letters signed',
        'Crew & Resourcing||LAHA / allowance settings confirmed',
        'Crew & Resourcing||Payroll regime confirmed per person (trades / mgmt / subcon)',
        'Crew & Resourcing||First shift briefing time and location confirmed',
        'Crew & Resourcing||Crew contact list and emergency contacts compiled',
        // Tooling
        'Tooling & Equipment||WOSIT / TV export received from Kanlog',
        'Tooling & Equipment||TV charge dates and costings entered',
        'Tooling & Equipment||Kollo manifest reviewed',
        'Tooling & Equipment||All tooling inspected and functional-tested pre-ship',
        'Tooling & Equipment||Torque tools calibrated and certs current',
        'Tooling & Equipment||Alignment kit checked and complete',
        'Tooling & Equipment||Jacking and lifting equipment certified',
        'Tooling & Equipment||NDT equipment calibrated',
        'Tooling & Equipment||PPE quantities checked vs crew headcount',
        'Tooling & Equipment||Consumables list confirmed (gaskets, fasteners, seals)',
        'Tooling & Equipment||Packing list complete and matched to manifest',
        // Shipping (domestic)
        'Shipping & Customs||SLI documents generated',
        'Shipping & Customs||DG (Dangerous Goods) declaration completed',
        'Shipping & Customs||Freight forwarder engaged and briefed',
        'Shipping & Customs||Shipping method confirmed (air / sea / road)',
        'Shipping & Customs||Expected arrival window confirmed vs outage start',
        'Shipping & Customs||Tracking / AWB numbers distributed to team',
        'Shipping & Customs||Site unloading / materials receiving contact confirmed',
        'Shipping & Customs||Contingency plan if tooling delayed (air freight escalation)',
        // Parts
        'Spare Parts & Hardware||Parts list finalised against scope',
        'Spare Parts & Hardware||OEM parts vs non-OEM decision documented',
        'Spare Parts & Hardware||Parts on order and confirmed with ETA',
        'Spare Parts & Hardware||Long-lead items identified and expedited',
        'Spare Parts & Hardware||Parts received and inspected at warehouse',
        'Spare Parts & Hardware||Certificate of conformance / traceability docs on file',
        'Spare Parts & Hardware||Balance weights / special hardware approved',
        'Spare Parts & Hardware||Rotor blade parts kitted and labelled by stage',
        'Spare Parts & Hardware||Seals and gaskets matched to as-built drawings',
        'Spare Parts & Hardware||Consumable hardware quantities confirmed (bolts, pins, lockwire)',
        // HSE
        'HSE & Compliance||SWMS / JSAs prepared',
        'HSE & Compliance||SWMS submitted to and approved by client',
        'HSE & Compliance||Site inductions completed by each crew member',
        'HSE & Compliance||Permit to work types identified (HV isolation, confined space, hot work, heights)',
        'HSE & Compliance||HV / LV isolation competency confirmed for crew',
        'HSE & Compliance||Confined space entry requirements confirmed',
        'HSE & Compliance||Emergency evacuation plan obtained from site',
        'HSE & Compliance||First aid officer on crew confirmed',
        'HSE & Compliance||Nearest hospital / medical facility confirmed',
        'HSE & Compliance||Crew fatigue management plan in place',
        'HSE & Compliance||Incident reporting process briefed',
        // Technical
        'Technical Readiness||Work orders created and assigned',
        'Technical Readiness||Inspection and Test Plan (ITP) prepared',
        'Technical Readiness||Maintenance procedures / work instructions issued',
        'Technical Readiness||Hold points and witness points confirmed with client QA',
        'Technical Readiness||As-built drawings available on site',
        'Technical Readiness||Alignment records from previous outage reviewed',
        'Technical Readiness||Test equipment calibration current',
        'Technical Readiness||As-found data sheets prepared (blank, ready to fill)',
        'Technical Readiness||Rotor dynamics / balance criteria confirmed',
        'Technical Readiness||OEM technical bulletins / service notices reviewed',
        'Technical Readiness||Hydraulic torquing requirements and sequence confirmed',
        'Technical Readiness||Non-conformance report (NCR) process briefed',
        // Site
        'Site Readiness||Unit isolation / shutdown confirmed by operations',
        'Site Readiness||Clearance / zero energy state confirmed',
        'Site Readiness||Site access approved for all crew',
        'Site Readiness||Crane / overhead lifting equipment booked',
        'Site Readiness||Crane operator certified and confirmed',
        'Site Readiness||Scaffolding erected and certified before crew arrival',
        'Site Readiness||Lifting plan reviewed and approved',
        'Site Readiness||Laydown / work area allocated and confirmed',
        'Site Readiness||LOTO hardware available on site',
        'Site Readiness||Temporary power / compressed air available',
        'Site Readiness||Lighting for night shift adequate',
        'Site Readiness||Toolbox talk agenda prepared',
        // Accom
        'Accommodation & Travel||Accommodation booked',
        'Accommodation & Travel||Accommodation booking confirmation on file',
        'Accommodation & Travel||Car hire booked',
        'Accommodation & Travel||Car hire confirmation and pickup details confirmed',
        'Accommodation & Travel||Domestic flights booked',
        'Accommodation & Travel||Crew aware of full travel itinerary',
        // Subcon
        'Subcontractors||All subcontractors identified and engaged',
        'Subcontractors||Subcontractor contracts executed',
        'Subcontractors||Subcontractor insurance certificates on file',
        'Subcontractors||Subcontractor HSE prequalification approved by client',
        'Subcontractors||Subcontractor inductions submitted to site',
        'Subcontractors||Scaffolding contractor engaged and schedule confirmed',
        'Subcontractors||NDT subcontractor confirmed with method approval',
        'Subcontractors||Crane / rigging subcontractor confirmed',
        // Client
        'Client & Stakeholder||Client kickoff meeting scheduled and held',
        'Client & Stakeholder||Unit shutdown timeline confirmed and agreed in writing',
        'Client & Stakeholder||Client QA representative identified',
        'Client & Stakeholder||Client operations representative (unit owner) confirmed',
        'Client & Stakeholder||Client HSE site rules received and distributed to crew',
        'Client & Stakeholder||Client permit-to-work system briefing held',
        'Client & Stakeholder||Escalation path agreed (site level → management level)',
        // Admin
        'IT & Admin Setup||Project code active in cost management system',
        'IT & Admin Setup||Timesheet templates set up and distributed',
        'IT & Admin Setup||Weekly reporting cadence agreed with client',
        'IT & Admin Setup||Crew added to project roster in system',
      ],
    },

    international: {
      label: 'International Outage',
      description: 'SE AG crew, Kollos shipping overseas — full customs, visas, ATA Carnet',
      icon: '✈️',
      keys: [
        // Commercial — full set
        'Commercial & Contract||Contract signed and fully executed',
        'Commercial & Contract||Scope freeze confirmed in writing with client',
        'Commercial & Contract||Scope of work document issued to team',
        'Commercial & Contract||PM100 budget approved',
        'Commercial & Contract||SE insurance and contractor registration current',
        'Commercial & Contract||Variation / scope change process agreed with client',
        'Commercial & Contract||Variation notices submitted and approved',
        'Commercial & Contract||Revenue recognition milestones confirmed',
        'Commercial & Contract||Billing schedule agreed (milestone vs T&M)',
        'Commercial & Contract||Customer cost report format agreed',
        'Commercial & Contract||Customer cost report issued',
        'Commercial & Contract||Client representative / point of contact confirmed',
        'Commercial & Contract||NDA / confidentiality obligations checked',
        // POs — full set
        'Procurement & Purchase Orders||Purchase orders raised for all subcontractors',
        'Procurement & Purchase Orders||All POs approved or active (none in draft)',
        'Procurement & Purchase Orders||SAP cost codes active and confirmed',
        'Procurement & Purchase Orders||WBS structure aligned to SAP / MIKA',
        'Procurement & Purchase Orders||PO numbers communicated to all vendors',
        'Procurement & Purchase Orders||PO for accommodation confirmed',
        'Procurement & Purchase Orders||PO for car hire confirmed',
        'Procurement & Purchase Orders||PO for freight / logistics confirmed',
        'Procurement & Purchase Orders||Subcontractor rate cards loaded in system',
        // Crew
        'Crew & Resourcing||All crew confirmed and on roster',
        'Crew & Resourcing||Supervision ratio adequate for scope',
        'Crew & Resourcing||Day/night shift roster finalised',
        'Crew & Resourcing||Crew acceptance / offer letters signed',
        'Crew & Resourcing||LAHA / allowance settings confirmed',
        'Crew & Resourcing||Payroll regime confirmed per person (trades / mgmt / subcon)',
        'Crew & Resourcing||Technical advisor role and authority defined',
        'Crew & Resourcing||First shift briefing time and location confirmed',
        'Crew & Resourcing||Crew contact list and emergency contacts compiled',
        // International — full set
        'International Mobilisation||SE AG (European) crew visas / work permits confirmed',
        'International Mobilisation||Passports valid (>6 months beyond outage end)',
        'International Mobilisation||Visa approval confirmed before flights booked',
        'International Mobilisation||Work permits / work authorisation obtained',
        'International Mobilisation||Flights booked (international legs)',
        'International Mobilisation||Connecting domestic flights booked',
        'International Mobilisation||Arrival / departure transfers arranged',
        'International Mobilisation||Travel insurance confirmed (medical, evacuation)',
        'International Mobilisation||International SIM cards / roaming plans arranged',
        'International Mobilisation||Per diem / foreign currency arranged',
        'International Mobilisation||Medical clearance for international crew',
        'International Mobilisation||Vaccination requirements checked and met',
        'International Mobilisation||Emergency contact protocol for overseas crew briefed',
        'International Mobilisation||Local emergency numbers and hospital identified',
        // Tooling
        'Tooling & Equipment||WOSIT / TV export received from Kanlog',
        'Tooling & Equipment||TV charge dates and costings entered',
        'Tooling & Equipment||Kollo manifest reviewed',
        'Tooling & Equipment||All tooling inspected and functional-tested pre-ship',
        'Tooling & Equipment||Torque tools calibrated and certs current',
        'Tooling & Equipment||Alignment kit checked and complete',
        'Tooling & Equipment||Jacking and lifting equipment certified',
        'Tooling & Equipment||NDT equipment calibrated',
        'Tooling & Equipment||PPE quantities checked vs crew headcount',
        'Tooling & Equipment||Packing list complete and matched to manifest',
        'Tooling & Equipment||Serial / asset numbers recorded pre-despatch',
        'Tooling & Equipment||Tooling insurance / ATA Carnet arranged',
        // Shipping & Customs — full intl set
        'Shipping & Customs||SLI documents generated',
        'Shipping & Customs||DG (Dangerous Goods) declaration completed',
        'Shipping & Customs||Freight forwarder engaged and briefed',
        'Shipping & Customs||Shipping method confirmed (air / sea / road)',
        'Shipping & Customs||Expected arrival window confirmed vs outage start',
        'Shipping & Customs||Tracking / AWB numbers distributed to team',
        'Shipping & Customs||Site unloading / materials receiving contact confirmed',
        'Shipping & Customs||Contingency plan if tooling delayed (air freight escalation)',
        'Shipping & Customs||Customs import clearance organised for tooling vehicles',
        'Shipping & Customs||Export clearance obtained (origin country)',
        'Shipping & Customs||HS codes confirmed for all tooling and parts',
        'Shipping & Customs||ATA Carnet prepared for temporary import of tools',
        'Shipping & Customs||Customs broker engaged at destination port',
        'Shipping & Customs||Estimated duty / import taxes budgeted',
        // Parts
        'Spare Parts & Hardware||Parts list finalised against scope',
        'Spare Parts & Hardware||OEM parts vs non-OEM decision documented',
        'Spare Parts & Hardware||Parts on order and confirmed with ETA',
        'Spare Parts & Hardware||Long-lead items identified and expedited',
        'Spare Parts & Hardware||Parts received and inspected at warehouse',
        'Spare Parts & Hardware||Certificate of conformance / traceability docs on file',
        'Spare Parts & Hardware||Balance weights / special hardware approved',
        'Spare Parts & Hardware||Hardware shipped and tracking confirmed',
        // HSE
        'HSE & Compliance||SWMS / JSAs prepared',
        'HSE & Compliance||SWMS submitted to and approved by client',
        'HSE & Compliance||Site inductions completed by each crew member',
        'HSE & Compliance||Permit to work types identified (HV isolation, confined space, hot work, heights)',
        'HSE & Compliance||HV / LV isolation competency confirmed for crew',
        'HSE & Compliance||Emergency evacuation plan obtained from site',
        'HSE & Compliance||First aid officer on crew confirmed',
        'HSE & Compliance||Nearest hospital / medical facility confirmed',
        'HSE & Compliance||Crew fatigue management plan in place',
        'HSE & Compliance||Incident reporting process briefed',
        // Technical
        'Technical Readiness||Work orders created and assigned',
        'Technical Readiness||Inspection and Test Plan (ITP) prepared',
        'Technical Readiness||Maintenance procedures / work instructions issued',
        'Technical Readiness||Hold points and witness points confirmed with client QA',
        'Technical Readiness||As-built drawings available on site',
        'Technical Readiness||Alignment records from previous outage reviewed',
        'Technical Readiness||Test equipment calibration current',
        'Technical Readiness||As-found data sheets prepared (blank, ready to fill)',
        'Technical Readiness||OEM technical bulletins / service notices reviewed',
        'Technical Readiness||Non-conformance report (NCR) process briefed',
        'Technical Readiness||Hydraulic torquing requirements and sequence confirmed',
        // Site
        'Site Readiness||Unit isolation / shutdown confirmed by operations',
        'Site Readiness||Clearance / zero energy state confirmed',
        'Site Readiness||Site access approved for all crew',
        'Site Readiness||Crane / overhead lifting equipment booked',
        'Site Readiness||Crane operator certified and confirmed',
        'Site Readiness||Scaffolding erected and certified before crew arrival',
        'Site Readiness||Lifting plan reviewed and approved',
        'Site Readiness||Laydown / work area allocated and confirmed',
        'Site Readiness||LOTO hardware available on site',
        'Site Readiness||Toolbox talk agenda prepared',
        // Accom
        'Accommodation & Travel||Accommodation booked',
        'Accommodation & Travel||Accommodation booking confirmation on file',
        'Accommodation & Travel||Car hire booked',
        'Accommodation & Travel||Car hire confirmation and pickup details confirmed',
        'Accommodation & Travel||Domestic flights booked',
        'Accommodation & Travel||Crew aware of full travel itinerary',
        'Accommodation & Travel||Meal allowance process confirmed (claim vs provided)',
        // Subcon
        'Subcontractors||All subcontractors identified and engaged',
        'Subcontractors||Subcontractor contracts executed',
        'Subcontractors||Subcontractor insurance certificates on file',
        'Subcontractors||Subcontractor HSE prequalification approved by client',
        'Subcontractors||Subcontractor inductions submitted to site',
        'Subcontractors||Subcontractor scope and deliverables agreed in writing',
        // Client
        'Client & Stakeholder||Client kickoff meeting scheduled and held',
        'Client & Stakeholder||Unit shutdown timeline confirmed and agreed in writing',
        'Client & Stakeholder||Client QA representative identified',
        'Client & Stakeholder||Client operations representative (unit owner) confirmed',
        'Client & Stakeholder||Client HSE site rules received and distributed to crew',
        'Client & Stakeholder||Client permit-to-work system briefing held',
        'Client & Stakeholder||Client decision authority for scope changes confirmed',
        'Client & Stakeholder||Escalation path agreed (site level → management level)',
        'Client & Stakeholder||SE management briefed on project risks',
        // Admin
        'IT & Admin Setup||Project code active in cost management system',
        'IT & Admin Setup||Timesheet templates set up and distributed',
        'IT & Admin Setup||Weekly reporting cadence agreed with client',
        'IT & Admin Setup||Crew added to project roster in system',
      ],
    },

    valve_minor: {
      label: 'Valve / Minor Outage',
      description: 'Valve overhaul or short-scope minor — lighter crew, no heavy rotor work',
      icon: '🔧',
      keys: [
        // Commercial
        'Commercial & Contract||Contract signed and fully executed',
        'Commercial & Contract||Scope of work document issued to team',
        'Commercial & Contract||PM100 budget approved',
        'Commercial & Contract||SE insurance and contractor registration current',
        'Commercial & Contract||Variation notices submitted and approved',
        'Commercial & Contract||Customer cost report issued',
        'Commercial & Contract||Client representative / point of contact confirmed',
        // POs
        'Procurement & Purchase Orders||Purchase orders raised for all subcontractors',
        'Procurement & Purchase Orders||All POs approved or active (none in draft)',
        'Procurement & Purchase Orders||SAP cost codes active and confirmed',
        'Procurement & Purchase Orders||PO for accommodation confirmed',
        'Procurement & Purchase Orders||PO for car hire confirmed',
        // Crew
        'Crew & Resourcing||All crew confirmed and on roster',
        'Crew & Resourcing||Day/night shift roster finalised',
        'Crew & Resourcing||LAHA / allowance settings confirmed',
        'Crew & Resourcing||Payroll regime confirmed per person (trades / mgmt / subcon)',
        'Crew & Resourcing||First shift briefing time and location confirmed',
        'Crew & Resourcing||Crew contact list and emergency contacts compiled',
        // Tooling — lighter
        'Tooling & Equipment||WOSIT / TV export received from Kanlog',
        'Tooling & Equipment||TV charge dates and costings entered',
        'Tooling & Equipment||All tooling inspected and functional-tested pre-ship',
        'Tooling & Equipment||Torque tools calibrated and certs current',
        'Tooling & Equipment||PPE quantities checked vs crew headcount',
        'Tooling & Equipment||Consumables list confirmed (gaskets, fasteners, seals)',
        // Shipping — domestic only
        'Shipping & Customs||SLI documents generated',
        'Shipping & Customs||Freight forwarder engaged and briefed',
        'Shipping & Customs||Expected arrival window confirmed vs outage start',
        // Parts — focused on valve hardware
        'Spare Parts & Hardware||Parts list finalised against scope',
        'Spare Parts & Hardware||OEM parts vs non-OEM decision documented',
        'Spare Parts & Hardware||Parts on order and confirmed with ETA',
        'Spare Parts & Hardware||Parts received and inspected at warehouse',
        'Spare Parts & Hardware||Certificate of conformance / traceability docs on file',
        'Spare Parts & Hardware||Seals and gaskets matched to as-built drawings',
        'Spare Parts & Hardware||Consumable hardware quantities confirmed (bolts, pins, lockwire)',
        // HSE
        'HSE & Compliance||SWMS / JSAs prepared',
        'HSE & Compliance||SWMS submitted to and approved by client',
        'HSE & Compliance||Site inductions completed by each crew member',
        'HSE & Compliance||Permit to work types identified (HV isolation, confined space, hot work, heights)',
        'HSE & Compliance||HV / LV isolation competency confirmed for crew',
        'HSE & Compliance||First aid officer on crew confirmed',
        'HSE & Compliance||Incident reporting process briefed',
        // Technical — no rotor dynamics, no balance
        'Technical Readiness||Work orders created and assigned',
        'Technical Readiness||Maintenance procedures / work instructions issued',
        'Technical Readiness||Hold points and witness points confirmed with client QA',
        'Technical Readiness||As-built drawings available on site',
        'Technical Readiness||Test equipment calibration current',
        'Technical Readiness||As-found data sheets prepared (blank, ready to fill)',
        'Technical Readiness||OEM technical bulletins / service notices reviewed',
        // Site
        'Site Readiness||Unit isolation / shutdown confirmed by operations',
        'Site Readiness||Clearance / zero energy state confirmed',
        'Site Readiness||Site access approved for all crew',
        'Site Readiness||LOTO hardware available on site',
        'Site Readiness||Toolbox talk agenda prepared',
        // Accom
        'Accommodation & Travel||Accommodation booked',
        'Accommodation & Travel||Car hire booked',
        'Accommodation & Travel||Domestic flights booked',
        // Client
        'Client & Stakeholder||Client kickoff meeting scheduled and held',
        'Client & Stakeholder||Unit shutdown timeline confirmed and agreed in writing',
        'Client & Stakeholder||Client HSE site rules received and distributed to crew',
        'Client & Stakeholder||Client permit-to-work system briefing held',
        // Admin
        'IT & Admin Setup||Project code active in cost management system',
        'IT & Admin Setup||Timesheet templates set up and distributed',
        'IT & Admin Setup||Crew added to project roster in system',
      ],
    },
  }

  function applyTemplate(templateKey: string) {
    const tmpl = TEMPLATES[templateKey]
    if (!tmpl) return
    const newSelection = new Set<string>()
    for (const key of tmpl.keys) {
      if (!existingTexts.has(key.split('||')[1])) {
        newSelection.add(key)
      }
    }
    setSelected(newSelection)
  }

  const existingTexts = useMemo(() => new Set(items.map(i => i.item)), [items])

  const filteredLibrary = useMemo(() => ITEM_LIBRARY.map(cat => ({
    ...cat,
    items: cat.items.filter(li => {
      const matchSearch = !pickerSearch || li.text.toLowerCase().includes(pickerSearch.toLowerCase())
      const matchFilter = pickerFilter === 'all' ? true : pickerFilter === 'critical' ? li.priority === 'critical' : !!li.isIntl
      return matchSearch && matchFilter
    }),
  })).filter(cat => cat.items.length > 0), [pickerSearch, pickerFilter])

  const toggleSelected = useCallback((key: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }, [])

  async function addSelectedItems() {
    const toAdd: ChecklistItem[] = []
    for (const cat of ITEM_LIBRARY) {
      for (const li of cat.items) {
        const key = `${cat.name}||${li.text}`
        if (!selected.has(key) || existingTexts.has(li.text)) continue
        toAdd.push({
          id: `temp-${Date.now()}-${Math.random()}`,
          category: cat.name, item: li.text, owner: li.owner,
          due_date: '', status: 'pending', notes: '',
          priority: li.priority, is_international: !!li.isIntl, smart_key: li.smartKey ?? null,
        })
      }
    }
    if (toAdd.length === 0) { setShowPicker(false); return }
    setSaving('bulk')
    try {
      const rows = toAdd.map(i => ({
        project_id: activeProject!.id,
        category: i.category, item: i.item, owner: i.owner,
        due_date: null, status: i.status, notes: i.notes,
        priority: i.priority, is_international: i.is_international, smart_key: i.smart_key,
      }))
      const { data, error } = await supabase.from('pre_planning').insert(rows).select('id')
      if (error) throw error
      const ids = (data as { id: string }[]).map(d => d.id)
      const saved = toAdd.map((item, idx) => ({ ...item, id: ids[idx] }))
      setItems(prev => [...prev, ...saved])
      toast(`Added ${saved.length} item(s)`, 'success')
    } catch (e) { toast((e as Error).message, 'error') }
    setSaving(null)
    setSelected(new Set())
    setShowPicker(false)
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const visibleItems = useMemo(() => items.filter(item => {
    if (viewFilter === 'critical') return item.priority === 'critical'
    if (viewFilter === 'incomplete') return item.status !== 'complete' && item.status !== 'na'
    return true
  }), [items, viewFilter])

  const categories = useMemo(() => [...new Set(visibleItems.map(i => i.category))], [visibleItems])
  const complete = items.filter(i => i.status === 'complete' || i.status === 'na').length
  const criticalIncomplete = items.filter(i => i.priority === 'critical' && i.status !== 'complete' && i.status !== 'na').length
  const pct = items.length > 0 ? Math.round(complete / items.length * 100) : 0

  // ─── Smart badge ──────────────────────────────────────────────────────────────

  function SmartBadge({ item }: { item: ChecklistItem }) {
    if (!item.smart_key || !smartCtx) return null
    const evaluator = SMART_EVALUATORS[item.smart_key]
    if (!evaluator) return null
    const result = evaluator(smartCtx)
    const s = SMART_STYLE[result.status]
    return (
      <div style={{ marginTop: '6px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'flex-start', gap: '6px',
          background: s.bg, color: s.color, borderRadius: '4px', padding: '4px 8px',
          fontSize: '11px', lineHeight: 1.4, maxWidth: '100%',
        }}>
          <span style={{ fontWeight: 700, flexShrink: 0 }}>{s.icon}</span>
          <div>
            <span style={{ fontWeight: 600 }}>{result.summary}</span>
            {result.detail.length > 0 && (
              <span style={{ marginLeft: '6px', opacity: 0.8 }}>
                — {result.detail.slice(0, 4).join(', ')}
                {result.detail.length > 4 ? ` +${result.detail.length - 4} more` : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px', maxWidth: '960px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700 }}>Pre-Outage Planning</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
            {complete}/{items.length} items complete · {pct}% ready
            {criticalIncomplete > 0 && <span style={{ color: '#dc2626', marginLeft: '10px' }}>· {criticalIncomplete} critical outstanding</span>}
            {smartLoading && <span style={{ marginLeft: '10px', color: 'var(--text3)' }}>⟳ refreshing live data…</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => loadSmartContext()} disabled={smartLoading}>↻ Refresh data</button>
          <button className="btn btn-sm" onClick={addBlankItem}>+ Custom item</button>
          <button className="btn btn-primary" onClick={() => { setShowPicker(true); setSelected(new Set()) }}>+ Add from Library</button>
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
          <span style={{ fontWeight: 600 }}>Overall Readiness</span>
          <span style={{ fontFamily: 'var(--mono)', color: pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)' }}>{pct}%</span>
        </div>
        <div style={{ background: 'var(--border2)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--amber)' : 'var(--red)', borderRadius: '4px', transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '11px', color: 'var(--text3)', flexWrap: 'wrap' }}>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => {
            const count = items.filter(i => i.status === k).length
            return count > 0 ? <span key={k}><span style={{ color: v.color, fontWeight: 600 }}>{v.icon} {count}</span> {v.label}</span> : null
          })}
        </div>
      </div>

      {/* ── View filter pills ── */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {(['all', 'critical', 'incomplete'] as const).map(f => (
          <button key={f} onClick={() => setViewFilter(f)} style={{
            fontSize: '12px', padding: '4px 12px', borderRadius: '999px',
            border: '1px solid var(--border2)', cursor: 'pointer',
            background: viewFilter === f ? 'var(--accent)' : 'transparent',
            color: viewFilter === f ? '#fff' : 'var(--text2)',
          }}>
            {f === 'all' ? 'All items' : f === 'critical' ? '🔴 Critical only' : '○ Incomplete'}
          </button>
        ))}
      </div>

      {/* ── Checklist ── */}
      {loading
        ? <div className="loading-center"><span className="spinner" /></div>
        : items.length === 0
          ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text3)' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>📋</div>
              <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>No items yet</div>
              <div style={{ fontSize: '12px', marginBottom: '20px' }}>Build your checklist from the library or add a custom item</div>
              <button className="btn btn-primary" onClick={() => setShowPicker(true)}>+ Add from Library</button>
            </div>
          )
          : categories.map(cat => {
            const catItems = visibleItems.filter(i => i.category === cat)
            const catDone = catItems.filter(i => i.status === 'complete' || i.status === 'na').length
            return (
              <div key={cat} style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 700, fontSize: '11px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{cat}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{catDone}/{catItems.length}</div>
                  <div style={{ flex: 1, height: '3px', background: 'var(--border2)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (catItems.length > 0 ? catDone / catItems.length * 100 : 0) + '%', background: 'var(--accent)', borderRadius: '2px' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {catItems.map(item => {
                    const sc = STATUS_CONFIG[item.status]
                    const pc = PRIORITY_CONFIG[item.priority ?? 'standard']
                    const isEditing = editingId === item.id
                    const isEditingNote = editingNoteId === item.id
                    return (
                      <div key={item.id} className="card" style={{
                        padding: '10px 12px',
                        borderLeft: `3px solid ${pc.border}`,
                        opacity: item.status === 'na' ? 0.5 : 1,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {/* Status */}
                          <button style={{
                            background: sc.bg, color: sc.color, border: 'none', borderRadius: '4px',
                            padding: '3px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                            minWidth: '88px', textAlign: 'center', flexShrink: 0,
                          }} onClick={() => cycleStatus(item)}>
                            {sc.icon} {sc.label}
                          </button>

                          {/* Priority dot */}
                          <button title={`Priority: ${pc.label} — click to change`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0, color: pc.color, fontSize: '10px' }}
                            onClick={() => cyclePriority(item)}>
                            {pc.dot} <span style={{ fontSize: '9px' }}>{pc.label}</span>
                          </button>

                          {/* Item text */}
                          <div style={{ flex: 1, minWidth: '160px' }}>
                            {isEditing
                              ? <input className="input" defaultValue={item.item} style={{ fontSize: '13px', width: '100%' }}
                                  autoFocus
                                  onBlur={e => { updateField(item, 'item', e.target.value); setEditingId(null) }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                              : <span style={{ fontSize: '13px', cursor: 'text', textDecoration: item.status === 'na' ? 'line-through' : 'none', lineHeight: 1.4 }}
                                  onClick={() => setEditingId(item.id)}>
                                  {item.item}
                                  {item.is_international && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#92400e', background: '#fef3c7', borderRadius: '3px', padding: '1px 5px' }}>✈ intl</span>}
                                  {item.smart_key && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#0369a1', background: '#e0f2fe', borderRadius: '3px', padding: '1px 5px' }}>⚡ live</span>}
                                </span>
                            }
                          </div>

                          {/* Owner */}
                          <input defaultValue={item.owner} placeholder="Owner"
                            style={{ width: '88px', fontSize: '11px', padding: '2px 6px', border: '1px solid var(--border2)', borderRadius: '4px', background: 'transparent', flexShrink: 0 }}
                            onBlur={e => { if (e.target.value !== item.owner) updateField(item, 'owner', e.target.value) }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />

                          {/* Due date */}
                          <input type="date" defaultValue={item.due_date}
                            style={{ width: '118px', fontSize: '11px', padding: '2px 6px', border: '1px solid var(--border2)', borderRadius: '4px', background: 'transparent', fontFamily: 'var(--mono)', flexShrink: 0 }}
                            onBlur={e => { if (e.target.value !== item.due_date) updateField(item, 'due_date', e.target.value) }} />

                          {/* Note toggle */}
                          <button className="btn btn-sm" title="Notes"
                            style={{ padding: '2px 6px', fontSize: '11px', flexShrink: 0, color: item.notes ? 'var(--accent)' : 'var(--text3)' }}
                            onClick={() => setEditingNoteId(isEditingNote ? null : item.id)}>📝</button>

                          {saving === item.id && <span className="spinner" style={{ width: '12px', height: '12px', flexShrink: 0 }} />}

                          <button className="btn btn-sm" style={{ color: 'var(--red)', padding: '2px 6px', flexShrink: 0 }} onClick={() => deleteItem(item)}>✕</button>
                        </div>

                        {/* Smart badge */}
                        <SmartBadge item={item} />

                        {/* Notes */}
                        {isEditingNote && (
                          <textarea className="input" rows={2} placeholder="Add notes…" defaultValue={item.notes}
                            style={{ marginTop: '8px', fontSize: '12px', resize: 'vertical', width: '100%' }}
                            onBlur={e => { updateField(item, 'notes', e.target.value); setEditingNoteId(null) }} />
                        )}
                        {!isEditingNote && item.notes && (
                          <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--text3)', paddingLeft: '2px', cursor: 'text' }}
                            onClick={() => setEditingNoteId(item.id)}>{item.notes}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
      }

      {/* ── Library Picker Modal ── */}
      {showPicker && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '40px 16px', overflowY: 'auto',
        }} onClick={e => { if (e.target === e.currentTarget) setShowPicker(false) }}>
          <div style={{
            background: 'var(--bg)', borderRadius: '12px', width: '100%', maxWidth: '800px',
            overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          }}>
            {/* Modal header */}
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border2)', background: 'var(--bg)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '16px' }}>Item Library</div>
                  <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
                    {selected.size} item{selected.size !== 1 ? 's' : ''} selected
                    {[...selected].filter(k => existingTexts.has(k.split('||')[1])).length > 0 && ' (some already added)'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-sm" onClick={() => setShowPicker(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={selected.size === 0 || saving === 'bulk'} onClick={addSelectedItems}>
                    {saving === 'bulk' ? 'Adding…' : `Add ${selected.size} item${selected.size !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
              {/* Template strip */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Start from a template</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {Object.entries(TEMPLATES).map(([key, tmpl]) => {
                    const availableCount = tmpl.keys.filter(k => !existingTexts.has(k.split('||')[1])).length
                    return (
                      <button key={key} onClick={() => applyTemplate(key)} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                        border: '1px solid var(--border2)', background: 'var(--bg3)',
                        fontSize: '12px', color: 'var(--text1)', textAlign: 'left',
                      }}>
                        <span style={{ fontSize: '16px' }}>{tmpl.icon}</span>
                        <div>
                          <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{tmpl.label}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text3)', lineHeight: 1.3 }}>{availableCount} items</div>
                        </div>
                      </button>
                    )
                  })}
                  {selected.size > 0 && (
                    <button onClick={() => setSelected(new Set())} style={{
                      padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                      border: '1px solid var(--border2)', background: 'transparent',
                      fontSize: '12px', color: 'var(--text3)', alignSelf: 'center',
                    }}>Clear selection</button>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input className="input" placeholder="Search items…" value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)} style={{ flex: 1, fontSize: '13px' }} />
                {(['all', 'critical', 'intl'] as const).map(f => (
                  <button key={f} onClick={() => setPickerFilter(f)} style={{
                    fontSize: '11px', padding: '4px 10px', borderRadius: '999px',
                    border: '1px solid var(--border2)', cursor: 'pointer', whiteSpace: 'nowrap',
                    background: pickerFilter === f ? 'var(--accent)' : 'transparent',
                    color: pickerFilter === f ? '#fff' : 'var(--text2)',
                  }}>
                    {f === 'all' ? 'All' : f === 'critical' ? '🔴 Critical' : '✈ International'}
                  </button>
                ))}
              </div>
            </div>

            {/* Modal body */}
            <div style={{ padding: '16px 24px', maxHeight: '62vh', overflowY: 'auto' }}>
              {filteredLibrary.map(cat => (
                <div key={cat.name} style={{ marginBottom: '20px' }}>
                  <div style={{ fontWeight: 700, fontSize: '11px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                    {cat.name}
                    <span style={{ fontWeight: 400, marginLeft: '8px', color: 'var(--text3)', textTransform: 'none', letterSpacing: 0, fontSize: '11px' }}>
                      {cat.items.filter(li => selected.has(`${cat.name}||${li.text}`)).length}/{cat.items.length} selected
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {cat.items.map(li => {
                      const key = `${cat.name}||${li.text}`
                      const alreadyAdded = existingTexts.has(li.text)
                      const isSel = selected.has(key)
                      const pc = PRIORITY_CONFIG[li.priority]
                      return (
                        <div key={key}
                          onClick={() => !alreadyAdded && toggleSelected(key)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '7px 10px', borderRadius: '6px',
                            cursor: alreadyAdded ? 'default' : 'pointer',
                            background: isSel ? '#eff6ff' : alreadyAdded ? 'var(--bg2)' : 'var(--bg3)',
                            border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border2)'}`,
                            opacity: alreadyAdded ? 0.4 : 1,
                          }}>
                          {/* Checkbox */}
                          <div style={{
                            width: '15px', height: '15px', borderRadius: '3px', flexShrink: 0,
                            border: `2px solid ${isSel ? 'var(--accent)' : 'var(--border2)'}`,
                            background: isSel ? 'var(--accent)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isSel && <span style={{ color: '#fff', fontSize: '10px', lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ flex: 1, fontSize: '12px', lineHeight: 1.4 }}>{li.text}</span>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
                            {li.smartKey && <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#e0f2fe', color: '#0369a1' }}>⚡ live</span>}
                            {li.isIntl && <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: '#fef3c7', color: '#92400e' }}>✈ intl</span>}
                            <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: pc.bg, color: pc.color }}>{pc.label}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text3)', minWidth: '48px' }}>{li.owner}</span>
                            {alreadyAdded && <span style={{ fontSize: '10px', color: 'var(--green)' }}>✓ added</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {filteredLibrary.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text3)', fontSize: '13px' }}>No items match</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
