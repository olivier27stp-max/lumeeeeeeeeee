import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/d2d/card';
import { Button } from '../components/d2d/button';
import { Input } from '../components/d2d/input';
import { cn } from '../lib/utils';
import { Upload, Save, Building2, Globe, Palette } from 'lucide-react';
import { useTranslation } from '../i18n';
import BackToSettings from '../components/ui/BackToSettings';

export default function D2DSettingsGeneral() {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [companyName, setCompanyName] = useState('Clostra Solar');
  const [timezone, setTimezone] = useState('America/New_York');
  const [locale, setLocale] = useState('en');
  const [primaryColor, setPrimaryColor] = useState('#171717');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BackToSettings />
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-text-primary">
            {isFr ? 'Paramètres généraux' : 'General Settings'}
          </h2>
          <p className="text-xs text-text-tertiary">
            {isFr
              ? 'Configurez le profil et les préférences de votre entreprise'
              : 'Configure your company profile and preferences'}
          </p>
        </div>
      </div>

      {/* Company info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-text-secondary" />
            {isFr ? "Informations de l'entreprise" : 'Company Information'}
          </CardTitle>
          <CardDescription>
            {isFr ? 'Détails de base sur votre organisation' : 'Basic details about your organization'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {isFr ? "Nom de l'entreprise" : 'Company Name'}
            </label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {isFr ? "Logo de l'entreprise" : 'Company Logo'}
            </label>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-elevated">
                <Building2 className="h-6 w-6 text-text-muted" />
              </div>
              <div>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Upload className="h-3 w-3" />
                  {isFr ? 'Téléverser le logo' : 'Upload Logo'}
                </Button>
                <p className="mt-1 text-[11px] text-text-muted">
                  {isFr ? 'SVG, PNG ou JPG. Max 2 Mo.' : 'SVG, PNG, or JPG. Max 2MB.'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Localization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-text-secondary" />
            {isFr ? 'Localisation' : 'Localization'}
          </CardTitle>
          <CardDescription>
            {isFr ? 'Fuseau horaire et paramètres de langue' : 'Timezone and language settings'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {isFr ? 'Fuseau horaire' : 'Timezone'}
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-primary outline-none transition-colors hover:border-border focus:border-outline-strong focus:ring-2 focus:ring-outline/30"
            >
              <option value="America/New_York">{isFr ? "Heure de l'Est (HE)" : 'Eastern Time (ET)'}</option>
              <option value="America/Chicago">{isFr ? 'Heure du Centre (HC)' : 'Central Time (CT)'}</option>
              <option value="America/Denver">{isFr ? 'Heure des Rocheuses (HR)' : 'Mountain Time (MT)'}</option>
              <option value="America/Los_Angeles">{isFr ? 'Heure du Pacifique (HP)' : 'Pacific Time (PT)'}</option>
              <option value="America/Toronto">{isFr ? 'Toronto (HE)' : 'Toronto (ET)'}</option>
              <option value="America/Montreal">{isFr ? 'Montréal (HE)' : 'Montreal (ET)'}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {isFr ? 'Langue par défaut' : 'Default Locale'}
            </label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-primary outline-none transition-colors hover:border-border focus:border-outline-strong focus:ring-2 focus:ring-outline/30"
            >
              <option value="en">{isFr ? 'Anglais' : 'English'}</option>
              <option value="fr">{isFr ? 'Français' : 'French'}</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-3.5 w-3.5 text-text-secondary" />
            {isFr ? 'Image de marque' : 'Branding'}
          </CardTitle>
          <CardDescription>
            {isFr ? "Personnalisez l'apparence" : 'Customize the look and feel'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {isFr ? 'Couleur principale' : 'Primary Color'}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-9 cursor-pointer rounded-lg border border-border-subtle bg-transparent"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="max-w-[10rem]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button className="gap-1.5" size="sm">
          <Save className="h-3.5 w-3.5" />
          {isFr ? 'Enregistrer les modifications' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
