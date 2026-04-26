/**
 * persons.ts — Persistent person identity
 *
 * findOrCreatePerson() is the single entry point for all person creation:
 * - Manual resource add
 * - Bulk CSV upload
 * - RFQ award → resource
 * - Admin user invite
 */

import { supabase } from './supabase'

export interface Person {
  id: string
  full_name: string
  preferred_name: string | null
  email: string | null
  phone: string | null
  employee_id: string | null
  company: string | null
  default_category: 'trades' | 'management' | 'seag' | 'subcontractor' | null
  default_role: string | null
  app_user_id: string | null
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type MatchedBy = 'email' | 'name_company' | 'created'

export interface FindOrCreateResult {
  person: Person
  created: boolean
  matched_by: MatchedBy
}

export interface PersonInput {
  full_name: string
  email?: string | null
  phone?: string | null
  company?: string | null
  employee_id?: string | null
  default_category?: Person['default_category']
  default_role?: string | null
  preferred_name?: string | null
  notes?: string | null
}

/**
 * Find an existing person or create a new one.
 * Resolution order:
 *   1. Email match (definitive — always links)
 *   2. Name + company fuzzy (returns candidate, caller decides)
 *   3. Create new
 */
export async function findOrCreatePerson(
  input: PersonInput
): Promise<FindOrCreateResult> {
  const email = input.email?.trim().toLowerCase() || null

  // 1. Email match
  if (email) {
    const { data } = await supabase
      .from('persons')
      .select('*')
      .ilike('email', email)
      .single()
    if (data) return { person: data as Person, created: false, matched_by: 'email' }
  }

  // 2. Name + company fuzzy match (return without creating — caller confirms)
  if (input.company) {
    const { data } = await supabase
      .from('persons')
      .select('*')
      .ilike('full_name', input.full_name.trim())
      .ilike('company', input.company.trim())
      .limit(1)
      .single()
    if (data) return { person: data as Person, created: false, matched_by: 'name_company' }
  }

  // 3. Create new
  const payload: Partial<Person> = {
    full_name:        input.full_name.trim(),
    preferred_name:   input.preferred_name || null,
    email:            email,
    phone:            input.phone?.trim() || null,
    employee_id:      input.employee_id?.trim() || null,
    company:          input.company?.trim() || null,
    default_category: input.default_category || null,
    default_role:     input.default_role?.trim() || null,
    notes:            input.notes || null,
    active:           true,
  }
  const { data, error } = await supabase.from('persons').insert(payload).select().single()
  if (error) throw new Error(`findOrCreatePerson: ${error.message}`)
  return { person: data as Person, created: true, matched_by: 'created' }
}

/** Search persons by name or email — for the resource picker */
export async function searchPersons(query: string, limit = 10): Promise<Person[]> {
  if (!query.trim()) return []
  const { data } = await supabase
    .from('persons')
    .select('*')
    .or(`full_name.ilike.%${query}%,email.ilike.%${query}%,company.ilike.%${query}%`)
    .eq('active', true)
    .order('full_name')
    .limit(limit)
  return (data || []) as Person[]
}

/** Get all resource deployments for a person across all projects */
export async function getPersonDeployments(personId: string) {
  const { data } = await supabase
    .from('resources')
    .select('*, project:projects(id,name,client,start_date,end_date)')
    .eq('person_id', personId)
    .order('mob_in', { ascending: false })
  return data || []
}

/** Link an app_user to a persons record */
export async function linkAppUserToPerson(personId: string, appUserId: string) {
  await supabase.from('persons').update({ app_user_id: appUserId }).eq('id', personId)
  await supabase.from('app_users').update({ /* no field needed, link is on persons */ }).eq('id', appUserId)
}
