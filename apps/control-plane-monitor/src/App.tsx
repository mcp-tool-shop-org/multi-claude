import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { OverviewPage } from './pages/OverviewPage';
import { QueuePage } from './pages/QueuePage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { LanesPage } from './pages/LanesPage';
import { ActivityPage } from './pages/ActivityPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="items/:queueItemId" element={<ItemDetailPage />} />
          <Route path="lanes" element={<LanesPage />} />
          <Route path="activity" element={<ActivityPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
