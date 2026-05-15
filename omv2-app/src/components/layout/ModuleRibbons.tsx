/**
 * ModuleRibbons.tsx
 * Lightweight tab-bar ribbons for the Resource Manager and Tooling modules.
 * Shown instead of (or alongside) the project ribbon when in those modules.
 */
import { useAppStore } from '../../store/appStore'

// ── Resource Manager ribbon ───────────────────────────────────────────────────

const RESOURCE_TABS = [
  { icon: '🏠', label: 'Home',               panel: 'resource-manager'     },
  { icon: '👥', label: 'Resource Board',     panel: 'resource-board'       },
  { icon: '✅', label: 'Crew Confirmation',  panel: 'resource-crew-confirm' },
  { icon: '📅', label: 'Availability',       panel: 'resource-timeline'    },
  { icon: '📊', label: 'Demand vs Supply',   panel: 'resource-demand'      },
  { icon: '📋', label: 'People Directory',   panel: 'hr-directory'         },
  { icon: '🪪', label: 'Induction Register', panel: 'resource-inductions'  },
]

const TOOLING_TABS = [
  { icon: '🏠', label: 'Home',          panel: 'tooling-manager'          },
  { icon: '🧰', label: 'Asset Board',   panel: 'resource-assets'          },
  { icon: '📅', label: 'Timeline',      panel: 'resource-asset-timeline'  },
  { icon: '🔧', label: 'Demand',        panel: 'resource-tooling-demand'  },
]

const RESOURCE_PANELS = new Set(RESOURCE_TABS.map(t => t.panel))
const TOOLING_PANELS  = new Set(TOOLING_TABS.map(t => t.panel))

function ModuleTabBar({
  tabs, activePanel, setActivePanel, accentColor, moduleLabel,
}: {
  tabs: { icon: string; label: string; panel: string }[]
  activePanel: string | null
  setActivePanel: (p: string | null) => void
  accentColor: string
  moduleLabel: string
}) {
  return (
    <div className="ribbon-nav" style={{
      background: 'var(--bg2)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      paddingLeft: 12,
      paddingRight: 16,
      overflowX: 'auto',
      flexShrink: 0,
    }}>
      {/* Module label */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: accentColor,
        padding: '0 14px 0 4px',
        borderRight: '1px solid var(--border)',
        marginRight: 6,
        whiteSpace: 'nowrap',
        letterSpacing: '-0.01em',
        flexShrink: 0,
      }}>
        {moduleLabel}
      </div>

      {/* Tabs */}
      {tabs.map(tab => {
        const isActive = activePanel === tab.panel
        return (
          <button
            key={tab.panel}
            onClick={() => setActivePanel(tab.panel)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '10px 12px',
              fontSize: 12, fontWeight: isActive ? 600 : 400,
              color: isActive ? accentColor : 'var(--text2)',
              background: 'none', border: 'none',
              borderBottom: `2px solid ${isActive ? accentColor : 'transparent'}`,
              cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'color 0.1s, border-color 0.1s',
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'var(--text2)' }}
          >
            <span style={{ fontSize: 13 }}>{tab.icon}</span>
            {tab.label}
          </button>
        )
      })}

      {/* Platform home link */}
      <button
        onClick={() => setActivePanel(null)}
        style={{
          marginLeft: 'auto', flexShrink: 0,
          fontSize: 11, color: 'var(--text3)',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 8px', borderRadius: 4,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text3)'}
      >
        ← Platform
      </button>
    </div>
  )
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function useModuleRibbon(activePanel: string | null) {
  return {
    isResourceModule: RESOURCE_PANELS.has(activePanel ?? ''),
    isToolingModule:  TOOLING_PANELS.has(activePanel ?? ''),
  }
}

export function ResourceManagerRibbon() {
  const { activePanel, setActivePanel } = useAppStore()
  return (
    <ModuleTabBar
      tabs={RESOURCE_TABS}
      activePanel={activePanel}
      setActivePanel={setActivePanel}
      accentColor="#0369a1"
      moduleLabel="Resource Manager"
    />
  )
}

export function ToolingRibbon() {
  const { activePanel, setActivePanel } = useAppStore()
  return (
    <ModuleTabBar
      tabs={TOOLING_TABS}
      activePanel={activePanel}
      setActivePanel={setActivePanel}
      accentColor="#7c3aed"
      moduleLabel="Tooling"
    />
  )
}
