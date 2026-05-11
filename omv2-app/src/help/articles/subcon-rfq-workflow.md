---
slug: subcon-rfq-workflow
title: RFQ Workflow
category: Subcontractors
order: 10
summary: Build an RFQ document, send it to vendors, log responses, cost-model them, and award the winner. Six stages track progress from Draft through Contracted.
relatedPanels: [subcon-rfq-doc, subcon-rfq-register]
---

# RFQ Workflow

The Subcontractor module covers the full RFQ → contract lifecycle for vendor-supplied scope:

```
Build RFQ → Send to vendors → Log responses → Cost-model → Award → Link contract
```

Two panels handle the bulk of this: the **RFQ Document** builder for creating the RFQ itself, and the **RFQ Register** for tracking each RFQ through the workflow.

## The six stages

Every RFQ moves through stages — visible as coloured pills next to each saved RFQ:

| Stage | Meaning |
|---|---|
| **Draft** | Being prepared, not yet sent |
| **Issued** | Sent to vendors, awaiting responses |
| **Responses In** | At least one vendor has responded |
| **Awarded** | A specific vendor response has been selected |
| **Contracted** | A PO has been raised against the awarded response |
| **Cancelled** | RFQ withdrawn — no further action |

Stage transitions happen automatically as you progress through the workflow.

## Building an RFQ

Open via **Subcontractors → RFQ Document**.

A saved RFQ pill bar appears at the top with all existing RFQs on the project. Click one to load it for editing, or **+ New RFQ** for a fresh document.

### Project & scope details

- **Title / Scope Name** — e.g. "Scaffolding Supply & Erect — GT1 Outage 2026"
- **Scope description** — the full scope of work, inclusions, exclusions, site conditions, access, HSE requirements
- **Response deadline** — when vendors need to respond by

### Labour rows

List each role you need vendors to quote. Per row:

- **Role name** — e.g. "Scaffolder Level 2"
- **Quantity** — number of people
- **Shift type** — Day Only / Night Only / Dual (both)
- **Duration** — full RFQ range or a specific date range

Vendors quote rates per role against this list.

### Equipment rows

List equipment items vendors need to rate:

- **Description** — e.g. "20t All-Terrain Crane"
- **Quantity, Duration**

Vendors quote rates plus transport in / transport out per equipment item.

### Special conditions

Free text for HSE requirements, induction prerequisites, SWMS expectations, PPE standards, etc. Appears verbatim in the printed RFQ.

### Save & Preview

- **Save RFQ** — persists the document. Marks it as Draft until issued.
- **Preview & Print** — produces the vendor-ready PDF. This is what gets sent to vendors.

## The RFQ Register

Open via **Subcontractors → RFQ Register**. Tracks every RFQ on the project through its stages.

### KPIs

Four cards at the top:

- **Total RFQs**
- **Issued**
- **Awarded**
- **Overdue** — Issued RFQs past their response deadline (red if > 0)

### The register table

Per RFQ: title, scope period, response deadline, vendors sent count, responses count, status pill, awarded vendor (if applicable). Click any row to expand response logging and award actions.

## Vendors Sent

When an RFQ moves to Issued, log the vendors it went out to via the **Vendors Sent** modal:

- Vendor name
- Contact phone, email
- Notes per recipient

This populates the Vendors Sent count on the register and gives an audit trail of who got what.

## Logging vendor responses

When vendors respond, log each one through the **Response Modal**:

- **Vendor name**
- **Total quote** and **currency**
- **Labour rates per role** — base rates per role (the system calculates shift costs)
- **Equipment rates** — rate per item, plus transport in / transport out
- **Inclusions / exclusions** — what's in scope, what's not
- **Received date**

Once a response is logged, the RFQ stage advances to Responses In.

## Awarding

Once you've selected a winner, click the award action against that vendor's response. The system:

- Marks that response as awarded (`is_awarded: true`)
- Clears award flags on all other responses for the same RFQ
- Sets the RFQ stage to **Awarded**
- Records the awarded response ID on the RFQ document

Only one award per RFQ. To switch the awarded vendor, award the new one — it transfers automatically.

## Overdue flagging

RFQs in **Issued** stage past their response deadline appear in the Overdue KPI on the Register. Useful for chasing up vendors who haven't responded yet, or for deciding whether to extend the deadline.

## What's next

Once awarded, two follow-on activities sit in separate articles:

- **Cost-model the responses** to compare projected total cost across vendors — see [Vendor Cost Modelling](subcon-cost-modelling)
- **Raise a PO** against the awarded response — see [Subcontractor Contracts](subcon-contracts-and-vendor-snapshot)
