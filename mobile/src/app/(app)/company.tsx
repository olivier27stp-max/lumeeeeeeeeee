// Company details — web parity (src/pages/CompanySettings.tsx on main):
// logo (immediate persist), company info, address with autocomplete,
// revenue goal, Google Reviews (URL + toggle), currency, and the same
// validations (email, https-normalized website, https review URL). Writes
// the same company_settings row the web reads, and syncs orgs.name.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';

import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useTranslation } from '@/lib/i18n';
import { CompanySettings, getCompany, updateCompany } from '@/lib/api/org';
import { getPublicUrl, STORAGE_BUCKETS, uploadBase64 } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';

type Form = Partial<Omit<CompanySettings, 'org_id'>>;

/** Unique storage path per upload (module scope: event-handler only, not render). */
function newLogoPath(orgId: string): string {
  return `${orgId}/logo-${Date.now()}.png`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-2xl border border-surface-border bg-white p-4">
      <Text className="text-[11px] font-semibold uppercase tracking-widest text-ink-subtle">{title}</Text>
      {children}
    </View>
  );
}

export default function Company() {
  const qc = useQueryClient();
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const { refresh } = useMembership();
  const { orgId, can, role } = usePermissions();
  const isManager = can('settings.update') || role === 'owner' || role === 'admin';
  const [form, setForm] = useState<Form>({});
  const [logoBusy, setLogoBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['company', orgId],
    queryFn: () => getCompany(orgId ?? ''),
    enabled: !!orgId && isManager,
  });

  // Hydrate the form once per loaded org (state reset during render — the
  // React-sanctioned pattern, no setState-in-effect).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (data && loadedFor !== data.org_id) {
    setLoadedFor(data.org_id);
    setForm({
      company_name: data.company_name ?? '',
      phone: data.phone ?? '',
      email: data.email ?? '',
      website: data.website ?? '',
      street1: data.street1 ?? '',
      street2: data.street2 ?? '',
      city: data.city ?? '',
      province: data.province ?? '',
      postal_code: data.postal_code ?? '',
      country: data.country ?? '',
      logo_url: data.logo_url ?? '',
      revenue_goal_cents: data.revenue_goal_cents ?? 0,
      currency: data.currency ?? 'CAD',
      google_review_url: data.google_review_url ?? '',
      review_enabled: data.review_enabled ?? false,
    });
  }

  const saveMut = useMutation({
    mutationFn: () => {
      // Same validations as the web — these values feed invoices, quotes and
      // outgoing emails, where a bad address fails silently downstream.
      const email = (form.email ?? '').trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new Error(fr ? 'Adresse courriel invalide.' : 'Invalid email address.');
      }
      let website = (form.website ?? '').trim();
      if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
      if (website && !/^https?:\/\/[^\s.]+\.\S{2,}/i.test(website)) {
        throw new Error(fr ? 'Adresse du site web invalide.' : 'Invalid website URL.');
      }
      const reviewUrl = (form.google_review_url ?? '').trim();
      if (reviewUrl && !/^https?:\/\/[^\s.]+\.\S{2,}/i.test(reviewUrl)) {
        throw new Error(
          fr ? 'Lien Google Review invalide (doit commencer par https://).' : 'Invalid Google Review URL (must start with https://).',
        );
      }
      return updateCompany(orgId ?? '', {
        ...form,
        company_name: (form.company_name ?? '').trim(),
        email,
        website,
        google_review_url: reviewUrl,
        revenue_goal_cents: Math.max(0, Math.round(form.revenue_goal_cents || 0)),
        currency: form.currency || 'CAD',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      // Refresh memberships so the live company name (used in client messages,
      // the More header, etc.) updates everywhere without an app reload.
      refresh();
      router.back();
    },
    onError: (e: Error) => Alert.alert(t.mobileTeam.couldNotSave, e.message),
  });

  // Persist the logo IMMEDIATELY on upload/remove — same rule as the web:
  // leaving it to the global save silently lost the logo on navigate-away.
  const pickLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      exif: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    setLogoBusy(true);
    try {
      const out = await ImageManipulator.manipulateAsync(res.assets[0].uri, [{ resize: { width: 1024 } }], {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.PNG,
        base64: true,
      });
      if (!out.base64) throw new Error(t.mobileErrors.imageFailed);
      const path = newLogoPath(String(orgId));
      await uploadBase64(STORAGE_BUCKETS.COMPANY_LOGOS, path, out.base64, 'image/png');
      const url = getPublicUrl(STORAGE_BUCKETS.COMPANY_LOGOS, path);
      await updateCompany(orgId ?? '', { logo_url: url });
      cleanupOldLogo(form.logo_url ?? '');
      setForm((f) => ({ ...f, logo_url: url }));
      qc.invalidateQueries({ queryKey: ['company'] });
    } catch (e) {
      Alert.alert(t.mobileTeam.couldNotSave, (e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await updateCompany(orgId ?? '', { logo_url: '' });
      cleanupOldLogo(form.logo_url ?? '');
      setForm((f) => ({ ...f, logo_url: '' }));
      qc.invalidateQueries({ queryKey: ['company'] });
    } catch (e) {
      Alert.alert(t.mobileTeam.couldNotSave, (e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  };

  // Best-effort deletion of the replaced/removed file (files were piling up).
  const cleanupOldLogo = (url: string) => {
    const rest = url.split(`/object/public/${STORAGE_BUCKETS.COMPANY_LOGOS}/`)[1];
    const path = rest ? decodeURIComponent(rest.split('?')[0]) : null;
    if (path) supabase.storage.from(STORAGE_BUCKETS.COMPANY_LOGOS).remove([path]).catch(() => {});
  };

  if (!isManager) return <Redirect href="/(app)/(tabs)/profile" />;
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <ActivityIndicator color="#171717" />
      </View>
    );
  }

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <ScreenContainer scroll>
      <View className="gap-4 py-4">
        {/* Logo */}
        <Section title={fr ? "Logo de l'entreprise" : 'Company logo'}>
          {form.logo_url ? (
            <View className="flex-row items-center gap-4">
              <View className="h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-surface-border bg-surface-sunken">
                <Image source={{ uri: form.logo_url }} style={{ width: 80, height: 80 }} contentFit="contain" />
              </View>
              <View className="gap-2">
                <Pressable onPress={removeLogo} disabled={logoBusy} className="rounded-lg border border-surface-border px-3 py-2">
                  <Text className="text-xs font-semibold" style={{ color: '#DC2626' }}>
                    {logoBusy ? '…' : fr ? 'Retirer' : 'Remove'}
                  </Text>
                </Pressable>
                <Pressable onPress={pickLogo} disabled={logoBusy} className="rounded-lg border border-surface-border px-3 py-2">
                  <Text className="text-xs font-semibold text-ink">{fr ? 'Remplacer' : 'Replace'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={pickLogo}
              disabled={logoBusy}
              className="items-center rounded-xl border border-dashed border-surface-border bg-surface-sunken px-4 py-6"
            >
              {logoBusy ? (
                <ActivityIndicator color="#525252" />
              ) : (
                <Text className="text-sm font-medium text-ink-muted">{fr ? 'Téléverser un logo' : 'Upload a logo'}</Text>
              )}
            </Pressable>
          )}
        </Section>

        {/* Company info */}
        <Section title={fr ? "Détails de l'entreprise" : 'Company details'}>
          <Input label={t.mobileTeam.companyName} value={form.company_name ?? ''} onChangeText={set('company_name')} />
          <Input label={t.mobileTeam.phone} value={form.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" />
          <Input
            label={t.mobileTeam.email}
            value={form.email ?? ''}
            onChangeText={set('email')}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Input label={t.mobileTeam.website} value={form.website ?? ''} onChangeText={set('website')} autoCapitalize="none" />
        </Section>

        {/* Address */}
        <Section title={fr ? 'Adresse' : 'Address'}>
          <AddressAutocomplete
            label={t.mobileTeam.streetAddress}
            value={form.street1 ?? ''}
            onChangeText={set('street1')}
            onSelect={(a) => {
              setForm((f) => ({
                ...f,
                street1: a.address,
                city: a.city ?? f.city,
                province: a.province ?? f.province,
                postal_code: a.postal_code ?? f.postal_code,
                country: a.country ?? f.country,
              }));
            }}
          />
          <Input label={t.mobileTeam.streetAddress2} value={form.street2 ?? ''} onChangeText={set('street2')} />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Input label={t.mobileTeam.city} value={form.city ?? ''} onChangeText={set('city')} />
            </View>
            <View className="flex-1">
              <Input label={t.mobileTeam.province} value={form.province ?? ''} onChangeText={set('province')} />
            </View>
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Input label={t.mobileTeam.postalCode} value={form.postal_code ?? ''} onChangeText={set('postal_code')} />
            </View>
            <View className="flex-1">
              <Input label={t.mobileTeam.country} value={form.country ?? ''} onChangeText={set('country')} />
            </View>
          </View>
        </Section>

        {/* Financial goal */}
        <Section title={fr ? 'Objectif financier' : 'Financial goal'}>
          <Input
            label={fr ? 'Objectif de revenus ($)' : 'Revenue goal ($)'}
            value={form.revenue_goal_cents ? String(Math.round(form.revenue_goal_cents / 100)) : ''}
            onChangeText={(v) => {
              const dollars = parseFloat(v.replace(',', '.'));
              setForm((f) => ({ ...f, revenue_goal_cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0 }));
            }}
            keyboardType="numeric"
            placeholder="100000"
          />
          <Text className="text-xs text-ink-subtle">
            {fr
              ? "Le diagramme d'objectif dans Statistiques affichera la progression par rapport à ce montant."
              : 'The goal chart in Insights will display progress against this amount.'}
          </Text>
        </Section>

        {/* Google Reviews */}
        <Section title="Google Reviews">
          <Input
            label={fr ? 'Lien Google Review' : 'Google Review URL'}
            value={form.google_review_url ?? ''}
            onChangeText={set('google_review_url')}
            autoCapitalize="none"
            placeholder="https://g.page/r/…/review"
          />
          <Text className="text-xs text-ink-subtle">
            {fr
              ? 'Les clients satisfaits seront redirigés vers ce lien pour laisser un avis.'
              : 'Satisfied customers will be redirected to this link to leave a review.'}
          </Text>
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1 pr-3">
              <Text className="text-sm font-medium text-ink">{fr ? "Activer les demandes d'avis" : 'Enable review requests'}</Text>
              <Text className="text-xs text-ink-subtle">
                {fr
                  ? "Envoyer automatiquement des demandes d'avis après complétion d'un travail"
                  : 'Automatically send review requests after job completion'}
              </Text>
            </View>
            <Switch
              value={!!form.review_enabled}
              onValueChange={(on) => {
                if (on && !(form.google_review_url ?? '').trim()) {
                  Alert.alert('Google Reviews', fr ? "Ajoutez d'abord votre lien Google Review" : 'Add your Google Review URL first');
                  return;
                }
                setForm((f) => ({ ...f, review_enabled: on }));
              }}
              trackColor={{ true: '#171717' }}
            />
          </View>
          {!(form.google_review_url ?? '').trim() ? (
            <View className="rounded-lg px-3 py-2" style={{ backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' }}>
              <Text className="text-xs" style={{ color: '#B45309' }}>
                {fr
                  ? "⚠️ Aucun lien Google Review configuré. Les emails de demande d'avis ne seront pas envoyés."
                  : '⚠️ No Google Review URL configured. Review request emails will not be sent.'}
              </Text>
            </View>
          ) : null}
        </Section>

        {/* Regional */}
        <Section title={fr ? 'Régional' : 'Regional'}>
          <Text className="text-xs font-medium uppercase tracking-wider text-ink-subtle">{fr ? 'Devise' : 'Currency'}</Text>
          <View className="flex-row gap-2">
            {(
              [
                ['CAD', fr ? 'Dollar canadien' : 'Canadian dollar'],
                ['USD', fr ? 'Dollar américain' : 'US dollar'],
              ] as [string, string][]
            ).map(([code, label]) => {
              const on = (form.currency ?? 'CAD') === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => setForm((f) => ({ ...f, currency: code }))}
                  className={`flex-1 items-center rounded-xl border px-3 py-2.5 ${on ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                >
                  <Text className={`text-sm font-semibold ${on ? 'text-white' : 'text-ink'}`}>{code}</Text>
                  <Text className={`text-[10px] ${on ? 'text-white/80' : 'text-ink-subtle'}`}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-xs text-ink-subtle">
            {fr
              ? "Devise utilisée pour l'affichage des montants (aperçu des taxes, etc.)."
              : 'Currency used to display amounts (tax preview, etc.).'}
          </Text>
        </Section>

        <Button title={t.mobileTeam.saveChanges} onPress={() => saveMut.mutate()} loading={saveMut.isPending} />
      </View>
    </ScreenContainer>
  );
}
