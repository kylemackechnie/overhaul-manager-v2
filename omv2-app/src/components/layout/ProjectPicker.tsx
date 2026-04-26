import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../ui/Toast'
import type { Project, Site } from '../../types'

interface ProjectPickerProps {
  onClose: () => void
}

const SITE_COLOURS = ['#0ea5e9','#f59e0b','#8b5cf6','#10b981','#f43f5e','#3b82f6','#ec4899','#14b8a6']

function siteColour(siteId: string, allIds: string[]): string {
  const idx = allIds.indexOf(siteId)
  return SITE_COLOURS[idx % SITE_COLOURS.length] || '#94a3b8'
}

function projStatus(p: Project): 'active' | 'planned' | 'closed' {
  if (!p.start_date) return 'planned'
  const now = new Date().toISOString().slice(0, 10)
  if (p.end_date && p.end_date < now) return 'closed'
  if (p.start_date <= now) return 'active'
  return 'planned'
}

export function ProjectPicker({ onClose }: ProjectPickerProps) {
  const { activeProject, setActiveProject, currentUser } = useAppStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string|null>(null)
  const [activeSiteKey, setActiveSiteKey] = useState('__all__')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectSiteId, setNewProjectSiteId] = useState('')
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    console.log('[Picker] mounted — calling load()')
    // Session is guaranteed by App.tsx before this component renders
    load()
    if (activeProject) {
      const siteId = (activeProject as Project & { site_id?: string }).site_id
      if (siteId) setActiveSiteKey(siteId)
    }
    // Escape key to close when project already selected
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && activeProject) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function load() {
    const t0 = performance.now()
    const ms = () => `+${Math.round(performance.now() - t0)}ms`
    console.log(`[Picker] ${ms()} load() entered`)
    setLoading(true)
    setLoadError(null)
    try {
      // Diagnostic: time getSession() separately — this is suspected to hang on cold-start refresh
      console.log(`[Picker] ${ms()} calling getSession()...`)
      const sessionTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getSession() hung for 5s — auth not initialised')), 5000)
      )
      const sessionResult = await Promise.race([
        supabase.auth.getSession(),
        sessionTimeout,
      ])
      const session = sessionResult.data.session
      console.log(`[Picker] ${ms()} getSession() resolved | uid:`, session?.user?.id ?? 'NONE', '| expires:', session?.expires_at ?? 'N/A')

      console.log(`[Picker] ${ms()} firing projects + sites queries...`)
      const queryTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('projects/sites query hung for 8s — RLS or network issue')), 8000)
      )
      const [projResult, siteResult] = await Promise.race([
        Promise.all([
          supabase.from('projects').select('*, site:sites(id,name)').order('created_at', { ascending: false }),
          supabase.from('sites').select('*').order('name'),
        ]),
        queryTimeout,
      ])
      console.log(`[Picker] ${ms()} queries resolved | projects:`, projResult.data?.length ?? 'error', '| sites:', siteResult.data?.length ?? 'error', '| projErr:', projResult.error?.message ?? 'ok', '| siteErr:', siteResult.error?.message ?? 'ok')
      if (projResult.error) throw projResult.error
      if (siteResult.error) throw siteResult.error
      setProjects((projResult.data || []) as Project[])
      setSites((siteResult.data || []) as Site[])
      console.log(`[Picker] ${ms()} load() complete — state set`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setLoadError(msg)
      console.error(`[Picker] ${ms()} load error:`, e)
    } finally {
      setLoading(false)
      console.log(`[Picker] ${ms()} load() finally — loading=false`)
    }
  }

  async function selectProject(p: Project) {
    setActiveProject(p)
    onClose()
  }

  async function createProject() {
    if (!newProjectName.trim()) return
    setCreating(true)
    try {
      const { data, error } = await supabase.from('projects')
        .insert({ name: newProjectName.trim(), site_id: newProjectSiteId || null, wbs: '', notes: '' })
        .select('*, site:sites(id,name)').single()
      if (error) throw error
      if (currentUser) {
        await supabase.from('project_members').insert({ project_id: data.id, user_id: currentUser.id, role: 'owner' })
      }
      toast('Project created', 'success')
      setProjects(prev => [data as Project, ...prev])
      setActiveProject(data as Project)
      onClose()
    } catch (e: unknown) {
      toast((e as Error).message, 'error')
    }
    setCreating(false)
  }

  const allSiteIds = sites.map(s => s.id).sort()

  // Sidebar: group sites by country/state
  function renderSidebar() {
    const totalCount = projects.length
    const siteProjects = (siteId: string) => projects.filter(p => (p as Project & { site_id?: string }).site_id === siteId)

    return (
      <div className="picker-sidebar">
        <div className="picker-sb-label">Sites</div>

        <button className={`picker-sb-btn ${activeSiteKey === '__all__' ? 'active' : ''}`}
          onClick={() => setActiveSiteKey('__all__')}>
          <div className="picker-sb-dot" style={{ background: '#94a3b8' }} />
          <span className="picker-sb-name">All Sites</span>
          <span className="picker-sb-count">{totalCount}</span>
        </button>

        {/* Australia group */}
        {sites.length > 0 && (
          <>
            <div className="picker-sb-country">
              <span className="picker-sb-flag">🇦🇺</span>Australia
            </div>
            {sites.map(site => {
              const colour = siteColour(site.id, allSiteIds)
              const count = siteProjects(site.id).length
              const isActive = activeSiteKey === site.id
              return (
                <button key={site.id} className={`picker-sb-btn ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveSiteKey(site.id)}>
                  <div className="picker-sb-dot" style={{ background: colour }} />
                  <span className="picker-sb-name">{site.name}</span>
                  <span className="picker-sb-count">{count}</span>
                </button>
              )
            })}
          </>
        )}

        {/* No site */}
        {projects.filter(p => !(p as Project & { site_id?: string }).site_id).length > 0 && (
          <>
            <div className="picker-sb-country" style={{ paddingTop: '10px' }}>
              <span className="picker-sb-flag">📋</span>Unassigned
            </div>
            <button className={`picker-sb-btn ${activeSiteKey === '__nosite__' ? 'active' : ''}`}
              onClick={() => setActiveSiteKey('__nosite__')}>
              <div className="picker-sb-dot" style={{ background: '#94a3b8' }} />
              <span className="picker-sb-name">No Site</span>
              <span className="picker-sb-count">{projects.filter(p => !(p as Project & { site_id?: string }).site_id).length}</span>
            </button>
          </>
        )}

        <div className="picker-sb-divider" />
        <button className="picker-sb-action" onClick={() => setShowNewProject(true)}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M8 5.5v5M5.5 8h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          New Project
        </button>
      </div>
    )
  }

  // Main: project cards
  function renderMain() {
  let filteredProjects: Project[]
    let siteTitle: string
    let siteColourHex: string
    let site: Site | null = null

    if (activeSiteKey === '__all__') {
      return renderAllSites()
    } else if (activeSiteKey === '__nosite__') {
      filteredProjects = projects.filter(p => !(p as Project & { site_id?: string }).site_id)
      siteTitle = 'No Site Assigned'
      siteColourHex = '#94a3b8'
    } else {
      site = sites.find(s => s.id === activeSiteKey) || null
      if (!site) return renderAllSites()
      filteredProjects = projects.filter(p => (p as Project & { site_id?: string }).site_id === activeSiteKey)
      siteTitle = site.name
      siteColourHex = siteColour(activeSiteKey, allSiteIds)
    }

    return (
      <div className="picker-main">
        <div style={{padding:'10px 16px 0'}}>
          <input
            className="input"
            style={{width:'100%',fontSize:'13px',marginBottom:'4px'}}
            placeholder="Search projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus={false}
          />
        </div>
        <div className="picker-main-header">
          <div className="picker-site-hero">
            <div className="picker-site-icon" style={{ background: siteColourHex + '22' }}>🏭</div>
            <div>
              <div className="picker-site-title">{siteTitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowNewProject(true)}>
              + New Project
            </button>
          </div>
        </div>

        <div className="picker-section-label">Projects — {filteredProjects.length} total</div>
        <div className="picker-proj-grid">
          {filteredProjects.map(p => {
            const status = projStatus(p)
            const isActive = p.id === activeProject?.id
            return (
              <div key={p.id} className={`picker-proj-card ${isActive ? 'is-active' : ''}`}
                onClick={() => selectProject(p)}>
                <div className="picker-proj-accent" style={{ background: siteColourHex }} />
                <div className={`picker-proj-status pps-${status}`}>{status.toUpperCase()}</div>
                <div className="ppc-name">{p.name}</div>
                <div className="ppc-wbs">{p.wbs || 'No WBS'}</div>
                <div className="ppc-dates">
                  {p.start_date ? `${p.start_date}${p.end_date ? ' → ' + p.end_date : ''}` : 'No dates set'}
                </div>
              </div>
            )
          })}
          <div className="picker-proj-add" onClick={() => setShowNewProject(true)}>
            <div style={{ fontSize: '20px', marginBottom: '6px' }}>+</div>
            Add project
          </div>
        </div>
      </div>
    )
  }

  function renderAllSites() {
    return (
      <div className="picker-main">
        <div style={{padding:'10px 16px 0'}}>
          <input
            className="input"
            style={{width:'100%',fontSize:'13px',marginBottom:'4px'}}
            placeholder="Search projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus={false}
          />
        </div>
        <div className="picker-main-header">
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>All Sites</div>
            <div style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '2px' }}>
              {sites.length} sites · {projects.length} projects
            </div>
          </div>
          <button className="btn btn-primary" style={{ fontSize: '12px' }} onClick={() => setShowNewProject(true)}>
            + New Project
          </button>
        </div>

        {sites.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏭</div>
            <h3>No sites yet</h3>
            <p>Projects will appear here once sites are configured.</p>
          </div>
        ) : (
          <>
            <div className="picker-all-grid">
              {sites.map(site => {
                const colour = siteColour(site.id, allSiteIds)
                const siteProjects = projects.filter(p => (p as Project & { site_id?: string }).site_id === site.id)
                const activeCount = siteProjects.filter(p => projStatus(p) === 'active').length
                return (
                  <div key={site.id} className="picker-all-card" onClick={() => setActiveSiteKey(site.id)}>
                    <div className="picker-all-top">
                      <div className="picker-all-icon" style={{ background: colour + '22' }}>🏭</div>
                      <div>
                        <div className="picker-all-name">{site.name}</div>
                      </div>
                    </div>
                    <div className="picker-all-stats">
                      <div>
                        <div className="picker-all-num">{siteProjects.length}</div>
                        <div className="picker-all-numlbl">projects</div>
                      </div>
                      <div>
                        <div className="picker-all-num" style={{ color: colour }}>{activeCount}</div>
                        <div className="picker-all-numlbl">active</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Unassigned projects */}
            {projects.filter(p => !(p as Project & { site_id?: string }).site_id).length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <div className="picker-section-label">Unassigned Projects</div>
                <div className="picker-proj-grid">
                  {projects.filter(p => !(p as Project & { site_id?: string }).site_id).map(p => (
                    <div key={p.id} className={`picker-proj-card ${p.id === activeProject?.id ? 'is-active' : ''}`}
                      onClick={() => selectProject(p)}>
                      <div className={`picker-proj-status pps-${projStatus(p)}`}>{projStatus(p).toUpperCase()}</div>
                      <div className="ppc-name">{p.name}</div>
                      <div className="ppc-wbs">{p.wbs || 'No WBS'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const initials = currentUser
    ? (currentUser.name || currentUser.email || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="project-picker-overlay">
      {/* Top bar */}
      <div className="picker-topbar">
        <div className="picker-topbar-logo">
          <div className="picker-logo">SE</div>
          <span className="picker-title">Overhaul Manager</span>
          <span className="picker-ver">v2</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeProject && (
            <button className="btn btn-sm" onClick={onClose}>← Back to {activeProject.name}</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '20px', padding: '4px 10px 4px 5px' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: '9px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {initials}
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text2)' }}>{currentUser?.name || currentUser?.email || 'User'}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="loading-center" style={{ flexDirection: 'column', gap: '12px' }}>
          <>
            <span className="spinner" style={{ width: '32px', height: '32px' }} />
            <span style={{ fontSize: '13px', color: 'var(--text3)' }}>Loading projects...</span>
          </>
          {activeProject && <button className="btn" onClick={onClose}>← Back to {activeProject.name}</button>}
        </div>
      ) : loadError ? (
        <div className="loading-center" style={{ flexDirection: 'column', gap: '12px' }}>
          <div style={{ color: 'var(--red)', fontSize: '14px', fontWeight: 600 }}>Failed to load projects</div>
          <div style={{ color: 'var(--text3)', fontSize: '12px', maxWidth: '300px', textAlign: 'center' }}>{loadError}</div>
          <button className="btn btn-primary" onClick={load}>Retry</button>
          <button className="btn" onClick={() => { supabase.auth.signOut() }}>Sign out &amp; sign in again</button>
        </div>
      ) : (
        <div className="picker-body">
          {renderSidebar()}
          {renderMain()}
        </div>
      )}

      {/* New project modal */}
      {showNewProject && (
        <div className="modal-overlay" onClick={() => setShowNewProject(false)}>
          <div className="modal" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Project</h3>
              <button className="btn btn-sm" onClick={() => setShowNewProject(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>Project Name *</label>
                <input className="input" value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  placeholder="e.g. Unit 3 LP Turbine Outage 2026" autoFocus
                  onKeyDown={e => e.key === 'Enter' && createProject()} />
              </div>
              <div className="fg">
                <label>Site</label>
                <select className="input" value={newProjectSiteId} onChange={e => setNewProjectSiteId(e.target.value)}>
                  <option value="">— No Site —</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNewProject(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createProject} disabled={creating || !newProjectName.trim()}>
                {creating ? <span className="spinner" style={{ width: '14px', height: '14px' }} /> : null}
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
