import {
  CarProfile,
  CaretLeft,
  ChartBar,
  ClipboardText,
  Cube,
  FileText,
  GearSix,
  House,
  Robot,
  ShoppingCart,
  Storefront,
  Tag,
  User,
  Wrench,
  X,
} from '@phosphor-icons/react'
import { assetPath } from '../utils/assetPath'

const navGroups = [
  {
    items: [
      { id: 'home', label: '工作台', icon: House },
      { id: 'sku', label: 'SKU 资料库', icon: Cube },
      { id: 'vehicles', label: '车型库', icon: CarProfile },
      { id: 'customers', label: '客户管理', icon: User },
      { id: 'quotes', label: '报价管理', icon: ClipboardText },
      { id: 'purchases', label: '采购管理', icon: ShoppingCart },
      { id: 'orders', label: '订单管理', icon: FileText },
      { id: 'suppliers', label: '供应商管理', icon: Storefront },
      { id: 'reports', label: '数据报表', icon: ChartBar },
    ],
  },
  {
    title: '工具',
    items: [
      { id: 'compare', label: '多家比价', icon: Wrench },
      { id: 'vin', label: 'VIN 解析', icon: X },
      { id: 'oe', label: 'OE 查询', icon: Tag },
      { id: 'drawings', label: '图纸资料', icon: FileText },
    ],
  },
  {
    title: 'AI',
    items: [{ id: 'pi', label: 'Pi 助手', icon: Robot }],
  },
]

export function WorkbenchSidebar({ active = 'home', collapsed = false, onToggle, onNavigate, onUnavailable }) {
  const navigate = (item) => {
    if (item.id === 'home' || item.id === 'sku') onNavigate?.(item.id)
    else onUnavailable?.(item.label)
  }

  return (
    <>
      <aside className="workbench-sidebar" aria-label="主导航">
      <div className="workbench-brand">
        <img className="workbench-logo workbench-logo-full" src={assetPath('assets/workbench/logo-transparent.png')} alt="虎山行 Auto Parts" />
        <img className="workbench-logo workbench-logo-compact" src={assetPath('assets/workbench/logo-transparent.png')} alt="" />
      </div>
      <div className="workbench-nav-scroll">
        {navGroups.map((group, groupIndex) => (
          <div className={`workbench-nav-group group-${groupIndex}`} key={group.title || 'main'}>
            {group.title ? <span className="workbench-nav-title">{group.title}</span> : null}
            {group.items.map((item) => {
              const Icon = item.icon
              const isActive = item.id === active
              return (
                <button aria-label={item.label} className={`workbench-nav-item ${isActive ? 'active' : ''}`} key={item.id} onClick={() => navigate(item)} title={collapsed ? item.label : undefined} type="button">
                  <Icon size={20} weight={isActive ? 'fill' : 'bold'} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <button aria-label="设置" className="workbench-settings" title={collapsed ? '设置' : undefined} type="button" onClick={() => onUnavailable?.('设置')}><GearSix size={20} weight="bold" /><span>设置</span></button>
      <p className="workbench-slogan">更好的配件<br />让每一程更安心</p>
      </aside>
      <button aria-expanded={!collapsed} aria-label={collapsed ? '展开导航' : '收起导航'} className="workbench-sidebar-toggle" onClick={onToggle} title={collapsed ? '展开导航' : '收起导航'} type="button"><CaretLeft size={16} weight="bold" /></button>
    </>
  )
}
