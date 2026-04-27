import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import type { Project, Site } from '../../types'
import { toast } from '../ui/Toast'

export function ProjectSelector({ onProjectSelected }: { onProjectSelected?: () => void }) {
  const { activeProject, setActiveProject, currentUser } = useAppStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSiteId, setNewSiteId] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    // Wait for auth session before querying (RLS requires authenticated user)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        loadProjects()
        loadSites()
      } else {
        setLoading(false)
      }
    })
  }, [])

  async function loadProjects() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*, site:sites(id,name)')
        .order('created_at', { ascending: false })
      if (error) console.error('loadProjects error:', error)
      if (data) setProjects(data as Project[])
    } catch(e) {
      console.error('loadProjects exception:', e)
    } finally {
      setLoading(false)
    }
  }

  async function loadSites() {
    const { data } = await supabase.from('sites').select('*').order('name')
    if (data) setSites(data as Site[])
  }

  async function createProject() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          name: newName.trim(),
          site_id: newSiteId || null,
          wbs: '',
          notes: '',
        })
        .select('*, site:sites(id,name)')
        .single()

      if (error) throw error

      // Add creator as owner
      if (currentUser) {
        await supabase.from('project_members').insert({
          project_id: data.id,
          user_id: currentUser.id,
          role: 'owner',
        })
      }

      setProjects(prev => [data as Project, ...prev])
      setActiveProject(data as Project)
      setShowNew(false)
      setNewName('')
      setNewSiteId('')
      toast('Project created', 'success')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Failed to create project', 'error')
    } finally {
      setCreating(false)
    }
  }

  // Group projects by site
  const grouped: Record<string, { site: Site | null; projects: Project[] }> = {}
  projects.forEach(p => {
    const key = p.site_id || '__none__'
    if (!grouped[key]) grouped[key] = { site: p.site || null, projects: [] }
    grouped[key].projects.push(p)
  })

  return (
    <div style={{
      width: '240px', flexShrink: 0,
      background: 'var(--bg2)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Projects
        </span>
        {currentUser?.role === 'admin' && (
          <button
            className="btn btn-sm btn-primary"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => setShowNew(true)}
          >
            + New
          </button>
        )}
      </div>

      {/* Project list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <span className="spinner" />
          </div>
        ) : projects.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>
            No projects yet
          </div>
        ) : (
          Object.entries(grouped).map(([key, group]) => (
            <div key={key}>
              {/* Site header */}
              <div style={{
                padding: '6px 14px 2px',
                fontSize: '10px', fontWeight: 700, color: 'var(--text3)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {group.site?.name || 'No Site'}
              </div>
              {group.projects.map(proj => (
                <button
                  key={proj.id}
                  onClick={() => { setActiveProject(proj); onProjectSelected?.() }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'flex-start',
                    gap: '8px', padding: '8px 14px',
                    background: activeProject?.id === proj.id ? 'var(--accent)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    color: activeProject?.id === proj.id ? '#fff' : 'var(--text)',
                    transition: 'background 100ms',
                  }}
                  onMouseEnter={e => {
                    if (activeProject?.id !== proj.id)
                      (e.currentTarget as HTMLElement).style.background = 'var(--bg3)'
                  }}
                  onMouseLeave={e => {
                    if (activeProject?.id !== proj.id)
                      (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {proj.name}
                    </div>
                    {proj.wbs && (
                      <div style={{ fontSize: '11px', opacity: 0.7, fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {proj.wbs}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* New project modal */}
      {showNew && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <div className="modal-header">
              <h3>New Project</h3>
              <button className="btn btn-sm" onClick={() => setShowNew(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg">
                <label>Project Name</label>
                <input
                  className="input" value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. SPS Unit 3 LP Turbine 2026"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && createProject()}
                />
              </div>
              <div className="fg">
                <label>Site (optional)</label>
                <select className="input" value={newSiteId} onChange={e => setNewSiteId(e.target.value)}>
                  <option value="">— No site —</option>
                  {sites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={createProject}
                disabled={creating || !newName.trim()}
              >
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
