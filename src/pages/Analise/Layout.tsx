import { NavLink, Outlet } from 'react-router-dom';

export function AnaliseLayout() {
  return (
    <section className="page-blank">
      <h1 className="page-title">Análise</h1>
      <nav style={{display:'flex', gap:8, marginBottom:12}}>
        <NavLink to="info" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>Info</NavLink>
        <NavLink to="estatisticas" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>Estatísticas</NavLink>
        <NavLink to="mapa" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>Mapa</NavLink>
      </nav>
      <Outlet />
    </section>
  );
}


