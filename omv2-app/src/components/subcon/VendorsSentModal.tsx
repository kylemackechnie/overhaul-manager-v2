import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../ui/Toast'

interface Props {
  docId: string
  initialVendors: string[]
  onClose: () => void
  onSaved: (vendors: string[]) => void
}

export function VendorsSentModal({ docId, initialVendors, onClose, onSaved }: Props) {
  const [vendors, setVendors] = useState<string[]>(initialVendors.length ? initialVendors : [''])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function addRow() { setVendors([...vendors, '']) }
  function removeRow(i: number) { setVendors(vendors.filter((_, j) => j !== i)) }
  function updateRow(i: number, val: string) { setVendors(vendors.map((v, j) => j === i ? val : v)) }

  async function save() {
    setSaving(true)
    const filtered = vendors.map(v => v.trim()).filter(Boolean)
    const { error } = await supabase.from('rfq_documents').update({ vendors_sent: filtered }).eq('id', docId)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast('Vendors saved', 'success')
    onSaved(filtered)
    onClose()
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '12px',
        padding: '24px 28px', width: '420px', boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>Vendors Sent To</div>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '14px' }}>
          Track which companies received this RFQ
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px', maxHeight: '40vh', overflowY: 'auto' }}>
          {vendors.map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1, fontSize: '12px' }}
                value={v}
                onChange={e => updateRow(i, e.target.value)}
                placeholder="Company name"
                autoFocus={i === vendors.length - 1 && !v}
              />
              <button onClick={() => removeRow(i)} style={{
                padding: '3px 8px', border: '1px solid var(--border)', borderRadius: '4px',
                background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontSize: '11px',
              }}>✕</button>
            </div>
          ))}
        </div>
        <button onClick={addRow} style={{
          fontSize: '11px', padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '4px',
          background: 'transparent', color: 'var(--text2)', cursor: 'pointer', marginBottom: '14px',
        }}>+ Add Vendor</button>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{
            padding: '7px 16px', border: '1px solid var(--border)', borderRadius: '6px',
            background: 'var(--bg2)', color: 'var(--text)', fontSize: '12px', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{
            padding: '7px 16px', border: 'none', borderRadius: '6px',
            background: '#7c3aed', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
