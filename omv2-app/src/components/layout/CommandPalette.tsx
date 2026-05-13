import { useEffect, useRef, useState } from 'react'

import { useAppStore } from '../../store/appStore'
import { supabase } from '../../lib/supabase'

interface CmdItem {
  key: string
  icon: string
  title: string
  sub: string
  badge: string
  action: () => void
}

interface CmdSection {
  label: string
  items: CmdItem[]
}

// ─── Page navigation registry ─────────────────────────────────────────────────
// Covers every panel route in App.tsx. Keep in sync when new panels are added.
// Module column drives the section header in search results.

interface NavPage {
  icon: string
  label: string
  panel: string
  module: string
  /** Extra keywords for fuzzy matching beyond the label. */
  keywords?: string
}

const NAV_PAGES: NavPage[] = [
  // Getting Started / Project
  { icon: '📊', label: 'Dashboard',              panel: 'dashboard',          module: 'Project' },
  { icon: '⚙️', label: 'Project Settings',       panel: 'project-settings',   module: 'Project', keywords: 'config currency rates roles pm pa shift patterns' },
  { icon: '📅', label: 'Calendar',                panel: 'calendar',           module: 'Project' },
  { icon: '📋', label: 'Gantt Chart',             panel: 'gantt',              module: 'Project' },
  { icon: '✅', label: 'Pre-Outage Planning',     panel: 'pre-planning',       module: 'Project', keywords: 'checklist readiness' },
  { icon: '📑', label: 'Pre-Planning Report',     panel: 'pre-planning-report',module: 'Project' },
  { icon: '📍', label: 'WBS List',                panel: 'wbs-list',           module: 'Project', keywords: 'work breakdown structure' },
  { icon: '🗓️', label: 'Public Holidays',         panel: 'public-holidays',    module: 'Project' },
  { icon: '🏗', label: 'Sites',                    panel: 'sites',              module: 'Project' },

  // Cost Tracking
  { icon: '💰', label: 'Cost Dashboard',          panel: 'cost-dashboard',     module: 'Cost Tracking' },
  { icon: '📊', label: 'MIKA Cost Plan',          panel: 'cost-mika',          module: 'Cost Tracking', keywords: 'eac estimate at completion pm80 pm100' },
  { icon: '📈', label: 'Forecast',                 panel: 'cost-forecast',      module: 'Cost Tracking', keywords: 'eac' },
  { icon: '🔍', label: 'Forecast vs MIKA Reconcile',panel: 'cost-reconcile',     module: 'Cost Tracking', keywords: 'diagnostic eac variance' },
  { icon: '📉', label: 'S-Curve',                  panel: 'cost-scurve',        module: 'Cost Tracking', keywords: 'cumulative cost' },
  { icon: '📄', label: 'Purchase Orders',          panel: 'purchase-orders',    module: 'Cost Tracking', keywords: 'po contracts committed' },
  { icon: '💳', label: 'Invoices',                 panel: 'invoices',           module: 'Cost Tracking' },
  { icon: '📝', label: 'Variations',               panel: 'variations',         module: 'Cost Tracking', keywords: 'vn contract change' },
  { icon: '🧾', label: 'Expenses',                 panel: 'expenses',           module: 'Cost Tracking' },
  { icon: '🔄', label: 'SAP Reconciliation',       panel: 'sap-recon',          module: 'Cost Tracking' },
  { icon: '📑', label: 'Cost Summary Report',      panel: 'cost-report',        module: 'Cost Tracking' },
  { icon: '👤', label: 'Customer Report',          panel: 'cost-customer-report', module: 'Cost Tracking' },
  { icon: '📚', label: 'Cost Register',            panel: 'cost-register',      module: 'Cost Tracking', keywords: 'ledger transactions' },
  { icon: '📦', label: 'Reports Database',         panel: 'reports-db',         module: 'Cost Tracking', keywords: 'saved snapshots' },

  // Personnel
  { icon: '👥', label: 'HR Dashboard',             panel: 'hr-dashboard',       module: 'Personnel' },
  { icon: '👤', label: 'Resources',                panel: 'hr-resources',       module: 'Personnel', keywords: 'people crew' },
  { icon: '📋', label: 'People Directory',         panel: 'hr-directory',       module: 'Personnel', keywords: 'persons staff workforce' },
  { icon: '📅', label: 'Resource Year View',        panel: 'hr-year-view',       module: 'Personnel', keywords: 'gantt timeline roster 2026 all projects' },
  { icon: '📊', label: 'Utilisation',              panel: 'hr-utilisation',     module: 'Personnel' },
  { icon: '💲', label: 'Rate Cards',               panel: 'hr-ratecards',       module: 'Personnel' },
  { icon: '⏱', label: 'Trades Timesheets',         panel: 'hr-timesheets-trades',module: 'Personnel' },
  { icon: '⏱', label: 'Management Timesheets',     panel: 'hr-timesheets-mgmt', module: 'Personnel' },
  { icon: '⏱', label: 'SE AG Timesheets',          panel: 'hr-timesheets-seag', module: 'Personnel' },
  { icon: '⏱', label: 'Subcon Timesheets',         panel: 'hr-timesheets-subcon',module: 'Personnel' },
  { icon: '🏢', label: 'Back Office & SE Support', panel: 'hr-backoffice',      module: 'Personnel', keywords: 'bo hours' },
  { icon: '🚗', label: 'Car Hire',                 panel: 'hr-cars',            module: 'Personnel' },
  { icon: '🏨', label: 'Accommodation',            panel: 'hr-accommodation',   module: 'Personnel' },

  // HSE
  { icon: '🦺', label: 'HSE Dashboard',            panel: 'hse-dashboard',      module: 'HSE' },
  { icon: '🎓', label: 'Inductions',                panel: 'hr-inductions',      module: 'HSE' },
  { icon: '⏱', label: 'HSE Hours',                 panel: 'hse-hours',          module: 'HSE' },
  { icon: '🌿', label: 'CO₂ Tracking',              panel: 'hse-co2',            module: 'HSE' },

  // Subcontractors
  { icon: '📊', label: 'Subcon Dashboard',         panel: 'subcon-dashboard',   module: 'Subcontractors' },
  { icon: '📋', label: 'RFQ Register',             panel: 'subcon-rfq-register',module: 'Subcontractors', keywords: 'request for quotation' },
  { icon: '📄', label: 'RFQ Document',             panel: 'subcon-rfq-doc',     module: 'Subcontractors' },
  { icon: '📈', label: 'Cost Model',               panel: 'subcon-rfq',         module: 'Subcontractors', keywords: 'vendor comparison rfq' },
  { icon: '📋', label: 'Subcontractor Contracts',  panel: 'subcon-contracts',   module: 'Subcontractors' },
  { icon: '👥', label: 'Vendor Snapshot',          panel: 'subcon-vendor-snapshot', module: 'Subcontractors' },

  // Logistics (Hire + Shipping)
  { icon: '📊', label: 'Hire Dashboard',           panel: 'hire-dashboard',     module: 'Logistics' },
  { icon: '🚜', label: 'Dry Hire',                 panel: 'hire-dry',           module: 'Logistics' },
  { icon: '🏗️', label: 'Wet Hire',                 panel: 'hire-wet',           module: 'Logistics' },
  { icon: '🧰', label: 'SEA Local Tooling',     panel: 'hire-local',         module: 'Logistics' },
  { icon: '📑', label: 'Hire Reports',             panel: 'hire-reports',       module: 'Logistics' },
  { icon: '📊', label: 'Shipping Dashboard',       panel: 'shipping-dashboard', module: 'Logistics' },
  { icon: '📦', label: 'Inbound Shipping',         panel: 'shipping-inbound',   module: 'Logistics', keywords: 'shipments import' },
  { icon: '🚚', label: 'Outbound Shipping',        panel: 'shipping-outbound',  module: 'Logistics', keywords: 'shipments export' },
  { icon: '⬇', label: 'Shipping Import',           panel: 'shipping-import',    module: 'Logistics' },

  // Hardware
  { icon: '🔧', label: 'Hardware Dashboard',       panel: 'hardware-dashboard', module: 'Hardware' },
  { icon: '📋', label: 'Hardware Contract',        panel: 'hardware-contract',  module: 'Hardware' },
  { icon: '🛒', label: 'Hardware Carts',           panel: 'hardware-carts',     module: 'Hardware' },
  { icon: '📊', label: 'Hardware Reports',         panel: 'hardware-reports',   module: 'Hardware' },
  { icon: '⚠️', label: 'Hardware Escalation',      panel: 'hardware-escalation',module: 'Hardware' },
  { icon: '⬇', label: 'Hardware Import',           panel: 'hardware-import',    module: 'Hardware' },

  // Parts (Work Orders + Spare Parts)
  { icon: '📊', label: 'Parts Dashboard',          panel: 'parts-dashboard',    module: 'Parts' },
  { icon: '🔩', label: 'Spare Parts',              panel: 'parts-list',         module: 'Parts', keywords: 'wosit materials' },
  { icon: '🔍', label: 'Parts Search',             panel: 'parts-search',       module: 'Parts' },
  { icon: '📥', label: 'Parts Receiving',          panel: 'parts-receiving',    module: 'Parts' },
  { icon: '📤', label: 'Parts Issue',              panel: 'parts-issue',        module: 'Parts' },
  { icon: '📦', label: 'Parts Inventory',          panel: 'parts-inventory',    module: 'Parts' },
  { icon: '📑', label: 'Parts Reports',            panel: 'parts-reports',      module: 'Parts' },
  { icon: '⬇', label: 'WOSIT Import',              panel: 'parts-import',       module: 'Parts' },

  // Work Orders
  { icon: '⚙️', label: 'WO Dashboard',             panel: 'wo-dashboard',       module: 'Work Orders' },
  { icon: '📋', label: 'Work Orders',              panel: 'work-orders',        module: 'Work Orders' },
  { icon: '📈', label: 'WO Progress',              panel: 'wo-progress',        module: 'Work Orders' },
  { icon: '💵', label: 'WO Actuals',               panel: 'wo-actuals',         module: 'Work Orders' },

  // Tooling
  { icon: '📊', label: 'Tooling Dashboard',        panel: 'tooling-dashboard',  module: 'Tooling' },
  { icon: '🧰', label: 'TV Register',              panel: 'tooling-tvs',        module: 'Tooling' },
  { icon: '📦', label: 'Kollos',                    panel: 'tooling-kollos',     module: 'Tooling' },
  { icon: '🏢', label: 'Departments',               panel: 'tooling-departments',module: 'Tooling' },
  { icon: '💶', label: 'Tooling Costings',         panel: 'tooling-costings',   module: 'Tooling' },
  { icon: '📑', label: 'Tooling Reports',          panel: 'tooling-reports',    module: 'Tooling' },
  { icon: '🗺️', label: 'Tooling Tour',             panel: 'tooling-tour',       module: 'Tooling' },

  // NRG Module
  { icon: '📊', label: 'NRG Dashboard',            panel: 'nrg-dashboard',      module: 'NRG' },
  { icon: '📋', label: 'NRG TCE Register',         panel: 'nrg-tce',            module: 'NRG', keywords: 'total contract estimate' },
  { icon: '💵', label: 'NRG Actuals',              panel: 'nrg-actuals',        module: 'NRG' },
  { icon: '🧾', label: 'NRG Invoicing',            panel: 'nrg-invoicing',      module: 'NRG' },
  { icon: '✓', label: 'NRG Approvals',             panel: 'nrg-approvals',      module: 'NRG' },
  { icon: '🧮', label: 'NRG Scope Allocations',    panel: 'nrg-scope-allocations',module: 'NRG' },
  { icon: '📝', label: 'NRG Credit Notes',         panel: 'nrg-credit-notes',   module: 'NRG' },
  { icon: '📈', label: 'NRG Overhead Forecast',    panel: 'nrg-ohf',            module: 'NRG' },
  { icon: '🎯', label: 'NRG KPI',                  panel: 'nrg-kpi',            module: 'NRG' },

  // Site Specific
  { icon: '📊', label: 'Site Dashboard',           panel: 'site-dashboard',     module: 'Site Specific' },
  { icon: '📑', label: 'NRG Reports',              panel: 'nrg-reports',        module: 'Site Specific' },

  // Global
  { icon: '🧰', label: 'Global Tooling Register',  panel: 'global-tooling',     module: 'Global' },
  { icon: '📦', label: 'Global Kits',              panel: 'global-kits',        module: 'Global' },
  { icon: '🔩', label: 'Global Parts',             panel: 'global-parts',       module: 'Global' },
  { icon: '🌐', label: 'Global Rate Defaults',     panel: 'rate-defaults',      module: 'Global', keywords: 'rate book template' },
  { icon: '🧾', label: 'Payroll Rules',            panel: 'payroll-rules',      module: 'Global' },
  { icon: '🚗', label: 'Hertz Vehicle Rates',      panel: 'hertz-rates',        module: 'Global', keywords: 'car hire SIPP vehicle rate' },
  { icon: '📍', label: 'Hertz Locations',          panel: 'hertz-locations',    module: 'Global', keywords: 'car hire airport pickup branch' },

  // Admin / File menu
  { icon: '👥', label: 'User Management',          panel: 'user-management',    module: 'Admin' },
  { icon: '📋', label: 'Audit Trail',              panel: 'audit-trail',        module: 'Admin' },
  { icon: '🔄', label: 'Data Migration',           panel: 'migration',          module: 'Admin' },
  { icon: '❓', label: 'Help & Guide',             panel: 'help',               module: 'Admin', keywords: 'walkthrough docs articles' },
  { icon: '👤', label: 'My Profile',               panel: 'profile',            module: 'Admin' },
]

// ─── Action registry ──────────────────────────────────────────────────────────
// Each action navigates to a panel where the user will typically perform the
// "new X" action manually. Future iteration could open the modal directly via
// a global event bus, but for now landing on the panel is enough.

interface ActionEntry {
  icon: string
  label: string
  sub: string
  panel: string
  keywords?: string
}

const ACTIONS: ActionEntry[] = [
  { icon: '➕', label: 'Add Person',          sub: 'Resources → Add',          panel: 'hr-resources',     keywords: 'new resource crew add' },
  { icon: '➕', label: 'New PO',              sub: 'Purchase Orders → New',    panel: 'purchase-orders',  keywords: 'create purchase order' },
  { icon: '➕', label: 'New Invoice',         sub: 'Invoices → New',           panel: 'invoices' },
  { icon: '➕', label: 'New Variation',       sub: 'Variations → New',         panel: 'variations',       keywords: 'vn change order' },
  { icon: '➕', label: 'New Expense',         sub: 'Expenses → New',           panel: 'expenses' },
  { icon: '➕', label: 'New Rate Card',       sub: 'Rate Cards → New',         panel: 'hr-ratecards' },
  { icon: '➕', label: 'New RFQ',             sub: 'RFQ Document → New',       panel: 'subcon-rfq-doc',   keywords: 'request quotation' },
  { icon: '➕', label: 'New Timesheet Week',  sub: 'Trades Timesheets → New',  panel: 'hr-timesheets-trades', keywords: 'add week' },
  { icon: '➕', label: 'Add Vehicle',         sub: 'Cars → Add',                panel: 'hr-cars' },
  { icon: '➕', label: 'Add Accommodation',   sub: 'Accommodation → Add',       panel: 'hr-accommodation' },
  { icon: '➕', label: 'Add Dry Hire Item',   sub: 'Dry Hire → Add',           panel: 'hire-dry' },
  { icon: '➕', label: 'Add Wet Hire Item',   sub: 'Wet Hire → Add',           panel: 'hire-wet' },
  { icon: '➕', label: 'Add WBS',             sub: 'WBS List → Add',           panel: 'wbs-list' },
  { icon: '➕', label: 'Add Work Order',      sub: 'Work Orders → New',        panel: 'work-orders' },
  { icon: '📥', label: 'Import MIKA',         sub: 'MIKA Cost Plan',           panel: 'cost-mika',        keywords: 'csv upload import' },
  { icon: '📥', label: 'SAP Import',          sub: 'SAP Reconciliation',       panel: 'sap-recon',        keywords: 'xlsx reconcile' },
  { icon: '📥', label: 'Import Payroll',      sub: 'Trades Timesheets',        panel: 'hr-timesheets-trades', keywords: 'tastk timecloud ukg kronos' },
  { icon: '📥', label: 'Import Inductions',   sub: 'Inductions → SE Learning', panel: 'hr-inductions',    keywords: 'courses lessons xlsx' },
  { icon: '📥', label: 'Import Hardware',     sub: 'Hardware Import',          panel: 'hardware-import' },
  { icon: '📥', label: 'WOSIT Import',        sub: 'Parts → Import',           panel: 'parts-import',     keywords: 'spare parts' },
  { icon: '📥', label: 'Shipping Import',     sub: 'Shipping → Import',        panel: 'shipping-import' },
]

// ─── Fuzzy matcher ────────────────────────────────────────────────────────────
//
// Substring-only. We deliberately don't do subsequence matching (where
// 'craig' could match 'C[ost T]r[ack]i[n]g' as scattered letters) because
// it produces false positives for record-name queries like person names.
// Page entries compensate by carrying a `keywords` field for common
// abbreviations (po, eac, tce, etc.) that the bare label doesn't cover.
//
// Scoring: a substring at position 0 (prefix) scores highest, falling off
// as the substring sits deeper in the haystack.

function fuzzy(haystack: string, pattern: string): { match: boolean; score: number } {
  if (!pattern) return { match: true, score: 0 }
  const s = haystack.toLowerCase()
  const p = pattern.toLowerCase()
  const subIdx = s.indexOf(p)
  if (subIdx < 0) return { match: false, score: 0 }
  // Prefix match (position 0): 2000
  // Word-start match (after space/dash): 1500
  // Anywhere else: 1000 minus how deep
  if (subIdx === 0) return { match: true, score: 2000 }
  const prevCh = s[subIdx - 1]
  if (prevCh === ' ' || prevCh === '-' || prevCh === '_') return { match: true, score: 1500 }
  return { match: true, score: 1000 - Math.min(subIdx, 100) }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: Props) {
  const { activeProject, setActivePanel } = useAppStore()
  const [query, setQuery] = useState('')
  const [sections, setSections] = useState<CmdSection[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const queryRef = useRef('')
  const allItems = sections.flatMap(s => s.items)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(-1)
      setSections([])
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [open])

  // Debounced rebuild
  useEffect(() => {
    queryRef.current = query
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void buildResults(query) }, 180)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, activeProject?.id])

  async function buildResults(q: string) {
    const trimmed = q.trim()
    const ql = trimmed.toLowerCase()
    const result: CmdSection[] = []

    // ── Pages ───────────────────────────────────────────────────────────────
    // We match against (label, keywords) only — NOT module name. Module
    // names are short generic words (e.g. "Cost Tracking", "Personnel")
    // that produce too many false positives.
    const pageHits = NAV_PAGES
      .map(p => {
        const labelScore = fuzzy(p.label, ql).score
        const kwScore    = p.keywords ? fuzzy(p.keywords, ql).score * 0.9 : 0
        const score = Math.max(labelScore, kwScore)
        return score > 0 ? { ...p, score } : null
      })
      .filter((x): x is NavPage & { score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, ql ? 8 : 6)

    if (pageHits.length) {
      result.push({
        label: 'Pages',
        items: pageHits.map(p => ({
          key: 'page:' + p.panel,
          icon: p.icon,
          title: p.label,
          sub: p.module,
          badge: '→',
          action: () => { onClose(); setActivePanel(p.panel) },
        })),
      })
    }

    // ── Actions ─────────────────────────────────────────────────────────────
    if (ql) {
      const actionHits = ACTIONS
        .map(a => {
          const labelScore = fuzzy(a.label, ql).score
          const subScore   = fuzzy(a.sub, ql).score * 0.5
          const kwScore    = a.keywords ? fuzzy(a.keywords, ql).score : 0
          const score = Math.max(labelScore, subScore, kwScore)
          return score > 0 ? { ...a, score } : null
        })
        .filter((x): x is ActionEntry & { score: number } => x !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)

      if (actionHits.length) {
        result.push({
          label: 'Actions',
          items: actionHits.map(a => ({
            key: 'action:' + a.label,
            icon: a.icon,
            title: a.label,
            sub: a.sub,
            badge: '⏎',
            action: () => { onClose(); setActivePanel(a.panel) },
          })),
        })
      }
    }

    // Commit pages + actions now so the user gets instant feedback,
    // then fetch records asynchronously and merge.
    setSections(result)
    setActiveIdx(-1)

    // ── Records ─────────────────────────────────────────────────────────────
    if (!activeProject || trimmed.length < 2) {
      setRecordsLoading(false)
      return
    }
    setRecordsLoading(true)
    const records = await searchRecords(trimmed, activeProject.id)
    // Drop the result if the query has changed since we started — protects
    // against stale results overwriting fresher ones on rapid typing.
    if (queryRef.current.trim() !== trimmed) return
    setRecordsLoading(false)
    if (records.length) {
      setSections(prev => {
        const without = prev.filter(s => s.label !== 'Records')
        return [...without, { label: 'Records', items: records }]
      })
    }
  }

  // ── Record search across all major tables ─────────────────────────────────
  async function searchRecords(q: string, pid: string): Promise<CmdItem[]> {
    const ql = q.toLowerCase()
    const ilike = `%${q}%`

    const queries = await Promise.allSettled([
      // 1. Resources
      supabase.from('resources').select('id,name,role,company').eq('project_id', pid)
        .or(`name.ilike.${ilike},role.ilike.${ilike},company.ilike.${ilike}`).limit(4),
      // 2. Purchase Orders
      supabase.from('purchase_orders').select('id,po_number,vendor,description').eq('project_id', pid)
        .or(`po_number.ilike.${ilike},vendor.ilike.${ilike},description.ilike.${ilike}`).limit(4),
      // 3. Invoices
      supabase.from('invoices').select('id,invoice_number,vendor_ref,amount').eq('project_id', pid)
        .or(`invoice_number.ilike.${ilike},vendor_ref.ilike.${ilike}`).limit(4),
      // 4. Variations
      supabase.from('variations').select('id,number,title').eq('project_id', pid)
        .or(`number.ilike.${ilike},title.ilike.${ilike}`).limit(4),
      // 5. Work Orders
      supabase.from('work_orders').select('id,wo_number,description').eq('project_id', pid)
        .or(`wo_number.ilike.${ilike},description.ilike.${ilike}`).limit(4),
      // 6. WOSIT parts
      supabase.from('wosit_lines').select('id,description,material_no,tv_no').eq('project_id', pid)
        .or(`description.ilike.${ilike},material_no.ilike.${ilike}`).limit(4),
      // 7. RFQ documents
      supabase.from('rfq_documents').select('id,title,stage').eq('project_id', pid)
        .or(`title.ilike.${ilike},scope.ilike.${ilike}`).limit(3),
      // 8. WBS list
      supabase.from('wbs_list').select('id,code,name').eq('project_id', pid)
        .or(`code.ilike.${ilike},name.ilike.${ilike}`).limit(4),
      // 9. Cars
      supabase.from('cars').select('id,rego,vehicle_type,vendor').eq('project_id', pid)
        .or(`rego.ilike.${ilike},vehicle_type.ilike.${ilike},vendor.ilike.${ilike}`).limit(3),
      // 10. Accommodation
      supabase.from('accommodation').select('id,property,room,vendor').eq('project_id', pid)
        .or(`property.ilike.${ilike},vendor.ilike.${ilike}`).limit(3),
      // 11. Hire items
      supabase.from('hire_items').select('id,name,vendor,description,hire_type').eq('project_id', pid)
        .or(`name.ilike.${ilike},vendor.ilike.${ilike},description.ilike.${ilike}`).limit(3),
      // 12. Expenses
      supabase.from('expenses').select('id,description,vendor,amount').eq('project_id', pid)
        .or(`description.ilike.${ilike},vendor.ilike.${ilike}`).limit(3),
      // 13. Shipments
      supabase.from('shipments').select('id,reference,direction').eq('project_id', pid)
        .ilike('reference', ilike).limit(3),
      // 14. NRG TCE lines
      supabase.from('nrg_tce_lines').select('id,item_id,description,work_order,contract_scope').eq('project_id', pid)
        .or(`item_id.ilike.${ilike},description.ilike.${ilike},work_order.ilike.${ilike},contract_scope.ilike.${ilike}`).limit(4),
      // 15. Global TVs (cross-project register)
      supabase.from('global_tvs').select('tv_no,header_name').ilike('header_name', ilike).limit(3),
      // 16. Global Kollos
      supabase.from('global_kollos').select('kollo_id,description,tv_no').or(`kollo_id.ilike.${ilike},description.ilike.${ilike}`).limit(3),
    ])

    const items: (CmdItem & { score: number })[] = []
    const score = (text: string) => text.toLowerCase().startsWith(ql) ? 2 : 1

    const data = <T,>(idx: number): T[] => {
      const r = queries[idx]
      if (r.status === 'fulfilled' && r.value && 'data' in r.value && r.value.data) {
        return r.value.data as T[]
      }
      return []
    }

    // 1. Resources
    for (const r of data<{ id: string; name: string; role?: string; company?: string }>(0)) {
      items.push({
        key: 'res:' + r.id,
        icon: '👤', title: r.name,
        sub: [r.role, r.company].filter(Boolean).join(' · '),
        badge: 'Resource',
        action: () => { onClose(); setActivePanel('hr-resources') },
        score: score(r.name),
      })
    }
    // 2. POs
    for (const p of data<{ id: string; po_number?: string; vendor?: string; description?: string }>(1)) {
      items.push({
        key: 'po:' + p.id,
        icon: '📄', title: p.po_number || '(no number)',
        sub: [p.vendor, p.description].filter(Boolean).join(' · '),
        badge: 'PO',
        action: () => { onClose(); setActivePanel('purchase-orders') },
        score: p.po_number ? score(p.po_number) : 1,
      })
    }
    // 3. Invoices
    for (const i of data<{ id: string; invoice_number?: string; vendor_ref?: string; amount?: number }>(2)) {
      items.push({
        key: 'inv:' + i.id,
        icon: '💳', title: i.invoice_number || '(no number)',
        sub: [i.vendor_ref, i.amount ? '$' + i.amount.toLocaleString('en-AU') : null].filter(Boolean).join(' · '),
        badge: 'Invoice',
        action: () => { onClose(); setActivePanel('invoices') },
        score: i.invoice_number ? score(i.invoice_number) : 1,
      })
    }
    // 4. Variations
    for (const v of data<{ id: string; number?: string; title?: string }>(3)) {
      items.push({
        key: 'var:' + v.id,
        icon: '📝', title: 'VN ' + (v.number || ''),
        sub: v.title || '',
        badge: 'Variation',
        action: () => { onClose(); setActivePanel('variations') },
        score: v.number ? score(v.number) : 1,
      })
    }
    // 5. Work Orders
    for (const w of data<{ id: string; wo_number?: string; description?: string }>(4)) {
      items.push({
        key: 'wo:' + w.id,
        icon: '⚙️', title: w.wo_number || '(no number)',
        sub: w.description || '',
        badge: 'Work Order',
        action: () => { onClose(); setActivePanel('work-orders') },
        score: w.wo_number ? score(w.wo_number) : 1,
      })
    }
    // 6. Parts
    for (const p of data<{ id: string; description?: string; material_no?: string; tv_no?: string }>(5)) {
      items.push({
        key: 'part:' + p.id,
        icon: '🔩', title: p.description || p.material_no || '(no description)',
        sub: [p.material_no, p.tv_no ? 'TV ' + p.tv_no : null].filter(Boolean).join(' · '),
        badge: 'Part',
        action: () => { onClose(); setActivePanel('parts-list') },
        score: 1,
      })
    }
    // 7. RFQs
    for (const r of data<{ id: string; title?: string; stage?: string }>(6)) {
      items.push({
        key: 'rfq:' + r.id,
        icon: '📋', title: r.title || '(untitled)',
        sub: r.stage || '',
        badge: 'RFQ',
        action: () => { onClose(); setActivePanel('subcon-rfq-register') },
        score: r.title ? score(r.title) : 1,
      })
    }
    // 8. WBS
    for (const w of data<{ id: string; code?: string; name?: string }>(7)) {
      items.push({
        key: 'wbs:' + w.id,
        icon: '📍', title: w.code || '(no code)',
        sub: w.name || '',
        badge: 'WBS',
        action: () => { onClose(); setActivePanel('wbs-list') },
        score: w.code ? score(w.code) : 1,
      })
    }
    // 9. Cars
    for (const c of data<{ id: string; rego?: string; vehicle_type?: string; vendor?: string }>(8)) {
      items.push({
        key: 'car:' + c.id,
        icon: '🚗', title: c.rego || c.vehicle_type || '(no rego)',
        sub: [c.vehicle_type !== c.rego ? c.vehicle_type : null, c.vendor].filter(Boolean).join(' · '),
        badge: 'Car',
        action: () => { onClose(); setActivePanel('hr-cars') },
        score: c.rego ? score(c.rego) : 1,
      })
    }
    // 10. Accommodation
    for (const a of data<{ id: string; property?: string; room?: string; vendor?: string }>(9)) {
      items.push({
        key: 'accom:' + a.id,
        icon: '🏨', title: a.property || '(no property)',
        sub: [a.room ? 'Room ' + a.room : null, a.vendor].filter(Boolean).join(' · '),
        badge: 'Accommodation',
        action: () => { onClose(); setActivePanel('hr-accommodation') },
        score: a.property ? score(a.property) : 1,
      })
    }
    // 11. Hire items
    for (const h of data<{ id: string; name?: string; vendor?: string; description?: string; hire_type?: string }>(10)) {
      const panel = h.hire_type === 'wet' ? 'hire-wet' : h.hire_type === 'local' ? 'hire-local' : 'hire-dry'
      items.push({
        key: 'hire:' + h.id,
        icon: h.hire_type === 'wet' ? '🏗️' : h.hire_type === 'local' ? '🧰' : '🚜',
        title: h.name || h.description || '(unnamed)',
        sub: [h.hire_type ? h.hire_type[0].toUpperCase() + h.hire_type.slice(1) + ' hire' : null, h.vendor].filter(Boolean).join(' · '),
        badge: 'Hire',
        action: () => { onClose(); setActivePanel(panel) },
        score: h.name ? score(h.name) : 1,
      })
    }
    // 12. Expenses
    for (const e of data<{ id: string; description?: string; vendor?: string; amount?: number }>(11)) {
      items.push({
        key: 'exp:' + e.id,
        icon: '🧾', title: e.description || '(no description)',
        sub: [e.vendor, e.amount ? '$' + e.amount.toLocaleString('en-AU') : null].filter(Boolean).join(' · '),
        badge: 'Expense',
        action: () => { onClose(); setActivePanel('expenses') },
        score: 1,
      })
    }
    // 13. Shipments
    for (const s of data<{ id: string; reference?: string; direction?: string }>(12)) {
      const panel = s.direction === 'export' ? 'shipping-outbound' : 'shipping-inbound'
      items.push({
        key: 'ship:' + s.id,
        icon: s.direction === 'export' ? '🚚' : '📦',
        title: s.reference || '(no reference)',
        sub: s.direction === 'export' ? 'Outbound' : 'Inbound',
        badge: 'Shipment',
        action: () => { onClose(); setActivePanel(panel) },
        score: s.reference ? score(s.reference) : 1,
      })
    }
    // 14. NRG TCE
    for (const t of data<{ id: string; item_id?: string; description?: string; work_order?: string; contract_scope?: string }>(13)) {
      items.push({
        key: 'tce:' + t.id,
        icon: '🎯', title: t.item_id || '(no id)',
        sub: [t.description, t.work_order, t.contract_scope].filter(Boolean).join(' · '),
        badge: 'TCE',
        action: () => { onClose(); setActivePanel('nrg-tce') },
        score: t.item_id ? score(t.item_id) : 1,
      })
    }
    // 15. Global TVs
    for (const t of data<{ tv_no: string; header_name?: string }>(14)) {
      items.push({
        key: 'tv:' + t.tv_no,
        icon: '🧰', title: 'TV ' + t.tv_no,
        sub: t.header_name || '',
        badge: 'Tool TV',
        action: () => { onClose(); setActivePanel('global-tooling') },
        score: 1,
      })
    }
    // 16. Global Kollos
    for (const k of data<{ kollo_id: string; description?: string; tv_no?: string }>(15)) {
      items.push({
        key: 'kollo:' + k.kollo_id,
        icon: '📦', title: 'Kollo ' + k.kollo_id,
        sub: [k.description, k.tv_no ? 'TV ' + k.tv_no : null].filter(Boolean).join(' · '),
        badge: 'Kollo',
        action: () => { onClose(); setActivePanel('global-kits') },
        score: k.kollo_id.toLowerCase().startsWith(ql) ? 2 : 1,
      })
    }

    items.sort((a, b) => b.score - a.score)
    return items.slice(0, 14).map(({ score: _s, ...rest }) => rest)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, allItems.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') {
      if (activeIdx >= 0) allItems[activeIdx]?.action()
      else if (allItems.length > 0) allItems[0]?.action()
    }
  }

  if (!open) return null

  let globalIdx = 0
  const showEmptyState = sections.length === 0 && !query

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-modal" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text3)', flexShrink: 0 }}>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search pages, records, actions…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {recordsLoading && <span className="spinner" style={{ width: '14px', height: '14px', flexShrink: 0 }} />}
          {query && !recordsLoading && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '16px' }}>×</button>
          )}
        </div>

        <div className="cmd-results">
          {sections.length === 0 && query.length > 0 && !recordsLoading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '13px' }}>
              No results for "{query}"
            </div>
          ) : showEmptyState ? (
            <div style={{ padding: '16px' }}>
              <div className="cmd-section-label">Quick Navigation</div>
              {NAV_PAGES.slice(0, 8).map((p, i) => (
                <div key={p.panel} className={`cmd-item ${i === activeIdx ? 'active' : ''}`}
                  onClick={() => { onClose(); setActivePanel(p.panel) }}>
                  <span className="cmd-item-icon">{p.icon}</span>
                  <div className="cmd-item-body">
                    <div className="cmd-item-title">{p.label}</div>
                    <div className="cmd-item-sub">{p.module}</div>
                  </div>
                  <span className="cmd-item-badge">→</span>
                </div>
              ))}
              <div style={{ padding: '10px 4px', fontSize: '11px', color: 'var(--text3)' }}>
                Start typing to search across pages, records (resources, POs, invoices, variations, RFQs, WBS, parts, TCE…), and quick actions.
              </div>
            </div>
          ) : (
            sections.map(section => (
              <div key={section.label}>
                <div className="cmd-section-label">{section.label}</div>
                {section.items.map(item => {
                  const idx = globalIdx++
                  return (
                    <div key={item.key} className={`cmd-item ${idx === activeIdx ? 'active' : ''}`}
                      onClick={item.action}
                      onMouseEnter={() => setActiveIdx(idx)}>
                      <span className="cmd-item-icon">{item.icon}</span>
                      <div className="cmd-item-body">
                        <div className="cmd-item-title">{item.title}</div>
                        {item.sub && <div className="cmd-item-sub">{item.sub}</div>}
                      </div>
                      <span className="cmd-item-badge">{item.badge}</span>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="cmd-footer">
          <span className="cmd-key"><kbd>↑↓</kbd> navigate</span>
          <span className="cmd-key"><kbd>Enter</kbd> select</span>
          <span className="cmd-key"><kbd>Esc</kbd> close</span>
          <span className="cmd-key"><kbd>Ctrl K</kbd> open anywhere</span>
        </div>
      </div>
    </div>
  )
}
