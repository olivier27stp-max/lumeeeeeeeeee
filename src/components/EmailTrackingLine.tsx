/**
 * EmailTrackingLine — « Envoyé le 17 sept. · Vu le 17 sept. à 14 h 12 · Lien cliqué ».
 *
 * Plan courriels pro (2026-09-17) : une ligne discrète sous les actions
 * d'envoi d'une facture / d'une soumission. Le suivi d'ouverture est activé
 * par domaine chez Resend ; ici on lit le dernier envoi (GET
 * /api/email-deliveries) et on l'affiche : livré et vu, « Non livré » en rouge,
 * ou « Pas encore ouvert ». Rien tant qu'aucun courriel n'est parti.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useTranslation } from '../i18n';
import { listerEnvois } from '../lib/emailDeliveriesApi';

export const CLE_REQUETE_ENVOIS = 'email-deliveries';

export default function EmailTrackingLine({ entityType, entityId }: { entityType: 'invoice' | 'quote' | 'agreement'; entityId: string }) {
  const { t, language } = useTranslation();
  const q = useQuery({
    queryKey: [CLE_REQUETE_ENVOIS, entityType, entityId],
    queryFn: () => listerEnvois(entityType, entityId),
    staleTime: 30_000,
  });
  const d = q.data?.[0];
  if (!d) return null;

  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  const jour = (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
  const heure = (iso: string) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const s = t.suiviCourriel;

  const nonLivre = d.status === 'bounced' || d.status === 'complained' || d.status === 'failed';
  const segments: React.ReactNode[] = [<span key="envoye">{`${s.envoyeLe} ${jour(d.created_at)}`}</span>];
  if (nonLivre) {
    segments.push(<span key="non-livre" className="font-semibold text-danger">{d.status === 'complained' ? s.plainte : s.nonLivre}</span>);
  } else if (d.opened_at) {
    segments.push(<span key="vu" className="text-success">{`${s.vuLe} ${jour(d.opened_at)} ${s.a} ${heure(d.opened_at)}${d.open_count > 1 ? ` (${d.open_count}×)` : ''}`}</span>);
    if (d.clicked_at) segments.push(<span key="clic" className="text-success">{s.lienClique}</span>);
  } else {
    segments.push(<span key="pas-ouvert">{s.pasEncoreOuvert}</span>);
  }

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[12px] text-text-tertiary" data-email-tracking={nonLivre ? 'undelivered' : d.opened_at ? 'opened' : 'sent'}>
      <Mail size={12} className="shrink-0" aria-hidden="true" />
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {seg}
        </React.Fragment>
      ))}
    </p>
  );
}
