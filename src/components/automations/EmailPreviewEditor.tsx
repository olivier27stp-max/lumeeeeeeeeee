/* ═══════════════════════════════════════════════════════════════
   Édition d'un courriel d'automatisation, directement dans son aperçu.

   Le corps est stocké en HTML. Le montrer tel quel — `<div
   style="font-family:sans-serif;max-width:600px;...">` — est illisible pour
   qui veut simplement changer une phrase.

   Ici, le courriel s'affiche comme le client le recevra, et chaque bloc de
   texte est modifiable sur place : on clique sur la phrase, on la corrige.
   Aucune balise n'est jamais visible.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { X, Loader2, Check, Plus, Trash2, Type, List } from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { updateRuleMessage, getCompanyBranding } from '../../lib/automationRulesApi';
import { htmlVersTexte, texteVersHtml, remplacerVariables, VARIABLES_PROPOSEES } from '../../lib/emailBodyText';
import { variablesPour, VARIABLES_PAR_TYPE } from '../../lib/variablesCourriel';
import { apercuCourriel, envoyerEssaiCourriel } from '../../lib/emailTemplatesApi';

interface Props {
  /** Règle d'automatisation visée. Absent quand `enregistrerTexte` est fourni. */
  ruleId?: string;
  ruleName: string;
  /** Corps HTML actuel. */
  body: string;
  subject: string;
  fr: boolean;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Où va le texte une fois écrit. Par défaut dans la règle d'automatisation
   * désignée par `ruleId` ; la page « Modèles de courriel » l'envoie plutôt
   * dans `email_templates`. Le même éditeur sert ainsi aux 35 courriels, au
   * lieu d'en écrire un second qui divergerait au premier correctif.
   */
  enregistrerTexte?: (corpsHtml: string, objet: string) => Promise<void>;
  /**
   * Le poste visé (`invoice_sent`, `quote_sent`…), qui décide des variables
   * offertes : le serveur ne remplit pas les mêmes selon l'envoi. Absent pour
   * une automatisation, qui garde la liste générique.
   */
  typeCourriel?: string;
  /**
   * Rendre à ce courriel son texte d'origine. Absent quand l'entreprise n'a
   * rien écrit : il n'y a alors rien à défaire.
   *
   * Cette action vivait dans la LISTE, en bouton-icône sans étiquette, à côté
   * de « modifier » et d'« importer du HTML ». Trois icônes muettes par ligne,
   * dont une destructrice. Elle appartient ici : on défait un texte en le
   * regardant, pas depuis un index.
   */
  revenirAuDefaut?: () => Promise<void> | void;
  /**
   * Remplacer le corps par un HTML importé. Porte d'expert : elle était offerte
   * au même rang que « modifier le texte », alors que presque personne n'a de
   * HTML à coller. Reléguée dans l'éditeur, discrète.
   */
  importerHtml?: () => void;
}

/** Un bloc du courriel : titre, paragraphe ou puce. */
interface Bloc {
  id: number;
  type: 'titre' | 'paragraphe' | 'puce';
  texte: string;
}

/**
 * Identité de l'entreprise, pour montrer le courriel tel qu'il partira.
 *
 * Le serveur enveloppe chaque envoi dans `buildEmailLayout` — logo, en-tête,
 * pied de page avec téléphone et numéros de taxes — exactement comme pour une
 * facture ou un devis. L'éditeur doit le refléter, sinon on écrit un message
 * « nu » sans voir qu'il arrivera habillé.
 */
interface Entreprise {
  company_name?: string | null;
  company_logo_url?: string | null;
  company_phone?: string | null;
  company_email?: string | null;
}

/* Toutes les clés que Lume connaît, tous postes confondus. Sert à repérer
   celle qui existe AILLEURS : « [quote_number] » dans une facture a l'air
   juste, mais le serveur ne la remplit pas là et elle partirait en blanc. */
const TOUTES_LES_CLES = new Set(
  Object.values(VARIABLES_PAR_TYPE).flat().map((v) => v.cle),
);

let compteurId = 0;

/**
 * Champ d'un bloc, auto-dimensionné à son contenu.
 *
 * Déclaré au niveau module, pas dans le composant parent : React recrée un
 * composant défini à l'intérieur d'un rendu à CHAQUE frappe, ce qui démonte le
 * champ et lui fait perdre le focus au milieu d'une phrase.
 */
function ChampBloc({
  bloc, fr, onChange, onFocus,
}: {
  bloc: Bloc;
  fr: boolean;
  onChange: (texte: string) => void;
  onFocus: () => void;
}) {
  const ajuster = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <textarea
      value={bloc.texte}
      onChange={(e) => { onChange(e.target.value); ajuster(e.currentTarget); }}
      onFocus={onFocus}
      rows={1}
      placeholder={fr ? 'Écrivez ici…' : 'Type here…'}
      aria-label={bloc.type === 'titre' ? (fr ? 'Titre' : 'Title') : bloc.type === 'puce' ? (fr ? 'Puce' : 'Bullet') : (fr ? 'Paragraphe' : 'Paragraph')}
      className={cn(
        'w-full bg-transparent border border-transparent rounded px-2 py-1 resize-none overflow-hidden',
        'hover:border-outline/40 focus:border-primary/60 focus:bg-surface focus:outline-none transition-colors',
        bloc.type === 'titre'
          ? 'text-[17px] font-semibold text-text-primary'
          : 'text-[13px] text-text-secondary leading-relaxed',
      )}
      style={{ minHeight: bloc.type === 'titre' ? 30 : 26 }}
      ref={ajuster}
    />
  );
}

/** Découpe le texte converti en blocs manipulables. */
function texteEnBlocs(texte: string): Bloc[] {
  const lignes = texte.split('\n').filter((l) => l.trim());
  return lignes.map((ligne, i) => ({
    id: compteurId++,
    type: ligne.startsWith('- ') ? 'puce' : i === 0 ? 'titre' : 'paragraphe',
    texte: ligne.startsWith('- ') ? ligne.slice(2) : ligne,
  }));
}

function blocsEnTexte(blocs: Bloc[]): string {
  return blocs
    .map((b) => (b.type === 'puce' ? `- ${b.texte}` : b.texte))
    .join('\n');
}

export default function EmailPreviewEditor({
  ruleId, ruleName, body, subject, fr, onClose, onSaved, enregistrerTexte, typeCourriel,
  revenirAuDefaut,
  importerHtml,
}: Props) {
  const [blocs, setBlocs] = useState<Bloc[]>(() => texteEnBlocs(htmlVersTexte(body)));
  const [objet, setObjet] = useState(subject);
  const [actif, setActif] = useState<number | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [entreprise, setEntreprise] = useState<Entreprise>({});
  /** Objet ou corps : où la prochaine variable insérée doit atterrir. */
  const [cibleObjet, setCibleObjet] = useState(false);

  /* L'aperçu RÉEL, rendu par le serveur.

     Le bloc modifiable ci-dessous reste : on corrige une phrase en cliquant
     dessus, c'est tout l'intérêt de cet éditeur. Mais il ne DESSINE plus le
     décor — fond, logo, pied — qu'il inventait en React avec les couleurs en
     dur. Deux rendus pour une même chose, donc deux vérités : le jour où le
     gabarit serveur est passé du ciel au gris neutre, l'aperçu a continué de
     montrer un décor que plus personne ne recevait.

     L'onglet « Aperçu réel » affiche ce que le serveur enverrait, dans une
     iframe. `null` = le serveur n'a pas répondu : on reste sur l'éditeur
     plutôt que de bloquer l'écriture pour une image. */
  const [ongletApercu, setOngletApercu] = useState(false);
  const [htmlReel, setHtmlReel] = useState<string | null>(null);
  const [chargementApercu, setChargementApercu] = useState(false);
  const [essaiEnCours, setEssaiEnCours] = useState(false);

  /* S'envoyer le courriel, pour le voir dans une vraie boîte. L'aperçu montre
     le bon rendu, mais il ne dit pas comment Gmail coupe l'objet, ni à quoi
     ressemble le courriel sur un téléphone. */
  const envoyerEssai = async () => {
    setEssaiEnCours(true);
    try {
      const adresse = await envoyerEssaiCourriel(texteVersHtml(blocsEnTexte(blocs)), objet, typeCourriel);
      if (adresse) toast.success(fr ? `Essai envoyé à ${adresse}` : `Test sent to ${adresse}`);
      else toast.error(fr ? 'Envoi impossible' : 'Could not send');
    } finally {
      setEssaiEnCours(false);
    }
  };

  useEffect(() => {
    if (!ongletApercu) return;
    let vivant = true;
    setChargementApercu(true);
    void apercuCourriel(texteVersHtml(blocsEnTexte(blocs)), typeCourriel)
      .then((h) => { if (vivant) setHtmlReel(h); })
      .finally(() => { if (vivant) setChargementApercu(false); });
    return () => { vivant = false; };
    // Volontairement recalculé à chaque bascule vers l'onglet : l'aperçu doit
    // refléter le texte au moment où on le regarde, pas celui de l'ouverture.
  }, [ongletApercu, blocs]);

  /* Les variables offertes. Pour un modèle, celles que le serveur remplit
     VRAIMENT pour ce poste : proposer `{invoice_total}` sur une soumission
     laisserait un trou dans le courriel reçu par le client. Pour une
     automatisation (`typeCourriel` absent), la liste générique d'avant. */
  const variables = typeCourriel
    ? variablesPour(typeCourriel).map((v) => ({ cle: v.cle, fr: v.fr, en: v.en }))
    : VARIABLES_PROPOSEES;

  /* Les variables ÉCRITES qui n'existent pas.

     Deux façons de se tromper, et aucune ne se voyait :

       [invoice_numbr]  une lettre en moins → le serveur remplace par du VIDE.
                        Le client reçoit « Facture  » : un trou, pas un crochet.
       [montant_dû]     un accent, un tiret ou une espace dans la clé → le
                        serveur ne reconnaît RIEN (`applyTemplate` utilise
                        `\w`) et le crochet part tel quel chez le client.

     Le second cas est le piège francophone : écrire `[montant_dû]` est
     naturel, et c'est précisément ce qui casse.

     On ne peut pas effacer tous les crochets à l'envoi — « Rabais [50 %] »
     est un texte légitime. La seule bonne place pour attraper ça, c'est ici,
     pendant qu'on écrit. */
  const inconnues = useMemo(() => {
    const connues = new Set(variables.map((v) => v.cle));
    const vues = new Set<string>();
    const texte = `${objet} ${blocsEnTexte(blocs)}`;
    // La clé peut contenir n'importe quoi sauf le crochet fermant : c'est
    // ainsi qu'on attrape `[client-name]` et `[montant_dû]`, que le serveur
    // ne reconnaîtrait pas.
    for (const m of texte.matchAll(/[[{]([^\]}]{1,40})[\]}]/g)) {
      const cle = m[1].trim();
      /* Un crochet de texte courant n'est pas une variable ratée, et crier
         dessus apprendrait vite à ignorer l'avertissement — ce qui le rendrait
         inutile le jour où il a raison.

         Distinguer « [50 %] » de « [invoice_numbr] » par la forme seule est
         fragile : « [ci-dessous] » ressemble à une clé, « [client name] » n'y
         ressemble pas. On compare donc à ce qui EXISTE : on ne signale que ce
         qui est proche d'une variable connue (une lettre en trop, en moins ou
         changée, ou la même clé écrite autrement). Le reste est du texte, et
         on se tait. */
      if (connues.has(cle)) continue;
      /* Une variable d'un AUTRE poste : elle existe quelque part, donc elle a
         l'air juste — mais le serveur ne la remplit pas ici, et elle partirait
         en blanc. C'est le cas le plus sournois : rien dans le mot ne cloche. */
      if (TOUTES_LES_CLES.has(cle)) { vues.add(cle); continue; }
      const nu = (x: string) => x.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
      const cleNue = nu(cle);
      const ressemble = [...connues].some((k) => {
        const kn = nu(k);
        if (kn === cleNue) return true;                       // même clé, autre écriture
        if (Math.abs(kn.length - cleNue.length) > 3) return false;
        /* Un préfixe commun long : « invoice_amont » et « invoice_amount »
           partagent « invoice_am », soit assez pour dire que l'un visait
           l'autre. Le seuil est haut (7 caractères ou les trois quarts) pour
           que deux mots français courants ne se ressemblent pas par hasard. */
        let commun = 0;
        while (commun < kn.length && commun < cleNue.length && kn[commun] === cleNue[commun]) commun++;
        return commun >= Math.min(7, Math.ceil(Math.max(kn.length, cleNue.length) * 0.75));
      });
      if (!ressemble) continue;
      if (!connues.has(cle)) vues.add(cle);
    }
    return [...vues];
  }, [objet, blocs, variables]);

  // L'en-tête et le pied de page sont ajoutés par le SERVEUR à l'envoi
  // (`buildEmailLayout`), comme pour une facture ou un devis. Les afficher ici
  // évite d'écrire un message « nu » sans voir qu'il arrivera habillé — et de
  // répéter le nom de l'entreprise déjà présent dans le pied de page.
  useEffect(() => {
    getCompanyBranding()
      .then(setEntreprise)
      .catch(() => { /* aperçu sans logo : pas bloquant */ });
  }, []);

  const initial = useMemo(() => ({ blocs: blocsEnTexte(texteEnBlocs(htmlVersTexte(body))), objet: subject }), [body, subject]);
  const modifie = blocsEnTexte(blocs) !== initial.blocs || objet !== initial.objet;

  /**
   * Ferme la fenêtre, en demandant confirmation si du travail serait perdu.
   *
   * Les quatre chemins de fermeture — Échap, la croix, le bouton Fermer, un
   * clic sur le fond — passent par ici. Sans cette garde, un clic à côté
   * effaçait un courriel réécrit sans le moindre avertissement.
   */
  const fermer = useCallback(async () => {
    if (modifie) {
      const question = fr
        ? 'Vos modifications ne sont pas enregistrées. Fermer quand même ?'
        : 'Your changes are not saved. Close anyway?';
      if (!(await confirmer({ message: question, danger: true }))) return;
    }
    onClose();
  }, [modifie, fr, onClose]);

  // Échap ferme la fenêtre — réflexe attendu d'une fenêtre superposée.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void fermer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fermer]);

  const majBloc = (id: number, texte: string) =>
    setBlocs((bs) => bs.map((b) => (b.id === id ? { ...b, texte } : b)));

  /**
   * Supprime un bloc, en offrant de le rétablir.
   *
   * Le bouton de suppression est proche du texte : un clic malheureux faisait
   * disparaître un paragraphe sans recours, et rien ne permettait d'annuler.
   */
  const supprimerBloc = (id: number) => {
    const bloc = blocs.find((b) => b.id === id);
    const position = blocs.findIndex((b) => b.id === id);
    if (!bloc) return;

    setBlocs((bs) => bs.filter((b) => b.id !== id));

    // Rien à rétablir si la ligne était vide.
    if (!bloc.texte.trim()) return;
    toast(fr ? 'Ligne supprimée' : 'Line removed', {
      action: {
        label: fr ? 'Annuler' : 'Undo',
        onClick: () => setBlocs((bs) => {
          const copie = [...bs];
          copie.splice(Math.min(position, copie.length), 0, bloc);
          return copie;
        }),
      },
    });
  };

  const ajouterBloc = (type: Bloc['type']) =>
    setBlocs((bs) => [...bs, { id: compteurId++, type, texte: '' }]);

  const insererVariable = (cle: string) => {
    // L'objet décide de l'ouverture : il doit pouvoir porter le montant ou le
    // numéro, pas seulement le corps.
    if (cibleObjet) {
      setObjet((o) => `${o}[${cle}]`);
      return;
    }
    const cible = actif ?? blocs[blocs.length - 1]?.id;
    if (cible === undefined) return;
    setBlocs((bs) => bs.map((b) => (b.id === cible ? { ...b, texte: `${b.texte}[${cle}]` } : b)));
  };

  const enregistrer = async () => {
    if (!modifie || enregistrement) return;
    setEnregistrement(true);
    try {
      // Le HTML n'est reconstruit qu'ici : l'utilisateur ne l'a jamais vu.
      const corpsHtml = texteVersHtml(blocsEnTexte(blocs));
      if (enregistrerTexte) {
        await enregistrerTexte(corpsHtml, objet);
      } else if (ruleId) {
        await updateRuleMessage(ruleId, 'send_email', corpsHtml, objet);
      } else {
        // Ni destination injectée, ni règle : rien n'aurait été écrit, et
        // l'utilisateur aurait vu « enregistré » pour du travail perdu.
        throw new Error(fr ? 'Aucune destination d’enregistrement' : 'No save destination');
      }
      setEnregistre(true);
      setTimeout(() => setEnregistre(false), 1800);
      onSaved();
      toast.success(fr ? 'Courriel enregistré' : 'Email saved');
    } catch (e: any) {
      // `updateRuleMessage` lève quand la RLS filtre la ligne — sans quoi
      // l'utilisateur croirait avoir enregistré.
      toast.error(e?.message || (fr ? 'Enregistrement impossible' : 'Could not save'));
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="presentation"
      tabIndex={-1}
      onClick={fermer}
    >
      <div
        className="w-full sm:max-w-3xl h-[95vh] sm:h-auto sm:max-h-[90vh] flex flex-col rounded-t-xl sm:rounded-xl bg-surface-secondary shadow-2xl overflow-hidden"
        role="presentation"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline/50 shrink-0">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary truncate">{ruleName}</p>
            <p className="text-[11px] text-text-tertiary">
              {fr ? 'Cliquez sur le texte pour le modifier' : 'Click the text to edit it'}
            </p>
          </div>
          <button
            onClick={fermer}
            className="p-1.5 rounded-md hover:bg-surface-tertiary text-text-secondary shrink-0"
            aria-label={fr ? 'Fermer' : 'Close'}
          >
            <X size={16} />
          </button>
        </div>

        {/* Le courriel.

            Le fond reprend le CIEL du gabarit serveur (#e6f0ff, celui des
            pages marketing) : sans lui, l'aperçu montrait une enveloppe
            blanche que le client ne reçoit pas, et le propriétaire jugeait son
            courriel sur une image fausse. Les couleurs sont écrites en dur
            plutôt qu'en classes de thème, parce qu'un courriel ne suit pas le
            mode sombre de l'app : il arrive tel quel dans la boîte. */}
        {/* Deux onglets. « Modifier » garde l'édition sur place ; « Aperçu
            réel » montre ce que le serveur enverrait, sans rien redessiner. */}
        <div className="flex items-center gap-1 px-3 sm:px-5 pt-3 border-b border-outline/40">
          <button
            type="button"
            onClick={() => setOngletApercu(false)}
            className={cn(
              'px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px transition-colors',
              !ongletApercu ? 'border-primary text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary',
            )}
          >
            {fr ? 'Modifier' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={() => setOngletApercu(true)}
            className={cn(
              'px-3 py-2 text-[12px] font-semibold border-b-2 -mb-px transition-colors',
              ongletApercu ? 'border-primary text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary',
            )}
          >
            {fr ? 'Aperçu réel' : 'Real preview'}
          </button>
        </div>

        {ongletApercu ? (
          <div className="flex-1 overflow-y-auto bg-surface-secondary p-3 sm:p-5">
            {chargementApercu ? (
              <p className="flex items-center justify-center gap-2 py-10 text-[12px] text-text-tertiary">
                <Loader2 size={13} className="animate-spin" />
                {fr ? 'Rendu du courriel…' : 'Rendering…'}
              </p>
            ) : htmlReel ? (
              <iframe
                title={fr ? 'Aperçu du courriel' : 'Email preview'}
                srcDoc={htmlReel}
                sandbox=""
                className="mx-auto block w-full max-w-[600px] rounded-lg border border-outline/40 bg-white"
                style={{ height: 620 }}
              />
            ) : (
              <p className="py-10 text-center text-[12px] text-text-tertiary">
                {fr
                  ? 'Aperçu indisponible pour le moment. Votre texte est intact — revenez à « Modifier ».'
                  : 'Preview unavailable right now. Your text is safe — go back to “Edit”.'}
              </p>
            )}
            <div className="mx-auto mt-3 flex max-w-[600px] justify-center">
              <button
                type="button"
                onClick={() => void envoyerEssai()}
                disabled={essaiEnCours}
                className="rounded-lg border border-outline/60 bg-surface px-4 py-2 text-[12.5px] font-semibold text-text-secondary hover:bg-surface-secondary disabled:opacity-60"
              >
                {essaiEnCours
                  ? (fr ? 'Envoi…' : 'Sending…')
                  : (fr ? 'M’envoyer un essai' : 'Send me a test')}
              </button>
            </div>
            <p className="mx-auto mt-2 max-w-[600px] text-center text-[10px] leading-relaxed text-text-tertiary">
              {fr
                ? 'Rendu par le serveur, avec le même gabarit qu’à l’envoi. Le montant et le bouton sont des exemples ; les valeurs entre crochets seront remplacées par les vraies données du client.'
                : 'Rendered by the server, with the same template used when sending. The amount and button are samples; bracketed values are replaced with the client’s real data.'}
            </p>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto p-3 sm:p-5" style={{ background: '#f4f5f7' }}>
          <div className="mx-auto max-w-[600px] rounded-lg bg-white shadow-sm overflow-hidden">
            {/* Objet — ce que le client voit dans sa boîte */}
            <div className="px-5 py-3 border-b border-outline/40 bg-surface-secondary/40">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                {fr ? 'Objet' : 'Subject'}
              </p>
              <input
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
                onFocus={() => { setActif(null); setCibleObjet(true); }}
                placeholder={fr ? 'Objet du courriel' : 'Email subject'}
                aria-label={fr ? 'Objet du courriel' : 'Email subject'}
                className="w-full bg-transparent border border-transparent rounded px-2 py-1 text-[13px] font-semibold text-text-primary hover:border-outline/40 focus:border-primary/60 focus:bg-surface focus:outline-none transition-colors"
              />
            </div>

            {/* En-tête ajouté par le serveur — non modifiable ici, il vient
                des réglages de l'entreprise. Le logo se pose sur le ciel sans
                cadre blanc : son fond est retiré au téléversement. */}
            <div className="px-5 py-5 text-center" style={{ background: '#f4f5f7' }}>
              {entreprise.company_logo_url ? (
                <img
                  src={entreprise.company_logo_url}
                  alt={entreprise.company_name ?? ''}
                  className="mx-auto max-h-14 object-contain"
                />
              ) : (
                <span className="text-[18px] font-bold" style={{ color: '#101828' }}>
                  {entreprise.company_name || 'Lume'}
                </span>
              )}
            </div>

            {/* Corps */}
            <div className="px-5 py-4 space-y-0.5">
              {blocs.map((bloc) => (
                <div key={bloc.id} className="group relative flex items-start gap-1">
                  {bloc.type === 'puce' && (
                    <span className="text-text-tertiary text-[13px] pt-1.5 select-none">•</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <ChampBloc
                      bloc={bloc}
                      fr={fr}
                      onChange={(t) => majBloc(bloc.id, t)}
                      onFocus={() => { setActif(bloc.id); setCibleObjet(false); }}
                    />
                  </div>
                  <button
                    onClick={() => supprimerBloc(bloc.id)}
                    title={fr ? 'Supprimer cette ligne' : 'Remove this line'}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-text-tertiary hover:text-red-500 shrink-0 mt-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {blocs.length === 0 && (
                <p className="text-[12px] text-text-tertiary italic py-3">
                  {fr ? 'Courriel vide — ajoutez une ligne ci-dessous.' : 'Empty email — add a line below.'}
                </p>
              )}

              <div className="flex items-center gap-1.5 pt-2">
                <button
                  onClick={() => ajouterBloc('paragraphe')}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
                >
                  <Type size={11} /> {fr ? 'Paragraphe' : 'Paragraph'}
                </button>
                <button
                  onClick={() => ajouterBloc('puce')}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
                >
                  <List size={11} /> {fr ? 'Puce' : 'Bullet'}
                </button>
              </div>
            </div>

            {/* Pied de page ajouté par le serveur. Le montrer évite de
                répéter « Merci, [company_name] » en fin de message : la
                signature y est déjà. */}
            {/* Le pied, tel que le gabarit serveur le rend : le téléphone et
                le courriel de l'entreprise d'abord, puis « Envoyé avec Lume »
                en petit. Il affichait « Envoyé via LUME pour {entreprise} » —
                formule retirée du serveur le 2026-09-17 parce qu'elle vole la
                marque du client. L'aperçu la montrait encore. */}
            <div className="px-5 py-3 border-t text-center" style={{ borderColor: '#d3e3f7' }}>
              {(entreprise.company_phone || entreprise.company_email) && (
                <p className="text-[11px]" style={{ color: '#0b5cad' }}>
                  <span className="font-semibold">{entreprise.company_phone}</span>
                  {entreprise.company_phone && entreprise.company_email ? (
                    <span style={{ color: '#9fb3c8' }}> · </span>
                  ) : null}
                  <span className="font-semibold">{entreprise.company_email}</span>
                </p>
              )}
              {entreprise.company_name && (
                <p className="text-[10px] mt-0.5" style={{ color: '#5b6b7f' }}>{entreprise.company_name}</p>
              )}
              <p className="text-[10px] mt-1.5" style={{ color: '#8fa3ba' }}>
                {fr ? 'Envoyé avec' : 'Sent with'}{' '}
                <span className="font-bold" style={{ color: '#0b5cad' }}>Lume</span>
              </p>
            </div>
          </div>

          {/* Un SEUL aperçu : le courriel ci-dessus EST le rendu final.
              Un second bloc « ce que le client lira » répétait la même chose
              et ajoutait du bruit sans rien apprendre. */}
          <p className="mx-auto max-w-[600px] mt-2 text-[10px] text-text-tertiary text-center leading-relaxed">
            {fr
              ? 'L’en-tête et le pied de page viennent de vos réglages d’entreprise. Les valeurs entre crochets seront remplacées par les vraies données du client.'
              : 'Header and footer come from your company settings. Bracketed values are replaced with the client’s real data.'}
          </p>
        </div>
        )}

        {/* L'avertissement, juste au-dessus du bouton Enregistrer : c'est le
            dernier moment où quelqu'un peut corriger avant que son client
            reçoive un trou. On ne bloque PAS l'enregistrement — une entreprise
            peut avoir une raison d'écrire un crochet, et l'empêcher
            d'enregistrer son travail pour un avertissement serait pire que le
            défaut qu'on signale. */}
        {inconnues.length > 0 && (
          <div className="shrink-0 border-t border-amber-500/30 bg-amber-500/10 px-5 py-2.5">
            <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
              <span className="font-semibold">
                {fr
                  ? `${inconnues.length > 1 ? 'Ces variables n’existent pas' : 'Cette variable n’existe pas'} : `
                  : `${inconnues.length > 1 ? 'These variables don’t exist' : 'This variable doesn’t exist'}: `}
              </span>
              {inconnues.map((c) => `[${c}]`).join(', ')}
              {' — '}
              {fr
                ? 'votre client verra un blanc, ou le crochet tel quel. Utilisez les boutons « Insérer » ci-dessous.'
                : 'your client will see a blank, or the bracket as-is. Use the “Insert” buttons below.'}
            </p>
          </div>
        )}

        {/* Pied : variables + enregistrement */}
        <div className="border-t border-outline/50 px-5 py-3 shrink-0 bg-surface-secondary">
          <div className="flex flex-wrap items-center gap-1 mb-2.5">
            <span className="text-[10px] text-text-tertiary mr-1">
              {fr ? 'Insérer :' : 'Insert:'}
            </span>
            {variables.map((v) => (
              <button
                key={v.cle}
                title={`[${v.cle}]`}
                onClick={() => insererVariable(v.cle)}
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
              >
                <Plus size={9} /> {fr ? v.fr : v.en}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-text-tertiary">
              {modifie
                ? (fr ? 'Modifications non enregistrées' : 'Unsaved changes')
                : (fr ? 'Aucune modification' : 'No changes')}
            </p>
            <div className="flex items-center gap-2">
              {/* Les deux actions rares, reléguées ici : elles occupaient un
                  bouton-icône muet par ligne dans la liste, dont un
                  destructeur. On défait un texte en le regardant. */}
              {importerHtml ? (
                <button
                  onClick={importerHtml}
                  className="px-3 py-1.5 rounded-md text-[11px] text-text-tertiary hover:bg-surface-tertiary transition-colors"
                >
                  {fr ? 'Importer du HTML' : 'Import HTML'}
                </button>
              ) : null}
              {revenirAuDefaut ? (
                <button
                  onClick={() => void revenirAuDefaut()}
                  className="px-3 py-1.5 rounded-md text-[11px] text-text-tertiary underline underline-offset-2 hover:text-text-secondary transition-colors"
                >
                  {fr ? 'Revenir au texte d’origine' : 'Restore original'}
                </button>
              ) : null}
              <button
                onClick={fermer}
                className="px-3 py-1.5 rounded-md text-[11px] text-text-secondary hover:bg-surface-tertiary transition-colors"
              >
                {fr ? 'Fermer' : 'Close'}
              </button>
              <button
                onClick={enregistrer}
                disabled={!modifie || enregistrement}
                className={cn(
                  'px-4 py-1.5 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5',
                  modifie && !enregistrement
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'bg-surface-tertiary text-text-tertiary cursor-not-allowed',
                )}
              >
                {enregistrement && <Loader2 size={11} className="animate-spin" />}
                {enregistre && !enregistrement && <Check size={11} />}
                {fr ? 'Enregistrer' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
