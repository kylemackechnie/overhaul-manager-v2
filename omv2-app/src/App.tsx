import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { useAppStore } from './store/appStore'
import { usePermissions, AccessDenied, type Module } from './lib/permissions'
import { useAuth } from './hooks/useAuth'
import { setPayrollRules } from './engines/costEngine'
import { LoginPage } from './pages/LoginPage'
import { Header } from './components/layout/Header'
import { Ribbon } from './components/layout/Ribbon'
import { ProjectPicker } from './components/layout/ProjectPicker'
import { CommandPalette } from './components/layout/CommandPalette'
import { ToastContainer } from './components/ui/Toast'
import { HelpPanel } from './pages/HelpPanel'
import { DashboardPanel } from './pages/dashboard/DashboardPanel'
import { PlaceholderPanel } from './pages/PlaceholderPanel'
// Cost
import { CostDashboardPanel } from './pages/cost/CostDashboardPanel'
import { CustomerReportPanel } from './pages/cost/CustomerReportPanel'
import { ForecastPanel } from './pages/cost/ForecastPanel'
import { MikaPanel } from './pages/cost/MikaPanel'
import { PrePlanningReportPanel } from './pages/cost/PrePlanningReportPanel'
import { SubconVendorSnapshot } from './pages/subcon/SubconVendorSnapshot'
import { SubconRFQRegisterPanel } from './pages/subcon/SubconRFQRegisterPanel'
import { SubconRFQDocPanel } from './pages/subcon/SubconRFQDocPanel'
import { SubconCostModelPanel } from './pages/subcon/SubconCostModelPanel'
import { ShippingImportPanel } from './pages/shipping/ShippingImportPanel'
import { WOProgressPanel } from './pages/site/WOProgressPanel'
import { PartsSiteInventoryPanel } from './pages/site/PartsSiteInventoryPanel'
import { SCurvePanel } from './pages/cost/SCurvePanel'
import { CostReportPanel } from './pages/cost/CostReportPanel'
import { ReportsDatabasePanel } from './pages/cost/ReportsDatabasePanel'
import { POsPanel } from './pages/cost/POsPanel'
import { InvoicesPanel } from './pages/cost/InvoicesPanel'
import { VariationsPanel } from './pages/cost/VariationsPanel'
import { ExpensesPanel } from './pages/cost/ExpensesPanel'
import { SapReconPanel } from './pages/cost/SapReconPanel'
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
import { NrgKpiPanel } from './pages/site/NrgKpiPanel'
import { NrgInvoicingPanel } from './pages/site/NrgInvoicingPanel'
import { HardwareContractPanel } from './pages/site/HardwareContractPanel'
import { HardwareDashboard } from './pages/hardware/HardwareDashboard'
import { HardwareReportsPanel } from './pages/hardware/HardwareReportsPanel'
import { HardwareEscalationPanel } from './pages/hardware/HardwareEscalationPanel'
import { HardwareImportPanel } from './pages/hardware/HardwareImportPanel'
import { HardwareCartsPanel } from './pages/site/HardwareCartsPanel'
import { SparePartsPanel } from './pages/site/SparePartsPanel'
import { PartsDashboardPanel } from './pages/site/PartsDashboardPanel'
import { WositImportPanel } from './pages/site/WositImportPanel'
// Tooling
import { TVRegisterPanel } from './pages/tooling/TVRegisterPanel'
import { ToolingDashboard } from './pages/tooling/ToolingDashboard'
import { ToolingReportsPanel } from './pages/tooling/ToolingReportsPanel'
import { KollosPanel } from './pages/tooling/KollosPanel'
import { DepartmentsPanel } from './pages/tooling/DepartmentsPanel'
import { GlobalKitsPanel } from './pages/tooling/GlobalKitsPanel'
import { ToolingCostingsPanel } from './pages/tooling/ToolingCostingsPanel'
import { GlobalToolingPanel } from './pages/tooling/GlobalToolingPanel'
// Settings
import { UserManagementPanel } from './pages/settings/UserManagementPanel'
import { GlobalRateDefaultsPanel } from './pages/settings/GlobalRateDefaultsPanel'
import { PayrollRulesPanel } from './pages/settings/PayrollRulesPanel'
import { ProfilePage } from './pages/settings/ProfilePage'
import { SitesPanel } from './pages/settings/SitesPanel'
import { PrePlanningPanel } from './pages/project/PrePlanningPanel'
import { HSEHoursPanel } from './pages/personnel/HSEHoursPanel'
import { AuditTrailPanel } from './pages/settings/AuditTrailPanel'
import { UtilisationPanel } from './pages/personnel/UtilisationPanel'
import { MigrationPanel } from './pages/settings/MigrationPanel'
import { HireDashboard } from './pages/hire/HireDashboard'
import { HireReportsPanel } from './pages/hire/HireReportsPanel'
import { WODashboard } from './pages/site/WODashboard'
import { WOActualsPanel } from './pages/site/WOActualsPanel'
import { ShippingDashboard } from './pages/shipping/ShippingDashboard'
import { SubconDashboard } from './pages/subcon/SubconDashboard'
import { SiteDashboardPanel } from './pages/site/SiteDashboardPanel'
import { GlobalPartsPanel } from './pages/site/GlobalPartsPanel'
import { PartsReceivingPanel } from './pages/site/PartsReceivingPanel'
import { PartsIssuePanel } from './pages/site/PartsIssuePanel'
import { PartsReportsPanel } from './pages/site/PartsReportsPanel'
import { PartsSearchPanel } from './pages/site/PartsSearchPanel'
import type { Session } from '@supabase/supabase-js'
import type { Project } from './types'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  const { activePanel, activeProject, setActivePanel, setActiveProject, restoreProject } = useAppStore()

  // Force password reset — redirect to profile before anything else loads
  useEffect(() => {
    if (sessionStorage.getItem('force_password_reset') === '1') {
      setActivePanel('profile')
    }
    // Load global payroll rules into the engine on boot
    supabase.from('payroll_rules').select('rules').eq('id', 1).single()
      .then(({ data }) => { if (data?.rules) setPayrollRules(data.rules) })
  }, [])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [restoringProject, setRestoringProject] = useState(false)

  useEffect(() => {
    const t0 = performance.now()
    const ms = () => `+${Math.round(performance.now() - t0)}ms`
    console.log(`[App] ${ms()} mount — persistedProjectId:`, useAppStore.getState().activeProjectId ?? 'none')

    // Detect whether a stored session exists. If yes, we should wait for the
    // token refresh to complete (signalled by INITIAL_SESSION) — no matter how
    // long it takes — rather than punting to the login page after a fixed timeout.
    let hasStoredSession = false
    try {
      hasStoredSession = !!window.localStorage.getItem('om-v2-auth')
    } catch { /* localStorage blocked — assume no stored session */ }
    console.log(`[App] ${ms()} hasStoredSession:`, hasStoredSession)

    // Same pattern as useAuth: ignore SIGNED_IN until INITIAL_SESSION fires,
    // because the first SIGNED_IN on refresh has a stale (expired) JWT.
    let initialSessionSeen = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      console.log(`[App] ${ms()} auth event:`, event, '| uid:', s?.user?.id ?? 'none', '| initialSeen:', initialSessionSeen)
      if (event === 'INITIAL_SESSION') {
        initialSessionSeen = true
        setSession(s ?? null)
        if (s) {
          // Try to restore the previously-active project. activePanel and activeRibbonTab
          // are already persisted by zustand, so just rehydrating the project record is
          // enough to land the user back on the panel they had open before refresh.
          const persistedId = useAppStore.getState().activeProjectId
          const inMemoryProject = useAppStore.getState().activeProject
          if (inMemoryProject) {
            // Already in memory (HMR or navigation) — nothing to do
            console.log(`[App] ${ms()} INITIAL_SESSION — project already in memory`)
          } else if (persistedId) {
            console.log(`[App] ${ms()} INITIAL_SESSION — restoring project ${persistedId.slice(0, 8)}...`)
            setRestoringProject(true)
            // Fire the restore query but don't block on it. If it fails (project deleted,
            // RLS denies, etc.) we fall back to the picker.
            supabase.from('projects').select('*, site:sites(id,name)').eq('id', persistedId).single()
              .then(({ data, error }) => {
                setRestoringProject(false)
                if (error || !data) {
                  console.warn(`[App] project restore failed:`, error?.message ?? 'no data — opening picker')
                  setPickerOpen(true)
                } else {
                  console.log(`[App] project restored: ${data.name}`)
                  restoreProject(data as Project)
                }
              })
          } else {
            console.log(`[App] ${ms()} INITIAL_SESSION — no persisted project, opening picker`)
            setPickerOpen(true)
          }
        }
      } else if (event === 'SIGNED_IN') {
        if (!initialSessionSeen) {
          console.log(`[App] ${ms()} ignoring stale SIGNED_IN (waiting for INITIAL_SESSION)`)
          return
        }
        setSession(s)
        if (s && !useAppStore.getState().activeProject) setPickerOpen(true)
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(s)
      } else if (event === 'SIGNED_OUT') {
        setSession(null)
        setActiveProject(null)
        setPickerOpen(false)
      }
    })

    // Fallback: only applies when there's NO stored session. If there IS a stored
    // session, we wait indefinitely for the token refresh — even if it takes 40s.
    // Showing the login page mid-refresh would force a redundant re-auth.
    let fallback: ReturnType<typeof setTimeout> | undefined
    if (!hasStoredSession) {
      fallback = setTimeout(() => {
        setSession(prev => {
          if (prev === undefined) {
            console.warn(`[App] ${ms()} no stored session and no auth event in 3s — showing login`)
            return null
          }
          return prev
        })
      }, 3000)
    }

    return () => {
      subscription.unsubscribe()
      if (fallback) clearTimeout(fallback)
    }
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

  // Progressive loading message — most refreshes resolve in <2s, but tracking
  // prevention or slow networks can stretch the auth handshake to 30s+. We
  // update the message so the user knows the app hasn't frozen.
  const [loadingPhase, setLoadingPhase] = useState(0)
  useEffect(() => {
    if (session !== undefined) return
    const timers = [
      setTimeout(() => setLoadingPhase(1), 3000),
      setTimeout(() => setLoadingPhase(2), 10000),
    ]
    return () => timers.forEach(clearTimeout)
  }, [session])

  // Only block render if session is truly unknown (first frame)
  if (session === undefined) {
    const hasPersistedProject = !!useAppStore.getState().activeProjectId
    const messages = hasPersistedProject
      ? ['Resuming session...', 'Refreshing authentication...', 'Still working — this can take up to 30 seconds on a slow network']
      : ['', 'Connecting...', 'Connection slow — please wait']
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', gap:'12px' }}>
        <span className="spinner" style={{ width:'32px', height:'32px' }} />
        {messages[loadingPhase] && (
          <span style={{ fontSize:'13px', color:'var(--text3)', maxWidth:'320px', textAlign:'center' }}>
            {messages[loadingPhase]}
          </span>
        )}
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
        {/* Profile and settings panels don't require an active project */}
        {(['profile', 'user-management', 'audit-trail', 'sites', 'payroll-rules', 'rate-defaults'].includes(activePanel)) ? (
          <PanelRouter panel={activePanel} />
        ) : !activeProject ? (
          restoringProject ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'70vh', gap:'12px' }}>
              <span className="spinner" style={{ width:'28px', height:'28px' }} />
              <span style={{ fontSize:'13px', color:'var(--text3)' }}>Restoring your project...</span>
            </div>
          ) : (
            <div className="empty-state" style={{ paddingTop:'80px' }}>
              <div className="icon">⚙️</div>
              <h3>Select a project</h3>
              <p>Click the project pill in the header or the SE logo to open the project picker.</p>
              <button className="btn btn-primary" style={{ marginTop:'16px' }} onClick={() => setPickerOpen(true)}>
                Open Project Picker
              </button>
            </div>
          )
        ) : (
          <PanelRouter panel={activePanel} />
        )}
      </div>

      <ToastContainer />
    </div>
  )
}

// Map panel prefixes to modules for permission checks
const PANEL_MODULE_MAP: Record<string, Module> = {
  'cost-':        'cost_tracking',
  'purchase-':    'cost_tracking',
  'invoices':     'cost_tracking',
  'expenses':     'cost_tracking',
  'sap-':         'cost_tracking',
  'variations':   'cost_tracking',
  'hr-':          'personnel',
  'hire-':        'personnel',
  'hse-':         'hse',
  'subcon-':      'subcontractors',
  'shipping-':    'logistics',
  'hardware-':    'hardware',
  'parts-':       'hardware',
  'tooling-':     'tooling',
  'global-':      'global',
  'nrg-':         'site_specific',
  'wo-':          'site_specific',
  'work-':        'site_specific',
  'site-':        'site_specific',
}

function getPanelModule(panel: string): Module | null {
  for (const [prefix, mod] of Object.entries(PANEL_MODULE_MAP)) {
    if (panel.startsWith(prefix) || panel === prefix.replace('-','')) return mod
  }
  return null
}

function PanelRouter({ panel }: { panel: string }) {
  const { canRead } = usePermissions()
  const module = getPanelModule(panel)
  // Check read permission — skip for settings/admin panels
  if (module && !canRead(module)) {
    return <AccessDenied module={module.replace('_', ' ')} />
  }
  const p = (icon: string, title: string, sub?: string) => <PlaceholderPanel icon={icon} title={title} subtitle={sub} />
  switch (panel) {
    case 'dashboard':             return <DashboardPanel />
    case 'help':                  return <HelpPanel />
    case 'tooling-tour':          return <HelpPanel />
    case 'calendar':              return <CalendarPanel />
    case 'gantt':                 return <GanttPanel />
    case 'project-settings':      return <ProjectSettingsPanel />
    case 'pre-planning':          return <PrePlanningPanel />
    case 'wbs-list':              return <WBSPanel />
    case 'public-holidays':       return <PublicHolidaysPanel />
    case 'variations':            return <VariationsPanel />
    case 'cost-dashboard':        return <CostDashboardPanel />
    case 'cost-customer-report':  return <CustomerReportPanel />
    case 'cost-forecast':         return <ForecastPanel />
    case 'cost-mika':            return <MikaPanel />
    case 'pre-planning-report':  return <PrePlanningReportPanel />
    case 'cost-scurve':           return <SCurvePanel />
    case 'cost-report':           return <CostReportPanel />
    case 'reports-db':            return <ReportsDatabasePanel />
    case 'purchase-orders':       return <POsPanel />
    case 'invoices':              return <InvoicesPanel />
    case 'expenses':              return <ExpensesPanel />
    case 'sap-recon':             return <SapReconPanel />
    case 'subcon-rfq':            return <SubconCostModelPanel />
    case 'subcon-dashboard':      return <SubconDashboard />
    case 'subcon-vendor-snapshot': return <SubconVendorSnapshot />
    case 'subcon-rfq-register':    return <SubconRFQRegisterPanel />
    case 'subcon-rfq-doc':         return <SubconRFQDocPanel />
    case 'subcon-contracts':      return <POsPanel />
    case 'hr-dashboard':          return <HRDashboardPanel />
    case 'hr-ratecards':          return <RateCardsPanel />
    case 'hr-resources':          return <ResourcesPanel />
    case 'hr-timesheets-trades':  return <TimesheetsPanel key="trades" type="trades" />
    case 'hr-timesheets-mgmt':    return <TimesheetsPanel key="mgmt" type="mgmt" />
    case 'hr-timesheets-seag':    return <TimesheetsPanel key="seag" type="seag" />
    case 'hr-timesheets-subcon':  return <TimesheetsPanel key="subcon" type="subcon" />
    case 'hr-backoffice':         return <BackOfficePanel />
    case 'hr-utilisation':        return <UtilisationPanel />
    case 'hr-cars':               return <CarsPanel />
    case 'hr-accommodation':      return <AccommodationPanel />
    case 'hire-dashboard':        return <HireDashboard />
    case 'hire-reports':          return <HireReportsPanel />
    case 'hire-dry':              return <HirePanel hireType="dry" />
    case 'hire-wet':              return <HirePanel hireType="wet" />
    case 'hire-local':            return <HirePanel hireType="local" />
    case 'hr-inductions':         return <InductionsPanel />
    case 'hse-dashboard':         return <HSEDashboardPanel />
    case 'hse-hours':             return <HSEHoursPanel />
    case 'hse-co2':               return <Co2TrackingPanel />
    case 'shipping-dashboard':    return <ShippingDashboard />
    case 'shipping-import':       return <ShippingImportPanel />
    case 'shipping-inbound':      return <ShipmentsPanel direction="import" />
    case 'shipping-outbound':     return <ShipmentsPanel direction="export" />
    case 'wo-dashboard':          return <WODashboard />
    case 'wo-actuals':            return <WOActualsPanel />
    case 'wo-progress':           return <WOProgressPanel />
    case 'work-orders':           return <WorkOrdersPanel />
    case 'site-dashboard':        return <SiteDashboardPanel />
    case 'global-parts':          return <GlobalPartsPanel />
    case 'parts-receiving':       return <PartsReceivingPanel />
    case 'parts-issue':           return <PartsIssuePanel />
    case 'parts-reports':         return <PartsReportsPanel />
    case 'parts-search':          return <PartsSearchPanel />
    case 'nrg-dashboard':         return <NrgDashboardPanel />
    case 'nrg-tce':               return <NrgTcePanel />
    case 'nrg-ohf':               return <NrgOhfPanel />
    case 'nrg-actuals':           return <NrgActualsPanel />
    case 'nrg-invoicing':         return <NrgInvoicingPanel />
    case 'nrg-kpi':               return <NrgKpiPanel />
    case 'hardware-dashboard':    return <HardwareDashboard />
    case 'hardware-reports':      return <HardwareReportsPanel />
    case 'hardware-escalation':   return <HardwareEscalationPanel />
    case 'hardware-import':       return <HardwareImportPanel />
    case 'hardware-contract':     return <HardwareContractPanel />
    case 'hardware-carts':        return <HardwareCartsPanel />
    case 'parts-dashboard':       return <PartsDashboardPanel />
    case 'parts-list':            return <SparePartsPanel />
    case 'parts-import':          return <WositImportPanel />
    case 'parts-inventory':      return <PartsSiteInventoryPanel />
    case 'global-parts':          return <GlobalKitsPanel />
    case 'tooling-dashboard':     return <ToolingDashboard />
    case 'tooling-reports':       return <ToolingReportsPanel />
    case 'tooling-tvs':           return <TVRegisterPanel />
    case 'tooling-kollos':        return <KollosPanel />
    case 'tooling-departments':   return <DepartmentsPanel />
    case 'tooling-costings':      return <ToolingCostingsPanel />
    case 'global-tooling':        return <GlobalToolingPanel />
    case 'global-kits':           return <GlobalKitsPanel />
    case 'user-management':       return <UserManagementPanel />
    case 'rate-defaults':         return <GlobalRateDefaultsPanel />
    case 'payroll-rules':         return <PayrollRulesPanel />
    case 'profile':               return <ProfilePage />
    case 'sites':                 return <SitesPanel />
    case 'audit-trail':           return <AuditTrailPanel />
    case 'migration':             return <MigrationPanel />
    default:                      return p('🚧', panel, 'Coming soon')
  }
}
