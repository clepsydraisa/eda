import proj4 from 'proj4';
import { supabase } from './supabaseClient';

// Coordinate reference definitions
// Legacy Portuguese national grid (ESRI:102164) used in prior project data
proj4.defs(
  'ESRI:102164',
  '+proj=tmerc +lat_0=39.66666666666666 +lon_0=-8.131906111111112 +k=1 +x_0=200000 +y_0=300000 +ellps=intl +units=m +no_defs'
);

export type VariableKey = 'profundidade' | 'nitrato' | 'condutividade' | 'caudal';

export type TableKey = 'nitrato_tejo_loc_zvt' | 'condut_tejo_loc_zvt' | 'piezo_tejo_loc_zvt' | 'caudal_tejo_loc';

export const VARIABLE_CFG: Record<VariableKey, { table: TableKey; codeField: 'codigo' | 'localizacao' }> = {
  profundidade: { table: 'piezo_tejo_loc_zvt', codeField: 'codigo' },
  nitrato: { table: 'nitrato_tejo_loc_zvt', codeField: 'codigo' },
  condutividade: { table: 'condut_tejo_loc_zvt', codeField: 'codigo' },
  caudal: { table: 'caudal_tejo_loc', codeField: 'localizacao' },
};

export type BaseRow = {
  id?: number | string;
  data?: string | null;
  coord_x_m?: number | null;
  coord_y_m?: number | null;
  codigo?: string | null;
  localizacao?: string | null;
  sistema_aquifero?: string | null;
};

// Convert coordinates from ESRI:102164 (or assume degrees) to WGS84 [lat, lon]
export function utmToLatLng(x?: number | null, y?: number | null): [number, number] | null {
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  try {
    // Heuristic: if values are large it's projected meters -> convert; else assume degrees
    if (Math.abs(x) > 1000 || Math.abs(y) > 1000) {
      const [lon, lat] = proj4('ESRI:102164', 'WGS84', [x, y]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
      return null;
    }
    if (Math.abs(y) <= 90 && Math.abs(x) <= 180) return [y, x];
    return null;
  } catch {
    return null;
  }
}

export async function fetchVariableData(variable: VariableKey, sistemaAquifero: string) {
  if (!supabase) return { data: [] as BaseRow[] };
  const cfg = VARIABLE_CFG[variable];
  const select = cfg.codeField === 'localizacao'
    ? 'id, data, coord_x_m, coord_y_m, localizacao'
    : 'id, data, coord_x_m, coord_y_m, codigo, sistema_aquifero';
  const build = () => {
    let q = supabase.from(cfg.table).select(select, { count: 'none' });
    if (sistemaAquifero && sistemaAquifero !== 'todos' && cfg.codeField !== 'localizacao') {
      q = q.eq('sistema_aquifero', sistemaAquifero);
    }
    return q;
  };
  const data = await fetchAll<BaseRow>(build);
  return { data };
}

export async function fetchDistinctSistemas(variable: VariableKey) {
  if (!supabase) return [] as string[];
  const cfg = VARIABLE_CFG[variable];
  const build = () => supabase
    .from(cfg.table)
    .select('sistema_aquifero', { count: 'none' })
    .not('sistema_aquifero', 'is', null);
  const data = await fetchAll<any>(build);
  const uniq = Array.from(new Set((data || []).map((r: any) => r.sistema_aquifero))).filter(Boolean) as string[];
  return uniq;
}

export async function fetchHistory(variable: VariableKey, code: string, sistemaAquifero?: string) {
  if (!supabase) return [] as BaseRow[];
  const cfg = VARIABLE_CFG[variable];
  const codeField = cfg.codeField;
  const build = () => {
    let q = supabase.from(cfg.table).select('*').eq(codeField, code).order('data', { ascending: true });
    if (sistemaAquifero && sistemaAquifero !== 'todos' && cfg.codeField !== 'localizacao') {
      q = q.eq('sistema_aquifero', sistemaAquifero);
    }
    return q;
  };
  const data = await fetchAll<BaseRow>(build);
  return data;
}

// Helper to paginate all rows (no hard limit)
export async function fetchAll<T>(build: () => any, pageSize = 1000): Promise<T[]> {
  const result: T[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await build().range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    const arr = (data as T[]) || [];
    if (arr.length === 0) break;
    result.push(...arr);
    if (arr.length < pageSize) break;
    page++;
  }
  return result;
}


