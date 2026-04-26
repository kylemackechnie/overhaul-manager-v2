/**
 * permissions.ts — Module-level permission checking
 *
 * Usage in any panel:
 *   const { canRead, canWrite } = usePermissions()
 *   if (!canRead('cost_tracking')) return <AccessDenied />
 *   {canWrite('personnel') && <button>+ Add</button>}
 */

import { useAppStore } from '../store/appStore'

export type Module =
  | 'project'
  | 'cost_tracking'
  | 'personnel'
  | 'hse'
  | 'subcontractors'
  | 'logistics'
  | 'hardware'
  | 'tooling'
  | 'site_specific'
  | 'global'

export const ALL_MODULES: Module[] = [
  'project', 'cost_tracking', 'personnel', 'hse',
  'subcontractors', 'logistics', 'hardware', 'tooling',
  'site_specific', 'global',
]

export const MODULE_LABELS: Record<Module, string> = {
  project:        'Project',
  cost_tracking:  'Cost Tracking',
  personnel:      'Personnel',
  hse:            'HSE',
  subcontractors: 'Subcontractors',
  logistics:      'Logistics',
  hardware:       'Hardware',
  tooling:        'Tooling',
  site_specific:  'Site Specific',
  global:         'Global',
}

export const DEFAULT_PERMISSIONS: Record<Module, { read: boolean; write: boolean }> = {
  project:        { read: true,  write: false },
  cost_tracking:  { read: true,  write: false },
  personnel:      { read: true,  write: false },
  hse:            { read: true,  write: false },
  subcontractors: { read: true,  write: false },
  logistics:      { read: true,  write: false },
  hardware:       { read: false, write: false },
  tooling:        { read: true,  write: false },
  site_specific:  { read: true,  write: false },
  global:         { read: true,  write: false },
}

export function usePermissions() {
  const { currentUser } = useAppStore()

  // Admin bypasses everything
  const isAdmin = currentUser?.role === 'admin'
  // Viewer role: read may be granted but write never is
  const isViewer = currentUser?.role === 'viewer'

  const perms = (currentUser?.permissions || {}) as Record<string, { read?: boolean; write?: boolean }>

  function canRead(module: Module): boolean {
    if (!currentUser) return false
    if (isAdmin) return true
    const p = perms[module]
    if (p === undefined) return DEFAULT_PERMISSIONS[module].read
    return p.read ?? DEFAULT_PERMISSIONS[module].read
  }

  function canWrite(module: Module): boolean {
    if (!currentUser) return false
    if (isAdmin) return true
    if (isViewer) return false
    const p = perms[module]
    if (p === undefined) return false
    // Write requires read
    if (!canRead(module)) return false
    return p.write ?? false
  }

  return { canRead, canWrite, isAdmin, isViewer }
}

/** AccessDenied placeholder — rendered when canRead() is false */
export function AccessDenied({ module }: { module: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '300px', gap: '12px',
      color: 'var(--text3)',
    }}>
      <div style={{ fontSize: '32px' }}>🔒</div>
      <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text2)' }}>
        Access Restricted
      </div>
      <div style={{ fontSize: '13px' }}>
        You don't have permission to view {module}. Contact your administrator.
      </div>
    </div>
  )
}
