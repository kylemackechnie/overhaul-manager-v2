import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from '../ui/Toast'

interface Contract {
  id: string
  vendor: string
  description: string
  linked_po_id: string | null
}

interface Props {
  docId: string
  projectId: string
  awardedVendor: string
  onClose: () => void
  onLinked: (contractId: string) => void
}

export function LinkContractModal({ docId, projectId, awardedVendor, onClose, onLinked }: Props) {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { load() }, [])

  async function load() {
    const { data, error } = await supabase.from('subcon_contracts')
      .select('id,vendor,description,linked_po_id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) { toast(error.message, 'error'); setLoading(false); return }
    setContracts((data || []) as Contract[])
    setLoading(false)
  }

  async function link(contractId: string) {
    const { error } = await supabase.from('rfq_documents')
      .update({ linked_contract_id: contractId, stage: 'contracted' })
      .eq('id', docId)
    if (error) { toast(error.message, 'error'); return }
    toast('Contract linked — stage updated to Contracted', 'success')
    onLinked(contractId)
    onClose()
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '12px',
        padding: '24px 28px', width: '440px', boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>Link to Contract</div>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '16px' }}>
          Select the contract awarded to <strong>{awardedVendor}</strong>
        </div>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>Loading contracts…</div>
        ) : contracts.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>
            No subcontractor contracts yet. Create one in the Contracts panel first.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto' }}>
            {contracts.map(c => (
              <button key={c.id} onClick={() => link(c.id)} style={{
                padding: '10px 14px', border: '1px solid var(--border)', borderRadius: '6px',
                background: 'var(--bg2)', cursor: 'pointer', textAlign: 'left',
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#7c3aed'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ fontWeight: 600, fontSize: '12px' }}>{c.vendor}</div>
                <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{c.description || '—'}</div>
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', border: '1px solid var(--border)', borderRadius: '6px',
            background: 'var(--bg2)', color: 'var(--text)', fontSize: '12px', cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
