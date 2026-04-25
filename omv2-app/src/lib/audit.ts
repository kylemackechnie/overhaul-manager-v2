// Lightweight activity logger — writes to saved_reports as audit entries
export async function logActivity(supabaseClient: typeof import('./supabase').supabase, projectId: string, action: string, detail?: string) {
  try {
    await supabaseClient.from('saved_reports').insert({
      project_id: projectId,
      title: action,
      type: 'audit',
      content: JSON.stringify({ detail, ts: new Date().toISOString() }),
      created_by: 'system',
    })
  } catch (_) { /* silently fail — audit logging is best-effort */ }
}