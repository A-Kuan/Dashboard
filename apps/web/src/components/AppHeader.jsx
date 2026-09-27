import { Bell, CaretDown, Command, MagnifyingGlass } from '@phosphor-icons/react'

export function AppHeader({ onSearchFocus }) {
  return (
    <header className="app-header">
      <div className="brand-lockup"><span className="brand-name">命令中枢</span><span className="brand-tagline">让零件流动更简单</span></div>
      <nav className="global-nav" aria-label="主导航">
        {['零件库', '采购', '库存', '销售'].map((item, index) => <button className={index === 0 ? 'nav-item active' : 'nav-item'} key={item}>{item}</button>)}
      </nav>
      <button className="global-search" onClick={onSearchFocus} type="button">
        <MagnifyingGlass size={17} /><span>搜索 VIN、OE号、SKU、车型，或输入命令…</span><span className="shortcut"><Command size={13} /> K</span>
      </button>
      <div className="header-actions">
        <button className="current-space" type="button">当前：零件库 <CaretDown size={13} weight="bold" /></button>
        <button className="notification-button" aria-label="通知" type="button"><Bell size={22} /><span className="notification-count">3</span></button>
        <div className="user-profile"><img src="/assets/user-avatar.png" alt="张伟" /><span><strong>张伟</strong><small>采购中心 · 运营</small></span></div>
      </div>
    </header>
  )
}

