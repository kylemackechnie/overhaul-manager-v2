import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import type { AppUser } from '../../types'

const ROLES = ['admin','pm','viewer'] as const

export function UserManagementPanel() {
  const { currentUser } = useAppStore()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null|'new'|AppUser>(null)
  const [form, setForm] = useState({ email:'', name:'', role:'viewer' as AppUser['role'], active:true })
  const [saving, setSaving] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('app_users').select('*').order('name')
    setUsers((data||[]) as AppUser[])
    setLoading(false)
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return toast('Email required','error')
    setInviting(true)
    const { error } = await supabase.auth.admin.inviteUserByEmail(inviteEmail.trim())
    if (error) {
      // Fallback: send magic link
      const { error: mlErr } = await supabase.auth.signInWithOtp({ email: inviteEmail.trim() })
      if (mlErr) { toast(mlErr.message,'error'); setInviting(false); return }
      toast(`Magic link sent to ${inviteEmail}`,'success')
    } else {
      toast(`Invite sent to ${inviteEmail}`,'success')
    }
    setInviteEmail('')
    setInviting(false)
  }

  async function saveUser() {
    if (!form.name.trim()) return toast('Name required','error')
    setSaving(true)
    if (modal === 'new') {
      // Can't create auth users from client — just pre-populate app_users for when they sign up
      toast('To add users, use the Invite feature. They will auto-join when they first sign in.','info')
      setSaving(false); return
    }
    const { error } = await supabase.from('app_users').update({ name:form.name.trim(), role:form.role, active:form.active }).eq('id',(modal as AppUser).id)
    if (error) { toast(error.message,'error'); setSaving(false); return }
    toast('User updated','success'); setSaving(false); setModal(null); load()
  }

  async function toggleActive(u: AppUser) {
    await supabase.from('app_users').update({ active:!u.active }).eq('id',u.id)
    load()
  }

  const ROLE_COLORS: Record<string,{bg:string,color:string}> = {
    admin:{bg:'#fee2e2',color:'#7f1d1d'}, pm:{bg:'#dbeafe',color:'#1e40af'}, viewer:{bg:'#f1f5f9',color:'#64748b'}
  }

  return (
    <div style={{ padding:'24px', maxWidth:'800px' }}>
      <h1 style={{ fontSize:'18px', fontWeight:700, marginBottom:'20px' }}>User Management</h1>

      {/* Invite */}
      <div className="card" style={{ marginBottom:'20px' }}>
        <div style={{ fontWeight:600, marginBottom:'10px', fontSize:'13px' }}>Invite New User</div>
        <div className="fg-row" style={{ alignItems:'flex-end' }}>
          <div className="fg" style={{ flex:2 }}>
            <label>Email Address</label>
            <input className="input" type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="user@siemens-energy.com" onKeyDown={e=>e.key==='Enter'&&sendInvite()} />
          </div>
          <button className="btn btn-primary" onClick={sendInvite} disabled={inviting || !isAdmin}>
            {inviting?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Send Invite
          </button>
        </div>
        <p style={{ fontSize:'11px', color:'var(--text3)', marginTop:'8px' }}>
          User will receive a magic link. On first sign-in their account is created automatically with viewer access.
        </p>
      </div>

      {/* User table */}
      {loading ? <div className="loading-center"><span className="spinner"/> Loading...</div>
      : (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th></th></tr></thead>
            <tbody>
              {users.map(u => {
                const rc = ROLE_COLORS[u.role]||ROLE_COLORS.viewer
                return (
                  <tr key={u.id}>
                    <td style={{ fontWeight:500 }}>{u.name||'—'}</td>
                    <td style={{ fontSize:'12px', color:'var(--text2)' }}>{u.email}</td>
                    <td><span className="badge" style={rc}>{u.role}</span></td>
                    <td>
                      <span className="badge" style={u.active ? {bg:'#d1fae5',color:'#065f46'} as {bg:string,color:string} : {bg:'#e5e7eb',color:'#374151'}}>
                        {u.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ fontSize:'11px', color:'var(--text3)' }}>
                      {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    <td style={{ whiteSpace:'nowrap' }}>
                      {isAdmin && (
                        <>
                          <button className="btn btn-sm" onClick={() => { setForm({email:u.email,name:u.name,role:u.role,active:u.active}); setModal(u) }}>Edit</button>
                          {u.id !== currentUser?.id && (
                            <button className="btn btn-sm" style={{ marginLeft:'4px', color: u.active?'var(--red)':'var(--green)' }} onClick={() => toggleActive(u)}>
                              {u.active ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && modal !== 'new' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth:'420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit User</h3>
              <button className="btn btn-sm" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="fg"><label>Name</label><input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
              <div className="fg"><label>Email</label><input className="input" value={form.email} disabled style={{ opacity:0.6 }} /></div>
              <div className="fg"><label>Role</label>
                <select className="input" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value as AppUser['role']}))}>
                  {ROLES.map(r=><option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveUser} disabled={saving}>{saving?<span className="spinner" style={{width:'14px',height:'14px'}}/>:null} Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
