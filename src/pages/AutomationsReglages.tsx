/* ═══════════════════════════════════════════════════════════════
   Réglages globaux des automatisations — l'écran « Global Workflow
   Settings » de GoHighLevel.

   CE QUI EST BRANCHÉ ET CE QUI NE L'EST PAS. La langue des messages est un
   vrai réglage (`company_settings.default_language`), lu et écrit. Les
   autres cartes reprennent la structure de GHL et disent franchement quand
   le comportement est déjà en place sans être réglable — plutôt que
   d'afficher un interrupteur qui ne ferait rien.

   Deux cartes de GHL sont volontairement absentes, faute d'équivalent :
   « Workflow Pro Plans » (upsell d'agence) et « Constructeur par défaut »
   (Standard / Avancé — Lume n'a qu'un seul constructeur).
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import PermissionGate from '../components/PermissionGate';
import { getAutomationLanguage } from '../lib/automationRulesApi';

/** Une carte de réglage, avec son titre, son explication et son contenu. */
function Carte({
  titre, aide, children,
}: { titre: string; aide: string; children?: React.ReactNode }) {
  return (
    <section className="section-card p-4">
      <h2 className="text-[14px] font-semibold text-text-primary">{titre}</h2>
      <p className="mt-0.5 text-[12px] text-text-secondary">{aide}</p>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

/** Ce qui est déjà vrai dans le moteur, sans être réglable. */
function DejaEnPlace({ texte }: { texte: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-[12px] text-text-secondary">
      <Info size={13} className="mt-0.5 shrink-0 text-text-tertiary" aria-hidden="true" />
      <span>{texte}</span>
    </p>
  );
}

export default function AutomationsReglages() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();

  const [orgLang, setOrgLang] = useState<'fr' | 'en'>('fr');
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    getAutomationLanguage()
      .then(setOrgLang)
      .catch(() => {})
      .finally(() => setChargement(false));
  }, []);


  return (
    <PermissionGate permission="automations.update">
      <div className="mx-auto max-w-[900px] space-y-4">

        {/* Sous-navigation */}
        <div className="flex flex-wrap items-center gap-5 border-b border-border">
          <span className="pb-3 text-[15px] font-semibold text-text-primary">
            {fr ? 'Automatisation' : 'Automation'}
          </span>
          <nav className="flex items-center gap-1" aria-label={fr ? 'Sections' : 'Sections'}>
            <button
              type="button"
              onClick={() => navigate('/automations')}
              className="border-b-2 border-transparent px-3 pb-3 pt-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {fr ? 'Automatisations' : 'Workflows'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/automations/apercu')}
              className="border-b-2 border-transparent px-3 pb-3 pt-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {fr ? 'Vue d’ensemble' : 'Overview'}
            </button>
            <span className="inline-flex items-center gap-1.5 border-b-2 border-primary px-3 pb-3 pt-1 text-[13px] font-semibold text-primary">
              <Settings size={13} aria-hidden="true" />
              {fr ? 'Réglages globaux' : 'Global settings'}
            </span>
          </nav>
        </div>

        <h1 className="text-[22px] font-bold tracking-tight text-text-primary">
          {fr ? 'Réglages globaux' : 'Global workflow settings'}
        </h1>

        {chargement ? (
          <div className="section-card flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : (
          <>
            {/* Langue — un vrai réglage, lu et écrit */}
            <Carte
              titre={fr ? 'Langue des messages' : 'Message language'}
              aide={fr
                ? 'Celle que vos clients reçoivent, définie une fois pour toute l’entreprise dans Paramètres → Paramètres entreprise. Les automatisations la suivent.'
                : 'The one your clients receive, set once for the whole company in Settings → Company. Automations follow it.'}
            >
              {/* Le réglage VIT dans Paramètres → Langue : il décide aussi
                  de la langue des factures, des soumissions et des pages
                  publiques, pas seulement des automatisations. Le dupliquer
                  ici donnerait deux endroits où le changer, et un jour deux
                  réponses différentes. On montre ce qui est en vigueur, et
                  on emmène au bon endroit pour le changer. */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-lg border border-outline/50 px-3 py-1.5 text-[13px] font-medium text-text-primary">
                  {orgLang === 'fr' ? 'Français' : 'English'}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/settings/company')}
                  className="text-[13px] font-medium text-accent underline underline-offset-2 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {fr ? 'Changer dans les réglages' : 'Change it in settings'}
                </button>
              </div>
            </Carte>

            {/* Notifications d'erreur */}
            <Carte
              titre={fr ? 'Notifications' : 'Notifications'}
              aide={fr
                ? 'Qui est prévenu quand une automatisation n’arrive pas à envoyer un message.'
                : 'Who gets told when an automation fails to send a message.'}
            >
              <DejaEnPlace texte={fr
                ? 'Déjà en place : chaque échec définitif crée une notification dans Lume, avec la raison en clair (« ce client n’a pas de numéro », « désabonné »…). Le choix de destinataires supplémentaires arrivera ici.'
                : 'Already in place: every permanent failure creates a notification in Lume, with the reason in plain words. Choosing extra recipients will come here.'}
              />
            </Carte>

            {/* Enregistrement automatique */}
            <Carte
              titre={fr ? 'Enregistrement automatique' : 'Auto save'}
              aide={fr
                ? 'Enregistre les changements pendant que vous modifiez un brouillon, sans avoir à cliquer.'
                : 'Saves changes while you edit a draft, with no need to click.'}
            >
              <DejaEnPlace texte={fr
                ? 'Déjà actif : l’éditeur enregistre une seconde après votre dernière frappe, et l’indique en haut à droite (« Enregistré »).'
                : 'Already on: the editor saves one second after your last keystroke, and says so at the top right (“Saved”).'}
              />
            </Carte>

            {/* Mise en pause */}
            <Carte
              titre={fr ? 'Mettre en pause' : 'Pause workflows'}
              aide={fr
                ? 'Suspendre temporairement des automatisations sur une période donnée — vacances de la construction, fermeture d’hiver.'
                : 'Temporarily pause selected workflows over a date range.'}
            >
              <DejaEnPlace texte={fr
                ? 'En attendant, chaque automatisation se met en pause individuellement depuis la liste (interrupteur « Publiée / Brouillon »). Les plages de dates arriveront ici.'
                : 'For now, each automation pauses individually from the list. Date ranges will come here.'}
              />
            </Carte>

            {/* Fenêtre d'envoi — comportement en dur, dit franchement */}
            <Carte
              titre={fr ? 'Fenêtre d’envoi' : 'Send window'}
              aide={fr
                ? 'Les heures pendant lesquelles un message automatique peut partir chez un client.'
                : 'The hours during which an automated message may reach a client.'}
            >
              <DejaEnPlace texte={fr
                ? 'Aucun texto n’est envoyé entre 20 h et 8 h, heure du Québec : un message prêt en dehors de cette plage attend le matin. Ce n’est pas encore réglable.'
                : 'No text is sent between 8 p.m. and 8 a.m. Québec time: a message ready outside that window waits for morning. Not adjustable yet.'}
              />
            </Carte>

            {/* Lumi */}
            <Carte
              titre={fr ? 'Lumi' : 'Workflow AI'}
              aide={fr
                ? 'Décrire une automatisation en français et laisser Lumi la construire.'
                : 'Describe an automation in plain words and let Lumi build it.'}
            >
              <DejaEnPlace texte={fr
                ? 'Le champ de description est déjà dans l’éditeur, sur un parcours vide. La génération par Lumi arrive.'
                : 'The description field is already in the editor, on an empty path. Generation by Lumi is coming.'}
              />
            </Carte>
          </>
        )}
      </div>
    </PermissionGate>
  );
}
