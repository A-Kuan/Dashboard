import { IconLayoutGrid, IconCube, IconUsers, IconSettings } from '@tabler/icons-react'
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
      {
        id: 'sales',
        type: 'group',
        label: '客户与报价',
        icon: IconUsers,
        children: [
          { id: 'quote-templates', type: 'link', label: '报价模板', to: '/quotes/templates' },
          { id: 'customers', type: 'link', label: '客户项目', to: '/customers' },
        ],
      },
      {
        id: 'products',
        type: 'group',
        label: '商品资料',
        icon: IconCube,
        children: [
          { id: 'skus', type: 'link', label: 'SKU 档案', to: '/skus' },
          { id: 'sku-foundation', type: 'link', label: '商品基础字典', to: '/sku-foundation' },
        ],
      },
      {
        id: 'settings',
        type: 'group',
        label: '系统设置',
        icon: IconSettings,
        children: [
          {
            id: 'configuration-dictionaries',
            type: 'link',
            label: '配置中心字典',
            to: '/settings/dictionaries',
          },
          { id: 'accounts', type: 'link', label: '账号管理', to: '/settings/accounts' },
        ],
      },
    ],
  },
]
