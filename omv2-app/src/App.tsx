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
import type { Session } from '@supabase/supabase-js'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const { activePanel, activeProject } = useAppStore()
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
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden'}}>
      {activeProject && <Ribbon />}
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        <ProjectSelector />
        <div style={{flex:1,overflow:'auto',background:'var(--bg2)'}}>
          {!activeProject ? (
            <div className="empty-state" style={{paddingTop:'80px'}}>
              <div className="icon">⚙️</div>
              <h3>Select a project</h3>
              <p>Choose a project from the sidebar or create a new one.</p>
            </div>
          ) : <PanelRouter panel={activePanel} />}
        </div>
      </div>
      <ToastContainer />
    </div>
  )
}

function PanelRouter({ panel }: { panel: string }) {
  const p = (icon: string, title: string, sub?: string) => <PlaceholderPanel icon={icon} title={title} subtitle={sub} />
  switch (panel) {
    case 'dashboard': return <DashboardPanel />
    case 'cost-dashboard': return p('💰','Cost Dashboard')
    case 'cost-forecast': return p('📈','Forecast')
    case 'cost-scurve': return p('📉','S-Curve')
    case 'expenses': return p('🧾','Expenses')
    case 'purchase-orders': return p('📄','Purchase Orders')
    case 'invoices': return p('💳','Invoices')
    case 'sap-recon': return p('🔄','SAP Reconciliation')
    case 'cost-report': return p('📑','Cost Report')
    case 'reports-db': return p('📦','Reports Database')
    case 'hr-dashboard': return p('👥','HR Dashboard')
    case 'hr-resources': return p('👤','Resources')
    case 'hr-ratecards': return p('💲','Rate Cards')
    case 'hr-timesheets-trades': return p('⏱️','Trades Timesheets')
    case 'hr-timesheets-mgmt': return p('⏱️','Management Timesheets')
    case 'hr-timesheets-seag': return p('⏱️','SE AG Timesheets')
    case 'hr-timesheets-subcon': return p('⏱️','Subcontractor Timesheets')
    case 'hr-backoffice': return p('🏢','Back Office Hours')
    case 'hr-cars': return p('🚗','Cars')
    case 'hr-accommodation': return p('🏨','Accommodation')
    case 'hse-dashboard': return p('🦺','HSE Dashboard')
    case 'hr-inductions': return p('📋','Inductions')
    case 'hse-co2': return p('🌿','CO₂ Tracking')
    case 'subcon-rfq': return p('🤝','RFQ Register')
    case 'subcon-contracts': return p('📃','Contracts')
    case 'shipping-inbound': return p('📦','Inbound Shipping')
    case 'shipping-outbound': return p('🚚','Outbound Shipping')
    case 'hardware-contract': return p('🔧','Hardware Contract')
    case 'hardware-carts': return p('🛒','Hardware Carts')
    case 'parts-list': return p('🔩','Spare Parts')
    case 'tooling-tvs': return p('🧰','TV Register')
    case 'tooling-kollos': return p('📦','Kollos')
    case 'tooling-costings': return p('💶','Tooling Costings')
    case 'tooling-departments': return p('🏢','Departments')
    case 'hire-dry': return p('🚜','Dry Hire')
    case 'hire-wet': return p('🏗️','Wet Hire')
    case 'hire-local': return p('🧰','Local Hire')
    case 'work-orders': return p('📋','Work Orders')
    case 'nrg-dashboard': return p('📊','NRG Dashboard')
    case 'nrg-tce': return p('📋','TCE Register')
    case 'nrg-ohf': return p('📈','Overhead Forecast')
    case 'global-tooling': return p('🧰','Global Tooling')
    case 'global-parts': return p('🔩','Global Parts')
    case 'global-kits': return p('📦','Global Kits')
    case 'calendar': return p('📅','Calendar')
    case 'gantt': return p('📋','Gantt Chart')
    case 'variations': return p('📝','Variations')
    case 'project-settings': return p('⚙️','Project Settings')
    case 'public-holidays': return p('🗓️','Public Holidays')
    case 'wbs-list': return p('📍','WBS List')
    case 'user-management': return p('👥','User Management')
    case 'audit-trail': return p('📋','Audit Trail')
    default: return p('🚧', panel, 'Coming soon')
  }
}
