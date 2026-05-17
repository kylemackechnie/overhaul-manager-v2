---
slug: mobile-app
title: Mobile App (iOS / Android)
category: Mobile App
order: 5
summary: How to install Overhaul Manager on your phone, what works in the field, and what to come back to desktop for.
---

# Mobile App

Overhaul Manager runs as a **Progressive Web App (PWA)** — same code as the desktop app, but with a touch-first layout that kicks in on small screens. Once installed, it sits on your home screen like any other app, works offline for the screens you've already opened, and updates itself silently when a new version ships.

## Install on iPhone / iPad (1 minute)

> Do this once — after that, the app launches from your home screen like a native app, no Safari address bar, no tab switching.

**Step 1 — Open in Safari**
Open Safari (not Chrome, not the in-app browser inside Slack/Teams) and go to the app URL. If you're already in another browser, copy the URL and paste it into Safari directly.

**Step 2 — Tap Share**
At the bottom of the Safari window, tap the **Share** button (the square with the up-arrow). If the bottom toolbar isn't visible, tap once near the bottom of the screen to bring it back.

**Step 3 — Add to Home Screen**
Scroll the share sheet until you see **Add to Home Screen** (a `+` icon). Tap it.

**Step 4 — Confirm**
You can rename it if you want (default is "OMv2"). Tap **Add** in the top-right.

**Step 5 — Launch from home screen**
Go to your home screen — you'll see the teal Overhaul Manager icon. Tap it. The app opens in full-screen with no Safari chrome, and the iOS status bar tinted to match the app.

**Sign in once.** Your session persists, so you won't be asked to sign in again unless you sign out manually or don't open the app for several weeks.

## Install on Android

Almost identical, but the entry point is in Chrome's menu:

1. Open the URL in Chrome (not Samsung Internet, not Firefox)
2. Tap the **⋮** menu (top-right)
3. Tap **Install app** or **Add to Home screen**
4. Confirm — icon appears on your home screen

## Navigating the mobile app

The mobile app has a different shape from desktop. Instead of the ribbon at the top, you get five tabs at the bottom of the screen:

- **🏠 Home** — Dashboard for the active project
- **👥 People** — Resources, Accommodation, Cars, Inductions
- **🧾 Expenses** — Quick receipt capture
- **📦 Parts** — Receive parts, Issue parts
- **☰ More** — Everything else: search, project switcher, profile, sign-out, and access to desktop-only panels

Tapping a tab you're already on returns you to that tab's landing page — a useful reset gesture if you're deep in a sheet or sub-panel.

**Pull down at the top of any list to refresh** — a teal spinner appears so you can see it's reloading.

## What's built for mobile (works great on a phone)

These panels have been designed for field use — large tap targets, simplified forms, camera integration where it makes sense:

| Panel | What you can do |
|---|---|
| **Dashboard** | Project overview, status snapshots |
| **Resources** | Add and edit people; filter by status (on-site, incoming, expired) |
| **Accommodation** | View bookings, assign occupants |
| **Cars** | Track collections and drop-offs with one tap |
| **Inductions** | **Gate-check lookup** — type a name, see traffic-light status (cleared / expiring / expired / no passport). Great at site entry. |
| **Issue Parts** | Tap-to-issue with optional barcode scan |
| **Receive Parts** | Scan box label, enter qty, done |
| **Receipts (Expenses)** | **Snap a photo with your phone camera** and capture the expense in 4 fields. ISO Filing Ref is auto-assigned. Cost-ex-GST, GM %, and sell price are filled with project defaults — bulk-edit on desktop later. |
| **Profile, Help, Project Settings** | Standard mobile-friendly forms |

## What's desktop-only (and why)

Some panels are too dense or feature-rich to fit a phone comfortably. You can still reach them on mobile via **More → All panels**, but you'll see an "Open on desktop" message. These include forecasting, MIKA cost plans, S-curve, SAP reconciliation, NRG TCE register, full timesheet entry, RFQ document builder, and the customer report.

The general rule: if a panel is for **capturing or looking up data in the field**, it's mobile-ready. If it's for **analysis, reporting, or bulk editing**, it stays on desktop.

## The More sheet

Tap **☰ More** to open a sheet from the bottom that contains:

- **Search at the top** — full-text search across everything (same as `Cmd+K` / `Ctrl+K` on desktop)
- **Phone-ready / All panels toggle** — by default you see only mobile-friendly panels grouped by module. Tap "All panels" to see everything, including desktop-only ones.
- **Account section at the bottom** — switch project, view your profile, switch to desktop view (forces the desktop layout if you want it for some reason), sign out.

The current project name is always shown next to "Switch project" so you can see at a glance which project you're in.

## Capturing receipts on mobile

The expense flow is built for one-handed use at a roadhouse or hotel reception:

1. Tab **🧾 Expenses**
2. Tap the big teal **📸 Snap receipt** button
3. Your camera opens — point at the receipt, tap shutter
4. Photo previews at the top of the form
5. Fill in **What was this for**, the **amount inc GST**, **category**, and **date** (defaults to today)
6. Tap **Save** — done

The receipt photo uploads to the same storage your desktop expenses use. On desktop you'll see the new expense in the register and can edit GM %, WBS, vendor, and other fields. Cost-ex-GST and sell-price are pre-calculated from the inc-GST amount you entered.

If the photo upload fails (flaky cellular), the expense still saves — you just get a warning and can re-attach the photo on desktop.

## Inductions gate-check

Designed for a site supervisor at the gate. Type a name, see whether the person is cleared. The status pill on each card uses traffic-light colours:

- **EXPIRED** (red) — has at least one expired cert — *do not let them work*
- **NO PASSPORT** (orange) — missing SEP/SQP entirely
- **EXPIRING** (amber) — within 30 days of expiry — *renew soon*
- **CLEARED** (green) — all good
- **NO RECORD** (grey) — no induction record matched this resource

Tap a person to see every cert in detail (Inductions section + High-Risk Work Licences section), with expiry dates and traffic-light status on each row.

The reference date defaults to today but you can change it (e.g. set it 30 days out to see who'll be expiring before a planned shutdown). The choice persists across desktop and mobile via the same project setting.

**Note**: you upload the induction Excel file on desktop. The mobile view is read-only — for fresh data, do the upload on desktop, then **pull down to refresh** on mobile.

## Offline behaviour

The app caches the shell and the screens you've recently opened, so if you lose signal mid-shift:

- **Read-only views** continue to work (your already-loaded data is visible)
- **Saves and uploads** queue and fail with a toast — try again when signal returns
- **Pull-to-refresh** retries the data fetch

Don't rely on offline mode for *critical* data — it's a graceful-degradation layer, not a true offline-first system. Check signal before relying on what the screen shows.

## Switching between mobile and desktop

The app auto-detects. On a phone, you get mobile; on a tablet or laptop, desktop. To override:

- **From mobile** → More → Switch to desktop view
- **From desktop** → user menu (top-right) → Preview as mobile

The override sticks until you toggle it back, and survives reloads.

## Updates

When a new version ships, you'll see a **"Update available"** prompt at the bottom of the screen. Tap **Refresh** to apply. The app reloads with the new code; your sign-in survives.

If you've left the app in the iOS app switcher for a long time, the update check fires when you switch back to it — usually within seconds of foregrounding.

## Troubleshooting

**The app feels stuck on an old version.** Force-quit the PWA (swipe up + away in the app switcher) and reopen. If still stuck: iOS Settings → Safari → Advanced → Website Data → find the Vercel domain → delete. Then re-open the home-screen icon.

**Camera doesn't open in the receipt form.** iOS PWAs sometimes block camera access. Open the app in Safari (not from the home-screen icon) once to grant the permission, then return to the home-screen launcher.

**Pull-to-refresh isn't firing.** Make sure your finger starts at the very top of the list (not in the middle of scrollable content). You need to be at scroll-position 0 for the gesture to engage.

**Sheets dismiss when I drag down.** That's intentional — the drag-handle at the top of any sheet is for swipe-to-dismiss. Tap outside the sheet (on the dim backdrop) to also dismiss, or use the close ✕ if present.
