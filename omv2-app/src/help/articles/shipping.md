---
slug: shipping
title: Shipping
category: Logistics & Hardware
order: 20
summary: Inbound and outbound shipment tracking plus the 3-step WOSIT Excel import that creates shipments and populates the tooling and parts modules in one go.
relatedPanels: [shipping-dashboard, shipping-inbound, shipping-outbound, shipping-import]
---

# Shipping

The Shipping module tracks freight movements for the project — tooling and equipment coming to site, tooling returning home, hardware deliveries, parts arriving from Germany.

Two panel routes share the same `ShipmentsPanel` component, scoped by `direction`:

- **Inbound Shipping** (`shipping-inbound`) — anything coming to site
- **Outbound Shipping** (`shipping-outbound`) — anything leaving site (typically tooling returning home)

A third panel — **WOSIT Import** — is the bulk creation workflow for inbound shipments tied to SAP's WOSIT data.

## A shipment record

Each shipment captures:

- **Reference** — the unique identifier (HAWB, tracking number, internal ref)
- **Description** — what's in the shipment
- **Status** — pending / in_transit / delivered / etc.
- **Carrier** — DHL, freight forwarder name
- **Tracking number** — for live shipment tracking
- **ETA** — estimated arrival
- **Departure / Shipped date** — when it actually left
- **Ship type** — tooling / hardware / parts / other (drives which TVs and parts are tied to it)
- **Direction** — import or export (set by which panel route you're on)

Inbound and outbound shipments live in the same `shipments` table; the only difference is the `direction` field.

## Status pills

Each shipment shows a coloured pill for its current status. Click the row to expand and edit. Filter and group functions are kept simple — for high-volume tracking, use the Shipping Dashboard tiles.

## Manual add

The **+ Add Shipment** button opens a modal. Reference is required; everything else is optional. Useful for one-off freight movements not captured in WOSIT.

## Create from Imports (outbound only)

Outbound shipments often mirror inbound ones — tooling that came to site needs to go home again. The **📤 Create from Imports** button (visible only on the Outbound panel) generates outbound shipment records for tooling TVs that are currently inbound. Saves manually re-entering TV numbers and weights.

## WOSIT Import — the bulk workflow

This is the main way inbound shipments are created. SAP exports three Excel sheets that together describe everything coming to site for a project; the WOSIT Import panel parses all three and populates the database.

Open via **Logistics → WOSIT Import** (or Parts → Import — same panel).

### Step 1 — TV Sheet

Excel export with one row per TV (tooling/hardware top-level container). The sheet contains:

- TV numbers
- Header names (description)
- Departure date, ETA
- HAWB (House Air Waybill — the carrier reference)

Loading the TV sheet:

- Creates **import shipment records** with the HAWB as reference
- Creates **TV register entries** (linked through to the Global Tooling Register)
- Lets you classify each row per-row as **Tooling** or **Hardware** (the bulk **All Tooling** / **All Hardware** buttons set every row at once)

A checkbox column lets you exclude rows you don't want imported. The summary shows how many TVs are selected for each type.

### Step 2 — Kollo Sheet

The Kollo sheet lists individual packages/cartons within each TV. A TV might be one Kollo or several — the sheet maps Kollo → parent TV. Loading this populates the `global_kollos` table.

Kollos appear in the Tooling module's Kollos panel — see the Tooling article (when written).

### Step 3 — Parts Sheet

The Parts sheet lists every spare part / material number associated with the shipment. Loading this populates `wosit_lines` — the Spare Parts module reads from this table.

### Summary tiles

After loading any step, the top of the panel shows summary KPIs:

- Import Shipments created
- Tooling TVs
- Hardware TVs
- Packages (Kollos)
- WOSIT Parts

These give a quick read on what the import produced before you commit.

## Export documents

The Outbound Shipping panel can print two export documents per shipment:

- **🖨 Shipper's Letter of Instruction** — formal instruction to the freight forwarder
- **🖨 Commercial Invoice / Packing List** — for customs. The "show prices" toggle switches between Commercial Invoice (with prices, used for customs valuation) and Packing List (no prices, used as a contents manifest)

Both render from the shipment record plus the linked TVs and Kollos.

## Shipping Dashboard

Open via **Logistics → Shipping → Dashboard**. Tile-based overview of inbound and outbound movements, ETA tracker, in-transit count. Same dashboard framework as the main Dashboard.

## When to manually edit vs re-import

WOSIT data flows one direction — from SAP to OMV2. If a TV needs correcting:

- **Local change only** (e.g. status update, ETA adjustment) — edit directly on the Shipments panel
- **Source data change** (e.g. parts list amended in SAP) — re-export from SAP, re-import via WOSIT. The import detects existing TV numbers and updates them rather than duplicating.
