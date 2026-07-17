import { useTranslation } from '../../i18n';
import { useCompany } from '../../contexts/CompanyContext';
import LocationServices from '../../components/LocationServices';
import MyLocationConsentCard from '../../components/settings/MyLocationConsentCard';
import LocationTrackingSettingCard from '../../components/settings/LocationTrackingSettingCard';
import LocationConsentRoster from '../../components/settings/LocationConsentRoster';

export default function LocationSettings() {
  const { language } = useTranslation();
  const { currentRole } = useCompany();
  const lang = language === 'fr' ? 'fr' : 'en';
  const isAdmin = currentRole === 'owner' || currentRole === 'admin';

  return (
    <div className="max-w-2xl space-y-6">
      {/* Consentement personnel — visible pour tout le monde */}
      <MyLocationConsentCard language={lang} />

      {/* Volet admin : switch maître de l'org (rapatrié de la page Entreprise)
          + roster des consentements de l'équipe (Loi 25) */}
      {isAdmin && (
        <>
          <LocationTrackingSettingCard language={lang} />
          <LocationConsentRoster language={lang} />
        </>
      )}

      <LocationServices />
    </div>
  );
}
