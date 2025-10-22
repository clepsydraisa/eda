import { useEffect, useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { utmToLatLng, VARIABLE_CFG, fetchDistinctSistemas, fetchVariableData, fetchAll } from '../lib/edaData';
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


