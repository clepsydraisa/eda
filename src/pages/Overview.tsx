import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

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
    codigoDistinct?: Array<string | number>;
    dataMin?: string | null;
    dataMax?: string | null;
    loading?: boolean;
    error?: string | null;
  };

  const [stats, setStats] = useState<Record<string, TableStats>>({});
  const [selected, setSelected] = useState<string | null>(null);

  async function loadStats(table: string, columns: ColumnRow[]) {
    if (!supabase) return;
    // Avoid refetching while loading
    if (stats[table]?.loading) return;
    setStats((s) => ({ ...s, [table]: { ...s[table], loading: true, error: null } }));
    try {
      const hasCodigo = columns.some((c) => c.column_name === 'codigo');
      const hasData = columns.some((c) => c.column_name === 'data');

      const [{ count, error: countErr }, codigoRes, dataMinRes, dataMaxRes] = await Promise.all([
        supabase.from(table).select('*', { head: true, count: 'exact' }),
        hasCodigo
          ? supabase
              .from(table)
              .select('codigo')
              .not('codigo', 'is', null)
              .order('codigo', { ascending: true })
              .limit(1000)
          : Promise.resolve({ data: null, error: null } as any),
        hasData
          ? supabase.from(table).select('data').order('data', { ascending: true }).limit(1)
          : Promise.resolve({ data: null, error: null } as any),
        hasData
          ? supabase.from(table).select('data').order('data', { ascending: false }).limit(1)
          : Promise.resolve({ data: null, error: null } as any),
      ]);

      if (countErr) throw countErr;

      const distinctCodigo = Array.isArray(codigoRes?.data)
        ? Array.from(new Set(
            (codigoRes.data as Array<{ codigo: string | number | null }> )
              .map((d) => d.codigo)
              .filter((v): v is string | number => v !== null)
          )).slice(0, 50)
        : undefined;

      const dataMin = Array.isArray(dataMinRes?.data) && dataMinRes.data.length > 0
        ? (dataMinRes.data[0] as any).data ?? null
        : null;
      const dataMax = Array.isArray(dataMaxRes?.data) && dataMaxRes.data.length > 0
        ? (dataMaxRes.data[0] as any).data ?? null
        : null;

      setStats((s) => ({
        ...s,
        [table]: {
          rowCount: typeof count === 'number' ? count : undefined,
          codigoDistinct: distinctCodigo,
          dataMin,
          dataMax,
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
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, max-content))',
          justifyContent: 'center',
          justifyItems: 'center',
          paddingBottom: 8,
        }}
      >
        {[
          { key: 'nitrato_tejo_loc_zvt', label: 'Nitrato', img: `${import.meta.env.BASE_URL || '/'}img/tables/nitrato_tab.png`, dl: 'https://drive.google.com/file/d/1EVTWLQ4q3jDanTof6-CvXaf72uQ-goYf/view?usp=sharing' },
          { key: 'condut_tejo_loc_zvt', label: 'Condutividade', img: `${import.meta.env.BASE_URL || '/'}img/tables/condut_tab.png`, dl: 'https://drive.google.com/file/d/1-pnaH5dMB7fAUCVxNFGAd1oxXTZVBZ9f/view?usp=sharing' },
          { key: 'piezo_tejo_loc_zvt', label: 'Piezo', img: `${import.meta.env.BASE_URL || '/'}img/tables/piezo_tab.png`, dl: 'https://drive.google.com/file/d/1AZDCfhkT6qPaBm8_weEeBQ5_EiCxjUI4/view?usp=sharing' },
          { key: 'caudal_tejo_loc', label: 'Caudal', img: `${import.meta.env.BASE_URL || '/'}img/tables/caudal_tab.png`, dl: 'https://drive.google.com/file/d/13BIhNb6W23NvX-H33xxZVb6lTWnAWa_Y/view?usp=sharing' },
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
            <div style={{display:'grid', gap:6, position:'relative', paddingBottom:24}}>
              <img
                src={card.img}
                alt={card.label}
                style={{
                  width: 'auto',
                  height: 'auto',
                  maxWidth: 360,   // limite para manter a linha horizontal
                  maxHeight: 240,  // limite razoável para alturas grandes
                  objectFit: 'contain',
                  borderRadius: 6,
                  display: 'block'
                }}
              />
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
                  {(stats[selected].dataMin || stats[selected].dataMax) && (
                    <div>
                      <strong>Período (data):</strong> {stats[selected].dataMin ?? '—'} → {stats[selected].dataMax ?? '—'}
                    </div>
                  )}
                  {Array.isArray(stats[selected].codigoDistinct) && (
                    <div>
                      <strong>Distinct de codigo</strong> (primeiros {stats[selected].codigoDistinct.length}):
                      <div style={{display:'flex', flexWrap:'wrap', gap:6, marginTop:6}}>
                        {stats[selected].codigoDistinct.map((v) => (
                          <span key={String(v)} style={{border:'1px solid var(--border)', borderRadius:8, padding:'2px 8px'}}>{String(v)}</span>
                        ))}
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
import { utmToLatLng, VARIABLE_CFG, type VariableKey, fetchDistinctSistemas, fetchVariableData } from '../lib/edaData';

type TableKey = 'nitrato_tejo_loc_zvt' | 'condut_tejo_loc_zvt' | 'piezo_tejo_loc_zvt' | 'caudal_tejo_loc';

const VARIABLE_UI: Record<VariableKey, { label: string; color: string }> = {
  profundidade: { label: 'Profundidade', color: '#0ea5e9' },
  nitrato: { label: 'Nitrato', color: '#ef4444' },
  condutividade: { label: 'Condutividade', color: '#22c55e' },
  caudal: { label: 'Caudal', color: '#38bdf8' },
};

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
    const field = VARIABLE_CFG[selectedVariable].codeField;
    const set = new Set<string>();
    rows.forEach((r) => {
      const code = field === 'localizacao' ? r.localizacao : r.codigo;
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
        const cfg = VARIABLE_CFG[selectedVariable];
        // Buscar todos os registos (sem limite) e agregar por código
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
          // stats
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
        setRows(Array.from(byCode.values()));
        setStatsByCode(stats);

        // carregar opções de sistema aquífero
        if (cfg.codeField === 'localizacao') {
          setSistemaOptions([]);
        } else {
          const distinct = await fetchDistinctSistemas(selectedVariable);
          const vals = Array.from(new Set((distinct || []).map((v) => String(v).trim()))).sort((a,b)=>a.localeCompare(b,'pt'));
          if (selectedVariable === 'profundidade') {
            // eslint-disable-next-line no-console
            console.log('[Profundidade] DISTINCT sistema_aquifero (raw):', vals);
          }
          setSistemaOptions(vals);
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
    if (showZVT && !zvtData) {
      fetch('/data/zona_vulneravel.geojson')
        .then((r) => r.json())
        .then((gj) => { if (!cancel) setZvtData(gj); })
        .catch(() => {});
    }
    if (showMD && !mdData) {
      fetch('/data/margem_direita.geojson')
        .then((r) => r.json())
        .then((gj) => { if (!cancel) setMdData(gj); })
        .catch(() => {});
    }
    if (showME && !meData) {
      fetch('/data/margem_esquerda.geojson')
        .then((r) => r.json())
        .then((gj) => { if (!cancel) setMeData(gj); })
        .catch(() => {});
    }
    if (showAL && !alData) {
      fetch('/data/aluviao.geojson')
        .then((r) => r.json())
        .then((gj) => { if (!cancel) setAlData(gj); })
        .catch(() => {});
    }
    return () => { cancel = true; };
  }, [showZVT, zvtData, showMD, mdData, showME, meData, showAL, alData]);

  const centerLisboa: [number, number] = [38.7223, -9.1393];

  return (
    <div>
      <div style={{display:'flex', gap:12, flexWrap:'wrap', marginBottom:10, alignItems:'center'}}>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span>Variável:</span>
          <select value={selectedVariable} onChange={(e) => { setSelectedVariable(e.target.value as VariableKey); setSelectedCodigo(''); }}>
            {(['profundidade','nitrato','condutividade','caudal'] as VariableKey[]).map((k) => (
              <option key={k} value={k}>{VARIABLE_UI[k].label}</option>
            ))}
          </select>
        </label>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span>Sistema Aquífero:</span>
          <select value={selectedSistema} onChange={(e) => { setSelectedSistema(e.target.value); setSelectedCodigo(''); }} disabled={VARIABLE_CFG[selectedVariable].codeField==='localizacao'}>
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
            const cfg = VARIABLE_CFG[selectedVariable];
            const row = rows.find((r) => {
              const codeVal = cfg.codeField === 'localizacao' ? r.localizacao : r.codigo;
              if (!codeVal) return false;
              // Dependência direta do sistema aquífero
              if (selectedSistema !== 'todos' && r.sistema_aquifero && VARIABLE_CFG[selectedVariable].codeField !== 'localizacao') {
                return codeVal === code && r.sistema_aquifero === selectedSistema;
              }
              return codeVal === code;
            });
            if (!row) return;
            const latlng = utmToLatLng(row.coord_x_m as number, row.coord_y_m as number);
            if (latlng) map.setView(latlng, 14);
          }}>
            <option value="">Todos</option>
            {uniqueCodes
              .filter((code) => {
                if (VARIABLE_CFG[selectedVariable].codeField === 'localizacao') return true;
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
              if (VARIABLE_CFG[selectedVariable].codeField === 'localizacao') return true;
              if (selectedSistema === 'todos') return true;
              return (r.sistema_aquifero === selectedSistema);
            })
            .map((r, idx) => {
            const latlng = utmToLatLng(r.coord_x_m as number, r.coord_y_m as number);
            if (!latlng) return null;
            const cfg = VARIABLE_CFG[selectedVariable];
            const ui = VARIABLE_UI[selectedVariable];
            const code = cfg.codeField === 'localizacao' ? r.localizacao : r.codigo;
            if (selectedCodigo && String(code) !== selectedCodigo) return null;
            const st = statsByCode[String(code)];
            return (
              <Marker key={`row-${idx}`} position={latlng} icon={colorIcon(ui.color)}>
                <Popup>
                  <div style={{display:'grid', gap:4}}>
                    <div><strong>{ui.label}</strong></div>
                    {code && <div>codigo: {code}</div>}
                    {st && (
                      <>
                        <div>data início: {st.min ? formatDate(st.min) : '—'}</div>
                        <div>data final: {st.max ? formatDate(st.max) : '—'}</div>
                        <div>amostras: {st.count}</div>
                      </>
                    )}
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


