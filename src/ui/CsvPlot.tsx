import { useEffect, useMemo, useRef, useState } from 'react';
// Import Plotly via dynamic global to avoid TS type resolution issues at build time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Plotly: any = (window as any).Plotly ?? undefined;

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]!);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line !== 'string') continue;
    const cols = splitCsvLine(line);
    const first = cols[0];
    if (cols.length === 1 && (!first || first.trim() === '')) continue;
    const obj: CsvRow = {};
    for (let idx = 0; idx < header.length; idx++) {
      const h: string = header[idx] as string;
      const val = cols[idx];
      obj[h] = typeof val === 'string' ? val : '';
    }
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += ch; }
    } else {
      if (ch === ',') { result.push(current); current = ''; }
      else if (ch === '"') { inQuotes = true; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

export function tryParseDate(v: string): Date | null {
  if (!v) return null;
  const iso = Date.parse(v);
  if (!isNaN(iso)) return new Date(iso);
  // try YYYY-MM or YYYY/MM
  const m = v.match(/^(\d{4})[-\/]?(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return null;
}

export function isNumericColumn(values: string[]): boolean {
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (x === '' || x == null) continue;
    const n = Number(x);
    if (!isFinite(n)) return false;
  }
  return true;
}

type SeriesConfig = {
  key: string;
  color: string;
};

const COLORS = ['#38bdf8', '#22c55e', '#ef4444', '#f59e0b', '#a78bfa', '#eab308'];

export function CsvPlot({ defaultPath = 'data/mensal_por_poco_full_valores_lags.csv' }: { defaultPath?: string }) {
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [well, setWell] = useState<string>('(Todos)');
  const [selected, setSelected] = useState<string[]>([]);
  const [normalize, setNormalize] = useState<boolean>(false);
  const [xVar, setXVar] = useState<string>('');
  const [yVar, setYVar] = useState<string>('');
  const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setErr(null);
      try {
        const base = (import.meta.env.BASE_URL || '/');
        const res = await fetch(`${base}${defaultPath}`);
        if (!res.ok) throw new Error('CSV não encontrado em public/data');
        const txt = await res.text();
        if (!cancelled) setRows(parseCsv(txt));
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Erro ao ler CSV');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [defaultPath]);

  const columns = useMemo(() => {
    if (!rows || rows.length === 0) return [] as string[];
    return Object.keys(rows[0]!);
  }, [rows]);

  const ymKey = useMemo(() => {
    if (columns.includes('ym')) return 'ym';
    const cand = columns.find((c) => c.toLowerCase().includes('data') || c.toLowerCase().includes('time'));
    return cand ?? 'ym';
  }, [columns]);

  const numericCols = useMemo(() => {
    if (!rows || rows.length === 0) return [] as string[];
    const cols = columns.filter((c) => c !== 'codigo' && c !== ymKey && c !== 'ano' && c !== 'mes');
    return cols.filter((c) => isNumericColumn(rows.map((r) => r![c]!)));
  }, [rows, columns, ymKey]);

  const wells = useMemo(() => {
    if (!rows || !columns.includes('codigo')) return ['(Todos)'];
    const s = new Set<string>();
    rows.forEach((r) => { if (r['codigo']) s.add(String(r['codigo'])); });
    return ['(Todos)', ...Array.from(s).sort((a,b)=>a.localeCompare(b,'pt'))];
  }, [rows, columns]);

  const data = useMemo(() => {
    if (!rows) return [] as Array<{ t: Date; values: Record<string, number>; codigo?: string }>;
    return rows.map((r) => {
      const d = tryParseDate(r![ymKey]!);
      const vals: Record<string, number> = {};
      numericCols.forEach((c) => { const n = Number(r![c]); vals[c] = isFinite(n) ? n : NaN; });
      return { t: d ?? new Date(0), values: vals, codigo: r!['codigo'] };
    }).filter((x) => x.t.getTime() > 0).sort((a,b)=>a.t.getTime()-b.t.getTime());
  }, [rows, numericCols, ymKey]);

  const filtered = useMemo(() => {
    if (well === '(Todos)') return data;
    return data.filter((r) => String(r.codigo) === String(well));
  }, [data, well]);

  const series: SeriesConfig[] = useMemo(() => {
    const list = selected.length > 0 ? selected : numericCols.slice(0, Math.min(3, numericCols.length));
    return list.map((k, i) => ({ key: k, color: COLORS[i % COLORS.length]! }));
  }, [selected, numericCols]);

  // Normalization stats per selected series (computed on filtered set)
  function isZeroInvalidForVar(key: string): boolean {
    const k = key.toLowerCase();
    return (k === 'profundidade' || k === 'nivel_piezo');
  }

  const normStats = useMemo(() => {
    if (!normalize) return {} as Record<string, { mu: number; sd: number }>;
    const stats: Record<string, { mu: number; sd: number }> = {};
    series.forEach((s) => {
      const arr: number[] = [];
      filtered.forEach((r) => {
        const raw = Number(r.values[s.key]);
        if (!isFinite(raw)) return;
        if (isZeroInvalidForVar(s.key) && raw <= 0) return; // tratar 0 como missing
        arr.push(raw);
      });
      const n = arr.length;
      const mu = n ? arr.reduce((a,b)=>a+b,0)/n : 0;
      const denom = n > 1 ? (n - 1) : 1; // pandas std -> ddof=1
      const sd = n ? Math.sqrt(arr.reduce((a,b)=>a+(b-mu)*(b-mu),0)/denom) : 1;
      stats[s.key] = { mu, sd: sd || 1 };
    });
    return stats;
  }, [normalize, series, filtered]);

  return (
    <div style={{display:'grid', gap:10}}>
      <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'}}>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span>Poço:</span>
          <select value={well} onChange={(e)=>setWell(e.target.value)}>
            {wells.map((w) => (<option key={w} value={w}>{w}</option>))}
          </select>
        </label>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span>Variáveis:</span>
          <select
            multiple
            size={Math.min(6, Math.max(3, numericCols.length))}
            value={selected}
            onChange={(e)=>{
              const opts = Array.from(e.target.selectedOptions).map((o)=>o.value);
              setSelected(opts);
            }}
            style={{minWidth:260}}
          >
            {numericCols.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
        </label>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <input type="checkbox" checked={normalize} onChange={(e)=>setNormalize(e.target.checked)} /> Normalizar (z-score)
        </label>
        {err && <span className="muted">{err}</span>}
      </div>

      <TimeSeriesPlot data={filtered} series={series} normalize={normalize} normStats={normStats} />

      {/* Scatter box */}
      <div style={{marginTop:12, border:'1px solid var(--border)', borderRadius:10, padding:10}}>
        <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:8}}>
          <strong>Scatter OLS</strong>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <span>X:</span>
            <select value={xVar} onChange={(e)=>setXVar(e.target.value)}>
              <option value="">—</option>
              {numericCols.map((c)=>(<option key={`x-${c}`} value={c}>{c}</option>))}
            </select>
          </label>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <span>Y:</span>
            <select value={yVar} onChange={(e)=>setYVar(e.target.value)}>
              <option value="">—</option>
              {numericCols.map((c)=>(<option key={`y-${c}`} value={c}>{c}</option>))}
            </select>
          </label>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <span>Método:</span>
            <select value={method} onChange={(e)=>setMethod(e.target.value as any)}>
              <option value="pearson">Pearson</option>
              <option value="spearman">Spearman</option>
            </select>
          </label>
        </div>
        <ScatterSection data={filtered} xVar={xVar} yVar={yVar} method={method} />
      </div>

      {/* Heatmap box */}
      <div style={{marginTop:12, border:'1px solid var(--border)', borderRadius:10, padding:10}}>
        <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:8}}>
          <strong>Heatmap de correlação</strong>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <span>Método:</span>
            <select value={method} onChange={(e)=>setMethod(e.target.value as any)}>
              <option value="pearson">Pearson</option>
              <option value="spearman">Spearman</option>
            </select>
          </label>
          <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <span>Variáveis:</span>
            <select
              multiple
              size={Math.min(7, Math.max(3, numericCols.length))}
              value={selected}
              onChange={(e)=>{
                const opts = Array.from(e.target.selectedOptions).map((o)=>o.value);
                setSelected(opts);
              }}
              style={{minWidth:260}}
            >
              {numericCols.map((c) => (<option key={`hm-${c}`} value={c}>{c}</option>))}
            </select>
          </label>
        </div>
        <HeatmapSection data={filtered} variables={selected.length>1?selected: numericCols.slice(0,Math.min(4,numericCols.length))} method={method} />
      </div>
    </div>
  );
}

function TimeSeriesPlot({ data, series, normalize, normStats }:
  { data: Array<{ t: Date; values: Record<string, number> }>; series: SeriesConfig[]; normalize: boolean; normStats: Record<string, { mu: number; sd: number }> }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!elRef.current || !(window as any).Plotly) return;
    const traces = series.map((s) => {
      const x: string[] = [];
      const y: number[] = [];
      data.forEach((r) => {
        const t = r.t; let v: number = Number(r.values[s.key]);
        const keyLower = String(s.key).toLowerCase();
        if ((keyLower === 'profundidade' || keyLower === 'nivel_piezo') && (!isFinite(v) || v <= 0)) return; // descartar zeros inválidos
        if (normalize) { const st = normStats[s.key]; if (st) v = (v - st.mu)/st.sd; }
        if (isFinite(v) && t instanceof Date && !isNaN(t.getTime())) { x.push(t.toISOString()); y.push(v); }
      });
      return {
        x,
        y,
        mode: 'lines+markers',
        name: s.key,
        line: { color: s.color },
        marker: { size: 4 },
        connectgaps: true,
        type: 'scatter'
      } as any;
    });
    const layout: any = {
      autosize: true,
      height: 420,
      uirevision: 'ts-plot',
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { l: 64, r: 24, t: 28, b: 46 },
      xaxis: { title: 'Tempo', type: 'date', rangeslider: { visible: true }, gridcolor: 'rgba(226,232,240,0.2)', color: 'var(--text)' } as any,
      yaxis: { title: normalize ? 'Valor (z-score)' : 'Valor', gridcolor: 'rgba(226,232,240,0.2)', color: 'var(--text)' } as any,
      legend: { orientation: 'h', y: 1.1, font: { color: 'var(--text)' } } as any,
    };
    const config: any = {
      displayModeBar: true,
      displaylogo: false,
      responsive: true,
      modeBarButtonsToRemove: [],
    };
    (window as any).Plotly.newPlot(elRef.current, traces as any, layout, config);
    const ro = new ResizeObserver(() => { Plotly.Plots.resize(elRef.current as any); });
    ro.observe(elRef.current);
    return () => { ro.disconnect(); Plotly.purge(elRef.current as any); };
  }, [data, series, normalize, normStats]);
  return <div ref={elRef} />;
}

function round(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  if (Math.abs(n) >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

function HeatmapSection({ data, variables, method }:
  { data: Array<{ t: Date; values: Record<string, number>; codigo?: string }>; variables: string[]; method: 'pearson'|'spearman' }) {
  const cols = variables.filter((v, i, arr) => arr.indexOf(v) === i);
  if (cols.length < 2) return <p className="muted">Selecione pelo menos duas variáveis.</p>;
  const rows: number[][] = data.map((r) => {
    const row: number[] = [];
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k] as string;
      const v: unknown = (r && r.values) ? (r.values as any)[c] : undefined;
      const num = typeof v === 'number' ? v : Number(v);
      row.push(isFinite(num) ? num : NaN);
    }
    return row;
  });
  // compute correlation matrix
  const corr: number[][] = cols.map(() => cols.map(() => 0));
  for (let i = 0; i < cols.length; i++) {
    for (let j = 0; j < cols.length; j++) {
      const xi: number[] = rows
        .map((row) => (Array.isArray(row) && typeof row[i] === 'number' ? (row[i] as number) : NaN))
        .filter((v) => isFinite(v));
      const yj: number[] = rows
        .map((row) => (Array.isArray(row) && typeof row[j] === 'number' ? (row[j] as number) : NaN))
        .filter((v) => isFinite(v));
      const r = correlation(xi, yj, method);
      const rowCorr = corr[i] as number[];
      rowCorr[j] = typeof r === 'number' && isFinite(r) ? r : 0;
    }
  }
  const size = 22; const pad = 4; const w = cols.length * (size + pad) + pad; const h = w + 24;
  function color(z:number) { // -1..1 to RdBu_r-like
    const v = Math.max(-1, Math.min(1, z));
    const r = v < 0 ? 239 : Math.round(239 - 239*v);
    const b = v > 0 ? 239 : Math.round(239 + 239*v);
    const g = Math.round(68 + (239-68)*(1-Math.abs(v)));
    return `rgb(${r},${g},${b})`;
  }
  return (
    <svg width={w+160} height={h} role="img" aria-label="Heatmap">
      <g transform={`translate(60,20)`}>
        {cols.map((c,i)=> (
          <text key={`x-${c}`} x={i*(size+pad)+size/2} y={-6} fill="var(--muted)" fontSize={10} textAnchor="middle">{c}</text>
        ))}
        {cols.map((c,i)=> (
          <text key={`y-${c}`} x={-6} y={i*(size+pad)+size/2} fill="var(--muted)" fontSize={10} textAnchor="end" alignmentBaseline="middle">{c}</text>
        ))}
        {corr.map((row,i)=> row.map((z,j)=> {
          const val: number = typeof z === 'number' ? z : 0;
          return (
            <g key={`cell-${i}-${j}`}>
              <rect x={j*(size+pad)} y={i*(size+pad)} width={size} height={size} fill={color(val)} stroke="rgba(255,255,255,0.1)" />
              <text x={j*(size+pad)+size/2} y={i*(size+pad)+size/2} fontSize={9} fill="#111827" textAnchor="middle" alignmentBaseline="middle">{val.toFixed(2)}</text>
            </g>
          );
        }))}
      </g>
    </svg>
  );
}

function ScatterSection({ data, xVar, yVar, method }:
  { data: Array<{ t: Date; values: Record<string, number>; codigo?: string }>; xVar: string; yVar: string; method: 'pearson'|'spearman' }) {
  if (!xVar || !yVar || xVar === yVar) return <p className="muted">Selecione X e Y diferentes.</p>;
  const pts = data
    .map((r) => ({ x: Number(r.values[xVar]), y: Number(r.values[yVar]), t: r.t, codigo: r.codigo }))
    .filter((p) => isFinite(p.x) && isFinite(p.y));
  if (pts.length < 3) return <p className="muted">Dados insuficientes (n&lt;3).</p>;
  // Compute correlation
  const xArr = pts.map(p=>p.x); const yArr = pts.map(p=>p.y);
  const corr = correlation(xArr, yArr, method);
  // Simple OLS y = a + b x
  const { a, b } = ols(xArr, yArr);
  const xs = extent(xArr, 20);
  const ys = xs.map((x)=>a + b*x);
  return (
    <svg width={1000} height={360} role="img" aria-label="Scatter">
      <rect x={0} y={0} width={1000} height={360} fill="rgba(15,23,42,0.35)" stroke="var(--border)" rx={10} />
      {renderScatter({ pts, line:{ xs, ys }, padding:{left:56,right:16,top:18,bottom:32} })}
      <text x={60} y={24} fill="var(--muted)" fontSize={12}>n={pts.length} | r({method[0]})={corr.toFixed(2)}</text>
    </svg>
  );
}

function renderScatter({ pts, line, padding }:
  { pts: Array<{x:number;y:number}>, line:{ xs:number[]; ys:number[] }, padding:{left:number;right:number;top:number;bottom:number} }) {
  const width = 1000; const height = 360;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const xVals: number[] = pts.map(p=>p.x);
  const yVals: number[] = pts.map(p=>p.y);
  const xmin = Math.min(...xVals);
  const xmax = Math.max(...xVals);
  const ymin = Math.min(...yVals);
  const ymax = Math.max(...yVals);
  const sx = (x:number)=> padding.left + (x - xmin)/((xmax-xmin) || 1)*plotW;
  const sy = (y:number)=> padding.top + (1 - (y - ymin)/((ymax-ymin) || 1))*plotH;
  const dots = pts.map((p,i)=>(<circle key={`d-${i}`} cx={sx(p.x)} cy={sy(p.y)} r={2.5} fill="#38bdf8" />));
  const path = line.xs.map((x,i)=>{
    const yraw = line.ys?.[i];
    const yv: number = typeof yraw === 'number' ? yraw : 0;
    return `${i===0?'M':'L'}${sx(x)},${sy(yv)}`;
  }).join(' ');
  return (
    <g>
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top+plotH} stroke="rgba(226,232,240,0.35)" />
      <line x1={padding.left} y1={padding.top+plotH} x2={padding.left+plotW} y2={padding.top+plotH} stroke="rgba(226,232,240,0.35)" />
      {dots}
      <path d={path} fill="none" stroke="#ef4444" strokeWidth={2} />
    </g>
  );
}

function correlation(x:number[], y:number[], method:'pearson'|'spearman') {
  if (method === 'spearman') {
    const rx = rank(x); const ry = rank(y);
    return pearson(rx, ry);
  }
  return pearson(x, y);
}

function pearson(x:number[], y:number[]) {
  const n = Math.min(x.length, y.length);
  const mx = x.reduce((a,b)=>a+b,0)/n; const my = y.reduce((a,b)=>a+b,0)/n;
  let num=0, dx=0, dy=0;
  for (let i=0;i<n;i++){ const xv=x[i]??0, yv=y[i]??0; const a=xv-mx, b=yv-my; num+=a*b; dx+=a*a; dy+=b*b; }
  return num/Math.sqrt((dx||1)*(dy||1));
}

function rank(a:number[]) {
  const pairs = a.map((v,i)=>({v,i})).sort((p,q)=>p.v-q.v);
  const ranks: number[] = Array(a.length).fill(0);
  for (let i=0;i<pairs.length;i++){
    const pr = pairs[i];
    const idx = pr && typeof pr.i === 'number' ? pr.i : 0;
    ranks[idx]=i+1;
  }
  return ranks;
}

function ols(x:number[], y:number[]) {
  const n = Math.min(x.length, y.length);
  const mx = x.reduce((a,b)=>a+b,0)/n; const my = y.reduce((a,b)=>a+b,0)/n;
  let num=0, den=0; for (let i=0;i<n;i++){ const xi=x[i]??0; const yi=y[i]??0; num+=(xi-mx)*(yi-my); den+=(xi-mx)*(xi-mx); }
  const b = num/(den||1); const a = my - b*mx; return { a, b };
}

function extent(arr:number[], segments:number){
  const min = Math.min(...arr), max = Math.max(...arr);
  const xs: number[] = []; for(let i=0;i<segments;i++){ const denom = (segments-1) || 1; xs.push(min + (i/denom)*(max-min)); }
  return xs;
}


