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
            Company Information
          </CardTitle>
          <CardDescription>
            Basic details about your organization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              Company Name
            </label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              Company Logo
            </label>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-elevated">
                <Building2 className="h-6 w-6 text-text-muted" />
              </div>
              <div>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Upload className="h-3 w-3" />
                  Upload Logo
                </Button>
                <p className="mt-1 text-[11px] text-text-muted">
                  SVG, PNG, or JPG. Max 2MB.
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
            Localization
          </CardTitle>
          <CardDescription>
            Timezone and language settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-primary outline-none transition-colors hover:border-border focus:border-outline-strong focus:ring-2 focus:ring-outline/30"
            >
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Chicago">Central Time (CT)</option>
              <option value="America/Denver">Mountain Time (MT)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
              <option value="America/Toronto">Toronto (ET)</option>
              <option value="America/Montreal">Montreal (ET)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              Default Locale
            </label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-primary outline-none transition-colors hover:border-border focus:border-outline-strong focus:ring-2 focus:ring-outline/30"
            >
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-3.5 w-3.5 text-text-secondary" />
            Branding
          </CardTitle>
          <CardDescription>
            Customize the look and feel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              Primary Color
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
          Save Changes
        </Button>
      </div>
    </div>
  );
}
