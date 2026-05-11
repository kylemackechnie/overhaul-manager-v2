/**
 * Tour runner — wraps driver.js to plug into our app's panel routing
 * and Tour/TourStep types.
 *
 * Usage:
 *   import { runTour } from '../help/tours/runner'
 *   import { getTour } from '../help/tours/_index'
 *
 *   const tour = getTour('getting-started-tour')
 *   if (tour) runTour(tour, { setActivePanel })
 *
 * The runner is intentionally stateless — callers wire navigation via the
 * `setActivePanel` callback so this module doesn't need to know about Zustand.
 */

import { driver, type Driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import type { Tour, TourStep } from './_types'

interface RunTourOptions {
  /** Called when the tour wants to navigate to a panel (for requiresPanel and per-step nav). */
  setActivePanel?: (panel: string) => void
  /** Called when the user reaches the end of the tour (after clicking Done). */
  onComplete?: () => void
  /** Called when the user skips/closes the tour mid-flow. */
  onSkip?: () => void
}

/**
 * Map our TourStep[] to driver.js DriveStep[].
 *
 * driver.js exposes element=undefined steps as "popover only" (centered overlay).
 * We use that fallback if the target selector returns no match.
 */
function toDriveStep(step: TourStep): DriveStep {
  const driveStep: DriveStep = {
    popover: {
      title: step.title,
      description: step.body,
      side: step.side,
      align: step.align,
    },
  }
  if (step.target) {
    // driver.js accepts string selectors directly; missing elements become popover-only.
    driveStep.element = step.target
  }
  return driveStep
}

/**
 * Run a tour. Returns the driver.js instance so callers can destroy it
 * if they need to (e.g. on unmount), though normally the runner handles this.
 */
export function runTour(tour: Tour, opts: RunTourOptions = {}): Driver {
  const { setActivePanel, onComplete, onSkip } = opts

  // Pre-flight: if the tour expects a specific panel, navigate first and wait a tick
  // so the DOM mounts before driver tries to highlight an element on it.
  const prep = async () => {
    if (tour.requiresPanel && setActivePanel) {
      setActivePanel(tour.requiresPanel)
      // 2 RAFs ensures React commits + paints before driver measures positions
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    }
  }

  const steps = tour.steps.map(toDriveStep)

  const driverInstance = driver({
    showProgress: true,
    progressText: 'Step {{current}} of {{total}}',
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Done',
    showButtons: ['next', 'previous', 'close'],
    overlayOpacity: 0.6,
    stagePadding: 4,
    stageRadius: 6,
    allowClose: true,
    smoothScroll: true,
    steps,
    onPopoverRender: (_popover, { state }) => {
      // Run the step's onShow hook (if any) AFTER the popover renders so the
      // user has visual confirmation, then any DOM mutations from onShow
      // (e.g. opening a menu) happen with the popover already on screen.
      const idx = state.activeIndex
      if (typeof idx === 'number') {
        const step = tour.steps[idx]
        if (step?.onShow) {
          void Promise.resolve(step.onShow())
        }
      }
    },
    onDestroyStarted: () => {
      // Triggered when user closes the tour. Distinguish complete vs skip
      // by checking if we're on the last step.
      const isLast = driverInstance.isLastStep()
      driverInstance.destroy()
      if (isLast) {
        onComplete?.()
      } else {
        onSkip?.()
      }
    },
  })

  // Fire-and-forget the prep + start. Errors here are non-fatal: if requiresPanel
  // fails for any reason, the tour still starts on whatever's currently rendered.
  void prep().then(() => driverInstance.drive()).catch(err => {
    console.error('[runTour] failed to start tour', tour.id, err)
  })

  return driverInstance
}
