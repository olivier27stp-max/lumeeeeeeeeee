import { useTranslation } from '../../i18n';
import LocationServices from '../../components/LocationServices';
import MyLocationConsentCard from '../../components/settings/MyLocationConsentCard';

export default function LocationSettings() {
  const { language } = useTranslation();
  return (
    <div className="max-w-2xl space-y-6">
      <MyLocationConsentCard language={language === 'fr' ? 'fr' : 'en'} />
      <LocationServices />
    </div>
  );
}
