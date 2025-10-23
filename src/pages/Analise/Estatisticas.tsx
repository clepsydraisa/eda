import { CsvPlot } from '../../ui/CsvPlot';

export function AnaliseEstatisticas() {
  return (
    <section className="page-blank">
      <h1 className="page-title">Estatísticas</h1>
      <div style={{display:'grid', gap:12}}>
        <div style={{border:'1px solid var(--border)', borderRadius:12, padding:12}}>
          <h3 style={{marginTop:0}}>Unificação dos CSV</h3>
          <p className="muted">Aqui vamos explicar como os ficheiros de condutividade, piezo, caudal e meteo foram tratados e agregados para gerar um CSV mensal unificado.</p>
        </div>
        <div style={{border:'1px solid var(--border)', borderRadius:12, padding:12}}>
          <h3 style={{marginTop:0}}>Heatmaps</h3>
          <p className="muted">Espaço reservado para heatmaps das variáveis mensais.</p>
        </div>
        <div style={{border:'1px solid var(--border)', borderRadius:12, padding:12}}>
          <h3 style={{marginTop:0}}>Exploração Interativa (CSV com lags)</h3>
          <p className="muted">Escolha o poço e as variáveis para estudo</p>
          <div style={{marginTop:8}}>
            {/* Gráfico reativo baseado em CSV */}
            <CsvPlot />
          </div>
        </div>
        <div style={{border:'1px solid var(--border)', borderRadius:12, padding:12}}>
          <h3 style={{marginTop:0}}>Retas de Regressão</h3>
          <p className="muted">Espaço reservado para regressões e métricas associadas.</p>
        </div>
      </div>
    </section>
  );
}


