import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

// The splash in index.html paints first; the canvas engine then loads behind it.
const App = lazy(() => import('./ui/App').then((m) => ({ default: m.App })));

createRoot(document.getElementById('root')!).render(<StrictMode><Suspense><App /></Suspense></StrictMode>);
