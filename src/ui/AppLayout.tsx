import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Overview' },
  { to: '/analise', label: 'Análise' },
  { to: '/modelos', label: 'Modelos' },
  { to: '/config', label: 'Config' },
];

export function AppLayout() {
  return (
    <div className="app">
      <header className="navbar glass">
        <div className="brand">CLEPSYDRA - EDA</div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              end={item.to === '/'}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <footer className="footer">
        <span>
          © {new Date().getFullYear()} EDA. Feito com React + Vite.
        </span>
      </footer>
    </div>
  );
}


