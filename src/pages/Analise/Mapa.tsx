import { MapSection } from '../../ui/MapSection';

export function AnaliseMapa() {
  return (
    <section className="page-blank">
      <h1 className="page-title">Mapa</h1>
      <MapSection />
      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <h2 className="page-title" style={{ fontSize: '22px' }}>Mapa de Correlações</h2>
        <p className="muted" style={{ marginTop: 4 }}>correlação entre as 9 variáveis</p>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginTop: 8 }}>
          <iframe
            title="Mapa de correlações"
            src={`${import.meta.env.BASE_URL || '/'}correlacoes/mapa_r2.html`}
            style={{ width: '100%', height: 520, border: '0' }}
          />
        </div>
      </div>

      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <h2 className="page-title" style={{ fontSize: '22px' }}>Mapa de Correlações</h2>
        <p className="muted" style={{ marginTop: 4 }}>correlação entre variáveis independentes</p>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginTop: 8 }}>
          <iframe
            title="Mapa de correlações - Variáveis Independentes"
            src={`${import.meta.env.BASE_URL || '/'}correlacoes/mapa_r2_sep.html`}
            style={{ width: '100%', height: 520, border: '0' }}
          />
        </div>
      </div>
    </section>
  );
}


