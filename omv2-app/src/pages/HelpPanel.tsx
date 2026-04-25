import { useAppStore } from '../store/appStore'

const SECTIONS = [
  {
    title: '🚀 Getting Started',
    items: [
      ['Create a project', 'Click the project picker (top left) → New Project. Set the project name, start date, and base currency in Project Settings.'],
      ['Add your team', 'Go to Personnel → Resources. Add each person with their role, company, and mob in/out dates. Assign a rate card to calculate costs.'],
      ['Set up WBS codes', 'Go to Cost → WBS. Add your WBS structure and optionally import from MIKA (OPSA/SPASS CSV export).'],
      ['Enter rate cards', 'Go to Personnel → Rate Cards. Create cards for Trades, Management, and SE AG with hourly rates for each shift bucket.'],
    ]
  },
  {
    title: '⏱ Timesheets',
    items: [
      ['Creating a week', 'Timesheets → (Trades/Mgmt/SE AG) → + New Week. Select the week start date and add crew members.'],
      ['Entering hours', 'Click a cell and type the hours. The day type (weekday/Saturday/Sunday) and shift (day/night) affect which rate buckets apply.'],
      ['WO allocations', 'If the project has Work Orders, a 📋 button appears in each cell. Click it to split hours across WOs.'],
      ['Allowances', 'Click 🏷 Allowances to bulk-apply LAHA and meal defaults from the resource list. Or tick boxes per cell.'],
      ['Approving', 'Click ✓ Approve on any week in the list, or open the week and change status from the dropdown.'],
    ]
  },
  {
    title: '💰 Cost Tracking',
    items: [
      ['Variations', 'Cost → Variations. Each variation has a number (auto-incremented), title, status, and line items with cost/sell amounts.'],
      ['Purchase Orders', 'Cost → POs. Link invoices to POs to track spend against approved amounts.'],
      ['Invoices', 'Cost → Invoices. Link to POs and optionally to NRG TCE lines for actuals tracking.'],
      ['Forecast', 'Cost → Forecast. Shows day-by-day cost built from resources, hire, tooling, and accommodation. Use ⚙ Configure to toggle categories. Use 📸 Baseline to snapshot and track drift.'],
      ['SAP Reconciliation', 'Cost → SAP Recon. Upload a SAP XLSX export to match against project invoices.'],
    ]
  },
  {
    title: '🔧 Tooling (SE Rental)',
    items: [
      ['TV Register', 'Tooling → TV Register. Add TVs to this project from the global list. Set charge dates and rates in Costings.'],
      ['WOSIT Import', 'Site → Import WOSIT/TV/Kollo. Upload the Excel export from Kanlog/SE to import spare parts, TV data and Kollo manifests.'],
      ['Parts receiving', 'Site → Parts. Use the Receiving tab to mark parts as received as TVs arrive on site.'],
    ]
  },
  {
    title: '🏗 NRG Gladstone',
    items: [
      ['TCE Register', 'NRG → TCE Register. Import from TasTK XLSX or add lines manually. Group headers (e.g. 1.2.3) collapse/expand. Bulk-assign WBS codes with checkboxes.'],
      ['Overhead Forecast', 'NRG → Overhead Forecast. Configure weekly billing amounts per contract scope. Links to invoicing.'],
      ['WO Actuals', 'NRG → WO Actuals. Shows hours allocated to each Work Order from timesheet entries.'],
      ['KPI Model', 'NRG → KPI Model. Shows TCE consumption vs actuals grouped by contract scope.'],
    ]
  },
  {
    title: '💡 Tips',
    items: [
      ['Keyboard shortcut N', 'Press N on Variations, Invoices, POs, Work Orders, and Resources panels to open a new item.'],
      ['Inline date editing', 'Click mob in/out dates on the Resources panel to edit inline without opening a modal.'],
      ['Global search', 'Use Cmd+K (or the search button) to search across resources, parts, WOs, invoices, variations, and POs.'],
      ['FX rates', 'Set exchange rates in Project Settings → Exchange Rates. Used in forecast, cost dashboard, and hire calculations.'],
      ['Ribbon tabs', 'Clicking a ribbon tab navigates to its first panel automatically.'],
    ]
  },
]

export function HelpPanel() {
  const { setActivePanel } = useAppStore()

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700 }}>Help & Guide</h1>
        <p style={{ fontSize: '13px', color: 'var(--text3)', marginTop: '4px' }}>How to use the Overhaul Manager</p>
      </div>

      {SECTIONS.map(section => (
        <div key={section.title} style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', paddingBottom: '6px', borderBottom: '2px solid var(--border)' }}>
            {section.title}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {section.items.map(([title, desc]) => (
              <div key={title} style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '12px', padding: '10px 12px', background: 'var(--bg3)', borderRadius: '6px', fontSize: '13px' }}>
                <div style={{ fontWeight: 600 }}>{title}</div>
                <div style={{ color: 'var(--text2)' }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ padding: '16px', background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.2)', borderRadius: '8px', fontSize: '13px' }}>
        <div style={{ fontWeight: 600, marginBottom: '6px', color: 'var(--accent)' }}>📬 Need more help?</div>
        <p style={{ color: 'var(--text2)', margin: 0 }}>
          The Overhaul Manager is a bespoke tool built by Kyle Mackechnie for turbine outage project management.
          For questions or to report issues, use the thumbs down button on any Claude response to send feedback.
        </p>
        <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => setActivePanel('dashboard')}>← Project Dashboard</button>
          <button className="btn btn-sm" onClick={() => setActivePanel('project-settings')}>⚙ Project Settings</button>
        </div>
      </div>
    </div>
  )
}
