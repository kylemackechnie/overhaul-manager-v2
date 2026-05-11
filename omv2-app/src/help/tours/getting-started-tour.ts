/**
 * Getting Started walkthrough.
 *
 * Introduces a brand-new user to the ribbon layout, the File menu, the Help
 * button, project switching, and how tabs+buttons work together.
 *
 * Anchors used (all in src/components/layout/Ribbon.tsx):
 *   - [data-tour="ribbon-file-button"]
 *   - [data-tour="ribbon-help-button"]
 *   - [data-tour="ribbon-project-name"]
 *   - [data-tour="ribbon-tabs"]
 *   - [data-tour="ribbon-buttons"]
 */

import type { Tour } from './_types'

const tour: Tour = {
  id: 'getting-started-tour',
  title: 'Getting Started',
  description: 'A 90-second tour of the ribbon, File menu, and how to find your way around',
  module: 'Getting Started',
  estimatedSeconds: 90,
  steps: [
    {
      title: '👋 Welcome to Overhaul Manager',
      body: "Let's take a quick tour of the layout so you know where things live. You can skip any time with the × button, or use Back/Next to move through.",
      // No target → driver.js shows this centered with overlay only
    },
    {
      target: '[data-tour="ribbon-file-button"]',
      title: 'The File menu',
      body: "The purple File button opens a dropdown for things that aren't project-specific — User Management, Audit Trail, Reports Database, Data Migration, and Sign Out.",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="ribbon-help-button"]',
      title: 'Help is one click away',
      body: "Click this Help button any time to open Help & Guide. It has searchable reference articles, interactive walkthroughs like this one, and a What's New feed.",
      side: 'bottom',
      align: 'center',
    },
    {
      target: '[data-tour="ribbon-project-name"]',
      title: 'Your active project',
      body: "Everything in the app — costs, timesheets, resources, POs — is scoped to one project at a time. The active project is shown here in the title bar.",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="ribbon-tabs"]',
      title: 'Module tabs',
      body: "Features are grouped into module tabs across the ribbon: Project, Cost Tracking, Personnel, HSE, Subcontractors, Logistics, Hardware, Tooling, Site, and Global. Click a tab to switch modules.",
      side: 'bottom',
      align: 'start',
    },
    {
      target: '[data-tour="ribbon-buttons"]',
      title: 'Tab buttons',
      body: "The buttons in this strip change based on the active tab. Each one takes you to a specific panel. The ⚙ button on the far right of the tab row lets you reorder or hide tabs to suit how you work.",
      side: 'bottom',
      align: 'start',
    },
    {
      title: "🎉 You're ready to go",
      body: "That's the meta layer. For deep dives on specific workflows — timesheets, TCE, RFQs, POs, payroll imports — open the Help button and browse the Reference tab. New walkthroughs will be added over time.",
    },
  ],
}

export default tour
