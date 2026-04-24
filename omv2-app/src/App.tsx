import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { useAppStore } from './store/appStore'
import { useAuth } from './hooks/useAuth'
import { LoginPage } from './pages/LoginPage'
import { Ribbon } from './components/layout/Ribbon'
import { ProjectSelector } from './components/layout/ProjectSelector'
import { ToastContainer } from './components/ui/Toast'
import { DashboardPanel } from './pages/dashboard/DashboardPanel'
import { PlaceholderPanel } from './pages/PlaceholderPanel'
// Cost
import { CostDashboardPanel } from './pages/cost/CostDashboardPanel'
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
import { HardwareContractPanel } from './pages/site/HardwareContractPanel'
import { HardwareCartsPanel } from './pages/site/HardwareCartsPanel'
// Tooling
import { TVRegisterPanel } from './pages/tooling/TVRegisterPanel'
import { KollosPanel } from './pages/tooling/KollosPanel'
import { DepartmentsPanel } from './pages/tooling/DepartmentsPanel'
import { GlobalKitsPanel } from './pages/tooling/GlobalKitsPanel'
import { ToolingCostingsPanel } from './pages/tooling/ToolingCostingsPanel'
import { GlobalToolingPanel } from './pages/tooling/GlobalToolingPanel'
// Settings
import { UserManagementPanel } from './pages/settings/UserManagementPanel'
import { AuditTrailPanel } from './pages/settings/AuditTrailPanel'
import type { Session } from '@supabase/supabase-js'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const { activePanel, activeProject, sidebarOpen, setSidebarOpen } = useAppStore()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useAuth()

  if (session === undefined) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh' }}>
      <span className="spinner" style={{ width:'32px', height:'32px' }} />
    </div>
  )
  if (!session) return <><LoginPage /><ToastContainer /></>

  const showSidebar = !activeProject || sidebarOpen

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>
      {activeProject && <Ribbon />}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {showSidebar && <ProjectSelector onProjectSelected={() => setSidebarOpen(false)} />}
        <div style={{ flex:1, overflow:'auto', background:'var(--bg2)', position:'relative' }}>
          {!activeProject ? (
            <div className="empty-state" style={{ paddingTop:'80px' }}>
              <div className="icon">⚙️</div>
              <h3>Select a project</h3>
              <p>Choose a project from the sidebar or create a new one.</p>
            </div>
          ) : (
            <>
              {!sidebarOpen && (
                <button onClick={() => setSidebarOpen(true)} style={{
                  position:'absolute', top:'10px', left:'10px', zIndex:10,
                  background:'var(--bg)', border:'1px solid var(--border)',
                  borderRadius:'6px', padding:'4px 10px', cursor:'pointer',
                  fontSize:'12px', color:'var(--text2)', display:'flex', alignItems:'center', gap:'6px',
                }}>☰ {activeProject.name}</button>
              )}
              <PanelRouter panel={activePanel} />
            </>
          )}
        </div>
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
    case 'wbs-list':              return <WBSPanel />
    case 'public-holidays':       return <PublicHolidaysPanel />
    case 'variations':            return <VariationsPanel />
    case 'cost-dashboard':        return <CostDashboardPanel />
    case 'purchase-orders':       return <POsPanel />
    case 'invoices':              return <InvoicesPanel />
    case 'expenses':              return <ExpensesPanel />
    case 'sap-recon':             return <SapReconPanel />
    case 'subcon-rfq':            return <SubconRFQPanel />
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
    case 'hire-dry':              return <HirePanel hireType="dry" />
    case 'hire-wet':              return <HirePanel hireType="wet" />
    case 'hire-local':            return <HirePanel hireType="local" />
    case 'hr-inductions':         return <InductionsPanel />
    case 'hse-dashboard':         return <HSEDashboardPanel />
    case 'hse-co2':               return <Co2TrackingPanel />
    case 'shipping-inbound':      return <ShipmentsPanel direction="import" />
    case 'shipping-outbound':     return <ShipmentsPanel direction="export" />
    case 'work-orders':           return <WorkOrdersPanel />
    case 'nrg-dashboard':         return <NrgDashboardPanel />
    case 'nrg-tce':               return <NrgTcePanel />
    case 'nrg-ohf':               return <NrgOhfPanel />
    case 'hardware-contract':     return <HardwareContractPanel />
    case 'hardware-carts':        return <HardwareCartsPanel />
    case 'tooling-tvs':           return <TVRegisterPanel />
    case 'tooling-kollos':        return <KollosPanel />
    case 'tooling-departments':   return <DepartmentsPanel />
    case 'tooling-costings':      return <ToolingCostingsPanel />
    case 'global-tooling':        return <GlobalToolingPanel />
    case 'global-kits':           return <GlobalKitsPanel />
    case 'user-management':       return <UserManagementPanel />
    case 'audit-trail':           return <AuditTrailPanel />
    case 'cost-forecast':         return p('📈','Forecast','Coming soon')
    case 'cost-scurve':           return p('📉','S-Curve','Coming soon')
    case 'cost-report':           return p('📑','Cost Report','Coming soon')
    case 'reports-db':            return p('📦','Reports Database','Coming soon')
    case 'parts-list':            return p('🔩','Spare Parts','Coming soon')
    case 'global-parts':          return p('🔩','Global Parts','Coming soon')
    default:                      return p('🚧', panel, 'Coming soon')
  }
}
