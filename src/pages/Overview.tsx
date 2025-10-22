import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { cacheRead, cacheWrite, cacheClear } from '../lib/cache';


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
    codeInfo?: Array<{ code: string; min: string | null; max: string | null; count: number }>;
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

// Map section with filters per table
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { utmToLatLng, VARIABLE_CFG, fetchDistinctSistemas, fetchVariableData, fetchAll } from '../lib/edaData';

type TableKey = 'nitrato_tejo_loc_zvt' | 'condut_tejo_loc_zvt' | 'piezo_tejo_loc_zvt' | 'caudal_tejo_loc';

type VariableKey = 'profundidade' | 'nitrato' | 'condutividade' | 'caudal' | 'meteo';

const VARIABLE_UI: Record<VariableKey, { label: string; color: string }> = {
  profundidade: { label: 'Profundidade', color: '#0ea5e9' },
  nitrato: { label: 'Nitrato', color: '#ef4444' },
  condutividade: { label: 'Condutividade', color: '#22c55e' },
  caudal: { label: 'Caudal', color: '#38bdf8' },
  meteo: { label: 'Meteo', color: '#f59e0b' },
};

// cacheRead/cacheWrite/cacheClear agora vêm de '../lib/cache'

function colorIcon(hex: string) {
  // Pequeno pin SVG com cor sólida
  const svg = encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' width='20' height='28' viewBox='0 0 20 28'>
      <defs>
        <filter id='shadow' x='-20%' y='-20%' width='140%' height='140%'>
          <feDropShadow dx='0' dy='2' stdDeviation='1.5' flood-color='rgba(0,0,0,0.35)'/>
        </filter>
      </defs>
      <path filter='url(#shadow)' fill='${hex}' d='M10 0c-4.4 0-8 3.5-8 8 0 5.5 8 18 8 18s8-12.5 8-18c0-4.5-3.6-8-8-8z'/>
      <circle cx='10' cy='8' r='3.3' fill='white'/>
    </svg>`);
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconSize: [20, 28],
    iconAnchor: [10, 28],
    popupAnchor: [0, -26],
  });
}

function friendlySistemaLabel(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s.includes('aluv')) return 'Aluviões';
  if (s.includes('margem direita') || s.includes('direita')) return 'Margem Direita';
  if (s.includes('margem esquerda') || s.includes('esquerda')) return 'Margem Esquerda';
  return raw;
}

function parseDate(ds: string): Date {
  // suporta 'YYYY-MM-DD' e 'DD/MM/YYYY'
  if (/^\d{4}-\d{2}-\d{2}/.test(ds)) return new Date(ds);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(ds)) {
    const [d, m, y] = ds.split('/').map((v) => parseInt(v, 10));
    return new Date(y, m - 1, d);
  }
  const t = Date.parse(ds);
  return isNaN(t) ? new Date(0) : new Date(t);
}

function formatDate(ds: string): string {
  const d = parseDate(ds);
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-PT');
}

type AnyRow = {
  id?: number | string;
  coord_x_m?: number | null;
  coord_y_m?: number | null;
  codigo?: string | null;
  localizacao?: string | null;
  data?: string | null;
  sistema_aquifero?: string | null;
  lat?: number | null;
  long?: number | null;
};

function MapSection() {
  const [selectedVariable, setSelectedVariable] = useState<VariableKey>('profundidade');
  const [selectedSistema, setSelectedSistema] = useState<string>('todos');
  const [selectedCodigo, setSelectedCodigo] = useState<string>('');
  const [sistemaOptions, setSistemaOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [statsByCode, setStatsByCode] = useState<Record<string, { min?: string | null; max?: string | null; count: number }>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const [showZVT, setShowZVT] = useState<boolean>(false);
  const [zvtData, setZvtData] = useState<any>(null);
  const [showMD, setShowMD] = useState<boolean>(false);
  const [showME, setShowME] = useState<boolean>(false);
  const [showAL, setShowAL] = useState<boolean>(false);
  const [mdData, setMdData] = useState<any>(null);
  const [meData, setMeData] = useState<any>(null);
  const [alData, setAlData] = useState<any>(null);

  const uniqueCodes = useMemo(() => {
    const field = selectedVariable === 'meteo' ? 'codigo' : VARIABLE_CFG[selectedVariable].codeField;
    const set = new Set<string>();
    rows.forEach((r) => {
      const code = selectedVariable==='meteo' ? r.codigo : (field === 'localizacao' ? r.localizacao : r.codigo);
      if (code) set.add(String(code));
    });
    return Array.from(set).sort((a,b) => a.localeCompare(b, 'pt'));
  }, [rows, selectedVariable]);

  useEffect(() => {
    let cancel = false;
    async function run() {
      setLoading(true);
      setErr(null);
      try {
        if (selectedVariable === 'meteo') {
          const cacheKey = 'meteo_points_v1';
          const cached = cacheRead<AnyRow[]>(cacheKey, 24 * 60 * 60 * 1000);
          if (cached && Array.isArray(cached) && cached.length > 0) {
            setRows(cached);
          } else {
            const arr = await fetchAll<any>(() => supabase
              .from('temp_eobs_2014_24')
              .select('lat,long,"Time"')
              .not('lat','is',null)
              .not('long','is',null));
            const mapPts = new Map<string, AnyRow>();
            arr.forEach((r) => {
              const latNum = typeof r.lat === 'number' ? r.lat : Number(r.lat);
              const lonNum = typeof r.long === 'number' ? r.long : Number(r.long);
              if (!isFinite(latNum) || !isFinite(lonNum)) return;
              const key = `${latNum},${lonNum}`;
              if (!mapPts.has(key)) mapPts.set(key, { codigo: key, lat: latNum, long: lonNum, data: r.Time });
            });
            const arrPts = Array.from(mapPts.values());
            setRows(arrPts);
            cacheWrite(cacheKey, arrPts);
          }
          setSistemaOptions([]);
          setStatsByCode({});
        } else {
          const cfg = VARIABLE_CFG[selectedVariable];
          const cacheKey = `var_points_v1:${selectedVariable}:${selectedSistema}`;
          const cached = cacheRead<{ rows: AnyRow[]; stats: Record<string, { min?: string | null; max?: string | null; count: number }> }>(cacheKey, 24*60*60*1000);
          if (cached && Array.isArray(cached.rows)) {
            setRows(cached.rows);
            setStatsByCode(cached.stats || {});
          } else {
            const { data } = await fetchVariableData(selectedVariable, selectedSistema);
            if (cancel) return;
            const codeField = cfg.codeField;
            const byCode = new Map<string, AnyRow>();
            const stats: Record<string, { min?: string | null; max?: string | null; count: number }> = {};
            (data as AnyRow[]).forEach((r) => {
              const code = (codeField === 'localizacao' ? r.localizacao : r.codigo) as string | undefined;
              if (!code) return;
              if (typeof r.coord_x_m !== 'number' || typeof r.coord_y_m !== 'number') return;
              if (!byCode.has(code)) byCode.set(code, r);
              const ds = (r.data ?? undefined) as string | undefined;
              if (!stats[code]) stats[code] = { min: ds ?? null, max: ds ?? null, count: 0 };
              stats[code].count += 1;
              if (ds) {
                const a = parseDate(ds);
                const minA = stats[code].min ? parseDate(stats[code].min) : undefined;
                const maxA = stats[code].max ? parseDate(stats[code].max) : undefined;
                if (!minA || a < minA) stats[code].min = ds;
                if (!maxA || a > maxA) stats[code].max = ds;
              }
            });
            const arrByCode = Array.from(byCode.values());
            setRows(arrByCode);
            setStatsByCode(stats);
            cacheWrite(cacheKey, { rows: arrByCode, stats });
          }

          if (cfg.codeField === 'localizacao') {
            setSistemaOptions([]);
          } else {
            const sysKey = `sistemas_v1:${selectedVariable}`;
            const cachedSys = cacheRead<string[]>(sysKey, 7*24*60*60*1000);
            if (cachedSys && Array.isArray(cachedSys) && cachedSys.length>0) {
              setSistemaOptions(cachedSys);
            } else {
              const distinct = await fetchDistinctSistemas(selectedVariable);
              const vals = Array.from(new Set((distinct || []).map((v) => String(v).trim()))).sort((a,b)=>a.localeCompare(b,'pt'));
              setSistemaOptions(vals);
              cacheWrite(sysKey, vals);
            }
          }
        }
      } catch (e: any) {
        if (!cancel) setErr(e?.message ?? 'Erro ao carregar pontos');
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    run();
    return () => { cancel = true; };
  }, [selectedVariable, selectedSistema]);

  useEffect(() => {
    let cancel = false;
    const base = (import.meta.env.BASE_URL || '/');
    const urlFor = (name: string) => `${base}data/${name}`;
    const rawFor = (name: string) => `https://raw.githubusercontent.com/clepsydraisa/eda/refs/heads/main/public/data/${name}`;
    const fetchWithFallback = async (name: string) => {
      try {
        const res = await fetch(urlFor(name));
        if (res.ok) return res.json();
      } catch {}
      try {
        const res2 = await fetch(rawFor(name));
        if (res2.ok) return res2.json();
      } catch {}
      return null;
    };

    (async () => {
      if (showZVT && !zvtData) {
        const gj = await fetchWithFallback('zona_vulneravel.geojson');
        if (!cancel && gj) setZvtData(gj);
      }
      if (showMD && !mdData) {
        const gj = await fetchWithFallback('margem_direita.geojson');
        if (!cancel && gj) setMdData(gj);
      }
      if (showME && !meData) {
        const gj = await fetchWithFallback('margem_esquerda.geojson');
        if (!cancel && gj) setMeData(gj);
      }
      if (showAL && !alData) {
        const gj = await fetchWithFallback('aluviao.geojson');
        if (!cancel && gj) setAlData(gj);
      }
    })();
    return () => { cancel = true; };
  }, [showZVT, zvtData, showMD, mdData, showME, meData, showAL, alData]);

  const centerLisboa: [number, number] = [38.7223, -9.1393];

  return (
    <div>
      <div style={{display:'flex', gap:12, flexWrap:'wrap', marginBottom:10, alignItems:'center'}}>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span>Variável:</span>
          <select value={selectedVariable} onChange={(e) => { setSelectedVariable(e.target.value as VariableKey); setSelectedCodigo(''); }}>
            {(['profundidade','nitrato','condutividade','caudal','meteo'] as VariableKey[]).map((k) => (
              <option key={k} value={k}>{VARIABLE_UI[k].label}</option>
            ))}
          </select>
        </label>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span>Sistema Aquífero:</span>
          <select value={selectedSistema} onChange={(e) => { setSelectedSistema(e.target.value); setSelectedCodigo(''); }} disabled={selectedVariable==='meteo' || VARIABLE_CFG[selectedVariable].codeField==='localizacao'}>
            <option value="todos">Todos</option>
            {sistemaOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </label>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span>Pontos ({uniqueCodes.length}):</span>
          <select
            value={selectedCodigo}
            onChange={(e) => {
            const code = e.target.value; setSelectedCodigo(code);
            if (!code || !map) return;
            const cfg = VARIABLE_CFG[selectedVariable as Exclude<VariableKey,'meteo'>] as any;
            const row = rows.find((r) => {
              const codeVal = selectedVariable==='meteo' ? r.codigo : (cfg.codeField === 'localizacao' ? r.localizacao : r.codigo);
              if (!codeVal) return false;
              // Dependência direta do sistema aquífero
              if (selectedVariable!=='meteo' && selectedSistema !== 'todos' && r.sistema_aquifero && VARIABLE_CFG[selectedVariable].codeField !== 'localizacao') {
                return codeVal === code && r.sistema_aquifero === selectedSistema;
              }
              return codeVal === code;
            });
            if (!row) return;
            const latlng = selectedVariable==='meteo'
              ? ((typeof row.lat === 'number' && typeof row.long === 'number') ? [row.lat, row.long] : null)
              : utmToLatLng(row.coord_x_m as number, row.coord_y_m as number);
            if (latlng) map.setView(latlng, 14);
          }}>
            <option value="">Todos</option>
            {uniqueCodes
              .filter((code) => {
                if (selectedVariable==='meteo' || VARIABLE_CFG[selectedVariable].codeField === 'localizacao') return true;
                if (selectedSistema === 'todos') return true;
                // incluir apenas códigos que existam no sistema selecionado
                return rows.some((r) => r.codigo === code && r.sistema_aquifero === selectedSistema);
              })
              .map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </label>
        {/* camadas movidas para caixa dentro do mapa */}
        {loading && <span className="muted">A carregar…</span>}
        {err && <span className="muted">{err}</span>}
      </div>

      <div style={{position:'relative'}}>
        <MapContainer center={centerLisboa} zoom={9} whenCreated={(m) => setMap(m)} style={{height:420, width:'100%', borderRadius:12, overflow:'hidden'}}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          {rows
            .filter((r) => {
              if (selectedVariable==='meteo' || VARIABLE_CFG[selectedVariable].codeField === 'localizacao') return true;
              if (selectedSistema === 'todos') return true;
              return (r.sistema_aquifero === selectedSistema);
            })
            .map((r, idx) => {
            const latlng = selectedVariable==='meteo'
              ? ((typeof r.lat === 'number' && typeof r.long === 'number') ? [r.lat, r.long] : null)
              : utmToLatLng(r.coord_x_m as number, r.coord_y_m as number);
            if (!latlng) return null;
            const cfg = VARIABLE_CFG[selectedVariable as Exclude<VariableKey,'meteo'>] as any;
            const ui = VARIABLE_UI[selectedVariable];
            const code = selectedVariable==='meteo' ? r.codigo : (cfg.codeField === 'localizacao' ? r.localizacao : r.codigo);
            if (selectedCodigo && String(code) !== selectedCodigo) return null;
            const st = statsByCode[String(code)];
            return (
              <Marker key={`row-${idx}`} position={latlng as any} icon={colorIcon(ui.color)}>
                <Popup>
                  <div style={{display:'grid', gap:4, position:'relative', paddingBottom:22}}>
                    <div><strong>{ui.label}</strong></div>
                    {selectedVariable==='meteo' ? (
                      <div>ponto: {String(code)}</div>
                    ) : (
                      code && <div>codigo: {code}</div>
                    )}
                    {st && (
                      <>
                        <div>data início: {st.min ? formatDate(st.min) : '—'}</div>
                        <div>data final: {st.max ? formatDate(st.max) : '—'}</div>
                        <div>amostras: {st.count}</div>
                      </>
                    )}
                    <button
                      title="Visualizar"
                      style={{
                        position:'absolute', right:6, bottom:4,
                        display:'inline-flex', alignItems:'center', justifyContent:'center',
                        width:26, height:26, borderRadius:6,
                        background:'rgba(0,0,0,0.05)', border:'1px solid rgba(0,0,0,0.15)',
                        color:'inherit', cursor:'pointer'
                      }}
                      onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 5c-5.523 0-9.5 7-9.5 7s3.977 7 9.5 7 9.5-7 9.5-7-3.977-7-9.5-7zm0 11.2a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4zm0-2.7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>
                      </svg>
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {showZVT && zvtData && (
            <GeoJSON data={zvtData as any} style={() => ({ color: '#ef4444', weight: 1, fillColor: '#ef4444', fillOpacity: 0.12 })} />
          )}
          {showMD && mdData && (
            <GeoJSON data={mdData as any} style={() => ({ color: '#1d4ed8', weight: 1.2, fillColor: '#1d4ed8', fillOpacity: 0.75 })} />
          )}
          {showME && meData && (
            <GeoJSON data={meData as any} style={() => ({ color: '#059669', weight: 1.2, fillColor: '#059669', fillOpacity: 0.75 })} />
          )}
          {showAL && alData && (
            <GeoJSON data={alData as any} style={() => ({ color: '#a16207', weight: 1.2, fillColor: '#a16207', fillOpacity: 0.75 })} />
          )}
        </MapContainer>
        <div style={{position:'absolute', top:10, right:10, background:'rgba(15,23,42,0.9)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', color:'var(--text)', fontSize:12, display:'grid', gap:6, zIndex:1000, pointerEvents:'auto'}}>
          <div style={{opacity:0.9, marginBottom:2}}>Camadas</div>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <input type="checkbox" checked={showZVT} onChange={(e)=>setShowZVT(e.target.checked)} /> ZVT
          </label>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <input type="checkbox" checked={showMD} onChange={(e)=>setShowMD(e.target.checked)} /> MD
          </label>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <input type="checkbox" checked={showME} onChange={(e)=>setShowME(e.target.checked)} /> ME
          </label>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <input type="checkbox" checked={showAL} onChange={(e)=>setShowAL(e.target.checked)} /> AL
          </label>
        </div>
      </div>
    </div>
  );
}


