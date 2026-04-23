import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { toast } from '../components/ui/Toast'

export function LoginPage() {
  const { signIn, sendMagicLink } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [loading, setLoading] = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'magic') {
        await sendMagicLink(email)
        setMagicSent(true)
      } else {
        await signIn(email, password)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed'
      toast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg2)', padding: '24px'
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '52px', height: '52px', borderRadius: '12px',
            background: 'var(--purple)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 16px',
            fontSize: '24px'
          }}>⚙️</div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '4px' }}>
            Overhaul Manager
          </h1>
          <p style={{ color: 'var(--text3)', fontSize: '13px' }}>
            Project Cost Tracking Platform
          </p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '28px' }}>
          {magicSent ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>📧</div>
              <h3 style={{ marginBottom: '8px' }}>Check your email</h3>
              <p style={{ color: 'var(--text3)', fontSize: '13px' }}>
                We sent a sign-in link to <strong>{email}</strong>
              </p>
              <button
                className="btn btn-sm"
                style={{ marginTop: '16px' }}
                onClick={() => setMagicSent(false)}
              >
                Back
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="fg">
                <label>Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </div>

              {mode === 'password' && (
                <div className="fg">
                  <label>Password</label>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ justifyContent: 'center', padding: '10px' }}
              >
                {loading ? <span className="spinner" style={{ width: '16px', height: '16px' }} /> : null}
                {mode === 'magic' ? 'Send sign-in link' : 'Sign in'}
              </button>

              <button
                type="button"
                className="btn"
                style={{ justifyContent: 'center', fontSize: '12px' }}
                onClick={() => setMode(mode === 'magic' ? 'password' : 'magic')}
              >
                {mode === 'magic' ? '← Use password instead' : 'Sign in with email link →'}
              </button>
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '12px', color: 'var(--text3)' }}>
          Contact your administrator to request access
        </p>
      </div>
    </div>
  )
}
