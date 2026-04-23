// ─── Core Entities ───────────────────────────────────────────────────────────

export interface AppUser {
  id: string
  auth_id: string | null
  email: string
  name: string
  role: 'admin' | 'pm' | 'viewer'
  permissions: Record<string, string>
  active: boolean
  last_login: string | null
  created_at: string
  updated_at: string
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
  rates: { currency: string; currencies: CurrencyRate[] }
  public_holidays: PublicHoliday[]
  ph_state: string | null
  std_hours: { day: Record<string, number>; night: Record<string, number> }
  shift_patterns: ShiftPattern[]
  site_info: Record<string, string>
  forecast_config: ForecastConfig
  forecast_baseline: ForecastBaseline | null
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
  created_at: string
  updated_at: string
}

export interface RateBuckets {
  dnt?: number;  cost?: Record<string, number>; sell?: Record<string, number>
  [key: string]: unknown
}

export interface RegimeConfig {
  lt12?: Record<string, number>
  ge12?: Record<string, number>
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
  flags: Record<string, unknown>
  notes: string
  created_at: string
  updated_at: string
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
  created_at: string
  updated_at: string
}

export interface CrewMember {
  personId: string
  name: string
  role: string
  wbs: string
  days: Record<string, DayEntry>
}

export interface DayEntry {
  dayType: 'weekday' | 'saturday' | 'sunday' | 'publicHoliday'
  shiftType: 'day' | 'night'
  hours: number
  laha?: boolean
  meal?: boolean
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
  quote_source: { rfqId: string; docTitle: string } | null
  raised_date: string | null
  closed_date: string | null
  notes: string
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
  currency: string
  invoice_date: string | null
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
  date: string | null
  amount: number
  cost_ex_gst: number
  sell_price: number
  currency: string
  gm_pct: number
  attachment: unknown | null
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
  total_cost: number
  customer_total: number
  gm_pct: number
  linked_po_id: string | null
  notes: string
  created_at: string
  updated_at: string
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
  notes: string
  created_at: string
  updated_at: string
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
  id: string
  project_id: string
  tv_no: string
  linked_po_id: string | null
  charge_start: string | null
  charge_end: string | null
  sell_eur: number | null
  cost_eur: number | null
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ─── NRG ─────────────────────────────────────────────────────────────────────

export interface NrgTceLine {
  id: string
  project_id: string
  item_id: string | null
  wbs_code: string
  description: string
  category: string
  source: 'overhead' | 'skilled'
  tce_total: number
  forecast_enabled: boolean
  forecast_type: string | null
  forecast_subtype: string | null
  forecast_date_from: string | null
  forecast_date_to: string | null
  forecast_resources: string[]
  hire_links: string[]
  details: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ─── Other ────────────────────────────────────────────────────────────────────

export interface Variation {
  id: string; project_id: string; number: string; title: string
  status: string; value: number | null; scope: string
  submitted_date: string | null; approved_date: string | null
  notes: string; created_at: string; updated_at: string
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
  value: number | null; details: Record<string, unknown>
  created_at: string; updated_at: string
}

export interface WbsItem {
  id: string; project_id: string; code: string; name: string
  level: string | null; pm100: number | null; source: string | null
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
export interface SeSupportEntry { id: string; date: string; amount: number; sellPrice: number; [key: string]: unknown }
export interface RfqDoc { id: string; title: string; [key: string]: unknown }
export interface SparePartItem { id: string; materialNo: string; description: string; [key: string]: unknown }
export interface ForecastConfig { [key: string]: unknown }
export interface ForecastBaseline { grandCost: number; grandSell: number; setAt: string; setBy: string; weeks?: Record<string, number> }

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
