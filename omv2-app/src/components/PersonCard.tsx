/**
 * PersonCard — right-side drawer showing a person's full profile.
 * Opens from any name in the app. Stays open while you work.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import { getPersonDeployments, type Person } from '../lib/persons'
import { toast } from './ui/Toast'

interface PersonCardProps {
  person: Person
  onClose: () => void
}

interface Deployment {
  id: string
  name: string
  role: string
  mob_in: string | null
  mob_out: string | null
  shift: string
  category: string
  project: { id: string; name: string; client: string; start_date: string; end_date: string } | null
}

const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  trades:        { bg: '#dbeafe', color: '#1e40af' },
  management:    { bg: '#d1fae5', color: '#065f46' },
  seag:          { bg: '#fef3c7', color: '#92400e' },
  subcontractor: { bg: '#f3e8ff', color: '#6b21a8' },
}

export function PersonCard({ person, onClose }: PersonCardProps) {
  const { currentUser } = useAppStore()
  const isAdmin = currentUser?.role === 'admin'
  const [tab, setTab] = useState<'overview' | 'history' | 'timesheets' | 'access'>('overview')
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [appUser, setAppUser] = useState<{ id: string; email: string; role: string; active: boolean; last_login: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [person.id])

  async function load() {
    setLoading(true)
    const deps = await getPersonDeployments(person.id) as Deployment[]
    setDeployments(deps)

    // Load timesheet appearances
    const resourceIds = deps.map(d => d.id)
    if (resourceIds.length > 0) {
      // Approximate: find weeks where this person appears (by name match across projects)
      // Full implementation would join via personId on crew — placeholder for now
    }

    // Load app user if linked
    if (person.app_user_id) {
      const { data } = await supabase.from('app_users')
        .select('id,email,role,active,last_login')
        .eq('id', person.app_user_id).single()
      setAppUser(data)
    }
    setLoading(false)
  }

  const now = new Date().toISOString().slice(0, 10)
  const current = deployments.filter(d => {
    const mobIn = d.mob_in || ''
    const mobOut = d.mob_out || '9999'
    return mobIn <= now && mobOut >= now
  })
  const upcoming = deployments.filter(d => (d.mob_in || '') > now)

  const catStyle = CAT_STYLE[person.default_category || 'trades'] || CAT_STYLE.trades

  function deploymentRow(d: Deployment, showProject = true) {
    return (
      <div key={d.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
        {showProject && d.project && (
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{d.project.name}</div>
        )}
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text2)', flexWrap: 'wrap' }}>
          <span>{d.role || '—'}</span>
          <span style={{ color: 'var(--text3)' }}>·</span>
          <span style={{ textTransform: 'capitalize' }}>{d.shift} shift</span>
          {d.mob_in && <><span style={{ color: 'var(--text3)' }}>·</span><span>{d.mob_in}{d.mob_out ? ` → ${d.mob_out}` : ''}</span></>}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 460,
      background: 'var(--bg)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', zIndex: 600, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%', background: catStyle.bg,
              color: catStyle.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 16, flexShrink: 0,
            }}>
              {person.full_name.split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{person.preferred_name || person.full_name}</div>
              {person.preferred_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{person.full_name}</div>}
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
                {person.default_role || '—'} · {person.company || '—'}
              </div>
            </div>
          </div>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
          {person.email && <a href={`mailto:${person.email}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>📧 {person.email}</a>}
          {person.phone && <span>📞 {person.phone}</span>}
          <span style={{ background: catStyle.bg, color: catStyle.color, padding: '1px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>
            {person.default_category || 'trades'}
          </span>
          <span style={{ background: person.active ? '#d1fae5' : '#fee2e2', color: person.active ? '#065f46' : '#991b1b', padding: '1px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
            {person.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
        {(['overview', 'history', 'timesheets', ...(isAdmin ? ['access'] : [])] as const).map(t => (
          <button key={t} onClick={() => setTab(t as typeof tab)}
            style={{
              flex: 1, padding: '9px 4px', border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: 12, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--accent)' : 'var(--text2)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              textTransform: 'capitalize',
            }}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
        {loading ? <div className="loading-center"><span className="spinner" /></div> : <>

          {/* Overview */}
          {tab === 'overview' && (
            <div>
              {current.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    ● Currently On Site ({current.length})
                  </div>
                  {current.map(d => deploymentRow(d))}
                </>
              )}
              {upcoming.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 0 8px' }}>
                    ◎ Upcoming ({upcoming.length})
                  </div>
                  {upcoming.map(d => deploymentRow(d))}
                </>
              )}
              {current.length === 0 && upcoming.length === 0 && (
                <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                  Not currently deployed on any project.
                </div>
              )}
              {deployments.length > 0 && (
                <div style={{ marginTop: 20, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text3)' }}>Total projects</span>
                    <span style={{ fontWeight: 600 }}>{deployments.length}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Work History */}
          {tab === 'history' && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
                All project deployments · {deployments.length} total
              </div>
              {deployments.length === 0 ? (
                <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>No deployment history yet.</div>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Project</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Role</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.map(d => (
                      <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 500 }}>{d.project?.name || '—'}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--text2)' }}>{d.role || '—'}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                          {d.mob_in || '—'}{d.mob_out ? ` → ${d.mob_out}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Timesheets */}
          {tab === 'timesheets' && (
            <div>
              <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                Timesheet history will appear here once cross-project timesheet querying is implemented.
                <br /><br />
                <span style={{ fontSize: 11 }}>Person is linked across {deployments.length} project resource records.</span>
              </div>
            </div>
          )}

          {/* App Access (admin only) */}
          {tab === 'access' && isAdmin && (
            <div>
              {appUser ? (
                <div>
                  <div style={{ padding: '12px 14px', background: '#d1fae5', borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: '#065f46', marginBottom: 4 }}>● Has app account</div>
                    <div style={{ color: '#065f46' }}>Last login: {appUser.last_login ? new Date(appUser.last_login).toLocaleString('en-AU') : 'Never'}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="fg-row">
                      <div className="fg"><label>Role</label><div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{appUser.role}</div></div>
                      <div className="fg"><label>Status</label><div style={{ fontWeight: 600, color: appUser.active ? 'var(--green)' : 'var(--red)' }}>{appUser.active ? 'Active' : 'Inactive'}</div></div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>To manage permissions, go to User Management → find this user.</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ padding: '12px 14px', background: 'var(--bg3)', borderRadius: 6, marginBottom: 16, fontSize: 12, color: 'var(--text3)' }}>
                    This person does not have an app login.
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.6 }}>
                    Create a login for {person.preferred_name || person.full_name} to give them access to the app.
                    {person.email ? ` An invite will be sent to ${person.email}.` : ' Add an email address to this person first.'}
                  </p>
                  {!person.email && (
                    <div style={{ padding: '10px 12px', background: '#fef3c7', borderRadius: 6, fontSize: 12, color: '#92400e', marginBottom: 14 }}>
                      ⚠ No email address on file. Edit the person profile to add one before creating a login.
                    </div>
                  )}
                  <button className="btn btn-primary" disabled={!person.email}
                    onClick={() => {
                      // Navigate to user management and pre-fill invite
                      toast('Go to File → User Management → Invite User to create a login for this person.', 'info')
                    }}>
                    + Create Login
                  </button>
                </div>
              )}
            </div>
          )}
        </>}
      </div>
    </div>
  )
}

// Hook for easy use
import { useState as useStateCard } from 'react'
export function usePersonCard() {
  const [cardPerson, setCardPerson] = useStateCard<Person | null>(null)
  const openCard = (person: Person) => setCardPerson(person)
  const closeCard = () => setCardPerson(null)
  return { cardPerson, openCard, closeCard }
}
