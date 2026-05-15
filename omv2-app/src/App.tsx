import { useEffect, useState, lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from './lib/supabase'
import { useAppStore } from './store/appStore'
import { usePermissions, AccessDenied, type Module } from './lib/permissions'
import { useAuth } from './hooks/useAuth'
import { setPayrollRules } from './engines/costEngine'
import { LoginPage } from './pages/LoginPage'
import { Header } from './components/layout/Header'
import { ResourceManagerRibbon, ToolingRibbon, useModuleRibbon } from './components/layout/ModuleRibbons'
import { Ribbon } from './components/layout/Ribbon'
import { ProjectPicker } from './components/layout/ProjectPicker'
import { CommandPalette } from './components/layout/CommandPalette'
import { ToastContainer } from './components/ui/Toast'
import { PWAUpdatePrompt } from './components/ui/PWAUpdatePrompt'
import { FirstRunWelcomeModal } from './components/FirstRunWelcomeModal'
import { HelpPanel } from './pages/HelpPanel'
import { DashboardPanel } from './pages/dashboard/DashboardPanel'
import { PlaceholderPanel } from './pages/PlaceholderPanel'
// Cost
import { CostDashboardPanel } from './pages/cost/CostDashboardPanel'
import { CustomerReportPanel } from './pages/cost/CustomerReportPanel'
import { ForecastPanel } from './pages/cost/ForecastPanel'
import { MikaPanel } from './pages/cost/MikaPanel'
import { ReconcilePanel } from './pages/cost/ReconcilePanel'
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
import { CostRegisterPanel } from './pages/cost/CostRegisterPanel'
// Personnel
import { RateCardsPanel } from './pages/personnel/RateCardsPanel'
import { ResourcesPanel } from './pages/personnel/ResourcesPanel'
import { PersonsDirectoryPanel } from './pages/personnel/PersonsDirectoryPanel'
import { YearViewPanel } from './pages/personnel/YearViewPanel'
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
import { NrgApprovalsPanel } from './pages/site/NrgApprovalsPanel'
import { NrgScopeAllocationsPanel } from './pages/site/NrgScopeAllocationsPanel'
import { NrgCreditNotesPanel } from './pages/site/NrgCreditNotesPanel'
import { NrgReportsPanel } from './pages/site/NrgReportsPanel'
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
import { HertzRatesPanel } from './pages/settings/HertzRatesPanel'
import { HertzLocationsPanel } from './pages/settings/HertzLocationsPanel'
import { ProfilePage } from './pages/settings/ProfilePage'
import { SitesPanel } from './pages/settings/SitesPanel'
import { PrePlanningPanel } from './pages/project/PrePlanningPanel'
import { HSEHoursPanel } from './pages/personnel/HSEHoursPanel'
import { AuditTrailPanel } from './pages/settings/AuditTrailPanel'
import { AdminPanel } from './pages/settings/AdminPanel'
import { ResourceBoardPanel } from './pages/resources/ResourceBoardPanel'
import { ResourceManagerHome } from './pages/resources/ResourceManagerHome'
import { ToolingManagerHome } from './pages/resources/ToolingManagerHome'
import { CrewConfirmationPanel } from './pages/resources/CrewConfirmationPanel'
import { ResourceManagerInductionsPanel } from './pages/resources/ResourceManagerInductionsPanel'
import { AvailabilityTimelinePanel } from './pages/resources/AvailabilityTimelinePanel'
import { DemandSupplyPanel } from './pages/resources/DemandSupplyPanel'
import { AssetBoardPanel } from './pages/resources/AssetBoardPanel'
import { AssetTimelinePanel } from './pages/resources/AssetTimelinePanel'
import { ToolingDemandPanel } from './pages/resources/ToolingDemandPanel'
import { PlatformHomePanel } from './pages/platform/PlatformHomePanel'
import { ResourceRequirementsPanel } from './pages/project/ResourceRequirementsPanel'
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
import { MobileShell } from './components/mobile/MobileShell'
import { MobileDesktopOnly } from './components/mobile/MobilePanelHeader'
import { MOBILE_OPTIMISED, PANEL_FRIENDLY_NAMES } from './lib/mobilePanels'

// Mobile-only hub pages — landing pages for the bottom tabs that group
// multiple sub-panels (People, Parts). Lazy because phone-only code.
const PeopleHub = lazy(() =>
  import('./pages/mobile/PeopleHub').then(m => ({ default: m.PeopleHub }))
)
const PartsHub = lazy(() =>
  import('./pages/mobile/PartsHub').then(m => ({ default: m.PartsHub }))
)
import { useIsMobile } from './hooks/useIsMobile'
import type { Session } from '@supabase/supabase-js'
import type { Project } from './types'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function AppInner() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  const { activePanel, activeProject, setActivePanel, setActiveProject, restoreProject } = useAppStore()
  const { isResourceModule, isToolingModule } = useModuleRibbon(activePanel)

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

  // Panels that don't need a project — refreshing on these should NOT open the picker
  const NO_PROJECT_PANELS = new Set([
    'profile', 'user-management', 'admin', 'audit-trail', 'sites',
    'payroll-rules', 'rate-defaults', 'hertz-rates', 'hertz-locations',
    'resource-manager', 'tooling-manager',
    'resource-board', 'resource-crew-confirm', 'resource-inductions',
    'resource-timeline', 'resource-demand', 'resource-assets',
    'resource-asset-timeline', 'resource-tooling-demand',
    'hr-directory', 'hr-year-view',
  ])

  function needsProject(): boolean {
    const panel = useAppStore.getState().activePanel
    // null panel = platform home, no project needed
    if (!panel) return false
    return !NO_PROJECT_PANELS.has(panel)
  }
  const [cmdOpen, setCmdOpen] = useState(false)
  const [restoringProject, setRestoringProject] = useState(false)
  const isMobile = useIsMobile()

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
                  console.warn(`[App] project restore failed:`, error?.message ?? 'no data')
                  if (needsProject()) setPickerOpen(true)
                } else {
                  console.log(`[App] project restored: ${data.name}`)
                  restoreProject(data as Project)
                }
              })
          } else {
            console.log(`[App] ${ms()} INITIAL_SESSION — no persisted project`)
            if (needsProject()) setPickerOpen(true)
          }
        }
      } else if (event === 'SIGNED_IN') {
        if (!initialSessionSeen) {
          console.log(`[App] ${ms()} ignoring stale SIGNED_IN (waiting for INITIAL_SESSION)`)
          return
        }
        setSession(s)
        if (s && !useAppStore.getState().activeProject && needsProject()) setPickerOpen(true)
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

  // Keep --chrome-height CSS variable in sync so fixed drawers clear the app chrome
  useEffect(() => {
    function update() {
      const header = document.querySelector('.app-header')
      const ribbon = document.querySelector('.ribbon-nav')
      const h = (header?.getBoundingClientRect().height ?? 0) +
                (ribbon?.getBoundingClientRect().height ?? 0)
      document.documentElement.style.setProperty('--chrome-height', h + 'px')
    }
    update()
    const t = setTimeout(update, 50)
    const obs = new ResizeObserver(update)
    document.querySelectorAll('.app-header, .ribbon-nav').forEach(el => obs.observe(el))
    return () => { clearTimeout(t); obs.disconnect() }
  })

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
      <div className="app-boot-loading">
        <span className="spinner" style={{ width:'32px', height:'32px' }} />
        {messages[loadingPhase] && (
          <span style={{ fontSize:'13px', color:'var(--text3)', maxWidth:'320px', textAlign:'center' }}>
            {messages[loadingPhase]}
          </span>
        )}
      </div>
    )
  }
  if (!session) return <><LoginPage /><ToastContainer /><PWAUpdatePrompt /></>

  // Mobile shell — runs on screens ≤900px. Same Supabase session, same PanelRouter.
  // Panels not in MOBILE_OPTIMISED_PANELS show a hard-block "Open on desktop" screen.
  return isMobile ? (
    <>
      {pickerOpen && (
        <ProjectPicker onClose={() => {
          setPickerOpen(false)
          if (!activeProject) setPickerOpen(true)
        }} />
      )}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <MobileShell
        onOpenPicker={() => setPickerOpen(true)}
        onOpenSearch={() => setCmdOpen(true)}
      >
        {(['profile', 'user-management', 'admin', 'audit-trail', 'sites', 'payroll-rules', 'rate-defaults', 'hertz-rates', 'hertz-locations', 'resource-manager', 'tooling-manager', 'resource-board', 'resource-crew-confirm', 'resource-inductions', 'resource-timeline', 'resource-demand', 'resource-assets', 'resource-asset-timeline', 'resource-tooling-demand', 'hr-directory', 'hr-year-view'].includes(activePanel ?? '')) ? (
          <MobilePanelRouter panel={activePanel ?? 'dashboard'} />
        ) : !activeProject ? (
          restoringProject ? (
            <div className="mobile-loading"><span className="spinner" /> Restoring project…</div>
          ) : (
            <div className="mobile-empty">
              <div className="mobile-empty-icon">⚙️</div>
              <h3>Select a project</h3>
              <p>Tap the project pill at the top to choose a project.</p>
              <button className="btn btn-primary" style={{ marginTop:'16px' }} onClick={() => setPickerOpen(true)}>
                Open Project Picker
              </button>
            </div>
          )
        ) : (
          <MobilePanelRouter panel={activePanel ?? 'dashboard'} />
        )}
      </MobileShell>
      <ToastContainer />
      <PWAUpdatePrompt />
    </>
  ) : (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>

      {/* Full-screen project picker overlay */}
      {pickerOpen && (
        <ProjectPicker onClose={(projectSelected?: boolean) => {
          setPickerOpen(false)
          if (!projectSelected && !activeProject && needsProject()) setPickerOpen(true)
        }} />
      )}

      {/* Command palette */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      {/* Header — always visible when logged in */}
      <Header
        onOpenPicker={() => setPickerOpen(true)}
        onOpenSearch={() => setCmdOpen(true)}
        onOpenSettings={() => setActivePanel('project-settings')}
        onGoHome={() => { setPickerOpen(false); setActiveProject(null); setActivePanel(null) }}
      />

      {/* Ribbon — project ribbon OR module ribbon */}
      {activeProject
        ? <Ribbon />
        : isResourceModule ? <ResourceManagerRibbon />
        : isToolingModule  ? <ToolingRibbon />
        : null
      }

      {/* Main panel */}
      <div style={{ flex:1, overflow:'auto', background:'var(--bg)' }}>
        {/* Profile and settings panels don't require an active project */}
        {(['profile', 'user-management', 'admin', 'audit-trail', 'sites', 'payroll-rules', 'rate-defaults', 'hertz-rates', 'hertz-locations', 'resource-manager', 'tooling-manager', 'resource-board', 'resource-crew-confirm', 'resource-inductions', 'resource-timeline', 'resource-demand', 'resource-assets', 'resource-asset-timeline', 'resource-tooling-demand', 'hr-directory', 'hr-year-view'].includes(activePanel ?? '')) ? (
          <PanelRouter panel={activePanel ?? 'dashboard'} />
        ) : !activeProject ? (
          restoringProject ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'70vh', gap:'12px' }}>
              <span className="spinner" style={{ width:'28px', height:'28px' }} />
              <span style={{ fontSize:'13px', color:'var(--text3)' }}>Restoring your project...</span>
            </div>
          ) : (
            <PlatformHomePanel onOpenPicker={() => setPickerOpen(true)} />
          )
        ) : (
          <PanelRouter panel={activePanel ?? 'dashboard'} />
        )}
      </div>

      <ToastContainer />
      <PWAUpdatePrompt />
      <FirstRunWelcomeModal />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
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
  'resource-':     'resources',
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
    case 'tooling-tour':          return p('🗺️', 'Tour View', 'Track SE Rental tooling movements between sites')
    case 'calendar':              return <CalendarPanel />
    case 'gantt':                 return <GanttPanel />
    case 'project-settings':      return <ProjectSettingsPanel />
    case 'resource-requirements': return <ResourceRequirementsPanel />
    case 'pre-planning':          return <PrePlanningPanel />
    case 'wbs-list':              return <WBSPanel />
    case 'public-holidays':       return <PublicHolidaysPanel />
    case 'variations':            return <VariationsPanel />
    case 'cost-dashboard':        return <CostDashboardPanel />
    case 'cost-customer-report':  return <CustomerReportPanel />
    case 'cost-forecast':         return <ForecastPanel />
    case 'cost-mika':            return <MikaPanel />
    case 'cost-reconcile':       return <ReconcilePanel />
    case 'pre-planning-report':  return <PrePlanningReportPanel />
    case 'cost-scurve':           return <SCurvePanel />
    case 'cost-report':           return <CostReportPanel />
    case 'cost-register':         return <CostRegisterPanel />
    case 'reports-db':            return <ReportsDatabasePanel />
    case 'purchase-orders':       return <POsPanel />
    case 'po-manager':             return <POsPanel />
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
    case 'hr-directory':          return <PersonsDirectoryPanel />
    case 'hr-year-view':          return <YearViewPanel />
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
    case 'nrg-approvals':         return <NrgApprovalsPanel />
      case 'nrg-scope-allocations': return <NrgScopeAllocationsPanel />
      case 'nrg-credit-notes':      return <NrgCreditNotesPanel />
      case 'nrg-reports':           return <NrgReportsPanel />
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
    case 'admin':                 return <AdminPanel />
    case 'resource-manager':       return <ResourceManagerHome />
    case 'tooling-manager':        return <ToolingManagerHome />
    case 'resource-board':        return <ResourceBoardPanel />
    case 'resource-crew-confirm':   return <CrewConfirmationPanel />
    case 'resource-inductions':      return <ResourceManagerInductionsPanel />
    case 'resource-timeline':       return <AvailabilityTimelinePanel />
    case 'resource-demand':         return <DemandSupplyPanel />
    case 'resource-assets':         return <AssetBoardPanel />
    case 'resource-asset-timeline': return <AssetTimelinePanel />
    case 'resource-tooling-demand': return <ToolingDemandPanel />
    case 'rate-defaults':         return <GlobalRateDefaultsPanel />
    case 'payroll-rules':         return <PayrollRulesPanel />
    case 'hertz-rates':           return <HertzRatesPanel />
    case 'hertz-locations':       return <HertzLocationsPanel />
    case 'profile':               return <ProfilePage />
    case 'sites':                 return <SitesPanel />
    case 'audit-trail':           return <AuditTrailPanel />
    case 'migration':             return <MigrationPanel />
    default:                      return p('🚧', panel, 'Coming soon')
  }
}

// ════════════════════════════════════════════════════════════════════════
// MOBILE PANEL ROUTER
// MOBILE_OPTIMISED and PANEL_FRIENDLY_NAMES live in lib/mobilePanels.ts so
// MobileNavSheet can also import them (to hide desktop-only items from the
// More sheet).
// ════════════════════════════════════════════════════════════════════════

function MobilePanelRouter({ panel }: { panel: string }) {
  // Mobile-only hub pages — landing pages for bottom tabs that aggregate
  // several sub-panels. Live here (not in PanelRouter) so they don't
  // leak into the desktop dispatcher.
  if (panel === 'mobile-people-hub') {
    return (
      <Suspense fallback={<div className="mobile-loading"><span className="spinner" /> Loading…</div>}>
        <PeopleHub />
      </Suspense>
    )
  }
  if (panel === 'mobile-parts-hub') {
    return (
      <Suspense fallback={<div className="mobile-loading"><span className="spinner" /> Loading…</div>}>
        <PartsHub />
      </Suspense>
    )
  }
  // Permission check still applies — uses same helper as desktop
  if (MOBILE_OPTIMISED.has(panel)) {
    return <PanelRouter panel={panel} />
  }
  const friendly = PANEL_FRIENDLY_NAMES[panel] || panel
  return <MobileDesktopOnly panelName={friendly} />
}
