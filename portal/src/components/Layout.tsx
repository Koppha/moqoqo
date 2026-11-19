import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth'
import { MASERU_LABEL } from '../time'
import { Icon, type IconName } from './Icon'
import { TitleSlot } from './ui'

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/maintenance', label: 'Maintenance', icon: 'wrench' },
  { to: '/users', label: 'Users', icon: 'users' },
  { to: '/transactions', label: 'Transactions', icon: 'swap' },
  { to: '/analytics', label: 'Analytics', icon: 'bars' },
  { to: '/performance', label: 'Performance', icon: 'trend' },
  { to: '/retention', label: 'Retention (churn risk)', icon: 'store' },
  { to: '/channel-map', label: 'Channel map', icon: 'pin' },
  { to: '/risk', label: 'Risk', icon: 'alert' },
  { to: '/cases', label: 'Cases (financial crime)', icon: 'file' },
  { to: '/ai-governance', label: 'AI governance', icon: 'shield' },
  { to: '/sign-ins', label: 'Sign-in monitoring', icon: 'shield' },
  { to: '/ecosure', label: 'EcoSure', icon: 'shield' },
  { to: '/services', label: 'Services', icon: 'grid' },
  { to: '/remittance', label: 'Remittance', icon: 'send' },
  { to: '/split-bill', label: 'Split bill', icon: 'users' },
  { to: '/societies', label: 'Society (Mekhatlo)', icon: 'users' },
  { to: '/donate', label: 'Donate', icon: 'users' },
  { to: '/support', label: 'Help & support', icon: 'help' },
  { to: '/feedback', label: 'Feedback', icon: 'star' },
  { to: '/home-offers', label: 'Home & offers', icon: 'dashboard' },
  { to: '/places', label: 'Places (Find us)', icon: 'pin' },
  { to: '/branding', label: 'Branding', icon: 'image' },
  { to: '/atm', label: 'ATM simulator', icon: 'atm' },
  { to: '/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/ussd', label: 'USSD fallback', icon: 'settings' },
  { to: '/audit', label: 'Audit log', icon: 'audit' },
  { to: '/settings', label: 'App settings', icon: 'settings' },
]

/** "Kopano Hatasi" → "KH". */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.at(0)?.toUpperCase() ?? '').join('') || '?'

/** The sidebar item the page belongs to: /users/42 → Users. */
const section = (path: string) => NAV.find((n) => (n.to === '/' ? path === '/' : path === n.to || path.startsWith(`${n.to}/`)))

export function Layout() {
  const { admin, logout } = useAuth()
  const { pathname } = useLocation()
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null)
  const current = section(pathname)
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span>
            <span className="brand-name">EcoCash Super App</span>
            <span className="brand-sub">Staff portal</span>
          </span>
        </div>
        <nav aria-label="Main">
          <ul className="nav">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <Icon name={n.icon} size={18} />
                  <span>{n.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <div className="operator">
            <span className="operator-dot" aria-hidden="true" />
            <span>
              <span className="operator-name">Econet Telecom Lesotho</span>
              <span className="operator-sub">Connecting Basotho</span>
            </span>
          </div>
          <p className="tz-note">Times are {MASERU_LABEL}</p>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        <div className="topbar">
          {current && (
            <span className="topbar-icon" aria-hidden="true">
              <Icon name={current.icon} size={22} />
            </span>
          )}
          <div className="topbar-title" ref={setTitleSlot} data-label={current?.label ?? ''} />
          {admin && (
            <>
              <Link to="/notifications" className="topbar-bell" aria-label="Notifications" title="Notifications">
                <Icon name="bell" size={20} />
              </Link>
              {/* Who is signed in, their role, and sign-out. */}
              <details className="user-menu">
                <summary>
                  <span className="avatar" aria-hidden="true">{initials(admin.name)}</span>
                  <span className="user-name">{admin.name}</span>
                  <Icon name="chevronDown" size={16} />
                </summary>
                <div className="user-menu-panel">
                  <span className="who-email">{admin.email}</span>
                  <span className={`chip chip-role-${admin.role}`}>{admin.role === 'admin' ? 'Admin' : 'Support · read-only'}</span>
                  <button type="button" className="btn btn-ghost btn-sm signout" onClick={logout}>
                    <Icon name="logout" size={16} />
                    Sign out
                  </button>
                </div>
              </details>
            </>
          )}
        </div>
        <div className="content">
          <TitleSlot.Provider value={titleSlot}>
            <Outlet />
          </TitleSlot.Provider>
        </div>
      </main>
    </div>
  )
}
