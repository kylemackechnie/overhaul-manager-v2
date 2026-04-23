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

  // UI state
  activePanel: string
  setActivePanel: (panel: string) => void

  activeRibbonTab: string
  setActiveRibbonTab: (tab: string) => void

  // Sidebar collapse (for mobile)
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
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

      activePanel: 'dashboard',
      setActivePanel: (panel) => set({ activePanel: panel }),

      activeRibbonTab: 'project',
      setActiveRibbonTab: (tab) => set({ activeRibbonTab: tab }),

      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
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
