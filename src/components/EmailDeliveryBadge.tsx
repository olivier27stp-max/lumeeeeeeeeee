/**
 * EmailDeliveryBadge — « courriel non livré » sur une facture / un devis.
 *
 * Audit QA prod 2026-09-09, n°8 : une facture envoyée à une adresse
 * indélivrable restait « envoyée, en attente de paiement » pour toujours.
 * Le serveur journalise chaque envoi dans email_deliveries et le webhook du
 * fournisseur y écrit les rebonds ; ce badge lit la dernière ligne de
 * l'entité et ne s'affiche que si elle a rebondi (ou est en retard).
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import { useTranslation } from '../i18n';
import { derniereLivraison } from '../lib/emailDeliveriesApi';

export default function EmailDeliveryBadge({ entityType, entityId }: { entityType: 'invoice' | 'quote' | 'agreement'; entityId: string }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const q = useQuery({
    queryKey: ['email-delivery', entityType, entityId],
    queryFn: () => derniereLivraison(entityType, entityId),
    staleTime: 60_000,
  });
  const d = q.data;
  if (!d) return null;
  if (d.status !== 'bounced' && d.status !== 'complained' && d.status !== 'delayed') return null;

  const enRetard = d.status === 'delayed';
  return (
    <div
      className={
        enRetard
          ? 'mt-3 flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
          : 'mt-3 flex items-start gap-2.5 rounded-xl border border-red-300/60 bg-red-50 p-3 text-red-900 dark:bg-red-500/10 dark:text-red-200'
      }
      data-email-delivery={d.status}
    >
      {enRetard ? <Clock size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
      <div className="text-[13px] leading-snug">
        <p className="font-semibold">
          {enRetard
            ? (fr ? 'Courriel en attente de livraison' : 'Email delivery delayed')
            : d.status === 'complained'
              ? (fr ? 'Le destinataire a signalé ce courriel comme pourriel' : 'Recipient marked this email as spam')
              : (fr ? 'Courriel non livré' : 'Email not delivered')}
        </p>
        <p className="opacity-80">
          {d.to_email}
          {d.error ? ` — ${d.error}` : ''}
          {!enRetard && (fr ? '. Vérifiez l’adresse du client, puis renvoyez.' : '. Check the client’s address, then resend.')}
        </p>
      </div>
    </div>
  );
}
