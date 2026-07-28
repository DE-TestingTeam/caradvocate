import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AccountPage } from '@/pages/Account';
import { AskCAPage } from '@/pages/AskCA';
import { AssessmentDetailPage } from '@/pages/AssessmentDetail';
import { AssessmentsPage } from '@/pages/Assessments';
import { MyCarPage } from '@/pages/MyCar';
import { NewAssessmentPage } from '@/pages/NewAssessment';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/my-car" replace />} />
        <Route path="/my-car" element={<MyCarPage />} />
        <Route path="/ask" element={<AskCAPage />} />
        <Route path="/assessments" element={<AssessmentsPage />} />
        <Route path="/assessments/new" element={<NewAssessmentPage />} />
        <Route path="/assessments/:id" element={<AssessmentDetailPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/my-car" replace />} />
      </Route>
    </Routes>
  );
}
