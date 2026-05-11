/**
 * Tour type definitions for the Help & Guide walkthrough engine.
 *
 * A Tour is a typed array of steps that highlight UI elements with popovers.
 * Tours live in src/help/tours/ and are auto-registered by _index.ts.
 *
 * Anchor convention: components add data-tour="anchor-id" attributes to
 * elements they want a step to point at. Each step's `target` is the CSS
 * selector for that attribute, e.g. '[data-tour="ribbon-file-button"]'.
 *
 * Engine: built on driver.js (https://driverjs.com).
 */

export interface TourStep {
  /**
   * CSS selector for the element to highlight.
   * Standard pattern: '[data-tour="anchor-id"]'.
   * If the target doesn't exist or is omitted, the step is shown as a
   * centered popover with no element highlight.
   */
  target?: string
  /** Short heading shown in the popover. */
  title: string
  /** Body text shown below the title. Plain text only — no markdown. */
  body: string
  /** Which side of the target the popover sits. Default: driver.js auto. */
  side?: 'top' | 'right' | 'bottom' | 'left' | 'over'
  /** Alignment along the chosen side. Default: 'center'. */
  align?: 'start' | 'center' | 'end'
  /**
   * Optional hook called when this step is shown. Useful for opening
   * a menu, switching tabs, etc. so the next target is visible.
   *
   * Returns void or a Promise — engine awaits before moving on.
   */
  onShow?: () => void | Promise<void>
}

export interface Tour {
  /** Unique stable ID. Used by relatedTour: in article frontmatter, and by userPrefs.help_completed_tours. */
  id: string
  /** Display name shown in the Walkthroughs tab and welcome banner. */
  title: string
  /** Optional short description shown next to the title in the Walkthroughs list. */
  description?: string
  /** Loose grouping for the Walkthroughs list. Free-text — examples: 'Getting Started', 'Cost Tracking', 'Personnel'. */
  module: string
  /** Rough length so users know what they're signing up for. */
  estimatedSeconds?: number
  /**
   * Optional panel ID to navigate to before the tour starts.
   * The engine sets activePanel and waits a tick for the DOM to settle.
   */
  requiresPanel?: string
  /** The ordered list of steps. */
  steps: TourStep[]
}
