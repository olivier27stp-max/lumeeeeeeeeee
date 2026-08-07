import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { createJobAgreement, getJobAgreement } from '@/lib/api/jobAgreements';
import { sendAgreementEmailViaServer, sendAgreementSmsViaServer } from '@/lib/api/server';
import { useTranslation } from '@/lib/i18n';

/** Le contrat écrit lié à une job : accès à la propriété, garantie de 7 jours,
 *  annulation, responsabilité.
 *
 *  Même flux que le web (JobDetails) : on crée le contrat, on l'envoie au
 *  client par courriel ou par SMS, et le client le signe sur sa page publique
 *  /contract/:token. Pas de signature sur l'appareil — le web n'en a pas. */
export function JobAgreementCard({
  jobId,
  orgId,
  clientId,
  jobNumber,
}: {
  jobId: string;
  orgId: string;
  clientId?: string | null;
  jobNumber?: string | null;
}) {
  const { t, language } = useTranslation();
  const a = t.mobileAgreement;
  const qc = useQueryClient();
  // Les conditions font cinq paragraphes : repliées par défaut, sinon elles
  // écrasent le reste du panneau. Le web les met derrière un aperçu.
  const [conditionsOuvertes, setConditionsOuvertes] = useState(false);

  const { data: contrat, isLoading } = useQuery({
    queryKey: ['job-agreement', jobId],
    queryFn: () => getJobAgreement(jobId),
    enabled: !!jobId,
  });

  const creer = useMutation({
    mutationFn: () =>
      createJobAgreement({
        orgId,
        jobId,
        clientId: clientId ?? null,
        language: language === 'fr' ? 'fr' : 'en',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-agreement', jobId] }),
    onError: (e: Error) => Alert.alert(a.title, e.message),
  });

  const envoyer = useMutation({
    mutationFn: async (canal: 'email' | 'sms') => {
      if (!contrat) return;
      if (canal === 'email') await sendAgreementEmailViaServer(contrat.id);
      else await sendAgreementSmsViaServer(contrat.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-agreement', jobId] }),
    onError: (e: Error) => Alert.alert(a.title, e.message),
  });

  const libelleStatut =
    contrat?.status === 'signed' ? a.statusSigned
      : contrat?.status === 'sent' ? a.statusSent
      : a.statusDraft;

  return (
    <Card className="gap-3">
      <View>
        {/* « Contrat · CTR-123 », comme l'en-tête du web */}
        <Text className="text-sm font-bold text-ink">
          {a.title}{jobNumber ? ` · CTR-${jobNumber}` : ''}
        </Text>
        <Text className="pt-0.5 text-xs text-ink-muted">{a.hint}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator />
      ) : !contrat ? (
        <>
          <Text className="text-xs text-ink-subtle">{a.none}</Text>
          <Pressable
            onPress={() => creer.mutate()}
            disabled={creer.isPending}
            className="items-center rounded-xl bg-ink py-2.5"
          >
            <Text className="text-sm font-semibold text-white">
              {creer.isPending ? a.saving : a.create}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <View className="flex-row items-center gap-2">
            <View
              className={`rounded-full px-2.5 py-1 ${contrat.status === 'signed' ? 'bg-emerald-100' : 'bg-surface-sunken'}`}
            >
              <Text
                className={`text-[11px] font-bold uppercase ${contrat.status === 'signed' ? 'text-emerald-700' : 'text-ink-muted'}`}
              >
                {libelleStatut}
              </Text>
            </View>
            {contrat.signer_name ? (
              <Text className="flex-1 text-xs text-ink-muted" numberOfLines={1}>
                {a.signedBy.replace('{name}', contrat.signer_name)}
              </Text>
            ) : null}
          </View>

          <Pressable onPress={() => setConditionsOuvertes((v) => !v)} hitSlop={6}>
            <Text className="text-xs font-semibold text-ink-muted">
              {conditionsOuvertes ? a.hideTerms : a.viewTerms} {conditionsOuvertes ? '▴' : '▾'}
            </Text>
          </Pressable>
          {conditionsOuvertes ? (
            <Text className="text-xs leading-5 text-ink-muted">{contrat.terms}</Text>
          ) : null}

          {contrat.status !== 'signed' ? (
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => envoyer.mutate('email')}
                disabled={envoyer.isPending}
                className="flex-1 items-center rounded-xl bg-ink py-2.5"
              >
                <Text className="text-sm font-semibold text-white">
                  {envoyer.isPending ? a.saving : a.sendEmail}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => envoyer.mutate('sms')}
                disabled={envoyer.isPending}
                className="flex-1 items-center rounded-xl border border-surface-border bg-white py-2.5"
              >
                <Text className="text-sm font-semibold text-ink">{a.sendSms}</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}
