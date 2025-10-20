import { useEffect, useState } from 'react';
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

  const byTable = rows.reduce<Record<string, ColumnRow[]>>((acc, r) => {
    (acc[r.table_name] ||= []).push(r);
    return acc;
  }, {});

  return (
    <section className="page-blank">
      <h2 className="page-title">Overview do Esquema</h2>
      <div style={{display:'grid', gap:16}}>
        {Object.entries(byTable).map(([table, cols]) => (
          <div key={table} style={{border:'1px solid var(--border)', borderRadius:10, padding:12}}>
            <h3 style={{marginTop:0}}>{table}</h3>
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
                  {cols.map((c) => (
                    <tr key={c.column_name}>
                      <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{c.column_name}</td>
                      <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{c.data_type}</td>
                      <td style={{padding:'6px 8px', borderTop:'1px solid var(--border)'}}>{c.is_nullable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}


