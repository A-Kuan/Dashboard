import { createContext, useContext } from 'react'
import type { User } from '../catalog/types'
export const AuthContext = createContext<{ user: User; logout: () => Promise<void> } | null>(null)
export function useAuth() {
  return useContext(AuthContext)!
}
