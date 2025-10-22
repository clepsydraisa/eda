import { useEffect, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { utmToLatLng, VARIABLE_CFG, fetchDistinctSistemas, fetchVariableData, fetchAll, fetchHistory } from '../lib/edaData';
import { cacheRead, cacheWrite } from '../lib/cache';
import { supabase } from '../lib/supabaseClient';

type VariableKey = 'profundidade' | 'nitrato' | 'condutividade' | 'caudal' | 'meteo';

const VARIABLE_UI: Record<VariableKey, { label: string; color: string }> = {
  profundidade: { label: 'Profundidade', color: '#0ea5e9' },
  nitrato: { label: 'Nitrato', color: '#ef4444' },
  condutividade: { label: 'Condutividade', color: '#22c55e' },
  caudal: { label: 'Caudal', color: '#38bdf8' },
  meteo: { label: 'Meteo', color: '#f59e0b' },
};

function colorIcon(hex: string) {
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

function parseDate(ds: string): Date {
  if (/^\d{4}-\d{2}-\d{2}/.test(ds)) return new Date(ds);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(ds)) {
    const parts = ds.split('/').map((v) => parseInt(v, 10));
    const [dd, mm, yyyy] = parts as [number, number, number];
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

export function MapSection() {
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

  // modal de gráfico
  const [chartOpen, setChartOpen] = useState(false);
  const [chartTitle, setChartTitle] = useState<string>('');
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartPoints, setChartPoints] = useState<Array<{ t: number; v: number }>>([]);
  const [chartYLabel, setChartYLabel] = useState<string>('');
  const [chartSeriesLabel, setChartSeriesLabel] = useState<string>('');
  const [showPoints, setShowPoints] = useState<boolean>(false);

  async function openChartFor(code: string) {
    try {
      setChartOpen(true);
      setChartLoading(true);
      setChartError(null);
      setChartPoints([]);
      setChartTitle(`Poço ${code}`);
      const hist = await fetchHistory(selectedVariable as any, code, selectedSistema);
      if (!hist || hist.length === 0) { setChartPoints([]); return; }
      // detectar coluna de valor por variável
      let valKey: string | undefined;
      const sample = hist[0] as any;
      const keys = Object.keys(sample);
      const findKey = (cands: string[]) => {
        for (const c of cands) {
          const k = keys.find((kk) => kk.toLowerCase() === c.toLowerCase());
          if (k) return k;
        }
        return undefined;
      };
      if (selectedVariable === 'nitrato') {
        valKey = findKey(['nitrato']);
        setChartYLabel('Nitrato (mg/L)');
        setChartSeriesLabel('Nitrato (mg/L)');
      } else if (selectedVariable === 'condutividade') {
        valKey = findKey(['condutividade','condcamp20c']);
        setChartYLabel('Condutividade (µS/cm)');
        setChartSeriesLabel('Condutividade (µS/cm)');
      } else if (selectedVariable === 'profundidade') {
        valKey = findKey(['profundidade_nivel_m','profundidade_nivel','nivel_piezometrico']);
        setChartYLabel('Profundidade Nível Água (m)');
        setChartSeriesLabel('Profundidade Nível Água (m)');
      } else if (selectedVariable === 'caudal') {
        valKey = findKey(['caudal','caudal_médio_diário','caudal_medio_diario','caudal_medio']);
        setChartYLabel('Caudal (m³/s)');
        setChartSeriesLabel('Caudal (m³/s)');
      }
      if (!valKey) {
        // fallback: primeira coluna numérica que não seja meta
        const avoid = new Set(['id','coord_x_m','coord_y_m','codigo','localizacao','data','created_at','sistema_aquifero']);
        for (const k of keys) {
          if (avoid.has(k)) continue;
          const v = (sample as any)[k];
          if (typeof v === 'number') { valKey = k; break; }
        }
      }
      const pts = (hist as any[])
        .map((r) => ({ t: parseDate(String(r.data)).getTime(), v: Number(r[valKey as string]) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a,b)=>a.t-b.t);
      setChartPoints(pts);
    } catch (e: any) {
      setChartError(e?.message ?? 'Erro ao carregar série');
    } finally {
      setChartLoading(false);
    }
  }

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
              if (selectedVariable!=='meteo' && selectedSistema !== 'todos' && r.sistema_aquifero && VARIABLE_CFG[selectedVariable].codeField !== 'localizacao') {
                return codeVal === code && r.sistema_aquifero === selectedSistema;
              }
              return codeVal === code;
            });
            if (!row) return;
            const latlng = selectedVariable==='meteo'
              ? ((typeof row.lat === 'number' && typeof row.long === 'number') ? [row.lat, row.long] : null)
              : utmToLatLng(row.coord_x_m as number, row.coord_y_m as number);
            if (latlng) map.setView(latlng as any, 14);
          }}>
            <option value="">Todos</option>
            {uniqueCodes
              .filter((code) => {
                if (selectedVariable==='meteo' || VARIABLE_CFG[selectedVariable].codeField === 'localizacao') return true;
                if (selectedSistema === 'todos') return true;
                return rows.some((r) => r.codigo === code && r.sistema_aquifero === selectedSistema);
              })
              .map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </label>
        {loading && <span className="muted">A carregar…</span>}
        {err && <span className="muted">{err}</span>}
      </div>

      <div style={{position:'relative'}}>
        <MapContainer center={centerLisboa} zoom={9} ref={(m) => { if (m) setMap(m); }} style={{height:420, width:'100%', borderRadius:12, overflow:'hidden'}}>
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
                    {code && selectedVariable!=='meteo' && (
                      <button
                        title="Visualizar"
                        style={{
                          position:'absolute', right:6, bottom:4,
                          display:'inline-flex', alignItems:'center', justifyContent:'center',
                          width:26, height:26, borderRadius:6,
                          background:'rgba(0,0,0,0.05)', border:'1px solid rgba(0,0,0,0.15)',
                          color:'inherit', cursor:'pointer'
                        }}
                        onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); openChartFor(String(code)); }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M12 5c-5.523 0-9.5 7-9.5 7s3.977 7 9.5 7 9.5-7 9.5-7-3.977-7-9.5-7zm0 11.2a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4zm0-2.7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>
                        </svg>
                      </button>
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
      {chartOpen && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'grid', placeItems:'center', zIndex:2000}} onClick={()=>setChartOpen(false)}>
          <div style={{width:'min(980px, 95vw)', background:'#ffffff', color:'#0f172a', border:'1px solid #cbd5e1', borderRadius:10, padding:12}} onClick={(e)=>e.stopPropagation()}>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:8}}>
              <strong style={{fontSize:20}}>{chartTitle}</strong>
              <div style={{display:'inline-flex', alignItems:'center', gap:8}}>
                <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                  <input type="checkbox" checked={showPoints} onChange={(e)=>setShowPoints(e.target.checked)} />
                  <span>Mostrar pontos</span>
                </label>
                <button onClick={()=>setChartOpen(false)} style={{border:'1px solid var(--border)', background:'transparent', color:'inherit', borderRadius:6, padding:'2px 8px', cursor:'pointer'}}>Fechar</button>
              </div>
            </div>
            {chartLoading ? (
              <div className="muted">A carregar…</div>
            ) : chartError ? (
              <div className="muted">{chartError}</div>
            ) : chartPoints.length === 0 ? (
              <div className="muted">Sem dados para mostrar.</div>
            ) : (
              <TimeSeriesChart points={chartPoints} height={360} yLabel={chartYLabel} seriesLabel={chartSeriesLabel} showPoints={showPoints} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}


type ChartProps = { points: Array<{ t: number; v: number }>; height?: number; yLabel?: string; seriesLabel?: string; showPoints?: boolean };
function TimeSeriesChart({ points, height = 220, yLabel = '', seriesLabel = '', showPoints = false }: ChartProps) {
  const width = 920;
  const pad = 44;
  const xs = points.map(p=>p.t);
  const ys = points.map(p=>p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const xScale = (t: number) => pad + ((t - minX) / (maxX - minX || 1)) * (width - pad*2);
  const yScale = (v: number) => height - pad - ((v - minY) / (maxY - minY || 1)) * (height - pad*2);
  let d = '';
  points.forEach((p, i) => {
    const x = xScale(p.t); const y = yScale(p.v);
    d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
  });
  // grid ticks (years on X, 4 horizontal lines on Y)
  const minYear = new Date(minX).getFullYear();
  const maxYear = new Date(maxX).getFullYear();
  const startYear = Math.ceil(minYear / 5) * 5; // primeiro múltiplo de 5 >= minYear
  const endYear = Math.floor(maxYear / 5) * 5;  // último múltiplo de 5 <= maxYear
  const xTicks: number[] = [];
  for (let y = startYear; y <= endYear; y += 5) {
    xTicks.push(new Date(y, 0, 1).getTime());
  }
  const yTicks = 4;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{background:'#ffffff'}}>
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.35"/>
          <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.05"/>
        </linearGradient>
      </defs>
      {/* fundo do gráfico (área de plot) branco */}
      <rect x={pad} y={pad} width={width-pad*2} height={height-pad*2} fill="#ffffff" rx={4} />
      {/* grid */}
      {Array.from({length: yTicks+1}).map((_, i) => {
        const y = pad + ((height - pad*2) * (i / yTicks));
        return <line key={`h${i}`} x1={pad} y1={y} x2={width-pad} y2={y} stroke="#eef2f7" />;
      })}
      {xTicks.map((t, i) => (
        <line key={`v${i}`} x1={xScale(Math.max(minX, Math.min(maxX, t)))} y1={pad} x2={xScale(Math.max(minX, Math.min(maxX, t)))} y2={height-pad} stroke="#eef2f7" />
      ))}

      <path d={`${d} L ${xScale(maxX)} ${yScale(minY)} L ${xScale(minX)} ${yScale(minY)} Z`} fill="url(#areaFill)" stroke="none" />
      <path d={d} fill="none" stroke="#1d4ed8" strokeWidth={2} />
      {/* pontos marcados (opcional) */}
      {showPoints && (
        <g>
          {points.map((p, i) => (
            <circle key={i} cx={xScale(p.t)} cy={yScale(p.v)} r={3} fill="#1d4ed8" stroke="#ffffff" strokeWidth={1.5} />
          ))}
        </g>
      )}
      <line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} stroke="#cbd5e1" />
      <line x1={pad} y1={pad} x2={pad} y2={height-pad} stroke="#cbd5e1" />
      {false && <text x={pad} y={pad-10} fill="#0f172a" fontSize={12}>{yLabel}</text>}
      {/* anos no eixo X */}
      {xTicks.map((t, i) => (
        <text key={`tx${i}`} x={xScale(Math.max(minX, Math.min(maxX, t)))} y={height-8} fill="#0f172a" fontSize={12} textAnchor="middle">{new Date(t).getFullYear()}</text>
      ))}
      {/* rótulos extremos dos eixos */}
      <text x={pad} y={height-8} fill="#0f172a" fontSize={12} textAnchor="start">{new Date(minX).toLocaleDateString('pt-PT')}</text>
      <text x={width-pad} y={height-8} fill="#0f172a" fontSize={12} textAnchor="end">{new Date(maxX).toLocaleDateString('pt-PT')}</text>
      <text x={pad-8} y={pad+4} fill="var(--text, #e2e8f0)" fontSize={12} textAnchor="end">{maxY.toFixed(2)}</text>
      <text x={pad-8} y={height-pad} fill="var(--text, #e2e8f0)" fontSize={12} textAnchor="end">{minY.toFixed(2)}</text>
      <HoverOverlay width={width} height={height} pad={pad} xScale={xScale} yScale={yScale} points={points} />
      {seriesLabel && (
        <g>
          <rect x={pad} y={pad-30} width={260} height={20} fill="#ffffff" stroke="#e2e8f0" rx={4} />
          <rect x={pad+10} y={pad-24} width={22} height={6} fill="#1d4ed8" />
          <text x={pad+38} y={pad-14} fill="#0f172a" fontSize={12}>{seriesLabel}</text>
        </g>
      )}
    </svg>
  );
}

function HoverOverlay({ width, height, pad, xScale, yScale, points }: any) {
  const [x, setX] = useState<number | null>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const handle = (evt: any) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const xx = evt.clientX - rect.left;
    setX(xx);
    // nearest point by x
    const t = (xx - pad) / (width - pad*2);
    const target = points.length > 0 ? points[Math.max(0, Math.min(points.length-1, Math.round(t * (points.length-1))))] : null;
    if (!target) { setIdx(null); return; }
    let bestI = 0; let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].t - target.t);
      if (dist < best) { best = dist; bestI = i; }
    }
    setIdx(bestI);
  };
  return (
    <g onMouseMove={handle} onMouseLeave={()=>{ setX(null); setIdx(null); }}>
      <rect x={pad} y={pad} width={width-pad*2} height={height-pad*2} fill="transparent" />
      {x != null && idx != null && points[idx] && (
        <g>
          <circle cx={xScale(points[idx].t)} cy={yScale(points[idx].v)} r={5} fill="#1d4ed8" stroke="#ffffff" strokeWidth={2} />
          <rect x={xScale(points[idx].t)+8} y={pad+8} width={170} height={42} rx={6} fill="#0f172a" opacity="0.9" />
          <text x={xScale(points[idx].t)+16} y={pad+26} fill="#ffffff" fontSize={12}>{new Date(points[idx].t).toLocaleDateString('pt-PT')}</text>
          <text x={xScale(points[idx].t)+16} y={pad+40} fill="#ffffff" fontSize={12}>{points[idx].v.toFixed(2)}</text>
        </g>
      )}
    </g>
  );
}

