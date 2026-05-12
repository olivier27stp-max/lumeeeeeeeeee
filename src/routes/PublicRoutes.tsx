import { Route, Routes } from 'react-router-dom';
import Auth from '../pages/Auth';
import Register from '../pages/Register';
import VerifyEmail from '../pages/VerifyEmail';
import Privacy from '../pages/Privacy';
import Terms from '../pages/Terms';
import Subprocessors from '../pages/Subprocessors';
import MarketingNotFound from '../pages/marketing/NotFound';
import MarketingLayout from '../components/marketing/MarketingLayout';
import MarketingHome from '../pages/marketing/Home';
import MarketingFeatures from '../pages/marketing/Features';
import MarketingSolutions from '../pages/marketing/Solutions';
import MarketingIndustries from '../pages/marketing/Industries';
import MarketingIndustryDetail from '../pages/marketing/IndustryDetail';
import MarketingPricing from '../pages/marketing/Pricing';
import MarketingContact from '../pages/marketing/Contact';
import CheckoutSuccess from '../pages/CheckoutSuccess';
import OnboardingFlow from '../pages/OnboardingFlow';
import React from 'react';
const PublicBooking = React.lazy(() => import('../pages/PublicBooking'));

type PublicRoutesProps = {
  /** Called when the user clicks Back from the Auth page. */
  onAuthBack: () => void;
  /** When true, the checkout + success routes are also mounted (subscription-guard path). */
  includeCheckout?: boolean;
};

/**
 * Routes accessible without an authenticated session.
 * Covers marketing pages, legal pages, and the auth flow.
 * Used both on the "not logged in" path and on the "logged in without
 * subscription" path — the latter additionally mounts the checkout routes.
 */
export function PublicRoutes({ onAuthBack, includeCheckout = false }: PublicRoutesProps) {
  return (
    <Routes>
      {includeCheckout && (
        <>
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/checkout" element={<OnboardingFlow />} />
        </>
      )}
      <Route path="/auth" element={<Auth onBack={onAuthBack} />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/subprocessors" element={<Subprocessors />} />
      <Route path="/book/:slug" element={<React.Suspense fallback={<div className="min-h-screen" />}><PublicBooking /></React.Suspense>} />
      <Route element={<MarketingLayout />}>
        <Route index element={<MarketingHome />} />
        <Route path="features" element={<MarketingFeatures />} />
        <Route path="solutions" element={<MarketingSolutions />} />
        <Route path="industries" element={<MarketingIndustries />} />
        <Route path="industries/:slug" element={<MarketingIndustryDetail />} />
        <Route path="pricing" element={<MarketingPricing />} />
        <Route path="contact" element={<MarketingContact />} />
        <Route path="*" element={<MarketingNotFound />} />
      </Route>
    </Routes>
  );
}
