import { useAppStore } from '../../store/appStore'

export function SiteDashboardPanel() {
  const { setActivePanel } = useAppStore()

  const sites = [
    {
      key: 'nrg',
      icon: '🏭',
      title: 'NRG Gladstone Power Station',
      desc: 'TCE tracking, work order actuals, TasTK payroll import & KPI model.',
      color: 'var(--mod-nrg, #3730a3)',
      panel: 'nrg-dashboard',
      actions: [
        { label: 'TCE Register',      panel: 'nrg-tce'      },
        { label: 'OH Forecast',       panel: 'nrg-ohf'      },
        { label: 'WO Actuals',        panel: 'nrg-actuals'  },
        { label: 'Cust Invoicing',    panel: 'nrg-invoicing' },
        { label: 'KPI Model',         panel: 'nrg-kpi'      },
      ],
    },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700 }}>🏭 Site Specific</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
          Customer-specific modules — select a site to get started
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {sites.map(site => (
          <div key={site.key} className="card"
            style={{ cursor: 'pointer', borderTop: `3px solid ${site.color}`, padding: '20px' }}
            onClick={() => setActivePanel(site.panel)}>
            <div style={{ fontSize: '28px', marginBottom: '10px' }}>{site.icon}</div>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>{site.title}</div>
            <div style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '14px', lineHeight: 1.5 }}>{site.desc}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
              {site.actions.map(a => (
                <button key={a.panel} className="btn btn-secondary btn-xs"
                  onClick={e => { e.stopPropagation(); setActivePanel(a.panel) }}>
                  {a.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '12px', color: site.color, fontWeight: 600 }}>Open Dashboard →</div>
          </div>
        ))}

        {/* Placeholder for future sites */}
        <div className="card" style={{ opacity: 0.4, borderTop: '3px solid var(--border2)', padding: '20px' }}>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>➕</div>
          <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>Add Another Site</div>
          <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
            Site-specific modules for other customers will appear here as they are configured.
          </div>
        </div>
      </div>
    </div>
  )
}
