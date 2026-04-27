/**
 * audit.ts — Write to audit_log
 * Fire-and-forget — never blocks the user action.
 */

import { supabase } from './supabase'
import type { AppUser } from '../types'

export type AuditAction =
  | 'user_invited'
  | 'user_created'
  | 'user_deactivated'
  | 'user_reactivated'
  | 'user_deleted'
  | 'permission_changed'
  | 'project_access_granted'
  | 'project_access_revoked'
  | 'role_changed'
  | 'password_reset_forced'
  | 'user_login'
  | 'user_logout'
  | 'password_changed'
  | 'person_created'
  | 'person_merged'
  | 'person_linked_to_user'
  | 'template_created'
  | 'template_deleted'

export function writeAuditLog(opts: {
  action: AuditAction
  performedBy: AppUser | null
  targetUserId?: string | null
  targetPersonId?: string | null
  projectId?: string | null
  detail?: Record<string, unknown>
}) {
  // Fire and forget
  supabase.from('audit_log').insert({
    action:           opts.action,
    performed_by:     opts.performedBy?.id || null,
    target_user_id:   opts.targetUserId || null,
    target_person_id: opts.targetPersonId || null,
    project_id:       opts.projectId || null,
    detail:           opts.detail || null,
  }).then(({ error }) => {
    if (error) console.warn('[audit]', error.message)
  })
}
