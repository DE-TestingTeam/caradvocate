import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGate } from '@/components/layout/AuthGate';
import { RequireVehicle } from '@/components/layout/RequireVehicle';
import { AccountPage } from '@/pages/Account';
import { AskCAPage } from '@/pages/AskCA';
import { AssessmentDetailPage } from '@/pages/AssessmentDetail';
import { AssessmentsPage } from '@/pages/Assessments';
import { LoginPage } from '@/pages/Login';
import { MyCarPage } from '@/pages/MyCar';
import { NewAssessmentPage } from '@/pages/NewAssessment';
import { OnboardingPage } from '@/pages/Onboarding';

export default function App() {
  return (
    <Routes>
      {/* Public: the only route reachable without a session, and the only one
          without nav chrome. */}
      <Route element={<AppShell chrome={false} />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<AppShell />}>
        <Route element={<AuthGate />}>
          {/* Signed in, but may not have added a car yet. */}
          <Route path="/onboarding" element={<OnboardingPage />} />
          {/* Account works without a vehicle, so it sits outside RequireVehicle. */}
          <Route path="/account" element={<AccountPage />} />

          <Route element={<RequireVehicle />}>
            <Route path="/" element={<Navigate to="/my-car" replace />} />
            <Route path="/my-car" element={<MyCarPage />} />
            <Route path="/ask" element={<AskCAPage />} />
            <Route path="/assessments" element={<AssessmentsPage />} />
            <Route path="/assessments/new" element={<NewAssessmentPage />} />
            <Route path="/assessments/:id" element={<AssessmentDetailPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/my-car" replace />} />
      </Route>
    </Routes>
  );
}
