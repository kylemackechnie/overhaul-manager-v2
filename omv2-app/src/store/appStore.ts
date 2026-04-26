import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppUser, Project } from '../types'

interface AppStore {
  // Auth
  currentUser: AppUser | null
  setCurrentUser: (user: AppUser | null) => void

  // Active project
  activeProjectId: string | null
  activeProject: Project | null
  setActiveProject: (project: Project | null) => void
  restoreProject: (project: Project | null) => void

  // UI state
  activePanel: string
  setActivePanel: (panel: string) => void

  activeRibbonTab: string
  setActiveRibbonTab: (tab: string) => void

  // Sidebar collapse (for mobile)
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void

  // Cross-panel navigation intent (e.g. RFQ → auto-open PO edit)
  pendingPoId: string | null
  setPendingPoId: (id: string | null) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),

      activeProjectId: null,
      activeProject: null,
      setActiveProject: (project) => set({
        activeProject: project,
        activeProjectId: project?.id ?? null,
        activePanel: 'dashboard',
        activeRibbonTab: 'project',
      }),

      // Restore project without resetting panel (used on page reload)
      restoreProject: (project: Project | null) => set({
        activeProject: project,
        activeProjectId: project?.id ?? null,
      }),

      activePanel: 'dashboard',
      setActivePanel: (panel) => set({ activePanel: panel }),

      activeRibbonTab: 'project',
      setActiveRibbonTab: (tab) => set({ activeRibbonTab: tab }),

      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      pendingPoId: null,
      setPendingPoId: (id) => set({ pendingPoId: id }),
    }),
    {
      name: 'omv2-app-store',
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        activePanel: state.activePanel,
        activeRibbonTab: state.activeRibbonTab,
      }),
    }
  )
)
