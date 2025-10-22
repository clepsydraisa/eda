import type { RouteObject } from 'react-router-dom';
import { AppLayout } from './ui/AppLayout';
import { PageBlank } from './ui/PageBlank';
import { Overview } from './pages/Overview';
import { AnaliseLayout } from './pages/Analise/Layout';
import { AnaliseEstatisticas } from './pages/Analise/Estatisticas';
import { AnaliseMapa } from './pages/Analise/Mapa';
import { Navigate } from 'react-router-dom';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Overview /> },
      // removido: rota 'dados'
      {
        path: 'analise',
        element: <AnaliseLayout />,
        children: [
          { index: true, element: <Navigate to="estatisticas" replace /> },
          { path: 'estatisticas', element: <AnaliseEstatisticas /> },
          { path: 'mapa', element: <AnaliseMapa /> },
        ],
      },
      { path: 'modelos', element: <PageBlank title="Modelos" /> },
      { path: 'config', element: <PageBlank title="Config" /> },
      { path: '*', element: <PageBlank title="Página não encontrada" /> },
    ],
  },
];


