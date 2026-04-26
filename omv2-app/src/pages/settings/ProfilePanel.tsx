import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/Toast'
import { writeAuditLog } from '../../lib/audit'
import { MODULE_LABELS, type Module } from '../../lib/permissions'

export function ProfilePanel() {
  const { currentUser, setCurrentUser } = useAppStore()
  const [name, setName] = useState(currentUser?.name || '')
  const [savingName, setSavingName] = useState(false)
  const [emailForm, setEmailForm] = useState({ newEmail: '', confirm: '' })
  const [savingEmail, setSavingEmail] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [savingPw, setSavingPw] = useState(false)

  if (!currentUser) return null

  async function saveName() {
    if (!name.trim() || name === currentUser!.name) return
    setSavingName(true)
    const { error } = await supabase.from('app_users').update({ name: name.trim() }).eq('id', currentUser!.id)
    if (error) { toast(error.message, 'error'); setSavingName(false); return }
    setCurrentUser({ ...currentUser!, name: name.trim() })
    toast('Name updated', 'success')
    setSavingName(false)
  }

  async function saveEmail() {
    if (!emailForm.newEmail.trim()) return toast('Enter a new email', 'error')
    if (emailForm.newEmail !== emailForm.confirm) return toast('Emails do not match', 'error')
    setSavingEmail(true)
    const { error } = await supabase.auth.updateUser({ email: emailForm.newEmail.trim() })
    if (error) { toast(error.message, 'error'); setSavingEmail(false); return }
    toast('Confirmation sent to new email address. Check your inbox.', 'success')
    setEmailForm({ newEmail: '', confirm: '' })
    setSavingEmail(false)
  }

  async function savePassword() {
    if (!pwForm.newPw) return toast('Enter a new password', 'error')
    if (pwForm.newPw.length < 12) return toast('Password must be at least 12 characters', 'error')
    if (pwForm.newPw !== pwForm.confirm) return toast('Passwords do not match', 'error')
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: pwForm.newPw })
    if (error) { toast(error.message, 'error'); setSavingPw(false); return }
    // Clear force_password_reset flag if set
    if (currentUser!.force_password_reset) {
      await supabase.from('app_users').update({ force_password_reset: false }).eq('id', currentUser!.id)
      sessionStorage.removeItem('force_password_reset')
    }
    writeAuditLog({ action: 'password_changed', performedBy: currentUser })
    toast('Password updated successfully', 'success')
    setPwForm({ current: '', newPw: '', confirm: '' })
    setSavingPw(false)
  }

  const perms = currentUser.permissions || {}
  const isAdmin = currentUser.role === 'admin'

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>My Profile</h1>
      <p style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 28 }}>
        Manage your personal details and login credentials.
      </p>

      {currentUser.force_password_reset && (
        <div style={{ padding: '12px 16px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, marginBottom: 24, fontSize: 13, color: '#92400e' }}>
          ⚠ Your administrator has requested that you change your password before continuing.
        </div>
      )}

      {/* Account info */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Account</div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 20, flexShrink: 0,
          }}>
            {currentUser.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{currentUser.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>{currentUser.email}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              <span style={{ background: isAdmin ? '#ede9fe' : 'var(--bg3)', color: isAdmin ? '#6b21a8' : 'var(--text2)', padding: '2px 8px', borderRadius: 4, fontWeight: 600, textTransform: 'capitalize' }}>
                {currentUser.role}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Display name */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Display Name</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" style={{ flex: 1 }} value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveName()}
            placeholder="Your full name" />
          <button className="btn btn-primary" onClick={saveName} disabled={savingPw || !name.trim() || name === currentUser.name}>
            {savingName ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save'}
          </button>
        </div>
      </div>

      {/* Change email */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Change Email</div>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
          A confirmation link will be sent to your new email address. Your email won't change until you click the link.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" type="email" placeholder="New email address"
            value={emailForm.newEmail} onChange={e => setEmailForm(f => ({ ...f, newEmail: e.target.value }))} />
          <input className="input" type="email" placeholder="Confirm new email"
            value={emailForm.confirm} onChange={e => setEmailForm(f => ({ ...f, confirm: e.target.value }))} />
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}
            onClick={saveEmail} disabled={savingEmail || !emailForm.newEmail || !emailForm.confirm}>
            {savingEmail ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Update Email'}
          </button>
        </div>
      </div>

      {/* Change password */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Change Password</div>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>Minimum 12 characters.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" type="password" placeholder="New password"
            value={pwForm.newPw} onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))} />
          <input className="input" type="password" placeholder="Confirm new password"
            value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} />
          {pwForm.newPw && pwForm.newPw.length < 12 && (
            <div style={{ fontSize: 11, color: 'var(--red)' }}>Password must be at least 12 characters</div>
          )}
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}
            onClick={savePassword} disabled={savingPw || !pwForm.newPw || !pwForm.confirm}>
            {savingPw ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Update Password'}
          </button>
        </div>
      </div>

      {/* My permissions (read-only) */}
      {!isAdmin && (
        <div className="card" style={{ padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>My Permissions</div>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>Contact your administrator to change permissions.</p>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left' }}>Module</th>
                <th style={{ padding: '6px 10px', textAlign: 'center' }}>Read</th>
                <th style={{ padding: '6px 10px', textAlign: 'center' }}>Write</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(MODULE_LABELS) as Module[]).map(mod => {
                const p = perms[mod] || { read: false, write: false }
                return (
                  <tr key={mod} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 10px' }}>{MODULE_LABELS[mod]}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      <span style={{ color: p.read ? 'var(--green)' : 'var(--text3)' }}>{p.read ? '✓' : '—'}</span>
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      <span style={{ color: p.write ? 'var(--green)' : 'var(--text3)' }}>
                        {currentUser.role === 'viewer' ? <span style={{ fontSize: 10, color: 'var(--text3)' }}>viewer</span> : p.write ? '✓' : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Last login */}
      <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
        Last login: {currentUser.last_login ? new Date(currentUser.last_login).toLocaleString('en-AU') : 'This session'}
      </div>
    </div>
  )
}
