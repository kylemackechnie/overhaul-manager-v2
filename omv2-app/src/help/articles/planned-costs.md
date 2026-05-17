---
slug: planned-costs
title: Planned Costs
category: Cost Tracking
order: 45
relatedPanels: [planned-costs]
summary: PM100 cost lines that contribute to EAC without a vendor receipt — risk contingency, warranty allowance, financing costs, bank guarantees, and placeholder forecasts for items that will later become real expenses or POs.
---

# Planned Costs

Open via **Cost Tracking → Planned Costs**.

Some lines in the PM100 budget never have a vendor receipt. Risk contingency, warranty allowance, financing costs, bank guarantees — they exist in the cost plan by design, accrue with time, and never produce an invoice. Other lines start out as a forecast number and only later become real spend — local tooling transport, planned consumables. The **Planned Costs** panel is the home for both.

Before this panel existed, the only way to record these was to add them as Expenses. That worked but misused the Expenses table, which is built around vendor receipts — every "No photo" warning was a false alarm. Planned Costs replaces that workaround.

## What goes here

Two shapes of cost belong on this panel:

**Fixed-cost overheads** — exist by design, never have a receipt:

- Risk contingency (execution, warranty)
- Financing costs
- Bank guarantees
- Pre-outage planning allowances
- Any other PM100 line that's a planned accrual rather than a transaction

**Placeholder forecasts** — a forecast number now that will later convert to real spend:

- Local tooling transport (until the actual transport invoices land)
- Planned consumables (until purchase orders are raised)
- Anything else with a known budget but no vendor yet

Both shapes use the same fields. The difference comes through in the **Actualised** flag — see below.

## Fields

**Number** — auto-generated `PC-####` reference per project, like `EXP-` for expenses.

**Title** — what the line is. Free text.

**Category** — pick the closest match. Used for filtering and reporting:

- *Fixed Cost* — generic overhead allocation
- *Contingency* — risk reserve
- *Warranty* — post-completion warranty allowance
- *Financing* — bank fees, interest charges
- *Forecast Only* — placeholder; will be replaced by real spend later
- *Other*

**WBS** — the PM100 line this cost belongs to. Required for the cost to roll into the EAC; rows without a WBS contribute to an `(unallocated)` bucket and are excluded from per-line EAC.

**Amount** — total AUD value of the line. Multi-currency is supported (EUR/USD/GBP) but the row is always converted to AUD for EAC purposes using the project's FX rates.

**Accrual** — how the amount is spread across time. This matters for the Walk-Away analysis (where the engine asks "how much is Sunk vs Avoidable by date X?") and for the S-Curve. Four options:

- *Lump sum (single date)* — whole amount lands on one date. E.g. bank guarantees paid on project start.
- *Spread across project* — divided evenly across project start → end. Default, and the right choice for most contingency/warranty/financing lines.
- *Spread across custom dates* — explicit window. Use for things like a 6-week pre-outage planning period.
- *Spread monthly* — even spread, calendar-month granularity. Rarely needed.

**Actualised** — see below.

**Notes** — free text.

## The Actualised flag

Every planned cost starts as **Forecast** — it's a planned EAC line that hasn't been spent for real yet. In MIKA, it appears in the Forecast column on its WBS row.

Some planned costs eventually become real:

- Financing costs hit SAP at month-end as the bank debits clear
- Bank guarantees are paid on project start
- Placeholder forecasts get replaced by real expenses or invoices

When that happens, tick **Actualised** on the row. Two things change:

1. The cost moves from Forecast → Actuals on its WBS row in MIKA. The forecast column drops, the actuals column rises.
2. It contributes to Walk-Away as fully Sunk on the actualised date, regardless of accrual mode.

For lines that genuinely never actualise (contingency, warranty allowance) leave Actualised off forever. They sit in Forecast indefinitely, the EAC accounts for them, and they only show up as "spent" if the customer takes them.

You can toggle Actualised directly from the row in the table — no need to open the edit modal — and it's a single tap on mobile.

## How the numbers flow

The total of all planned cost rows on a WBS line is added to that line's **plan** in MIKA. MIKA computes its Forecast column as:

```
Forecast = max(0, Plan − Actuals − Committed)
```

- Non-actualised planned cost rows contribute to **Plan** only — they show up as Forecast.
- Actualised rows contribute to both **Plan** and **Actuals** — they net out of Forecast and appear in Actuals instead, so the EAC stays the same but the split is correct.

The S-Curve picks them up via the same plan total. The Forecast page and Cost Report both reflect them once they're entered.

## How this differs from Expenses

Same shape on the surface — a number with a date and a WBS — but the panels are doing different jobs:

| | Expenses | Planned Costs |
|---|---|---|
| Has a vendor receipt | Yes (always — photo capture is a core flow) | No, ever |
| Source of the number | Real invoice/receipt | PM100 budget plan |
| When created | After spending happens | Before, often at project setup |
| Receipt photo field | Yes | No |
| Mobile camera flow | Yes — snap and save | No — text entry only |
| When it hits Actuals in MIKA | When the expense is approved | When the Actualised flag is ticked |
| Walk-Away treatment | Date-driven (single-day classification) | Accrual-driven (3-way split across the window) |

If you find yourself uploading a receipt for a cost that didn't actually have one, it belongs here, not in Expenses.

## Migrating existing rows

If a project already has fake-expense rows for contingency or financing, just create the equivalent Planned Cost lines and delete the original expense rows. The MIKA numbers will be the same — same WBS, same amount — but the Expenses panel will stop nagging about missing receipts.
