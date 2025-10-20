import type { RouteObject } from 'react-router-dom';
import { AppLayout } from './ui/AppLayout';
import { PageBlank } from './ui/PageBlank';
import { Overview } from './pages/Overview';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'dados', element: <PageBlank title="Dados" /> },
      { path: 'analise', element: <PageBlank title="Análise" /> },
      { path: 'modelos', element: <PageBlank title="Modelos" /> },
      { path: 'config', element: <PageBlank title="Config" /> },
      { path: '*', element: <PageBlank title="Página não encontrada" /> },
    ],
  },
];


