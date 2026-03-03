import { create } from 'zustand'

interface User {
  id: number
  username: string
  realName: string
  permissions: Record<string, boolean>
  isAdmin: boolean
}

interface AuthState {
  user: User | null
  isLoggedIn: boolean
  login: (user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoggedIn: false,
  login: (user) => set({ user, isLoggedIn: true }),
  logout: () => set({ user: null, isLoggedIn: false })
}))
