import { IconLayoutGrid } from '@tabler/icons-react'
import type { NavigationSection } from '../components/navigation/types'

export const navigation: readonly NavigationSection[] = [
  {
    id: 'main',
    items: [
      {
        id: 'workspace',
        type: 'group',
        label: '工作台',
        icon: IconLayoutGrid,
        defaultOpen: true,
        children: [{ id: 'home', type: 'link', label: '首页', to: '/' }],
      },
    ],
  },
]
