# SE AG timesheet — EUR / AUD treatment

**Project:** NRG Gladstone Unit 2 2026
**Question from NRG:** confirm that SE AG (German specialist) labour is computed in EUR and converted to AUD, and that allowances are computed in AUD only.

**Answer:** confirmed on both counts. Evidence below is taken straight from the Overhaul Manager v2 source, with file and line references so it can be audited end-to-end.

---

## 1. Where labour and allowances are stored

Every approved timesheet is exploded by `writeTimesheetCostLines()` into rows in the `timesheet_cost_lines` table. This is the single source of truth that every NRG report reads from (Actuals, Invoicing, TCE Export, the new Weekly Register).

The relevant columns on each row:

| Column | Meaning | Currency |
|---|---|---|
| `cost_labour` | Internal cost of the labour for this row | **AUD** (FX-converted at project rate for EUR cards) |
| `sell_labour` | Internal sell of the labour for this row | **AUD** (FX-converted at project rate for EUR cards) |
| `sell_labour_eur` | Raw EUR sell — preserved only for SE AG rows | **EUR** (zero for all non-SE AG rows) |
| `cost_allowances` | Allowance cost for this row | **AUD** |
| `sell_allowances` | Allowance sell for this row | **AUD** |

---

## 2. Evidence — labour goes through EUR → AUD

Source: `omv2-app/src/engines/timesheetCostEngine.ts`

**Currency lookup (lines 146–151):**

```ts
const rcCurrency = (rcAny.currency as string) || 'AUD'
const isEurCard  = rcCurrency === 'EUR'
// sell_labour stores AUD (project-rate conversion) for internal cost tracking.
// sell_labour_eur stores the raw EUR amount for seag rows, used with
// invoice.eur_spot_rate at invoicing time. Non-seag rows always get 0.
const labourFx = isEurCard && project ? fxRate(project, rcCurrency) : 1
```

`labourFx` is the project's stored EUR → AUD rate. For non-EUR cards (Trades, SE Field Service, subcontractors) it is `1`.

**Labour write (lines 249–252):**

```ts
dayLabourCost = calcHoursCost(split, rc, 'cost') * labourFx
dayLabourSell = calcHoursCost(split, rc, 'sell') * labourFx
// Raw EUR for seag — stored separately so invoicing can apply spot rate
if (isEurCard) dayLabourSellEur = calcHoursCost(split, rc, 'sell')
```

- `calcHoursCost(split, rc, 'cost')` and `calcHoursCost(split, rc, 'sell')` return native rate-card currency — for SE AG that is EUR.
- The `* labourFx` multiplication converts that EUR amount into AUD before it is written to `cost_labour` / `sell_labour`.
- The raw EUR is preserved separately in `sell_labour_eur` so the customer invoice can re-apply a customer-specified spot rate at invoicing time (see §5).

---

## 3. Evidence — allowances are computed in AUD only

Source: `omv2-app/src/engines/timesheetCostEngine.ts`, lines 257–270.

```ts
if (isMgmt) {
  // Management/SE AG: FSA, Camp, or LAHA-treated-as-FSA (mutually exclusive)
  if (day.fsa) {
    dayCostAllow = pf(rcAny.fsa_cost);  daySellAllow = pf(rcAny.fsa_sell)
  } else if (day.camp) {
    dayCostAllow = pf(rcAny.camp_cost ?? rcAny.camp); daySellAllow = pf(rcAny.camp)
  } else if (day.laha) {
    // Legacy: management with LAHA toggle gets FSA rate
    dayCostAllow = pf(rcAny.fsa_cost);  daySellAllow = pf(rcAny.fsa_sell)
  }
}
```

`isMgmt` is true for both `management` (SE Field Service) and `seag` (SE AG) rate-card categories. Note that there is **no `* labourFx` multiplication** on any allowance value — the rate-card field is read directly and stored verbatim. This is intentional: LAHA, FSA, Meal and Camp are Australian award allowances paid in Australian dollars regardless of the worker's home currency.

The intent is documented in the engine itself at line 145:

> *"Allowances stay AUD (LAHA/FSA/meal/camp are Australian award allowances)."*

Travel allowance (line 274) uses the same pattern — `rcAny.travel_cost` / `rcAny.travel_sell` read directly, no FX.

---

## 4. Verification of stored values

A spot check on `timesheet_cost_lines` for any approved SE AG timesheet row will show:

- `sell_labour_eur > 0` and `sell_labour ≈ sell_labour_eur × project_fx_rate` (within rounding).
- `sell_allowances` is the AUD rate-card value direct (e.g. FSA at $183/day, Camp at $199/day) — independent of FX.

For all non-SE AG rows the column `sell_labour_eur` is zero by construction (line 314 of the engine: `sell_labour_eur = 0` for non-EUR cards), so this is also a quick check that no other category has accidentally landed there.

---

## 5. Invoicing — labour gets the customer-specified spot rate

Source: `omv2-app/src/pages/site/NrgInvoicingPanel.tsx`, lines 226–235.

At customer invoicing time, each NRG customer invoice carries its own `eur_spot_rate` (entered by the PM on the invoice header — typically the rate the customer wants applied for that billing week). For weeks containing SE AG hours:

```ts
// seag week — gated on spot rate
sell = row.sell_labour_eur * rate + (row.sell_allowances || 0)
```

- `row.sell_labour_eur` — native EUR from the engine
- `× rate` — customer's stated spot rate for that invoice week
- `+ row.sell_allowances` — Australian allowances added straight in (already AUD)

If no spot rate is set for a SE AG week, the labour portion is gated to zero and a warning is raised in the panel — the line is not allowed to flow through to invoicing without a stated FX rate.

---

## 6. Worked example

A SE AG specialist works a single Monday on Unit 2:

| Input | Value |
|---|---|
| Hours | 12h day shift |
| Day type | weekday, FSA flag set |
| Rate card | SE AG Specialist, EUR — NT €60/h, T1.5 €90/h |
| Project FX (EUR→AUD) | 1.65 |
| Rate card FSA allowance | $235 cost / $310 sell (AUD) |
| Customer invoice spot rate (later) | 1.62 |

**Hours split.** 12h on a weekday with the standard 10h NT threshold ⇒ 10h NT + 2h T1.5.

**Native EUR labour.** 10 × 60 + 2 × 90 = €600 + €180 = €780.

**What gets written to `timesheet_cost_lines`:**

| Column | Value | Source |
|---|---|---|
| `cost_labour` | 780 × 1.65 = **AUD 1,287.00** | EUR cost × project FX |
| `sell_labour` | 780 × 1.65 = **AUD 1,287.00** | EUR sell × project FX *(equal here because cost and sell rate cards are identical in this example)* |
| `sell_labour_eur` | **€780.00** | Raw EUR preserved for invoicing |
| `cost_allowances` | **AUD 235.00** | FSA cost — no FX |
| `sell_allowances` | **AUD 310.00** | FSA sell — no FX |

**What the customer sees on the NRG invoice for that week,** with NRG's stated spot rate of 1.62:

| Item | Calculation | AUD |
|---|---|---|
| SE AG labour | 780 × **1.62** | 1,263.60 |
| FSA allowance | 310 (unchanged) | 310.00 |
| **Total** | | **1,573.60** |

The labour portion has been re-priced at the customer's stated rate (1.62), while the allowance is unchanged from what was earned on the day. This is the design intent.

---

## 7. Summary table

| Item | Source currency | Conversion | Stored as | Reported to customer as |
|---|---|---|---|---|
| SE AG labour | EUR rate card | × project FX (internal) | AUD in `sell_labour` + raw EUR in `sell_labour_eur` | EUR × customer's invoice spot rate |
| SE AG allowance (FSA / Camp / LAHA) | AUD rate card | none | AUD in `sell_allowances` | AUD as-is |

---

## 8. Data integrity check (recommended)

The code is correct; the only thing that could break this in practice is a rate card with the wrong currency flag or with EUR values entered in the AUD allowance fields. Recommend confirming, on the project's rate cards:

1. SE AG rate cards have `currency = 'EUR'`.
2. `fsa_cost`, `fsa_sell`, `camp_cost`, `camp`, `travel_cost`, `travel_sell` on those cards are **AUD numbers**, not EUR.
3. `dnt`, `dt15`, `ddt`, `nnt`, `ndt` rate-band values on those cards are **EUR numbers**.

If any of these are wrong, the engine logic will silently apply the wrong treatment (e.g. an EUR allowance value would be stored as if it were AUD; an AUD labour rate would be EUR×FX'd). Easy to verify by opening the rate card and checking the labelled fields.
