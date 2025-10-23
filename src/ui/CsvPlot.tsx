import { useEffect, useMemo, useRef, useState } from 'react';

type CsvRow = Record<string, string>;

function parseCsv(text: string): CsvRow[] {
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

function tryParseDate(v: string): Date | null {
  if (!v) return null;
  const iso = Date.parse(v);
  if (!isNaN(iso)) return new Date(iso);
  // try YYYY-MM or YYYY/MM
  const m = v.match(/^(\d{4})[-\/]?(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return null;
}

function isNumericColumn(values: string[]): boolean {
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    const cols = columns.filter((c) => c !== 'codigo' && c !== ymKey);
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

  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const txt = String(reader.result || '');
        setRows(parseCsv(txt));
      } catch (ex: any) {
        setErr(ex?.message ?? 'Erro a ler o ficheiro');
      }
    };
    reader.onerror = () => setErr('Falha ao ler ficheiro');
    reader.readAsText(file);
  };

  return (
    <div style={{display:'grid', gap:10}}>
      <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'center'}}>
        <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
          <span>CSV:</span>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={onFileChange} />
        </label>
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
        {err && <span className="muted">{err}</span>}
      </div>

      <SvgMultiLine data={filtered} series={series} />
    </div>
  );
}

function SvgMultiLine({ data, series, width = 920, height = 360 }:
  { data: Array<{ t: Date; values: Record<string, number> }>; series: SeriesConfig[]; width?: number; height?: number }) {
  const padding = { left: 56, right: 16, top: 18, bottom: 32 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const times: number[] = data.map((d) => d.t.getTime());
  const tmin = times.length ? Math.min(...times) : 0;
  const tmax = times.length ? Math.max(...times) : 0;
  const yVals: number[] = [];
  data.forEach((r) => series.forEach((s) => { const v = r.values[s.key]; if (typeof v === 'number' && isFinite(v)) yVals.push(v); }));
  const ymin = yVals.length ? Math.min(...yVals) : 0;
  const ymax = yVals.length ? Math.max(...yVals) : 1;

  function xScale(t: number): number {
    if (tmax === tmin) return padding.left + plotW / 2;
    return padding.left + ((t - tmin) / (tmax - tmin)) * plotW;
  }
  function yScale(v: number): number {
    if (ymax === ymin) return padding.top + plotH / 2;
    return padding.top + (1 - (v - ymin) / (ymax - ymin)) * plotH;
  }

  const axisColor = 'rgba(226,232,240,0.35)';

  return (
    <svg width={width} height={height} role="img" aria-label="Gráfico de linhas">
      <rect x={0} y={0} width={width} height={height} fill="rgba(15,23,42,0.35)" stroke="var(--border)" rx={10} />
      {/* axes */}
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH} stroke={axisColor} />
      <line x1={padding.left} y1={padding.top + plotH} x2={padding.left + plotW} y2={padding.top + plotH} stroke={axisColor} />
      {/* y ticks */}
      {Array.from({ length: 5 }).map((_, i) => {
        const v: number = ymin + (i * (ymax - ymin)) / 4;
        const y = yScale(v);
        return (
          <g key={`yt-${i}`}>
            <line x1={padding.left} y1={y} x2={padding.left + plotW} y2={y} stroke={axisColor} opacity={0.2} />
            <text x={padding.left - 8} y={y} fill="var(--muted)" fontSize={10} textAnchor="end" alignmentBaseline="middle">{round(v)}</text>
          </g>
        );
      })}
      {/* lines */}
      {series.map((s, si) => {
        const path = data
          .map((r, idx) => {
            const v = r.values[s.key];
            if (typeof v !== 'number' || !isFinite(v)) return null;
            const x = xScale(r.t.getTime());
            const y = yScale(v);
            return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .filter(Boolean)
          .join(' ');
        return <path key={`line-${si}`} d={path} fill="none" stroke={s.color} strokeWidth={2} />;
      })}
      {/* legend */}
      <g transform={`translate(${padding.left}, ${padding.top - 6})`}>
        {series.map((s, i) => (
          <g key={`lg-${i}`} transform={`translate(${i * 160},0)`}>
            <rect x={0} y={-10} width={10} height={10} fill={s.color} rx={2} />
            <text x={14} y={-3} fill="var(--muted)" fontSize={12}>{s.key}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function round(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  if (Math.abs(n) >= 10) return n.toFixed(2);
  return n.toFixed(3);
}


