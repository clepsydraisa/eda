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
        <h2 className="page-title">Overview</h2>
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
        <h2 className="page-title">Overview</h2>
        <p className="muted">Sem colunas para mostrar. Confirma a view `table_columns`.</p>
      </section>
    );
  }

  return (
    <section className="page-blank">
      <h2 className="page-title">Overview</h2>

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
          { key: 'nitrato_tejo_loc_zvt', label: 'Nitrato', img: '/img/tables/nitrato_tab.png' },
          { key: 'condut_tejo_loc_zvt', label: 'Condutividade', img: '/img/tables/condut_tab.png' },
          { key: 'piezo_tejo_loc_zvt', label: 'Piezo', img: '/img/tables/piezo_tab.png' },
          { key: 'caudal_tejo_loc', label: 'Caudal', img: '/img/tables/caudal_tab.png' },
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
            <div style={{display:'grid', gap:6}}>
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
  );
}


