---
slug: sap-reconciliation
title: SAP Reconciliation
category: Cost Tracking
order: 50
summary: Compare SAP cost exports against internally tracked costs to spot gaps. Load a SAP export, filter by date range, and import Back Office Hours where SAP has labour the local timesheets don't.
relatedPanels: [sap-recon]
---

# SAP Reconciliation

The SAP Reconciliation panel compares the SAP cost export against costs tracked in this app. It's a sanity check — finding gaps where SAP has costs we don't, or where we've recorded costs that haven't flowed into SAP yet.

Open via **Cost Tracking → SAP Recon**.

## Loading a SAP export

Click **📂 Load SAP Export (.xlsx)** and select the SAP cost report export. The panel parses it and shows it alongside the internal cost data.

Once loaded, the panel shows:

- **Loaded File card** — filename, import date, total row count, total value
- **Date Range Filter card** — narrow the comparison to a specific period (both sides are filtered consistently)
- **Summary card** — SAP Total, Labour Hours (from SAP cost element 61800160), and reconciliation deltas

## What gets compared

The panel matches SAP entries against the locally tracked costs. Differences fall into a few categories:

- **In SAP only** — SAP has it, we don't (something invoiced through SAP that hasn't been added here)
- **In OMV2 only** — we have it, SAP doesn't (something tracked here that hasn't flowed to SAP)
- **Match** — values reconcile within tolerance

The header view changes based on what the loaded file contains — if there are labour rows, additional labour-specific summary and import options appear.

## Import BO Hours

When SAP labour rows are detected, a **📥 Import BO Hours** button appears. This takes the SAP labour totals and imports them as Back Office Hours so they flow into the local cost model.

This is useful for SE AG support and back-office personnel whose hours are tracked in SAP rather than in our timesheets — without this import, the local model would have a gap relative to SAP.

The button opens a modal where you can select which persons to import (defaults to all detected). Confirm to commit the import.

## Date range filter

The **From / To** date inputs filter both sides of the comparison consistently. Useful for:

- Period-end reconciliation (e.g. "show me month of October only")
- Spot-checking a specific week against SAP
- Excluding very old SAP entries from a long-running project

Empty fields = no filter.

## CSV export

Once rows are loaded, **⬇ CSV** exports the comparison for further analysis. Useful when you need to send finance a list of what doesn't match.

## When to run a reconciliation

Typical cadences:

- **Weekly** during an active outage — catch gaps early while details are fresh
- **End of month** for the formal financial cutoff
- **Before any major report to the client** — make sure internal numbers match what finance is seeing in SAP

If reconciliation surfaces a gap, the fix is usually in one of the source panels: a missing invoice, an unrecorded variation, or labour that needs to come in via Back Office Hours.
