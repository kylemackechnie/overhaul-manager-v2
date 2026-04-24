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
import { RateCardsPanel } from './pages/personnel/RateCardsPanel'
import { ResourcesPanel } from './pages/personnel/ResourcesPanel'
import { WBSPanel } from './pages/project/WBSPanel'
import { ProjectSettingsPanel } from './pages/project/ProjectSettingsPanel'
import { POsPanel } from './pages/cost/POsPanel'
import { InvoicesPanel } from './pages/cost/InvoicesPanel'
import { VariationsPanel } from './pages/cost/VariationsPanel'
import { TimesheetsPanel } from './pages/personnel/TimesheetsPanel'
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
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh' }}>
      <span className="spinner" style={{width:'32px',height:'32px'}} />
    </div>
  )
  if (!session) return <><LoginPage /><ToastContainer /></>

  // When a project is active, sidebar is hidden by default (like HTML app)
  const showSidebar = !activeProject || sidebarOpen

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>
      {activeProject && <Ribbon />}
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        {/* Sidebar */}
        {showSidebar && <ProjectSelector onProjectSelected={() => setSidebarOpen(false)} />}

        {/* Main panel area */}
        <div style={{flex:1,overflow:'auto',background:'var(--bg2)',position:'relative'}}>
          {!activeProject ? (
            <div className="empty-state" style={{paddingTop:'80px'}}>
              <div className="icon">⚙️</div>
              <h3>Select a project</h3>
              <p>Choose a project from the sidebar or create a new one.</p>
            </div>
          ) : (
            <>
              {/* Show project picker button when sidebar is hidden */}
              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  style={{
                    position:'absolute',top:'10px',left:'10px',zIndex:10,
                    background:'var(--bg)',border:'1px solid var(--border)',
                    borderRadius:'6px',padding:'4px 10px',cursor:'pointer',
                    fontSize:'12px',color:'var(--text2)',display:'flex',
                    alignItems:'center',gap:'6px',
                  }}
                  title="Switch project"
                >
                  ☰ {activeProject.name}
                </button>
              )}
              <div style={{paddingTop: !sidebarOpen ? '0' : '0'}}>
                <PanelRouter panel={activePanel} />
              </div>
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
    case 'dashboard':              return <DashboardPanel />
    case 'hr-ratecards':           return <RateCardsPanel />
    case 'hr-resources':           return <ResourcesPanel />
    case 'wbs-list':               return <WBSPanel />
    case 'project-settings':       return <ProjectSettingsPanel />
    case 'purchase-orders':        return <POsPanel />
    case 'invoices':               return <InvoicesPanel />
    case 'variations':             return <VariationsPanel />
    case 'hr-timesheets-trades':   return <TimesheetsPanel type="trades" />
    case 'hr-timesheets-mgmt':     return <TimesheetsPanel type="mgmt" />
    case 'hr-timesheets-seag':     return <TimesheetsPanel type="seag" />
    case 'hr-timesheets-subcon':   return <TimesheetsPanel type="subcon" />
    case 'cost-dashboard':         return p('💰','Cost Dashboard')
    case 'cost-forecast':          return p('📈','Forecast')
    case 'cost-scurve':            return p('📉','S-Curve')
    case 'expenses':               return p('🧾','Expenses')
    case 'sap-recon':              return p('🔄','SAP Reconciliation')
    case 'cost-report':            return p('📑','Cost Report')
    case 'reports-db':             return p('📦','Reports Database')
    case 'hr-dashboard':           return p('👥','HR Dashboard')
    case 'hr-backoffice':          return p('🏢','Back Office Hours')
    case 'hr-cars':                return p('🚗','Cars')
    case 'hr-accommodation':       return p('🏨','Accommodation')
    case 'hse-dashboard':          return p('🦺','HSE Dashboard')
    case 'hr-inductions':          return p('📋','Inductions')
    case 'hse-co2':                return p('🌿','CO₂ Tracking')
    case 'subcon-rfq':             return p('🤝','RFQ Register')
    case 'subcon-contracts':       return p('📃','Contracts')
    case 'shipping-inbound':       return p('📦','Inbound Shipping')
    case 'shipping-outbound':      return p('🚚','Outbound Shipping')
    case 'hardware-contract':      return p('🔧','Hardware Contract')
    case 'hardware-carts':         return p('🛒','Hardware Carts')
    case 'parts-list':             return p('🔩','Spare Parts')
    case 'tooling-tvs':            return p('🧰','TV Register')
    case 'tooling-kollos':         return p('📦','Kollos')
    case 'tooling-costings':       return p('💶','Tooling Costings')
    case 'tooling-departments':    return p('🏢','Departments')
    case 'hire-dry':               return p('🚜','Dry Hire')
    case 'hire-wet':               return p('🏗️','Wet Hire')
    case 'hire-local':             return p('🧰','Local Hire')
    case 'work-orders':            return p('📋','Work Orders')
    case 'nrg-dashboard':          return p('📊','NRG Dashboard')
    case 'nrg-tce':                return p('📋','TCE Register')
    case 'nrg-ohf':                return p('📈','Overhead Forecast')
    case 'global-tooling':         return p('🧰','Global Tooling')
    case 'global-parts':           return p('🔩','Global Parts')
    case 'global-kits':            return p('📦','Global Kits')
    case 'calendar':               return p('📅','Calendar')
    case 'gantt':                  return p('📋','Gantt Chart')
    case 'public-holidays':        return p('🗓️','Public Holidays')
    case 'user-management':        return p('👥','User Management')
    case 'audit-trail':            return p('📋','Audit Trail')
    default:                       return p('🚧', panel, 'Coming soon')
  }
}
