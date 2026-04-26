/**
 * ProfilePage — self-service profile management.
 * Users can change: display name, email, password.
 * Cannot touch: role, permissions, project assignments.
 */
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { writeAuditLog } from '../../lib/audit'
import { getPersonDeployments } from '../../lib/persons'

export function ProfilePage() {
  const { currentUser, setCurrentUser } = useAppStore()
  const [name, setName] = useState(currentUser?.name || '')
  const [savingName, setSavingName] = useState(false)

  const [emailForm, setEmailForm] = useState({ newEmail: '', confirm: '' })
  const [savingEmail, setSavingEmail] = useState(false)

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [savingPw, setSavingPw] = useState(false)

  const [deployments, setDeployments] = useState<{ project: { name: string } | null; role: string; mob_in: string | null; mob_out: string | null }[]>([])
  const [forceReset] = useState(() => sessionStorage.getItem('force_password_reset') === '1')

  useEffect(() => {
    // Load person deployments if linked
    async function loadDeployments() {
      if (!currentUser) return
      const { data: person } = await supabase
        .from('persons')
        .select('id')
        .eq('app_user_id', currentUser.id)
        .single()
      if (person) {
        const deps = await getPersonDeployments(person.id)
        setDeployments(deps as typeof deployments)
      }
    }
    loadDeployments()
  }, [currentUser?.id])

  async function saveName() {
    if (!name.trim() || name === currentUser?.name) return
    setSavingName(true)
    const { error } = await supabase.from('app_users').update({ name: name.trim() }).eq('id', currentUser!.id)
    if (error) { toast(error.message, 'error'); setSavingName(false); return }
    setCurrentUser({ ...currentUser!, name: name.trim() })
    toast('Name updated', 'success')
    setSavingName(false)
  }

  async function saveEmail() {
    if (!emailForm.newEmail.trim()) return
    if (emailForm.newEmail !== emailForm.confirm) { toast('Emails do not match', 'error'); return }
    setSavingEmail(true)
    const { error } = await supabase.auth.updateUser({ email: emailForm.newEmail.trim() })
    if (error) { toast(error.message, 'error'); setSavingEmail(false); return }
    toast('Confirmation sent to new email address. Check your inbox.', 'success')
    setEmailForm({ newEmail: '', confirm: '' })
    writeAuditLog({ action: 'password_changed', performedBy: currentUser, detail: { type: 'email_change' } })
    setSavingEmail(false)
  }

  async function savePassword() {
    if (!pwForm.next) return
    if (pwForm.next.length < 12) { toast('Password must be at least 12 characters', 'error'); return }
    if (pwForm.next !== pwForm.confirm) { toast('Passwords do not match', 'error'); return }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: pwForm.next })
    if (error) { toast(error.message, 'error'); setSavingPw(false); return }
    // Clear force reset flag
    if (forceReset) {
      await supabase.from('app_users').update({ force_password_reset: false }).eq('id', currentUser!.id)
      sessionStorage.removeItem('force_password_reset')
    }
    writeAuditLog({ action: 'password_changed', performedBy: currentUser, detail: { type: 'password_change' } })
    toast('Password updated', 'success')
    setPwForm({ current: '', next: '', confirm: '' })
    setSavingPw(false)
  }

  const roleLabel: Record<string, string> = {
    admin: 'Administrator — full access',
    member: 'Member — access controlled by permissions',
    viewer: 'Viewer — read-only',
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '32px 24px' }}>
      {forceReset && (
        <div style={{ padding: '12px 16px', background: '#fef3c7', borderRadius: 8, marginBottom: 24, color: '#92400e', fontSize: 13, fontWeight: 500 }}>
          🔑 Your administrator has requested that you change your password before continuing.
        </div>
      )}

      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>My Profile</h1>
      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 28 }}>Manage your personal account settings.</p>

      {/* Account info (read-only) */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Account</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
          <div>
            <div style={{ color: 'var(--text3)', fontSize: 11, marginBottom: 2 }}>Email</div>
            <div style={{ fontWeight: 500 }}>{currentUser?.email}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text3)', fontSize: 11, marginBottom: 2 }}>Role</div>
            <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{currentUser?.role}</div>
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
          {roleLabel[currentUser?.role || 'viewer']}
        </div>
      </div>

      {/* Display name */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Display Name</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ flex: 1 }} value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveName() }}
            placeholder="Your full name" />
          <button className="btn btn-primary" onClick={saveName} disabled={savingName || !name.trim() || name === currentUser?.name}>
            Save
          </button>
        </div>
      </div>

      {/* Change email */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Change Email</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" type="email" placeholder="New email address"
            value={emailForm.newEmail} onChange={e => setEmailForm(f => ({ ...f, newEmail: e.target.value }))} />
          <input className="input" type="email" placeholder="Confirm new email"
            value={emailForm.confirm} onChange={e => setEmailForm(f => ({ ...f, confirm: e.target.value }))} />
          <button className="btn btn-primary" onClick={saveEmail}
            disabled={savingEmail || !emailForm.newEmail || emailForm.newEmail !== emailForm.confirm}>
            {savingEmail ? 'Sending...' : 'Send Confirmation'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--text3)' }}>A confirmation email will be sent to the new address. Your email won't change until confirmed.</p>
        </div>
      </div>

      {/* Change password */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
          {forceReset ? '🔑 Set New Password (Required)' : 'Change Password'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" type="password" placeholder="New password (min 12 characters)"
            value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} />
          <input className="input" type="password" placeholder="Confirm new password"
            value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} />
          {pwForm.next && pwForm.next.length < 12 && (
            <p style={{ fontSize: 11, color: 'var(--red)' }}>Password must be at least 12 characters.</p>
          )}
          <button className="btn btn-primary" onClick={savePassword}
            disabled={savingPw || pwForm.next.length < 12 || pwForm.next !== pwForm.confirm}>
            {savingPw ? 'Saving...' : 'Update Password'}
          </button>
        </div>
      </div>

      {/* My project roles */}
      {deployments.length > 0 && (
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>My Project Roles</div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Project</th>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Role</th>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Period</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 500 }}>{d.project?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--text2)' }}>{d.role || '—'}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--text3)', fontSize: 11 }}>
                    {d.mob_in || '—'}{d.mob_out ? ` → ${d.mob_out}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
