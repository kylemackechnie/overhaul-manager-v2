import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { useAppStore } from './store/appStore'
import { useAuth } from './hooks/useAuth'
import { LoginPage } from './pages/LoginPage'
import { Header } from './components/layout/Header'
import { Ribbon } from './components/layout/Ribbon'
import { ProjectPicker } from './components/layout/ProjectPicker'
import { CommandPalette } from './components/layout/CommandPalette'
import { ToastContainer } from './components/ui/Toast'
import { DashboardPanel } from './pages/dashboard/DashboardPanel'
import { PlaceholderPanel } from './pages/PlaceholderPanel'
// Cost
import { CostDashboardPanel } from './pages/cost/CostDashboardPanel'
import { ForecastPanel } from './pages/cost/ForecastPanel'
import { SCurvePanel } from './pages/cost/SCurvePanel'
import { CostReportPanel } from './pages/cost/CostReportPanel'
import { ReportsDatabasePanel } from './pages/cost/ReportsDatabasePanel'
import { POsPanel } from './pages/cost/POsPanel'
import { InvoicesPanel } from './pages/cost/InvoicesPanel'
import { VariationsPanel } from './pages/cost/VariationsPanel'
import { ExpensesPanel } from './pages/cost/ExpensesPanel'
import { SapReconPanel } from './pages/cost/SapReconPanel'
import { SubconRFQPanel } from './pages/cost/SubconRFQPanel'
// Personnel
import { RateCardsPanel } from './pages/personnel/RateCardsPanel'
import { ResourcesPanel } from './pages/personnel/ResourcesPanel'
import { TimesheetsPanel } from './pages/personnel/TimesheetsPanel'
import { CarsPanel } from './pages/personnel/CarsPanel'
import { AccommodationPanel } from './pages/personnel/AccommodationPanel'
import { BackOfficePanel } from './pages/personnel/BackOfficePanel'
import { HirePanel } from './pages/personnel/HirePanel'
import { HRDashboardPanel } from './pages/personnel/HRDashboardPanel'
import { InductionsPanel } from './pages/personnel/InductionsPanel'
import { HSEDashboardPanel } from './pages/personnel/HSEDashboardPanel'
import { Co2TrackingPanel } from './pages/personnel/Co2TrackingPanel'
// Project
import { WBSPanel } from './pages/project/WBSPanel'
import { ProjectSettingsPanel } from './pages/project/ProjectSettingsPanel'
import { PublicHolidaysPanel } from './pages/project/PublicHolidaysPanel'
import { CalendarPanel } from './pages/project/CalendarPanel'
import { GanttPanel } from './pages/project/GanttPanel'
// Site
import { ShipmentsPanel } from './pages/site/ShipmentsPanel'
import { WorkOrdersPanel } from './pages/site/WorkOrdersPanel'
import { NrgDashboardPanel } from './pages/site/NrgDashboardPanel'
import { NrgTcePanel } from './pages/site/NrgTcePanel'
import { NrgOhfPanel } from './pages/site/NrgOhfPanel'
import { NrgActualsPanel } from './pages/site/NrgActualsPanel'
import { NrgInvoicingPanel } from './pages/site/NrgInvoicingPanel'
import { HardwareContractPanel } from './pages/site/HardwareContractPanel'
import { HardwareDashboard } from './pages/hardware/HardwareDashboard'
import { HardwareCartsPanel } from './pages/site/HardwareCartsPanel'
import { SparePartsPanel } from './pages/site/SparePartsPanel'
import { WositImportPanel } from './pages/site/WositImportPanel'
// Tooling
import { TVRegisterPanel } from './pages/tooling/TVRegisterPanel'
import { ToolingDashboard } from './pages/tooling/ToolingDashboard'
import { KollosPanel } from './pages/tooling/KollosPanel'
import { DepartmentsPanel } from './pages/tooling/DepartmentsPanel'
import { GlobalKitsPanel } from './pages/tooling/GlobalKitsPanel'
import { ToolingCostingsPanel } from './pages/tooling/ToolingCostingsPanel'
import { GlobalToolingPanel } from './pages/tooling/GlobalToolingPanel'
// Settings
import { UserManagementPanel } from './pages/settings/UserManagementPanel'
import { SitesPanel } from './pages/settings/SitesPanel'
import { PrePlanningPanel } from './pages/project/PrePlanningPanel'
import { HSEHoursPanel } from './pages/personnel/HSEHoursPanel'
import { AuditTrailPanel } from './pages/settings/AuditTrailPanel'
import { HireDashboard } from './pages/hire/HireDashboard'
import { WODashboard } from './pages/site/WODashboard'
import { ShippingDashboard } from './pages/shipping/ShippingDashboard'
import { SubconDashboard } from './pages/subcon/SubconDashboard'
import type { Session } from '@supabase/supabase-js'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  const { activePanel, activeProject, setActivePanel, setActiveProject } = useAppStore()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)

  useEffect(() => {
    // Get session — if we have one, show app immediately
    // Project restore happens in ProjectPicker if needed
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null)
      if (session && !useAppStore.getState().activeProject) {
        setPickerOpen(true)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setActiveProject(null)
        setPickerOpen(false)
      } else if (!useAppStore.getState().activeProject) {
        setPickerOpen(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Ctrl+K handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useAuth()

  // Only block render if session is truly unknown (first frame)
  // If we have a persisted project, show a minimal loading state rather than blank
  if (session === undefined) {
    const hasPersistedProject = !!useAppStore.getState().activeProjectId
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', gap:'12px' }}>
        <span className="spinner" style={{ width:'32px', height:'32px' }} />
        {hasPersistedProject && <span style={{ fontSize:'13px', color:'var(--text3)' }}>Resuming session...</span>}
      </div>
    )
  }
  if (!session) return <><LoginPage /><ToastContainer /></>

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>

      {/* Full-screen project picker overlay */}
      {pickerOpen && (
        <ProjectPicker onClose={() => {
          setPickerOpen(false)
          if (!activeProject) setPickerOpen(true) // keep open if no project selected
        }} />
      )}

      {/* Command palette */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      {/* Header — always visible when logged in */}
      <Header
        onOpenPicker={() => setPickerOpen(true)}
        onOpenSearch={() => setCmdOpen(true)}
        onOpenSettings={() => setActivePanel('project-settings')}
      />

      {/* Ribbon — only when project selected */}
      {activeProject && <Ribbon />}

      {/* Main panel */}
      <div style={{ flex:1, overflow:'auto', background:'var(--bg)' }}>
        {!activeProject ? (
          <div className="empty-state" style={{ paddingTop:'80px' }}>
            <div className="icon">⚙️</div>
            <h3>Select a project</h3>
            <p>Click the project pill in the header or the SE logo to open the project picker.</p>
            <button className="btn btn-primary" style={{ marginTop:'16px' }} onClick={() => setPickerOpen(true)}>
              Open Project Picker
            </button>
          </div>
        ) : (
          <PanelRouter panel={activePanel} />
        )}
      </div>

      <ToastContainer />
    </div>
  )
}

function PanelRouter({ panel }: { panel: string }) {
  const p = (icon: string, title: string, sub?: string) => <PlaceholderPanel icon={icon} title={title} subtitle={sub} />
  switch (panel) {
    case 'dashboard':             return <DashboardPanel />
    case 'calendar':              return <CalendarPanel />
    case 'gantt':                 return <GanttPanel />
    case 'project-settings':      return <ProjectSettingsPanel />
    case 'pre-planning':          return <PrePlanningPanel />
    case 'wbs-list':              return <WBSPanel />
    case 'public-holidays':       return <PublicHolidaysPanel />
    case 'variations':            return <VariationsPanel />
    case 'cost-dashboard':        return <CostDashboardPanel />
    case 'cost-forecast':         return <ForecastPanel />
    case 'cost-scurve':           return <SCurvePanel />
    case 'cost-report':           return <CostReportPanel />
    case 'reports-db':            return <ReportsDatabasePanel />
    case 'purchase-orders':       return <POsPanel />
    case 'invoices':              return <InvoicesPanel />
    case 'expenses':              return <ExpensesPanel />
    case 'sap-recon':             return <SapReconPanel />
    case 'subcon-rfq':            return <SubconRFQPanel />
    case 'subcon-dashboard':      return <SubconDashboard />
    case 'subcon-contracts':      return <SubconRFQPanel />
    case 'hr-dashboard':          return <HRDashboardPanel />
    case 'hr-ratecards':          return <RateCardsPanel />
    case 'hr-resources':          return <ResourcesPanel />
    case 'hr-timesheets-trades':  return <TimesheetsPanel type="trades" />
    case 'hr-timesheets-mgmt':    return <TimesheetsPanel type="mgmt" />
    case 'hr-timesheets-seag':    return <TimesheetsPanel type="seag" />
    case 'hr-timesheets-subcon':  return <TimesheetsPanel type="subcon" />
    case 'hr-backoffice':         return <BackOfficePanel />
    case 'hr-cars':               return <CarsPanel />
    case 'hr-accommodation':      return <AccommodationPanel />
    case 'hire-dashboard':        return <HireDashboard />
    case 'hire-dry':              return <HirePanel hireType="dry" />
    case 'hire-wet':              return <HirePanel hireType="wet" />
    case 'hire-local':            return <HirePanel hireType="local" />
    case 'hr-inductions':         return <InductionsPanel />
    case 'hse-dashboard':         return <HSEDashboardPanel />
    case 'hse-hours':             return <HSEHoursPanel />
    case 'hse-co2':               return <Co2TrackingPanel />
    case 'shipping-dashboard':    return <ShippingDashboard />
    case 'shipping-inbound':      return <ShipmentsPanel direction="import" />
    case 'shipping-outbound':     return <ShipmentsPanel direction="export" />
    case 'wo-dashboard':          return <WODashboard />
    case 'work-orders':           return <WorkOrdersPanel />
    case 'nrg-dashboard':         return <NrgDashboardPanel />
    case 'nrg-tce':               return <NrgTcePanel />
    case 'nrg-ohf':               return <NrgOhfPanel />
    case 'nrg-actuals':           return <NrgActualsPanel />
    case 'nrg-invoicing':         return <NrgInvoicingPanel />
    case 'hardware-dashboard':    return <HardwareDashboard />
    case 'hardware-contract':     return <HardwareContractPanel />
    case 'hardware-carts':        return <HardwareCartsPanel />
    case 'parts-list':            return <SparePartsPanel />
    case 'parts-import':          return <WositImportPanel />
    case 'global-parts':          return <SparePartsPanel />
    case 'tooling-dashboard':     return <ToolingDashboard />
    case 'tooling-tvs':           return <TVRegisterPanel />
    case 'tooling-kollos':        return <KollosPanel />
    case 'tooling-departments':   return <DepartmentsPanel />
    case 'tooling-costings':      return <ToolingCostingsPanel />
    case 'global-tooling':        return <GlobalToolingPanel />
    case 'global-kits':           return <GlobalKitsPanel />
    case 'user-management':       return <UserManagementPanel />
    case 'sites':                 return <SitesPanel />
    case 'audit-trail':           return <AuditTrailPanel />
    default:                      return p('🚧', panel, 'Coming soon')
  }
}
