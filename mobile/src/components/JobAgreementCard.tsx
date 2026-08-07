import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { SignaturePad } from '@/components/SignaturePad';
import {
  createJobAgreement,
  getJobAgreement,
  signJobAgreement,
} from '@/lib/api/jobAgreements';
import { useTranslation } from '@/lib/i18n';

/** L'entente de travail d'un job : accès à la propriété, garantie de 7 jours,
 *  annulation, responsabilité. Le web la crée depuis la fiche du job et
 *  l'envoie au client; le mobile la fait en plus signer sur place. */
export function JobAgreementCard({
  jobId,
  orgId,
  clientId,
}: {
  jobId: string;
  orgId: string;
  clientId?: string | null;
}) {
  const { t, language } = useTranslation();
  const a = t.mobileAgreement;
  const qc = useQueryClient();
  const [padOuvert, setPadOuvert] = useState(false);
  const [nomSignataire, setNomSignataire] = useState('');

  const { data: entente, isLoading } = useQuery({
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

  const signer = useMutation({
    mutationFn: (base64: string) => signJobAgreement(entente!.id, nomSignataire, base64),
    onSuccess: () => {
      setPadOuvert(false);
      setNomSignataire('');
      qc.invalidateQueries({ queryKey: ['job-agreement', jobId] });
    },
    onError: (e: Error) => Alert.alert(a.title, e.message),
  });

  const libelleStatut =
    entente?.status === 'signed' ? a.statusSigned
      : entente?.status === 'sent' ? a.statusSent
      : a.statusDraft;

  return (
    <Card className="gap-3">
      <View>
        <Text className="text-sm font-bold text-ink">{a.title}</Text>
        <Text className="pt-0.5 text-xs text-ink-muted">{a.hint}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator />
      ) : !entente ? (
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
              className={`rounded-full px-2.5 py-1 ${entente.status === 'signed' ? 'bg-emerald-100' : 'bg-surface-sunken'}`}
            >
              <Text
                className={`text-[11px] font-bold uppercase ${entente.status === 'signed' ? 'text-emerald-700' : 'text-ink-muted'}`}
              >
                {libelleStatut}
              </Text>
            </View>
            {entente.signer_name ? (
              <Text className="flex-1 text-xs text-ink-muted" numberOfLines={1}>
                {a.signedBy.replace('{name}', entente.signer_name)}
              </Text>
            ) : null}
          </View>

          <Text className="text-xs leading-5 text-ink-muted">{entente.terms}</Text>

          {entente.status !== 'signed' ? (
            <>
              <TextInput
                value={nomSignataire}
                onChangeText={setNomSignataire}
                placeholder={a.signerPlaceholder}
                className="rounded-xl border border-surface-border bg-white px-3 py-2 text-sm text-ink"
              />
              <Pressable
                onPress={() => setPadOuvert(true)}
                disabled={!nomSignataire.trim() || signer.isPending}
                className={`items-center rounded-xl py-2.5 ${nomSignataire.trim() ? 'bg-ink' : 'bg-surface-sunken'}`}
              >
                <Text
                  className={`text-sm font-semibold ${nomSignataire.trim() ? 'text-white' : 'text-ink-subtle'}`}
                >
                  {signer.isPending ? a.saving : a.sign}
                </Text>
              </Pressable>
            </>
          ) : null}
        </>
      )}

      <SignaturePad
        visible={padOuvert}
        onClose={() => setPadOuvert(false)}
        onSave={(base64) => signer.mutate(base64)}
      />
    </Card>
  );
}
