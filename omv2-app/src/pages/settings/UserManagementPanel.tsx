import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { writeAuditLog } from '../../lib/audit'
import { findOrCreatePerson } from '../../lib/persons'
import { ALL_MODULES, MODULE_LABELS, DEFAULT_PERMISSIONS, type Module } from '../../lib/permissions'
import type { AppUser, Project } from '../../types'

interface PermissionTemplate {
  id: string; name: string; permissions: Record<string, { read: boolean; write: boolean }>; is_builtin: boolean
}
interface AuditEntry {
  id: string; action: string; created_at: string
  detail: Record<string, unknown> | null
  target_user?: { name: string; email: string } | null
}

const STATUS_STYLE = {
  active:   { bg: '#d1fae5', color: '#065f46', label: 'Active' },
  inactive: { bg: '#fee2e2', color: '#991b1b', label: 'Inactive' },
  pending:  { bg: '#fef3c7', color: '#92400e', label: 'Pending' },
}

function userStatus(u: AppUser): 'active' | 'inactive' | 'pending' {
  if (!u.active) return 'inactive'
  if (!(u as AppUser & { auth_id?: string }).auth_id) return 'pending'
  return 'active'
}

const EMPTY_PERMS = () => Object.fromEntries(
  ALL_MODULES.map(m => [m, { ...DEFAULT_PERMISSIONS[m] }])
) as Record<Module, { read: boolean; write: boolean }>

export function UserManagementPanel() {
  const { currentUser } = useAppStore()
  const [users, setUsers] = useState<AppUser[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<PermissionTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AppUser | null>(null)
  const [drawerTab, setDrawerTab] = useState<'profile' | 'projects' | 'permissions' | 'activity'>('profile')
  const [activityLog, setActivityLog] = useState<AuditEntry[]>([])
  const [memberProjects, setMemberProjects] = useState<Record<string, string>>({}) // project_id → role
  const [saving, setSaving] = useState(false)

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState<{ name: string; email: string; role: 'admin' | 'member' | 'viewer' }>({ name: '', email: '', role: 'member' })
  const [inviting, setInviting] = useState(false)

  // Permissions edit (local copy for selected user)
  const [editPerms, setEditPerms] = useState<Record<Module, { read: boolean; write: boolean }>>(EMPTY_PERMS())

  // Template modal
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => { if (isAdmin) load() }, [])

  async function load() {
    setLoading(true)
    const [usersRes, projectsRes, tmplRes] = await Promise.all([
      supabase.from('app_users').select('*').order('name'),
      supabase.from('projects').select('id,name,client').order('name'),
      supabase.from('permission_templates').select('*').order('name'),
    ])
    setUsers((usersRes.data || []) as AppUser[])
    setProjects((projectsRes.data || []) as Project[])
    setTemplates((tmplRes.data || []) as PermissionTemplate[])
    setLoading(false)
  }

  const openDrawer = useCallback(async (user: AppUser) => {
    setSelected(user)
    setDrawerTab('profile')
    setEditPerms({ ...EMPTY_PERMS(), ...(user.permissions || {}) } as Record<Module, { read: boolean; write: boolean }>)
    // Load project memberships
    const { data: mems } = await supabase.from('project_members').select('project_id,role').eq('user_id', user.id)
    const map: Record<string, string> = {}
    for (const m of mems || []) map[m.project_id] = m.role
    setMemberProjects(map)
    // Load activity
    const { data: logs } = await supabase
      .from('audit_log')
      .select('id,action,created_at,detail,target_user:app_users!target_user_id(name,email)')
      .eq('performed_by', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setActivityLog((logs || []) as unknown as AuditEntry[])
  }, [])

  async function savePermissions() {
    if (!selected) return
    setSaving(true)
    const before = selected.permissions
    const { error } = await supabase.from('app_users').update({ permissions: editPerms }).eq('id', selected.id)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    writeAuditLog({ action: 'permission_changed', performedBy: currentUser, targetUserId: selected.id, detail: { before, after: editPerms } })
    toast('Permissions saved', 'success')
    setSelected({ ...selected, permissions: editPerms })
    setUsers(prev => prev.map(u => u.id === selected.id ? { ...u, permissions: editPerms } : u))
    setSaving(false)
  }

  async function saveProfile(field: Partial<AppUser>) {
    if (!selected) return
    const { error } = await supabase.from('app_users').update(field).eq('id', selected.id)
    if (error) { toast(error.message, 'error'); return }
    if (field.role) writeAuditLog({ action: 'role_changed', performedBy: currentUser, targetUserId: selected.id, detail: { role: field.role } })
    const updated = { ...selected, ...field }
    setSelected(updated)
    setUsers(prev => prev.map(u => u.id === selected.id ? updated as AppUser : u))
    toast('Saved', 'success')
  }

  async function toggleActive() {
    if (!selected) return
    const newActive = !selected.active
    await saveProfile({ active: newActive })
    writeAuditLog({ action: newActive ? 'user_reactivated' : 'user_deactivated', performedBy: currentUser, targetUserId: selected.id })
  }

  async function forcePasswordReset() {
    if (!selected) return
    await saveProfile({ force_password_reset: true } as Partial<AppUser>)
    writeAuditLog({ action: 'password_reset_forced', performedBy: currentUser, targetUserId: selected.id })
    toast('User will be prompted to reset password on next login', 'info')
  }

  async function deleteUser() {
    if (!selected) return
    if (selected.id === currentUser?.id) { toast('You cannot delete yourself', 'error'); return }
    const confirmed = confirm(
      `Delete ${selected.name || selected.email}?\n\n` +
      `This removes their access to the app, all project memberships, and the\n` +
      `login record. The same email can be re-invited later. This cannot be undone.`
    )
    if (!confirmed) return
    const { error } = await supabase.rpc('delete_app_user', { p_user_id: selected.id })
    if (error) { toast(error.message, 'error'); return }
    writeAuditLog({ action: 'user_deleted', performedBy: currentUser, targetUserId: selected.id, detail: { email: selected.email, name: selected.name } })
    toast(`Deleted ${selected.name || selected.email}`, 'success')
    setSelected(null)
    load()
  }

  async function toggleProjectAccess(projectId: string) {
    if (!selected) return
    if (memberProjects[projectId]) {
      // Remove
      await supabase.from('project_members').delete().eq('user_id', selected.id).eq('project_id', projectId)
      const updated = { ...memberProjects }; delete updated[projectId]
      setMemberProjects(updated)
      writeAuditLog({ action: 'project_access_revoked', performedBy: currentUser, targetUserId: selected.id, projectId, detail: { project_id: projectId } })
    } else {
      // Add
      await supabase.from('project_members').insert({ user_id: selected.id, project_id: projectId, role: 'editor', added_by: currentUser?.id })
      setMemberProjects({ ...memberProjects, [projectId]: 'editor' })
      writeAuditLog({ action: 'project_access_granted', performedBy: currentUser, targetUserId: selected.id, projectId, detail: { project_id: projectId } })
    }
  }

  async function setProjectRole(projectId: string, role: string) {
    if (!selected) return
    await supabase.from('project_members').update({ role }).eq('user_id', selected.id).eq('project_id', projectId)
    setMemberProjects({ ...memberProjects, [projectId]: role })
  }

  function applyTemplate(tmpl: PermissionTemplate) {
    const perms = { ...EMPTY_PERMS(), ...tmpl.permissions } as Record<Module, { read: boolean; write: boolean }>
    setEditPerms(perms)
  }

  async function saveTemplate() {
    if (!newTemplateName.trim()) return
    const { error } = await supabase.from('permission_templates').insert({
      name: newTemplateName.trim(), permissions: editPerms, created_by: currentUser?.id, is_builtin: false,
    })
    if (error) { toast(error.message, 'error'); return }
    writeAuditLog({ action: 'template_created', performedBy: currentUser, detail: { name: newTemplateName } })
    toast('Template saved', 'success')
    setTemplateModalOpen(false); setNewTemplateName('')
    load()
  }

  async function sendInvite() {
    if (!inviteForm.name.trim() || !inviteForm.email.trim()) { toast('Name and email required', 'error'); return }
    setInviting(true)
    try {
      // 1. Find or create person record
      const { person } = await findOrCreatePerson({ full_name: inviteForm.name.trim(), email: inviteForm.email.trim() })

      // 2. Check if app_users already exists
      const { data: existing } = await supabase.from('app_users').select('id').ilike('email', inviteForm.email.trim()).single()
      if (existing) { toast('A user with this email already exists', 'error'); setInviting(false); return }

      // 3. Insert app_users record (pending — no auth_id yet)
      const { data: newUser, error: userErr } = await supabase.from('app_users').insert({
        email: inviteForm.email.trim().toLowerCase(),
        name: inviteForm.name.trim(),
        role: inviteForm.role,
        active: true,
        permissions: EMPTY_PERMS(),
        invited_by: currentUser?.id,
        invited_at: new Date().toISOString(),
      }).select().single()
      if (userErr || !newUser) { toast(userErr?.message || 'Failed to create user', 'error'); setInviting(false); return }

      // 4. Link person to app_user
      await supabase.from('persons').update({ app_user_id: newUser.id }).eq('id', person.id)

      // 5. Send the invite via the invite-user edge function. The function
      //    uses the service role to call auth.admin.inviteUserByEmail, which
      //    works regardless of the project's "Allow new signups" setting and
      //    sends the styled invite email. Anon-key signInWithOtp can't do
      //    this — it returns "Signups not allowed for otp" when signups are
      //    disabled, even though we WANT the user created here.
      const redirectTo = `${window.location.origin}/`
      const { data: invRes, error: invErr } = await supabase.functions.invoke('invite-user', {
        body: {
          email: inviteForm.email.trim().toLowerCase(),
          name: inviteForm.name.trim(),
          role: inviteForm.role,
          redirect_to: redirectTo,
        },
      })
      if (invErr || (invRes && invRes.error)) {
        const msg = invErr?.message || invRes?.error || 'Unknown error'
        toast(`User created but invite email failed: ${msg}`, 'error')
      } else {
        toast(`Invite sent to ${inviteForm.email}`, 'success')
      }

      writeAuditLog({ action: 'user_invited', performedBy: currentUser, targetUserId: newUser.id, detail: { email: inviteForm.email, role: inviteForm.role } })
      setInviteOpen(false)
      setInviteForm({ name: '', email: '', role: 'member' })
      load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
    setInviting(false)
  }

  function permRow(module: Module) {
    const p = editPerms[module] || { read: false, write: false }
    const isSelectedViewer = selected?.role === 'viewer'
    return (
      <tr key={module} style={{ borderBottom: '1px solid var(--border)' }}>
        <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: 500 }}>{MODULE_LABELS[module]}</td>
        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
          <input type="checkbox" checked={p.read} style={{ width: 16, height: 16, cursor: 'pointer' }}
            onChange={e => {
              const read = e.target.checked
              setEditPerms(prev => ({ ...prev, [module]: { read, write: read ? prev[module].write : false } }))
            }} />
        </td>
        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
          <input type="checkbox" checked={p.write && !isSelectedViewer} disabled={!p.read || isSelectedViewer}
            style={{ width: 16, height: 16, cursor: p.read && !isSelectedViewer ? 'pointer' : 'not-allowed', opacity: (!p.read || isSelectedViewer) ? 0.3 : 1 }}
            onChange={e => setEditPerms(prev => ({ ...prev, [module]: { ...prev[module], write: e.target.checked } }))} />
        </td>
      </tr>
    )
  }

  if (!isAdmin) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>🔒 Admin access required</div>
  )

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: Users list + templates ───────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>User Management</h1>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{users.length} users · click a user to manage</p>
          </div>
          <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>+ Invite User</button>
        </div>

        {loading ? <div className="loading-center"><span className="spinner" /></div> : (
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Role</th><th>Projects</th>
                  <th>Last Login</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const st = STATUS_STYLE[userStatus(u)]
                  const isSelected = selected?.id === u.id
                  return (
                    <tr key={u.id} onClick={() => openDrawer(u)}
                      style={{ cursor: 'pointer', background: isSelected ? 'rgba(var(--accent-rgb),0.06)' : 'transparent' }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.email}</div>
                      </td>
                      <td><span className="badge" style={{ background: u.role === 'admin' ? '#ede9fe' : 'var(--bg3)', color: u.role === 'admin' ? '#6b21a8' : 'var(--text2)' }}>{u.role}</span></td>
                      <td style={{ color: 'var(--text3)', fontSize: 12 }}>—</td>
                      <td style={{ color: 'var(--text3)', fontSize: 12 }}>
                        {u.last_login ? new Date(u.last_login).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td><span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{st.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Permission templates */}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Permission Templates</div>
            <button className="btn btn-sm" onClick={() => setTemplateModalOpen(true)}>+ Save Current as Template</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {templates.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</span>
                {t.is_builtin && <span style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase' }}>built-in</span>}
                {selected && (
                  <button className="btn btn-sm" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => applyTemplate(t)}>Apply</button>
                )}
              </div>
            ))}
          </div>
          {!selected && <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Select a user to apply a template to their permissions.</p>}
        </div>
      </div>

      {/* ── Right: User detail drawer ──────────────────────────────────────── */}
      {selected && (
        <div style={{ width: 480, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden', flexShrink: 0 }}>
          {/* Drawer header */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{selected.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{selected.email}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setSelected(null)}>✕</button>
          </div>

          {/* Drawer tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
            {(['profile','projects','permissions','activity'] as const).map(tab => (
              <button key={tab} onClick={() => setDrawerTab(tab)}
                style={{ flex: 1, padding: '9px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: drawerTab === tab ? 700 : 400, color: drawerTab === tab ? 'var(--accent)' : 'var(--text2)', borderBottom: drawerTab === tab ? '2px solid var(--accent)' : '2px solid transparent', textTransform: 'capitalize' }}>
                {tab}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>

            {/* ── Profile tab ── */}
            {drawerTab === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="fg">
                  <label>Display Name</label>
                  <input className="input" defaultValue={selected.name}
                    onBlur={e => { if (e.target.value.trim() && e.target.value !== selected.name) saveProfile({ name: e.target.value.trim() }) }} />
                </div>
                <div className="fg">
                  <label>Email</label>
                  <input className="input" value={selected.email} readOnly style={{ opacity: 0.6 }} />
                  <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>Email changes must be made by the user from their profile page.</p>
                </div>
                <div className="fg">
                  <label>Role</label>
                  <select className="input" value={selected.role}
                    onChange={e => saveProfile({ role: e.target.value as AppUser['role'] })}
                    disabled={selected.id === currentUser?.id}>
                    <option value="admin">Admin — full access, can manage users</option>
                    <option value="member">Member — access controlled by permissions</option>
                    <option value="viewer">Viewer — read-only regardless of permissions</option>
                  </select>
                  {selected.id === currentUser?.id && <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>You cannot change your own role.</p>}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" style={{ background: selected.active ? 'var(--red)' : 'var(--green)', color: '#fff' }}
                    onClick={toggleActive} disabled={selected.id === currentUser?.id}>
                    {selected.active ? '⊘ Deactivate' : '✓ Reactivate'}
                  </button>
                  <button className="btn btn-sm" style={{ color: 'var(--amber)' }} onClick={forcePasswordReset}>
                    🔑 Force Password Reset
                  </button>
                  <button className="btn btn-sm" style={{ background: 'var(--red)', color: '#fff', marginLeft: 'auto' }}
                    onClick={deleteUser} disabled={selected.id === currentUser?.id}
                    title={selected.id === currentUser?.id ? 'You cannot delete yourself' : 'Permanently delete this user'}>
                    🗑 Delete User
                  </button>
                </div>

                <div style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text3)' }}>Status</span>
                    <span style={{ fontWeight: 600 }}>{STATUS_STYLE[userStatus(selected)].label}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text3)' }}>Last login</span>
                    <span>{selected.last_login ? new Date(selected.last_login).toLocaleString('en-AU') : 'Never'}</span>
                  </div>
                  {(selected as AppUser & { invited_at?: string }).invited_at && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text3)' }}>Invited</span>
                      <span>{new Date((selected as AppUser & { invited_at?: string }).invited_at!).toLocaleDateString('en-AU')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Projects tab ── */}
            {drawerTab === 'projects' && (
              <div>
                <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
                  Toggle project access. Role controls what they can do within that project.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {projects.map(p => {
                    const role = memberProjects[p.id]
                    const hasAccess = !!role
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, background: hasAccess ? 'rgba(0,137,138,0.04)' : 'var(--bg)' }}>
                        <input type="checkbox" checked={hasAccess} onChange={() => toggleProjectAccess(p.id)}
                          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                          {p.client && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.client}</div>}
                        </div>
                        {hasAccess && (
                          <select className="input" style={{ width: 100, fontSize: 12, padding: '2px 6px' }}
                            value={role} onChange={e => setProjectRole(p.id, e.target.value)}>
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                            <option value="owner">Owner</option>
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Permissions tab ── */}
            {drawerTab === 'permissions' && (
              <div>
                {selected.role === 'admin' ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                    Admin users have full access to everything. Permissions don't apply.
                  </div>
                ) : selected.role === 'viewer' ? (
                  <div style={{ padding: '10px 12px', background: '#fef3c7', borderRadius: 6, fontSize: 12, color: '#92400e', marginBottom: 14 }}>
                    ⚠ Viewer role — read access only regardless of settings below.
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {templates.slice(0, 4).map(t => (
                    <button key={t.id} className="btn btn-sm" onClick={() => applyTemplate(t)}>{t.name}</button>
                  ))}
                </div>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg3)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Module</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', width: 60 }}>Read</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', width: 60 }}>Write</th>
                    </tr>
                  </thead>
                  <tbody>{ALL_MODULES.map(permRow)}</tbody>
                </table>
                <button className="btn btn-primary" style={{ marginTop: 16, width: '100%' }}
                  onClick={savePermissions} disabled={saving}>
                  {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null} Save Permissions
                </button>
                <button className="btn btn-sm" style={{ marginTop: 8, width: '100%' }}
                  onClick={() => setTemplateModalOpen(true)}>
                  💾 Save as Template
                </button>
              </div>
            )}

            {/* ── Activity tab ── */}
            {drawerTab === 'activity' && (
              <div>
                {activityLog.length === 0 ? (
                  <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', paddingTop: 20 }}>No activity recorded yet.</div>
                ) : activityLog.map(entry => (
                  <div key={entry.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, textTransform: 'capitalize' }}>{entry.action.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {new Date(entry.created_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {entry.detail && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{JSON.stringify(entry.detail).slice(0, 100)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Invite modal ─────────────────────────────────────────────────── */}
      {inviteOpen && (
        <div className="modal-overlay" onClick={() => setInviteOpen(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>✉ Invite New User</h3><button className="btn btn-sm" onClick={() => setInviteOpen(false)}>✕</button></div>
            <div className="modal-body">
              <div className="fg"><label>Full Name *</label><input className="input" autoFocus value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. John Smith" /></div>
              <div className="fg"><label>Email Address *</label><input className="input" type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="john.smith@siemens-energy.com" /></div>
              <div className="fg">
                <label>Role</label>
                <select className="input" value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value as AppUser['role'] }))}>
                  <option value="member">Member — access controlled by permissions</option>
                  <option value="viewer">Viewer — read-only</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                An invite email will be sent. The user sets their own password on first login. A person profile will be created automatically.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setInviteOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={sendInvite} disabled={inviting || !inviteForm.name || !inviteForm.email}>
                {inviting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null} Send Invite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save template modal ──────────────────────────────────────────── */}
      {templateModalOpen && (
        <div className="modal-overlay" onClick={() => setTemplateModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>💾 Save Permission Template</h3><button className="btn btn-sm" onClick={() => setTemplateModalOpen(false)}>✕</button></div>
            <div className="modal-body">
              <div className="fg"><label>Template Name *</label><input className="input" autoFocus value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} placeholder="e.g. Site Engineer" /></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setTemplateModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveTemplate} disabled={!newTemplateName.trim()}>Save Template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
