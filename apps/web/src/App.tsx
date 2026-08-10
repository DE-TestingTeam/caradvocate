import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGate } from '@/components/layout/AuthGate';
import { OnboardingGate } from '@/components/layout/OnboardingGate';
import { RequirePaidPlan } from '@/components/layout/RequirePaidPlan';
import { RequireVehicle } from '@/components/layout/RequireVehicle';
import { AccountPage } from '@/pages/Account';
import { AskCAPage } from '@/pages/AskCA';
import { AssessmentDetailPage } from '@/pages/AssessmentDetail';
import { AssessmentNoPricingPage } from '@/pages/AssessmentNoPricing';
import { AssessmentsPage } from '@/pages/Assessments';
import { LoginPage } from '@/pages/Login';
import { MyCarPage } from '@/pages/MyCar';
import { NewAssessmentPage } from '@/pages/NewAssessment';
import { OnboardingPage } from '@/pages/Onboarding';

export default function App() {
  return (
    <Routes>
      {/* No nav chrome: signed out on /login, or signed in but not through onboarding yet.
          There is nowhere for the rail to point them while either is true. */}
      <Route element={<AppShell chrome={false} />}>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthGate />}>
          {/* Gated in the other direction: onboarding is for people who have not finished it. */}
          <Route element={<OnboardingGate />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
          </Route>
        </Route>
      </Route>

      <Route element={<AppShell />}>
        <Route element={<AuthGate />}>
          {/*
            Every signed-in page sits behind RequireVehicle, Account included. It used to sit
            outside, on the grounds that it reads without a car -- but "renders without a car"
            is not the same as "is somewhere a new signup should be able to reach", and it was
            the one door into the app that onboarding did not stand in front of.
          */}
          <Route element={<RequireVehicle />}>
            <Route path="/" element={<Navigate to="/my-car" replace />} />
            <Route path="/my-car" element={<MyCarPage />} />
            <Route path="/ask" element={<AskCAPage />} />
            <Route path="/account" element={<AccountPage />} />
            {/* The Repair Cost Checker: the only paid surface in v1. */}
            <Route element={<RequirePaidPlan />}>
              <Route path="/assessments" element={<AssessmentsPage />} />
              <Route path="/assessments/new" element={<NewAssessmentPage />} />
              {/* Before :id, and a literal segment so it cannot be read as one. */}
              <Route path="/assessments/no-pricing" element={<AssessmentNoPricingPage />} />
              <Route path="/assessments/:id" element={<AssessmentDetailPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/my-car" replace />} />
      </Route>
    </Routes>
  );
}
