import { Bell, CaretDown, Command, MagnifyingGlass, UserCircle, X } from '@phosphor-icons/react'
import { assetPath } from '../utils/assetPath'

export function AppHeader({ onSearchFocus, searchValue = '', activeNav = '零件库', currentSpace = '零件库' }) {
  return (
    <header className="app-header">
      <div className="brand-lockup"><span className="brand-name">命令中枢</span><span className="brand-tagline">让零件流动更简单</span></div>
      <nav className="global-nav" aria-label="主导航">
        {['零件库', '车型库', '采购', '库存', '销售'].map((item) => {
          const enabled = item === '零件库' || item === '车型库'
          return <button aria-disabled={!enabled || undefined} className={item === activeNav ? 'nav-item active' : 'nav-item'} disabled={!enabled} key={item} onClick={() => { if (item === '零件库') window.location.assign(assetPath('skus')); if (item === '车型库') window.location.assign(assetPath('vehicles')) }} title={enabled ? undefined : `${item}模块尚未开放`}>{item}</button>
        })}
      </nav>
      <button className="global-search" onClick={onSearchFocus} type="button">
        <MagnifyingGlass size={17} /><span>{searchValue || '搜索 VIN、OE号、SKU、车型，或输入命令…'}</span>{searchValue ? <span className="header-clear"><X size={14} /></span> : <span className="shortcut"><Command size={13} /> K</span>}
      </button>
      <div className="header-actions">
        <button className="current-space" type="button">当前：{currentSpace} <CaretDown size={13} weight="bold" /></button>
        <button className="notification-button" aria-label="通知模块尚未接入" disabled title="通知模块尚未接入" type="button"><Bell size={22} /></button>
        <div className="user-profile"><span className="user-avatar-placeholder"><UserCircle aria-hidden="true" size={29} /></span><span><strong>系统操作员</strong><small>身份认证待接入</small></span></div>
      </div>
    </header>
  )
}
