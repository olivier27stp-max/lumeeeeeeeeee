/* ═══════════════════════════════════════════════════════════════
   Éditeur du message d'une automatisation — SMS et courriel.

   Le corps des courriels est stocké en HTML : nécessaire pour l'envoi,
   illisible pour qui veut simplement changer « Bonjour ». On édite donc du
   TEXTE, converti en HTML à l'enregistrement, avec un aperçu de ce que le
   client recevra réellement — variables remplacées par un exemple.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useMemo } from 'react';
import { Mail, MessageSquare, Loader2, Check, Eye, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { updateRuleMessage } from '../../lib/automationRulesApi';
import { htmlVersTexte, texteVersHtml, remplacerVariables } from '../../lib/emailBodyText';
import EmailPreviewEditor from './EmailPreviewEditor';

interface Props {
  ruleId: string;
  /** Nom de la règle, affiché en en-tête de l'éditeur de courriel. */
  ruleName: string;
  actionType: 'send_sms' | 'send_email';
  /** Corps actuel : texte brut pour un SMS, HTML pour un courriel. */
  body: string;
  /** Objet du courriel. Absent pour un SMS. */
  subject?: string;
  fr: boolean;
  /** Rechargement de la liste après enregistrement. */
  onSaved: () => void;
}

/** Saut de ligne — nommé pour rester lisible dans les découpes de texte. */
const SAUT = '\n';

/** Variables reconnues par le moteur, avec un libellé compréhensible. */
const VARIABLES: Array<{ cle: string; fr: string; en: string }> = [
  { cle: 'client_first_name', fr: 'Prénom du client', en: 'Client first name' },
  { cle: 'client_name', fr: 'Nom complet', en: 'Full name' },
  { cle: 'company_name', fr: 'Votre entreprise', en: 'Your company' },
  { cle: 'invoice_number', fr: 'N° de facture', en: 'Invoice #' },
  { cle: 'invoice_total', fr: 'Montant', en: 'Amount' },
  { cle: 'quote_number', fr: 'N° de soumission', en: 'Quote #' },
  { cle: 'appointment_date', fr: 'Date du RDV', en: 'Appointment date' },
  { cle: 'appointment_time', fr: 'Heure du RDV', en: 'Appointment time' },
];

export default function MessageEditor({ ruleId, ruleName, actionType, body, subject, fr, onSaved }: Props) {
  const estCourriel = actionType === 'send_email';

  // ── Courriel : aperçu compact + ouverture de l'éditeur pleine page ──
  //
  // Éditer un courriel dans une bande étroite obligeait à lire du HTML ou à
  // taper dans un champ minuscule. Le courriel s'ouvre donc dans sa propre
  // fenêtre, où il s'affiche comme le client le recevra.
  const [editeurOuvert, setEditeurOuvert] = useState(false);

  // ── SMS : édition directe, le texte est déjà lisible ──
  const [texte, setTexte] = useState(body);
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const modifie = texte !== body;

  /** Lignes du courriel, variables remplacées — pour l'aperçu compact. */
  const lignesApercu = useMemo(
    () => (estCourriel ? remplacerVariables(htmlVersTexte(body)).split(SAUT) : []),
    [body, estCourriel],
  );

  const enregistrerSms = async () => {
    if (!modifie || enregistrement) return;
    setEnregistrement(true);
    try {
      await updateRuleMessage(ruleId, 'send_sms', texte);
      setEnregistre(true);
      setTimeout(() => setEnregistre(false), 1800);
      onSaved();
      toast.success(fr ? 'Message enregistré' : 'Message saved');
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Enregistrement impossible' : 'Could not save'));
    } finally {
      setEnregistrement(false);
    }
  };

  if (estCourriel) {
    return (
      <div className="mt-3 pt-3 border-t border-outline/40" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <Mail size={11} className="text-text-tertiary" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {fr ? 'Courriel envoyé au client' : 'Email sent to client'}
            </p>
          </div>
          <button
            onClick={() => setEditeurOuvert(true)}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-primary text-white hover:bg-primary/90 transition-colors font-semibold"
          >
            <Pencil size={10} /> {fr ? 'Modifier' : 'Edit'}
          </button>
        </div>

        {/* Aperçu compact : les premières lignes suffisent à reconnaître le
            message ; le détail se voit dans l'éditeur. */}
        <div className="rounded-md border border-outline/50 bg-surface p-3">
          {subject && (
            <p className="text-[12px] font-semibold text-text-primary pb-1.5 mb-1.5 border-b border-outline/40">
              {remplacerVariables(subject)}
            </p>
          )}
          {lignesApercu.slice(0, 3).map((ligne, i) => (
            <p key={i} className="text-[12px] text-text-secondary leading-relaxed truncate">
              {ligne}
            </p>
          ))}
          {lignesApercu.length > 3 && (
            <p className="text-[11px] text-text-tertiary mt-1">…</p>
          )}
        </div>

        {editeurOuvert && (
          <EmailPreviewEditor
            ruleId={ruleId}
            ruleName={ruleName}
            body={body}
            subject={subject ?? ''}
            fr={fr}
            onClose={() => setEditeurOuvert(false)}
            onSaved={onSaved}
          />
        )}
      </div>
    );
  }

  // ── SMS ──
  return (
    <div className="mt-3 pt-3 border-t border-outline/40" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mb-2">
        <MessageSquare size={11} className="text-text-tertiary" />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          {fr ? 'SMS envoyé au client' : 'SMS sent to client'}
        </p>
      </div>

      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={3}
        className="w-full px-2.5 py-2 text-[12px] rounded-md bg-surface border border-outline/60 text-text-primary leading-relaxed focus:outline-none focus:border-primary/60 resize-y"
      />

      {/* Twilio facture par tranche de 160 caractères : sans compteur, un texte
          rallongé double la facture sans que personne ne le voie. */}
      <p className="mt-1 text-[10px] text-text-tertiary">
        {texte.length} {fr ? 'caractères' : 'characters'}
        {texte.length > 160 && (
          <span className="text-amber-600 dark:text-amber-400">
            {' '}· {Math.ceil(texte.length / 160)} SMS
          </span>
        )}
      </p>

      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        <Eye size={10} className="text-text-tertiary" />
        <span className="text-[10px] text-text-tertiary">
          {fr ? 'Le client lira :' : 'The client will read:'}
        </span>
        <span className="text-[11px] text-text-secondary italic">
          {remplacerVariables(texte) || '—'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-text-tertiary mr-1">
          {fr ? 'Insérer :' : 'Insert:'}
        </span>
        {VARIABLES.map((v) => (
          <button
            key={v.cle}
            type="button"
            title={`[${v.cle}]`}
            onClick={() => setTexte((t) => `${t}[${v.cle}]`)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
          >
            {fr ? v.fr : v.en}
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={enregistrerSms}
          disabled={!modifie || enregistrement}
          className={cn(
            'px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5',
            modifie && !enregistrement
              ? 'bg-primary text-white hover:bg-primary/90'
              : 'bg-surface-tertiary text-text-tertiary cursor-not-allowed',
          )}
        >
          {enregistrement && <Loader2 size={11} className="animate-spin" />}
          {enregistre && !enregistrement && <Check size={11} />}
          {fr ? 'Enregistrer' : 'Save'}
        </button>
        {modifie && (
          <button
            type="button"
            onClick={() => setTexte(body)}
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {fr ? 'Annuler' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}
