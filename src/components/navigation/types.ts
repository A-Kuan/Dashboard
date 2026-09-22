import type { TablerIcon } from '@tabler/icons-react'

type NavigationBase = {
  id: string
  label: string
  icon?: TablerIcon
  badge?: number
}

export type NavigationLink = NavigationBase & {
  type: 'link'
  to: string
  end?: boolean
}

export type NavigationGroup = NavigationBase & {
  type: 'group'
  defaultOpen?: boolean
  children: readonly NavigationItem[]
}

export type NavigationItem = NavigationLink | NavigationGroup

export type NavigationSection = {
  id: string
  label?: string
  items: readonly NavigationItem[]
}
