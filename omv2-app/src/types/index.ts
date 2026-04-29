// ─── Core Entities ───────────────────────────────────────────────────────────

export interface AppUser {
  id: string
  auth_id: string | null
  email: string
  name: string
  role: 'admin' | 'member' | 'viewer'
  permissions: Record<string, { read: boolean; write: boolean }>
  active: boolean
  last_login: string | null
  created_at: string
  updated_at: string
  force_password_reset?: boolean
  invited_by?: string | null
  invited_at?: string | null
}

export interface Site {
  id: string
  name: string
  client: string
  address: string
  inventory: SparePartItem[]
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  site_id: string | null
  name: string
  wbs: string
  start_date: string | null
  end_date: string | null
  notes: string
  default_gm: number
  unit: string
  pm: string
  site_contact: string
  site_phone: string
  client: string
  currency: string
  scope_tracking: string
  rates: { currency: string; currencies: CurrencyRate[] }
  public_holidays: PublicHoliday[]
  ph_state: string | null
  std_hours: { day: Record<string, number>; night: Record<string, number> }
  shift_patterns: ShiftPattern[]
  /** Named labour shift patterns for RFQ cost modelling — hours per DOW */
  labour_patterns: ShiftPattern[]
  site_info: Record<string, string>
  forecast_config: ForecastConfig
  forecast_baseline: ForecastBaseline | null
  currency_rates?: { code: string; name: string; rate: number }[]
  pre_planning_notes: Record<string, string>
  role_aliases: RoleAlias[]
  mika_data: MikaRow[] | null
  induction_data: InductionPerson[] | null
  induction_upload_time: string | null
  co2_config: Co2Config
  sap_reconciliation: SapReconState
  nrg_config: { kpiTarget: unknown | null; ohfLineIds: string[] }
  report_log: ReportLogEntry[]
  wosit_lines: WositLine[]
  issued_log: IssuedLogEntry[]
  hardware: HardwareState
  se_support: SeSupportEntry[]
  rfq_docs: RfqDoc[]
  created_at: string
  updated_at: string
  // Joined
  site?: Site
  members?: ProjectMember[]
}

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  role: 'owner' | 'editor' | 'viewer'
  permissions: Record<string, string>
  created_at: string
  user?: AppUser
}

// ─── Rate Cards ───────────────────────────────────────────────────────────────

export interface RateCard {
  id: string
  project_id: string
  role: string
  category: 'trades' | 'management' | 'seag' | 'subcontractor'
  /** Native currency for hourly rates (EUR for SE AG, AUD for all others) */
  currency: string
  subcon_vendor: string | null
  rates: RateBuckets
  regime: RegimeConfig | null
  laha_cost: number
  laha_sell: number
  fsa_cost: number
  fsa_sell: number
  meal_cost: number
  meal_sell: number
  camp: number
  travel_cost: number
  travel_sell: number
  created_at: string
  updated_at: string
}

export interface RateBuckets {
  dnt?: number;  cost?: Record<string, number>; sell?: Record<string, number>
  [key: string]: unknown
}

export interface RegimeConfig {
  // Flat schema matching the rate-card form and HTML splitHours.
  // Hour thresholds for NT / T1.5 splits — defaults are 7.2 / 3.3 / 3 / 7.2 / 7.2.
  wdNT?: number    // Weekday day NT cap
  wdT15?: number   // Weekday day T1.5 band
  satT15?: number  // Saturday T1.5 band (lt12 only)
  nightNT?: number // Night NT cap
  restNT?: number  // Rest day flat NT
  [key: string]: unknown
}

// ─── Resources ───────────────────────────────────────────────────────────────

export interface Resource {
  id: string
  project_id: string
  name: string
  role: string
  category: 'trades' | 'management' | 'seag' | 'subcontractor'
  shift: 'day' | 'night' | 'both'
  mob_in: string | null
  mob_out: string | null
  travel_days: number
  wbs: string
  allow_laha: boolean
  allow_fsa: boolean
  allow_meal: boolean
  linked_po_id: string | null
  rate_card_id: string | null
  company: string
  phone: string
  email: string
  home_city: string
  transport_mode: string
  drive_km: number
  meal_break_adj: boolean
  flights: string
  flags: Record<string, unknown>
  notes: string
  created_at: string
  updated_at: string
  person_id: string | null
  // Joined
  rate_card?: RateCard
  linked_po?: PurchaseOrder
}

// ─── Timesheets ───────────────────────────────────────────────────────────────

export interface WeeklyTimesheet {
  id: string
  project_id: string
  type: 'trades' | 'mgmt' | 'seag' | 'subcon'
  week_start: string
  regime: 'lt12' | 'ge12'
  status: 'draft' | 'submitted' | 'approved'
  wbs: string
  notes: string
  vendor: string | null
  po_id: string | null
  crew: CrewMember[]
  /** Default TCE item_id (text, not UUID) for crew allowances. Per-person
   *  override on CrewMember.allowancesTceItemId takes precedence. Empty string
   *  means "no default" — allowances will land as unallocated in NRG Actuals. */
  allowances_tce_default?: string
  scope_tracking?: 'none' | 'work_orders' | 'nrg_tce'
  created_at: string
  updated_at: string
}

export interface CrewMember {
  personId: string
  name: string
  role: string
  wbs: string
  days: Record<string, DayEntry>
  mealBreakAdj?: boolean
  /** Per-person override for the allowance TCE item_id. Falls back to the
   *  timesheet-level allowances_tce_default when null/missing. */
  allowancesTceItemId?: string | null
}

export interface DayEntry {
  dayType: string
  shiftType: 'day' | 'night'
  hours: number
  laha?: boolean
  meal?: boolean
  [key: string]: unknown
}

export interface BackOfficeHour {
  id: string
  project_id: string
  name: string
  role: string
  date: string
  hours: number
  cost: number
  sell: number
  wbs: string
  notes: string
  created_at: string
}

// ─── Purchase Orders & Invoices ───────────────────────────────────────────────

export interface PurchaseOrder {
  id: string
  project_id: string
  po_number: string
  internal_ref: string
  vendor: string
  description: string
  status: 'draft' | 'quoted' | 'raised' | 'active' | 'closed' | 'cancelled'
  currency: string
  po_value: number | null
  quote_source: { type?: 'rfq' | 'manual'; rfqId: string; responseId?: string; docTitle: string } | null
  raised_date: string | null
  closed_date: string | null
  notes: string
  tce_item_id: string | null
  receipt_paths: string[]
  created_at: string
  updated_at: string
  // Computed (not in DB)
  invoiced_total?: number
  approved_total?: number
  forecast_value?: number | null
}

export type InvoiceStatus = 'received' | 'checked' | 'approved' | 'paid' | 'disputed'

export interface Invoice {
  id: string
  project_id: string
  po_id: string | null
  invoice_number: string
  vendor_ref: string
  status: InvoiceStatus
  amount: number
  expected_amount: number
  currency: string
  invoice_date: string | null
  received_date: string | null
  paid_date: string | null
  due_date: string | null
  period_from: string | null
  period_to: string | null
  source: string
  sap_doc_number: string | null
  sap_wbs: string | null
  tce_item_id: string | null
  linked_asset_ids: string[]
  status_history: InvoiceStatusHistory[]
  notes: string
  created_at: string
  updated_at: string
  // Joined
  po?: PurchaseOrder
}

export interface InvoiceStatusHistory {
  from: InvoiceStatus | null
  to: InvoiceStatus
  by: string
  byEmail: string
  at: string
  note?: string
}

// ─── Expenses & Cars & Accommodation ─────────────────────────────────────────

export interface Expense {
  id: string
  project_id: string
  resource_id: string | null
  category: string
  description: string
  vendor: string
  date: string | null
  amount: number
  cost_ex_gst: number
  sell_price: number
  currency: string
  gm_pct: number
  chargeable: boolean
  tce_item_id: string | null
  attachment: unknown | null
  receipt_paths: string[]
  wbs: string
  notes: string
  created_at: string
  updated_at: string
}

export interface Car {
  id: string
  project_id: string
  vehicle_type: string
  rego: string
  vendor: string
  person_id: string | null
  start_date: string | null
  end_date: string | null
  daily_rate: number
  total_cost: number
  customer_total: number
  gm_pct: number
  linked_po_id: string | null
  notes: string
  created_at: string
  updated_at: string
  wbs: string
  // Pricing extras (HTML parity)
  location_fee_pct: number
  one_way_fee: number
  // Booking metadata
  reservation: string
  pickup_loc: string
  return_loc: string
  collected: boolean
  dropped_off: boolean
  // CO2 tracking
  fuel_type: string
  total_km: number
}

export interface Accommodation {
  id: string
  project_id: string
  property: string
  room: string
  vendor: string
  check_in: string | null
  check_out: string | null
  nights: number
  total_cost: number
  customer_total: number
  gm_pct: number
  inclusive: boolean
  linked_po_id: string | null
  occupants: string[]
  notes: string
  created_at: string
  updated_at: string
  wbs: string
}

// ─── Hire Items ───────────────────────────────────────────────────────────────

export interface HireItem {
  id: string
  project_id: string
  hire_type: 'dry' | 'wet' | 'local'
  name: string
  vendor: string
  description: string
  start_date: string | null
  end_date: string | null
  hire_cost: number
  customer_total: number
  gm_pct: number
  currency: string
  transport_in: number
  transport_out: number
  linked_po_id: string | null
  rates: WetHireRates | null
  calendar: WetHireCalendarDay[]
  crew: WetHireCrewMember[]
  daa_rate: number
  daily_rate: number | null
  weekly_rate: number | null
  notes: string
  created_at: string
  updated_at: string
  wbs: string
}

export interface WetHireRates { ds?: number; ns?: number; wds?: number; wns?: number; sd?: number }
export interface WetHireCalendarDay { date: string; shifts: { ds?: boolean; ns?: boolean; wds?: boolean; wns?: boolean; sdd?: boolean; sdn?: boolean } }
export interface WetHireCrewMember { name: string; role: string }

// ─── Tooling ─────────────────────────────────────────────────────────────────

export interface GlobalTV {
  id: string
  tv_no: string
  header_name: string
  department_id: string | null
  gross_kg: number | null
  net_kg: number | null
  length_cm: number | null
  width_cm: number | null
  height_cm: number | null
  vol_m3: number | null
  pack_items: string | null
  extra: Record<string, unknown>
  imported_by_project_id: string | null
  created_at: string
  updated_at: string
  replacement_value_eur: number | null
  department?: GlobalDepartment
}

export interface GlobalDepartment {
  id: string
  name: string
  rates: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface GlobalKollo {
  id: string
  kollo_id: string
  vb_no: string
  tv_no: string | null
  crate_no: string
  gross_kg: number | null
  net_kg: number | null
  length_cm: number | null
  width_cm: number | null
  height_cm: number | null
  vol_m3: number | null
  pack_items: string | null
  extra: Record<string, unknown>
  created_at: string
}

export interface ToolingCosting {
  id: string; project_id: string; tv_no: string
  charge_start: string | null; charge_end: string | null
  cost_eur: number | null; sell_eur: number | null
  wbs: string; fx_rate: number
  splits: { type: 'project'|'standby'; projectId?: string; projectName?: string; startDate: string; endDate: string; wbs: string; discountPct?: number }[]
  sell_override_eur: number | null
  // Freight costs
  import_cost_eur: number | null; import_sell_eur: number | null
  import_wbs: string;             import_project_id: string | null
  export_cost_eur: number | null; export_sell_eur: number | null
  export_wbs: string;             export_project_id: string | null
  linked_po_id: string | null; notes: string
  created_at: string; updated_at: string
}

// ─── NRG ─────────────────────────────────────────────────────────────────────

export interface VariationLine {
  id: string; variation_id: string; project_id: string
  category: 'labour_trades'|'labour_mgmt'|'labour_subcon'|'materials'|'equipment'|'third_party'|'other'
  // Per-line WBS — CRITICAL for MIKA rollup. A variation affecting multiple WBS buckets needs multiple lines.
  wbs: string; wbs_name: string
  description: string; cost_total: number; sell_total: number
  // Non-labour fields
  qty: number|null; unit: string|null; unit_cost: number|null; unit_sell: number|null
  // Labour-only fields
  role: string|null; hours: number|null; day_type: string|null; shift_type: string|null
  allowances: boolean; shifts_calc: number|null; breakdown: unknown[]
  created_at: string; updated_at: string
}

export interface NrgCustomerInvoice {
  id: string; project_id: string
  label: string; invoice_number: string
  week_ending: string|null; sent_date: string|null; notes: string
  // Keys are contractScope strings e.g. '00173164/00001', values are override amounts
  overrides: Record<string, number>
  created_at: string; updated_at: string
}

export interface NrgInvoiceGroupingRule {
  id: string; project_id: string
  group_name: string; triggers: string[]; sort_order: number; created_at: string
}

export interface MikaWbsLine {
  id: string; project_id: string; import_batch_id: string|null; imported_at: string
  wbs: string; description: string; level: number|null
  pm80: number|null; pm100: number|null; forecast_tc: number|null
  monthly_forecast: Record<string, number>; sort_order: number; created_at: string
}

export interface NrgTceLine {
  id: string; project_id: string
  item_id: string | null; wbs_code: string; description: string
  category: string; source: 'overhead' | 'skilled'
  tce_total: number; tce_rate: number; estimated_qty: number; unit_type: string
  work_order: string; contract_scope: string; line_type: string; kpi_included: boolean
  forecast_enabled: boolean; forecast_type: string | null
  forecast_subtype: string | null
  forecast_date_from: string | null; forecast_date_to: string | null
  forecast_resources: unknown[]; hire_links: unknown[]
  details: Record<string, unknown>
  // Fields added in fix migration
  assigned_resources: string[]
  is_variation_line: boolean
  invoice_override: number | null
  notes: string
  linked_module: string | null
  linked_ids: unknown[]
  sort_order: number
  parent_id: string | null
  created_at: string; updated_at: string
}

// ─── Other ────────────────────────────────────────────────────────────────────

export interface Variation {
  id: string; project_id: string; number: string; title: string
  status: string; value: number | null; scope: string
  cause: string; raised_date: string | null; assumptions: string; exclusions: string
  submitted_date: string | null; approved_date: string | null
  notes: string; line_items: unknown[] | null; customer_ref?: string
  // Fields added in fix migration
  tce_link: string        // stores TCE item_id (text), NOT internal UUID — stable across re-imports
  wo_ref: string          // NRG work order reference
  cost_total: number      // sum of variation_lines.cost_total
  sell_total: number      // sum of variation_lines.sell_total
  status_history: { from: string; to: string; at: string; by: string }[]
  created_at: string; updated_at: string
}

export interface WorkOrder {
  id: string; project_id: string; wo_number: string; description: string
  status: string; wbs_code: string | null; budget_hours: number | null
  actual_hours: number; notes: string; allocations: unknown[]
  created_at: string; updated_at: string
}

export interface Shipment {
  id: string; project_id: string; direction: 'import' | 'export'
  reference: string; description: string; status: string; carrier: string
  tracking: string; eta: string | null; shipped_date: string | null
  details: Record<string, unknown>; notes: string
  created_at: string; updated_at: string
}

export interface SubconContract {
  id: string; project_id: string; vendor: string; status: string
  value: number | null
  description: string; scope: string
  start_date: string | null; end_date: string | null
  notes: string
  linked_po_id: string | null
  quoted_amount: number | null
  response_notes: string | null
  awarded: boolean
  details: Record<string, unknown>
  created_at: string; updated_at: string
}

export interface RfqDocument {
  id: string
  project_id: string
  title: string
  stage: 'draft' | 'issued' | 'responses_in' | 'awarded' | 'contracted' | 'cancelled'
  scope: string
  start_date: string | null
  end_date: string | null
  deadline: string | null
  contact_name: string
  contact_role: string
  contact_email: string
  contact_phone: string
  notes: string
  vendors_sent: string[]
  awarded_response_id: string | null
  linked_contract_id: string | null
  linked_po_id: string | null
  labour_rows: RfqLabourRow[]
  equip_rows: RfqEquipRow[]
  created_at: string
  updated_at: string
}

export interface RfqLabourRow {
  id: string
  role: string
  shiftType: 'single' | 'single-night' | 'dual'
  qty: number
  durMode: 'shifts' | 'dates'
  shifts: number
  dateStart: string | null
  dateEnd: string | null
}

export interface RfqEquipRow {
  id: string
  desc: string
  unit: 'days' | 'weeks' | 'lump'
  durMode: 'qty' | 'dates'
  dur: number
  dateStart: string | null
  dateEnd: string | null
}

export interface RfqResponse {
  id: string
  rfq_document_id: string
  project_id: string
  vendor: string
  received_date: string | null
  total_quote: number | null
  currency: string
  notes: string
  labour: RfqResponseLabour[]
  equip: RfqResponseEquip[]
  quote_pdf_path: string | null
  quote_pdf_name: string | null
  quote_pdf_size_bytes: number | null
  is_awarded: boolean
  created_at: string
  updated_at: string
}

export interface RfqResponseLabour {
  role: string
  rates: RfqResponseLabourRates
}

export interface RfqResponseLabourRates {
  rateMode: 'hourly' | 'flat'
  // Hourly fields
  dnt?: number; dt15?: number; ddt?: number; ddt15?: number
  nnt?: number; ndt?: number; ndt15?: number
  laha?: number
  ntHrs?: number; ot1Hrs?: number; shiftHrs?: number
  satNtHrs?: number; satT15Hrs?: number; satShiftHrs?: number
  sunT15Hrs?: number; sunShiftHrs?: number
  nntHrs?: number; nshiftHrs?: number
  // Flat fields
  flatDs?: number; flatNs?: number
}

export interface RfqResponseEquip {
  desc: string
  rate: number
  unit: 'day' | 'week' | 'lump'
  transportIn: number
  transportOut: number
}

export interface WbsItem {
  id: string; project_id: string; code: string; name: string
  level: string | null; pm100: number | null; pm80: number | null; source: string | null
  sort_order: number; created_at: string
}

// ─── Embedded types (kept as jsonb) ──────────────────────────────────────────

export interface PublicHoliday { date: string; name: string }
export interface CurrencyRate { code: string; name: string; rate: number }
export interface ShiftPattern { id: string; name: string; day: Record<string, number>; night: Record<string, number> }
export interface RoleAlias { from: string; to: string }
export interface MikaRow { wbs: string; pm80: number; pm100: number; description: string }
export interface InductionPerson { name: string; company: string; [key: string]: unknown }
export interface Co2Config { emissionFactors?: Record<string, number>; [key: string]: unknown }
export interface SapReconState { lastImport: string | null; fileName: string | null; rows: unknown[]; mapping: Record<string, string> }
export interface ReportLogEntry { id: string; title: string; type: string; html: string; createdAt: string; createdBy: string }
export interface WositLine { id: string; materialNo: string; tv: string; installLocation: string; [key: string]: unknown }
export interface IssuedLogEntry { [key: string]: unknown }
export interface HardwareState { contract: unknown | null; carts: unknown[]; escalationHistory: unknown[]; items: unknown[] }
export interface SeSupportEntry { id: string; date: string; person: string; description: string; category: string; currency: string; amount: number; sell_price: number; wbs: string; notes: string }
export interface RfqDoc { id: string; title: string; [key: string]: unknown }
export interface SparePartItem { id: string; materialNo: string; description: string; [key: string]: unknown }
export interface ForecastConfig { [key: string]: unknown }
export interface ForecastBaseline { grandCost: number; grandSell: number; setAt: string; setBy: string; weeks?: Record<string, number | { cost: number; sell: number; hours: number }> }

// ─── Forecast engine types ────────────────────────────────────────────────────

export interface DayCostRow {
  trades: { cost: number; sell: number; headcount: number; hours: number }
  mgmt:   { cost: number; sell: number; headcount: number; hours: number }
  seag:   { cost: number; sell: number; headcount: number; hours: number }
  dryHire:   { cost: number; sell: number }
  wetHire:   { cost: number; sell: number }
  localHire: { cost: number; sell: number }
  tooling:   { cost: number; sell: number }
  cars:      { cost: number; sell: number }
  accom:     { cost: number; sell: number }
  expenses:  { cost: number; sell: number }
  people: PersonDay[]
}

export interface PersonDay {
  name: string; role: string; category: string
  cost: number; sell: number; hours: number
  isMob?: boolean; isDemob?: boolean; isBackOffice?: boolean
}
