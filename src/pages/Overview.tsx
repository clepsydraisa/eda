import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { cacheRead, cacheWrite, cacheClear } from '../lib/cache';
import { fetchAll } from '../lib/edaData';


type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
};

export function Overview() {
  const [rows, setRows] = useState<ColumnRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [codeSortDir, setCodeSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    async function fetchColumns() {
      setLoading(true);
      setError(null);
      try {
        if (!supabase) {
          setError('Faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
          return;
        }
        const { data, error: err } = await supabase
          .from('table_columns')
          .select('*')
          .order('table_name', { ascending: true })
          .order('column_name', { ascending: true });
        if (err) throw err;
        if (!cancelled) setRows(data as ColumnRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Erro ao carregar esquema.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchColumns();
    return () => { cancelled = true; };
  }, []);

  // Hooks must run before any conditional returns to keep a stable order
  const byTable = useMemo(() => {
    if (!rows || rows.length === 0) return {} as Record<string, ColumnRow[]>;
    return rows.reduce<Record<string, ColumnRow[]>>((acc, r) => {
      (acc[r.table_name] ||= []).push(r);
      return acc;
    }, {});
  }, [rows]);

  type TableStats = {
    rowCount?: number;
    codeInfo?: Array<{ code: string; sa?: string | null; min: string | null; max: string | null; count: number }>;
    globalMin?: string | null;
    globalMax?: string | null;
    pointDistinct?: number;
    loading?: boolean;
    error?: string | null;
  };

  const [stats, setStats] = useState<Record<string, TableStats>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const isDev = import.meta.env.DEV;
  function timeStart(label: string) { if (isDev) console.time(label); }
  function timeEnd(label: string) { if (isDev) console.timeEnd(label); }

  async function loadStats(table: string, columns: ColumnRow[]) {
    if (!supabase) return;
    // Avoid refetching while loading
    if (stats[table]?.loading) return;
    setStats((s) => ({ ...s, [table]: { ...s[table], loading: true, error: null } }));
    try {
      const hasData = columns.some((c) => c.column_name === 'data' || c.column_name === 'time');
      const codeField = table === 'caudal_tejo_loc' ? 'localizacao' : 'codigo';

      // total de linhas com head+count
      const { count, error: countErr } = await supabase.from(table).select('*', { head: true, count: 'estimated' });
      if (countErr) throw countErr;

      // obter todas as linhas com codigo+data e agregar por codigo
      let codeInfo: Array<{ code: string; sa?: string | null; min: string | null; max: string | null; count: number }> | undefined = undefined;
      if (table !== 'meteo') {
        const selectCols = table === 'caudal_tejo_loc' ? `${codeField}, data` : `${codeField}, data, sistema_aquifero`;
        const build = () => supabase.from(table).select(selectCols).not(codeField, 'is', null);
        const all = await fetchAll<any>(build);
        const map: Record<string, { sa?: string | null; min: string | null; max: string | null; count: number }> = {};
        const abbrSA = (raw?: string | null): string | null => {
          if (!raw) return null;
          const s = String(raw).toLowerCase();
          if (s.includes('aluv')) return 'AL';
          if (s.includes('margem direita') || s.includes(' direita') || s.includes(' dir')) return 'MD';
          if (s.includes('margem esquerda') || s.includes(' esquerda') || s.includes(' esq')) return 'ME';
          return raw;
        };
        all.forEach((r) => {
          const code = r[codeField] as string | null;
          const d = (r['data'] ?? r['time']) as string | null;
          if (!code) return;
          if (!map[code]) map[code] = { sa: abbrSA(r['sistema_aquifero'] as string | null), min: d, max: d, count: 0 };
          map[code].count += 1;
          if (d) {
            const t = Date.parse(d);
            const tmin = map[code].min ? Date.parse(map[code].min as string) : undefined;
            const tmax = map[code].max ? Date.parse(map[code].max as string) : undefined;
            if (!tmin || t < (tmin as number)) map[code].min = d;
            if (!tmax || t > (tmax as number)) map[code].max = d;
          }
        });
        codeInfo = Object.entries(map)
          .map(([code, info]) => ({ code, ...info }))
          .sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt'));
      } else {
        // estatísticas específicas meteo: global min/max (time) e pontos distintos (lat/long)
        timeStart(`[stats] meteo base`);
        const { data } = await supabase.from('meteo').select('time, lat, long');
        const arr = (data || []) as Array<{ time: string | null; lat: number | null; long: number | null }>;
        let gmin: string | null = null;
        let gmax: string | null = null;
        const pts = new Set<string>();
        arr.forEach((r) => {
          if (typeof r.lat === 'number' && typeof r.long === 'number') pts.add(`${r.lat},${r.long}`);
          const t = r.time ? Date.parse(r.time) : NaN;
          if (!isNaN(t)) {
            if (!gmin || t < Date.parse(gmin)) gmin = r.time as string;
            if (!gmax || t > Date.parse(gmax)) gmax = r.time as string;
          }
        });
        codeInfo = undefined; // não listado por código para meteo
        setStats((s) => ({
          ...s,
          [table]: {
            rowCount: typeof count === 'number' ? count : undefined,
            codeInfo: undefined,
            globalMin: gmin,
            globalMax: gmax,
            pointDistinct: pts.size,
            loading: false,
            error: null,
          },
        }));
        timeEnd(`[stats] meteo base`);
        return;
      }

      setStats((s) => ({
        ...s,
        [table]: {
          rowCount: typeof count === 'number' ? count : undefined,
          codeInfo,
          globalMin: undefined,
          globalMax: undefined,
          pointDistinct: undefined,
          loading: false,
          error: null,
        },
      }));
    } catch (e: any) {
      setStats((s) => ({ ...s, [table]: { ...s[table], loading: false, error: e?.message ?? 'Erro' } }));
    }
  }

  function handleSelect(tableKey: string) {
    if (selected === tableKey) {
      setSelected(null);
      return;
    }
    setSelected(tableKey);
    const cols = byTable[tableKey];
    if (cols) loadStats(tableKey, cols);
  }

  if (loading) {
    return <p className="muted">A carregar…</p>;
  }

  if (error) {
    return (
      <section className="page-blank">
        <h2 className="page-title">Dados</h2>
        <p className="muted">{error}</p>
        <details>
          <summary>Como criar a view pública table_columns</summary>
          <pre style={{whiteSpace:'pre-wrap'}}>{`
-- Execute no SQL editor do Supabase (ajuste o schema se necessário)
create or replace view public.table_columns as
select
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

-- Opcional: habilitar leitura anónima
-- Se usar RLS em views, crie política adequada
-- grant select on public.table_columns to anon, authenticated;
`}</pre>
        </details>
      </section>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <section className="page-blank">
        <h2 className="page-title">Dados</h2>
        <p className="muted">Sem colunas para mostrar. Confirma a view `table_columns`.</p>
      </section>
    );
  }

  return (
    <>
    <section className="page-blank">
      <h2 className="page-title">Dados</h2>

      <div
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'space-around',
          alignItems: 'flex-start',
          paddingBottom: 8,
        }}
      >
        {[
          { key: 'nitrato_tejo_loc_zvt', label: 'Nitrato', img: `${import.meta.env.BASE_URL || '/'}img/tables/nitrato_tab.png`, dl: 'https://drive.google.com/file/d/1EVTWLQ4q3jDanTof6-CvXaf72uQ-goYf/view?usp=sharing' },
          { key: 'condut_tejo_loc_zvt', label: 'Condutividade', img: `${import.meta.env.BASE_URL || '/'}img/tables/condut_tab.png`, dl: 'https://drive.google.com/file/d/1-pnaH5dMB7fAUCVxNFGAd1oxXTZVBZ9f/view?usp=sharing' },
          { key: 'piezo_tejo_loc_zvt', label: 'Piezo', img: `${import.meta.env.BASE_URL || '/'}img/tables/piezo_tab.png`, dl: 'https://drive.google.com/file/d/1AZDCfhkT6qPaBm8_weEeBQ5_EiCxjUI4/view?usp=sharing' },
          { key: 'caudal_tejo_loc', label: 'Caudal', img: `${import.meta.env.BASE_URL || '/'}img/tables/caudal_tab.png`, dl: 'https://drive.google.com/file/d/13BIhNb6W23NvX-H33xxZVb6lTWnAWa_Y/view?usp=sharing' },
          { key: 'meteo', label: 'Meteo', img: `${import.meta.env.BASE_URL || '/'}img/tables/meteo_tab.png`, dl: 'https://drive.google.com/file/d/1rRuf0FO6grKU4fD_KdN-5xIGfp--Cq_T/view?usp=sharing' },
        ].map((card) => (
          <button
            key={card.key}
            onClick={() => handleSelect(card.key)}
            style={{
              border:'1px solid var(--border)', background:'transparent', color:'inherit',
              borderRadius:10, padding:8, cursor:'pointer', display:'inline-block'
            }}
            className={selected === card.key ? 'nav-item active' : 'nav-item'}
          >
            <div style={{position:'relative'}}>
              <div style={{position:'relative', height:280, overflow:'hidden'}}>
              <img
                src={card.img}
                alt={card.label}
                style={{
                  width: 'auto',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block'
                }}
              />
              </div>
              <div style={{textAlign:'center'}}>{card.label}</div>

              <a
                href={card.dl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Transferir CSV"
                style={{
                  position:'absolute', right:6, bottom:6,
                  display:'inline-flex', alignItems:'center', justifyContent:'center',
                  width:26, height:26, borderRadius:6,
                  background:'rgba(2,6,23,0.35)', border:'1px solid var(--border)',
                  color:'inherit'
                }}
                onMouseEnter={(e)=>{ (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(226,232,240,0.25)'; (e.currentTarget as HTMLAnchorElement).style.border = '1px solid rgba(226,232,240,0.5)'; }}
                onMouseLeave={(e)=>{ (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(2,6,23,0.35)'; (e.currentTarget as HTMLAnchorElement).style.border = '1px solid var(--border)'; }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 3a1 1 0 0 1 1 1v9.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4.001 4.001a1 1 0 0 1-1.414 0l-4.001-4.001a1 1 0 1 1 1.414-1.414L11 13.586V4a1 1 0 0 1 1-1z"/>
                  <path d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/>
                </svg>
              </a>
            </div>
          </button>
        ))}
      </div>

      <div style={{display:'flex', justifyContent:'flex-end', marginTop:8}}>
        <button onClick={() => { cacheClear(); setSelected(null); }} style={{border:'1px solid var(--border)', background:'transparent', color:'inherit', borderRadius:8, padding:'6px 10px', cursor:'pointer'}}>Atualizar dados</button>
      </div>

      {selected && byTable[selected] && (
        <div style={{marginTop:16}}>
          <h3 style={{marginTop:0}}>{selected}</h3>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left', padding:'6px 8px'}}>Coluna</th>
                  <th style={{textAlign:'left', padding:'6px 8px'}}>Tipo</th>
                  <th style={{textAlign:'left', padding:'6px 8px'}}>Nullable</th>
                </tr>
              </thead>
              <tbody>
                {byTable[selected].map((c) => (
                  <tr key={c.column_name}>
                    <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{c.column_name}</td>
                    <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{c.data_type}</td>
                    <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{c.is_nullable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {stats[selected] && (
            <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid var(--border)'}}>
              {stats[selected].loading ? (
                <p className="muted">A calcular…</p>
              ) : stats[selected].error ? (
                <p className="muted">{stats[selected].error}</p>
              ) : (
                <div style={{display:'grid', gap:8}}>
                  {typeof stats[selected].rowCount === 'number' && (
                    <div><strong>Total de linhas:</strong> {stats[selected].rowCount}</div>
                  )}
                  {selected === 'meteo' && (
                    <>
                      <div><strong>Período (time):</strong> {stats[selected].globalMin ? formatDate(stats[selected].globalMin) : '—'} → {stats[selected].globalMax ? formatDate(stats[selected].globalMax) : '—'}</div>
                      <div><strong>Pontos distintos (lat,long):</strong> {stats[selected].pointDistinct ?? 0}</div>
                    </>
                  )}
                  {Array.isArray(stats[selected].codeInfo) && stats[selected].codeInfo.length > 0 && (
                    <div style={{marginTop:8}}>
                      <strong>Por ponto ({stats[selected].codeInfo.length}):</strong>
                      <div style={{maxHeight:240, overflow:'auto', marginTop:6, border:'1px solid var(--border)', borderRadius:8}}>
                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                          <thead>
                            <tr>
                              <th style={{textAlign:'left', padding:'6px 8px', borderBottom:'1px solid var(--border)'}}>Código</th>
                              <th style={{textAlign:'left', padding:'6px 8px', borderBottom:'1px solid var(--border)'}}>SA</th>
                              <th style={{textAlign:'left', padding:'6px 8px', borderBottom:'1px solid var(--border)'}}>Início</th>
                              <th style={{textAlign:'left', padding:'6px 8px', borderBottom:'1px solid var(--border)'}}>Final</th>
                              <th style={{textAlign:'left', padding:'6px 8px', borderBottom:'1px solid var(--border)'}}>
                                <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
                                  n
                                  <span style={{display:'inline-flex', gap:4}}>
                                    <button title="Ordenar crescente" onClick={() => setCodeSortDir('asc')} style={{border:'1px solid var(--border)', background:'transparent', cursor:'pointer', lineHeight:1, padding:'0 4px', borderRadius:4}}>▲</button>
                                    <button title="Ordenar decrescente" onClick={() => setCodeSortDir('desc')} style={{border:'1px solid var(--border)', background:'transparent', cursor:'pointer', lineHeight:1, padding:'0 4px', borderRadius:4}}>▼</button>
                                  </span>
                                </span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {([...stats[selected].codeInfo]
                              .sort((a,b) => codeSortDir === 'asc' ? a.count - b.count : b.count - a.count))
                              .map((ci) => (
                              <tr key={ci.code}>
                                <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{ci.code}</td>
                                <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{ci.sa ?? '—'}</td>
                                <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{ci.min ? formatDate(ci.min) : '—'}</td>
                                <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{ci.max ? formatDate(ci.max) : '—'}</td>
                                <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{ci.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>

    <section className="page-blank" style={{ marginTop: 24 }}>
      <h2 className="page-title">Mapa</h2>
      <MapSection />
    </section>
    </>
  );
}

function parseDate(ds: string): Date {
  if (/^\d{4}-\d{2}-\d{2}/.test(ds)) return new Date(ds);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(ds)) {
    const parts = ds.split('/');
    const dd = Number(parts[0] ?? 1);
    const mm = Number(parts[1] ?? 1);
    const yyyy = Number(parts[2] ?? 1970);
    return new Date(yyyy, mm - 1, dd);
  }
  const t = Date.parse(ds);
  return isNaN(t) ? new Date(0) : new Date(t);
}

function formatDate(ds: string): string {
  const d = parseDate(ds);
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-PT');
}

import { MapSection } from '../ui/MapSection';
