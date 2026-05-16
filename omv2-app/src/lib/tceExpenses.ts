import { supabase } from './supabase'

/**
 * Fetch expenses AND invoice lines for TCE actuals — returns a flat array including:
 *   1. Regular expenses (with tce_item_id set at the top level, no line items)
 *   2. Exploded expense_lines rows (each line as a virtual expense)
 *   3. Exploded invoice_lines rows (each line as a virtual expense entry)
 *
 * Parent expenses/invoices with line items have tce_item_id = null — only their
 * child lines carry the TCE allocation.
 */
export interface TceExpenseRow {
  tce_item_id: string | null
  cost_ex_gst: number
  amount: number
  sell_price: number | null
  gm_pct?: number | null
  chargeable: boolean | null
  date: string | null
  expense_ref?: string | null
  description?: string | null
  vendor?: string | null
}

export async function fetchTceExpenses(projectId: string): Promise<TceExpenseRow[]> {
  const [expRes, expLineRes, invLineRes] = await Promise.all([
    // Regular expenses — only those with a direct tce_item_id (no line items)
    supabase
      .from('expenses')
      .select('tce_item_id,cost_ex_gst,amount,sell_price,gm_pct,chargeable,date,expense_ref,description,vendor')
      .eq('project_id', projectId)
      .eq('chargeable', true)
      .not('tce_item_id', 'is', null),

    // Exploded expense line items — join to parent for date/expense_ref/project
    supabase
      .from('expense_lines')
      .select('tce_item_id,cost_ex_gst,amount,sell_price,gm_pct,chargeable,description,expenses!inner(date,expense_ref,vendor,project_id)')
      .eq('expenses.project_id', projectId)
      .eq('chargeable', true)
      .not('tce_item_id', 'is', null),

    // Exploded invoice line items — join to parent invoice for date/ref/project
    supabase
      .from('invoice_lines')
      .select('tce_item_id,amount,sell_price,gm_pct,chargeable,description,invoices!inner(invoice_date,date_processed,invoice_ref,vendor_details,project_id)')
      .eq('invoices.project_id', projectId)
      .eq('invoices.status', 'approved')
      .eq('chargeable', true)
      .not('tce_item_id', 'is', null),
  ])

  const directRows: TceExpenseRow[] = (expRes.data || []).map((e: Record<string, unknown>) => ({
    tce_item_id: e.tce_item_id as string | null,
    cost_ex_gst: Number(e.cost_ex_gst) || 0,
    amount: Number(e.amount) || 0,
    sell_price: e.sell_price != null ? Number(e.sell_price) : null,
    gm_pct: e.gm_pct != null ? Number(e.gm_pct) : null,
    chargeable: e.chargeable as boolean | null,
    date: e.date as string | null,
    expense_ref: e.expense_ref as string | null,
    description: e.description as string | null,
    vendor: e.vendor as string | null,
  }))

  const expLineRows: TceExpenseRow[] = (expLineRes.data || []).map((l: Record<string, unknown>) => {
    const parent = (l.expenses as Record<string, unknown>) || {}
    return {
      tce_item_id: l.tce_item_id as string | null,
      cost_ex_gst: Number(l.cost_ex_gst) || 0,
      amount: Number(l.amount) || 0,
      sell_price: l.sell_price != null ? Number(l.sell_price) : null,
      gm_pct: l.gm_pct != null ? Number(l.gm_pct) : null,
      chargeable: l.chargeable as boolean | null,
      date: parent.date as string | null,
      expense_ref: parent.expense_ref as string | null,
      description: l.description as string | null,
      vendor: parent.vendor as string | null,
    }
  })

  const invLineRows: TceExpenseRow[] = (invLineRes.data || []).map((l: Record<string, unknown>) => {
    const parent = (l.invoices as Record<string, unknown>) || {}
    const cost = Number(l.amount) || 0
    const sell = l.sell_price != null ? Number(l.sell_price) : null
    return {
      tce_item_id: l.tce_item_id as string | null,
      cost_ex_gst: cost,
      amount: cost,
      sell_price: sell,
      gm_pct: l.gm_pct != null ? Number(l.gm_pct) : null,
      chargeable: l.chargeable as boolean | null,
      date: (parent.date_processed || parent.invoice_date) as string | null,
      expense_ref: parent.invoice_ref as string | null,
      description: l.description as string | null,
      vendor: parent.vendor_details as string | null,
    }
  })

  return [...directRows, ...expLineRows, ...invLineRows]
}
