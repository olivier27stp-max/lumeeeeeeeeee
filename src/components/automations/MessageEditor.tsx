/* ═══════════════════════════════════════════════════════════════
   Éditeur du message d'une automatisation — SMS et courriel.

   35 automatisations écrivent aux clients au nom de l'entreprise, et la page
   Automatisations n'affichait que le TYPE d'action (« Envoyer un courriel »).
   L'utilisateur ne pouvait ni relire ni corriger ce qui partait en son nom :
   les SMS n'étaient modifiables que depuis Réglages → Messagerie, sans aucun
   lien depuis cette page, et les courriels nulle part.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState } from 'react';
import { Mail, MessageSquare, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { updateRuleMessage } from '../../lib/automationRulesApi';

interface Props {
  ruleId: string;
  actionType: 'send_sms' | 'send_email';
  /** Corps actuel : texte brut pour un SMS, HTML pour un courriel. */
  body: string;
  /** Objet du courriel. Absent pour un SMS. */
  subject?: string;
  fr: boolean;
  /** Rechargement de la liste après enregistrement. */
  onSaved: () => void;
}

/** Variables reconnues par le moteur, proposées à l'utilisateur. */
const VARIABLES = [
  'client_first_name',
  'client_name',
  'company_name',
  'invoice_number',
  'invoice_total',
  'quote_number',
  'appointment_date',
  'appointment_time',
];

export default function MessageEditor({ ruleId, actionType, body, subject, fr, onSaved }: Props) {
  const [texte, setTexte] = useState(body);
  const [objet, setObjet] = useState(subject ?? '');
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);

  const estCourriel = actionType === 'send_email';
  const modifie = texte !== body || (estCourriel && objet !== (subject ?? ''));

  const enregistrer = async () => {
    if (!modifie || enregistrement) return;
    setEnregistrement(true);
    try {
      await updateRuleMessage(ruleId, actionType, texte, estCourriel ? objet : undefined);
      setEnregistre(true);
      // Repère visuel bref : l'utilisateur doit voir que c'est parti sans que
      // la coche reste indéfiniment.
      setTimeout(() => setEnregistre(false), 2000);
      onSaved();
      toast.success(fr ? 'Message enregistré' : 'Message saved');
    } catch (e: any) {
      // `updateRuleMessage` lève explicitement quand la RLS filtre la ligne —
      // sans quoi l'utilisateur croirait avoir enregistré.
      toast.error(e?.message || (fr ? 'Enregistrement impossible' : 'Could not save'));
    } finally {
      setEnregistrement(false);
    }
  };

  const insererVariable = (v: string) => {
    setTexte((t) => `${t}[${v}]`);
  };

  return (
    <div className="mt-3 pt-3 border-t border-outline/40" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mb-2">
        {estCourriel ? (
          <Mail size={11} className="text-text-tertiary" />
        ) : (
          <MessageSquare size={11} className="text-text-tertiary" />
        )}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          {estCourriel
            ? (fr ? 'Courriel envoyé au client' : 'Email sent to client')
            : (fr ? 'SMS envoyé au client' : 'SMS sent to client')}
        </p>
      </div>

      {estCourriel && (
        <input
          type="text"
          value={objet}
          onChange={(e) => setObjet(e.target.value)}
          placeholder={fr ? 'Objet du courriel' : 'Email subject'}
          className="w-full mb-2 px-2.5 py-1.5 text-[12px] rounded-md bg-surface border border-outline/60 text-text-primary focus:outline-none focus:border-primary/60"
        />
      )}

      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={estCourriel ? 6 : 3}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-surface border border-outline/60 text-text-primary font-mono leading-relaxed focus:outline-none focus:border-primary/60 resize-y"
      />

      {/* Le SMS est facturé par tranche de 160 caractères : le compteur évite
          les mauvaises surprises sur la facture Twilio. */}
      {!estCourriel && (
        <p className="mt-1 text-[10px] text-text-tertiary">
          {texte.length} {fr ? 'caractères' : 'characters'}
          {texte.length > 160 && (
            <span className="text-amber-600 dark:text-amber-400">
              {' '}· {Math.ceil(texte.length / 160)} SMS
            </span>
          )}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-text-tertiary mr-1">
          {fr ? 'Insérer :' : 'Insert:'}
        </span>
        {VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => insererVariable(v)}
            className="text-[10px] px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
          >
            [{v}]
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={enregistrer}
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
            onClick={() => {
              setTexte(body);
              setObjet(subject ?? '');
            }}
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {fr ? 'Annuler' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}
