import { Route, Routes } from 'react-router-dom';
import Auth from '../pages/Auth';
import Register from '../pages/Register';
import ResetPassword from '../pages/ResetPassword';
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
import MarketingContact from '../pages/marketing/Contact';
import MarketingPricing from '../pages/marketing/Pricing';
import CheckoutSuccess from '../pages/CheckoutSuccess';
import OnboardingFlow from '../pages/OnboardingFlow';
import OAuthConsent from '../pages/OAuthConsent';
import React from 'react';

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
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/subprocessors" element={<Subprocessors />} />
      {/* Consentement OAuth : la page doit exister AUSSI hors session — elle
          mémorise la demande puis renvoie vers /auth, et le retour la rejoue.
          Sans cette route, un utilisateur déconnecté verrait la page d'accueil
          marketing et le client MCP attendrait un code qui n'arrive jamais. */}
      <Route path="/oauth/consent" element={<OAuthConsent />} />
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
