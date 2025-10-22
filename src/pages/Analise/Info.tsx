export function AnaliseInfo() {
  const base = (import.meta.env.BASE_URL || '/');
  const fullImg = `${base}img/tables/meteo_full_tab.png`;
  const fallbackImg = `${base}img/tables/meteo_tab.png`;

  return (
    <section className="page-blank">
      <h1 className="page-title">Info</h1>

      <div style={{display:'grid', placeItems:'center', margin:'12px 0 16px'}}>
        <img
          src={fullImg}
          alt="Tabela unificada (meteo_full)"
          style={{maxWidth:'100%', height:'auto', borderRadius:12, border:'1px solid var(--border)'}}
          onError={(e)=>{ (e.currentTarget as HTMLImageElement).src = fallbackImg; }}
        />
      </div>

      <div style={{display:'grid', gap:12}}>
        <div style={{border:'1px solid var(--border)', borderRadius:12, padding:12}}>
          <h3 style={{marginTop:0}}>Objetivo</h3>
          <p className="muted">Gerar uma tabela mensal unificada a partir das cinco fontes principais (condutividade, piezo, caudal, meteo e nitrato), para posterior análise estatística e correlações.</p>
        </div>
        <div style={{border:'1px solid var(--border)', borderRadius:12, padding:12}}>
          <h3 style={{marginTop:0}}>Join e Harmonização</h3>
          <p className="muted">Os datasets são limpos e normalizados e depois unidos por data e por código do ponto de medição. A data é alinhada para o mesmo intervalo e formato; os códigos são padronizados.</p>
        </div>
        <div style={{border:'1px solid var(--border)', borderRadius:12, padding:12}}>
          <h3 style={{marginTop:0}}>Agregação Mensal</h3>
          <p className="muted">Após o join, os valores são agregados ao nível mensal (média/mediana conforme variável), produzindo a tabela final utilizada nas páginas de Estatísticas e Mapa.</p>
        </div>
      </div>
    </section>
  );
}


