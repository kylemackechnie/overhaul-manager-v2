/**
 * AdminPanel.tsx
 * Central hub for all administrative tools, replacing the scattered File menu entries.
 */
import { useAppStore } from '../../store/appStore'

const ADMIN_ITEMS = [
  {
    icon: '🪪',
    label: 'Induction Register',
    description: 'Upload SE Learning Courses and Lessons exports to update the global compliance register for all employees',
    panel: 'resource-inductions',
  },
  {
    icon: '✅',
    label: 'Crew Confirmation',
    description: 'Per-project mob readiness — flights, accommodation, car, inductions, medical status for every crew member',
    panel: 'resource-crew-confirm',
  },
  {
    icon: '📅',
    label: 'Availability Timeline',
    description: 'Cross-project Gantt by person — teal bars are OMV2 projects, grey bars are the broader register. Free gaps show available windows.',
    panel: 'resource-timeline',
  },
  {
    icon: '👥',
    label: 'Resource Board',
    description: 'Cross-project view of all people on active OMV2 projects — status, compliance, assignment',
    panel: 'resource-board',
  },
  {
    icon: '📋',
    label: 'People Directory',
    description: 'Browse and edit all personnel records, inductions and profile details',
    panel: 'hr-directory',
  },
  {
    icon: '📅',
    label: 'Resource Year View',
    description: '30,000ft Gantt of all resources across all 2026 projects',
    panel: 'hr-year-view',
  },
  {
    icon: '👥',
    label: 'User Management',
    description: 'Manage app users, roles and permissions',
    panel: 'user-management',
  },
  {
    icon: '🌐',
    label: 'Global Rate Defaults',
    description: 'Default labour rates applied across all projects',
    panel: 'rate-defaults',
  },
  {
    icon: '⚖️',
    label: 'Payroll Rules',
    description: 'Configure payroll calculation rules and allowances',
    panel: 'payroll-rules',
  },
  {
    icon: '🚗',
    label: 'Hertz Vehicle Rates',
    description: 'Manage Hertz rental vehicle rate tables',
    panel: 'hertz-rates',
  },
  {
    icon: '📍',
    label: 'Hertz Locations',
    description: 'Hertz pickup/dropoff location directory',
    panel: 'hertz-locations',
  },
  {
    icon: '📋',
    label: 'Audit Trail',
    description: 'View a log of all system changes and user actions',
    panel: 'audit-trail',
  },
  {
    icon: '📑',
    label: 'Reports Database',
    description: 'Saved and archived project reports',
    panel: 'reports-db',
  },
  {
    icon: '🔄',
    label: 'Data Migration',
    description: 'Import and migrate data from legacy systems',
    panel: 'migration',
  },
]

export function AdminPanel() {
  const { setActivePanel } = useAppStore()

  return (
    <div style={{
      maxWidth: 800, margin: '0 auto', padding: '32px 24px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          margin: 0, fontSize: 22, fontWeight: 700,
          color: 'var(--text)', letterSpacing: '-0.02em',
        }}>
          Admin
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text3)' }}>
          System configuration and administrative tools
        </p>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 12,
      }}>
        {ADMIN_ITEMS.map(item => (
          <button
            key={item.panel}
            onClick={() => setActivePanel(item.panel)}
            style={{
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '16px 18px',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'border-color 0.12s, box-shadow 0.12s',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
            onMouseEnter={e => {
              const el = e.currentTarget
              el.style.borderColor = 'var(--accent)'
              el.style.boxShadow = '0 2px 12px rgba(0,137,138,0.10)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget
              el.style.borderColor = 'var(--border)'
              el.style.boxShadow = 'none'
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>{item.icon}</span>
            <span style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text)',
              marginTop: 2,
            }}>
              {item.label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 }}>
              {item.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
