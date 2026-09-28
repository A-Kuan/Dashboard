import { Bell, CaretDown, Command, MagnifyingGlass, X } from '@phosphor-icons/react'
import { assetPath } from '../utils/assetPath'

export function AppHeader({ onSearchFocus, searchValue = '', activeNav = '零件库', currentSpace = '零件库' }) {
  return (
    <header className="app-header">
      <div className="brand-lockup"><span className="brand-name">命令中枢</span><span className="brand-tagline">让零件流动更简单</span></div>
      <nav className="global-nav" aria-label="主导航">
        {['零件库', '采购', '库存', '销售'].map((item) => <button aria-disabled={item !== '零件库'} className={item === activeNav ? 'nav-item active' : 'nav-item'} disabled={item !== '零件库'} key={item} title={item === '零件库' ? undefined : `${item}模块尚未开放`}>{item}</button>)}
      </nav>
      <button className="global-search" onClick={onSearchFocus} type="button">
        <MagnifyingGlass size={17} /><span>{searchValue || '搜索 VIN、OE号、SKU、车型，或输入命令…'}</span>{searchValue ? <span className="header-clear"><X size={14} /></span> : <span className="shortcut"><Command size={13} /> K</span>}
      </button>
      <div className="header-actions">
        <button className="current-space" type="button">当前：{currentSpace} <CaretDown size={13} weight="bold" /></button>
        <button className="notification-button" aria-label="通知" type="button"><Bell size={22} /><span className="notification-count">3</span></button>
        <div className="user-profile"><img src={assetPath('assets/user-avatar.png')} alt="张伟" /><span><strong>张伟</strong><small>采购中心 · 运营</small></span></div>
      </div>
    </header>
  )
}
