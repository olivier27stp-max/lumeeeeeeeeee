/* ═══════════════════════════════════════════════════════════════
   Éditeur du message d'une automatisation — SMS et courriel.

   Le corps des courriels est stocké en HTML : nécessaire pour l'envoi,
   illisible pour qui veut simplement changer « Bonjour ». On édite donc du
   TEXTE, converti en HTML à l'enregistrement, avec un aperçu de ce que le
   client recevra réellement — variables remplacées par un exemple.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useMemo, useRef, useEffect, useId } from 'react';
import { Mail, MessageSquare, Loader2, Check, Eye, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { updateRuleMessage, ecrireMessageDeRegle, type EcritureMessage } from '../../lib/automationRulesApi';
import { trouverAction } from '../../lib/automationCatalogue';
import { htmlVersTexte, texteVersHtml, remplacerVariables, variablesInconnues, variableLisible, VARIABLES_PROPOSEES } from '../../lib/emailBodyText';
import { libelleSegments } from '../../lib/smsSegments';
import EmailPreviewEditor from './EmailPreviewEditor';
import AutreVersionMessage, { AvisRetraitAutreVersion, nomAutreVersion, phraseLangueDesMessages, type ChoixAutreVersion } from './AutreVersionMessage';

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
  /** Le déclencheur de la règle, pour un aperçu fidèle du courriel (bouton de l'entité). */
  declencheur?: string;
  /**
   * Le rang de ce message parmi ceux du MÊME type dans la règle (0 = le
   * premier). Une règle peut envoyer deux textos : c'est ce rang — et le texte
   * lu — qui désigne celui qu'on écrit. Sans lui, « Enregistrer » sur le
   * premier recopiait son texte dans le second (triage « modèles », 03-texto:172).
   */
  rang?: number;
  /** La version anglaise du texto (`body_en`), quand le message en porte une. */
  bodyEn?: string;
  /** La langue dans laquelle le bureau écrit à ses clients ; `null` = elle n'a pas pu être lue. */
  langueBureau?: 'fr' | 'en' | null;
  /** L'automatisation est à la corbeille : on lit ses messages, on ne les modifie pas. */
  lectureSeule?: boolean;
}

/** Saut de ligne — nommé pour rester lisible dans les découpes de texte. */
const SAUT = '\n';

/** Plafond d'un texto : celui du catalogue (champ « Texte du message » de « Envoyer un texto »), que le serveur applique aussi. */
const LONGUEUR_MAX_TEXTO = trouverAction('send_sms')?.champs.find((c) => c.cle === 'body')?.max ?? 1600;

/**
 * Ce que le client LIRA : les variables connues remplacées par un exemple, les
 * variables inconnues par du VIDE — c'est ce que fait le serveur (`vars[key] ?? ''`).
 * Montrer « Bonjour [prenom], » laissait croire que le crochet partait tel quel.
 */
function texteLu(texte: string, fr: boolean): string {
  let lu = remplacerVariables(texte, fr);
  for (const inconnue of variablesInconnues(texte)) {
    const champ = inconnue.match(/^([a-z]+)_cf_([a-z][a-z0-9_]*)$/);
    const motifs = champ
      ? [new RegExp(`\\{\\{\\s*${champ[1]}\\.${champ[2]}\\s*\\}\\}`, 'g')]
      : [new RegExp(`\\[${inconnue}\\]`, 'g'), new RegExp(`\\{${inconnue}\\}`, 'g')];
    for (const motif of motifs) lu = lu.replace(motif, '');
  }
  return lu;
}

export default function MessageEditor({
  ruleId, ruleName, actionType, body, subject, fr, onSaved, declencheur, rang, bodyEn, langueBureau, lectureSeule,
}: Props) {
  const estCourriel = actionType === 'send_email';

  // ── Courriel : aperçu compact + ouverture de l'éditeur pleine page ──
  //
  // Éditer un courriel dans une bande étroite obligeait à lire du HTML ou à
  // taper dans un champ minuscule. Le courriel s'ouvre donc dans sa propre
  // fenêtre, où il s'affiche comme le client le recevra.
  const [editeurOuvert, setEditeurOuvert] = useState(false);

  /*
   * ── SMS : édition directe, le texte est déjà lisible ──
   *
   * LES DEUX LANGUES (03-texto:345 ; règle fixée le 2026-10-01, voir
   * `AutreVersionMessage`). Un texto peut porter une version anglaise
   * (`body_en`) : le moteur l'envoie À LA PLACE du texte de base quand le
   * bureau envoie ses messages en anglais.
   *   · Le champ principal montre et modifie le texte qui PART.
   *   · L'autre langue, quand le texto en porte une, est dans un bloc replié
   *     juste en dessous, dépliable et modifiable.
   *   · Corriger le texte principal sans l'autre ne bloque rien : le bloc se
   *     déplie, dit « Cette version n'est plus à jour. » et offre de la retirer
   *     (coché d'office) ou de la garder telle quelle.
   */
  const aAnglais = typeof bodyEn === 'string' && bodyEn.trim() !== '';
  const principale: 'fr' | 'en' = langueBureau === 'en' && aAnglais ? 'en' : 'fr';
  const autre: 'fr' | 'en' = principale === 'fr' ? 'en' : 'fr';
  const enBase = { fr: body, en: bodyEn ?? '' };
  const [textes, setTextes] = useState(enBase);
  // Le texte enregistré a changé (après « Enregistrer », la liste se recharge) : on repart de lui.
  useEffect(() => { setTextes({ fr: body, en: bodyEn ?? '' }); }, [body, bodyEn]);
  const texte = textes[principale];
  const setTexte = (maj: string | ((t: string) => string)) => setTextes((t) => ({ ...t, [principale]: typeof maj === 'function' ? maj(t[principale]) : maj }));
  /** L'autre langue, périmée : « La retirer » (d'office) ou « La garder telle quelle ». */
  const [choixAutre, setChoixAutre] = useState<ChoixAutreVersion>('retirer');
  const idAutreVersion = useId();
  /** Le bloc de l'autre langue, déplié par l'utilisateur (périmée, elle l'est toujours). */
  const [autreDeplie, setAutreDeplie] = useState(false);

  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const modifiePrincipale = textes[principale] !== enBase[principale];
  const modifieAutre = aAnglais && textes[autre] !== enBase[autre];
  const modifie = modifiePrincipale || modifieAutre;
  /** Le texte principal a changé, pas l'autre langue : elle n'est plus à jour. */
  const autrePerimee = aAnglais && modifiePrincipale && !modifieAutre;
  /** L'autre langue s'en va : on l'a vidée, ou elle est périmée et « La retirer » est resté coché. */
  const retirerAutre = (modifieAutre && !textes[autre].trim()) || (autrePerimee && choixAutre === 'retirer');
  /** Un texto vide partirait vide : jamais enregistrable (A-06). */
  const vide = texte.trim().length === 0;
  /** Un texto plafonne à 1 600 caractères : au-delà, le fournisseur refuse l'envoi. */
  const tropLong = texte.length > LONGUEUR_MAX_TEXTO || (aAnglais && !retirerAutre && textes[autre].length > LONGUEUR_MAX_TEXTO);
  const enregistrable = modifie && !vide && !tropLong && !enregistrement && !lectureSeule;

  /** Variables citées que le serveur ne sait pas remplir — elles partiraient vides. */
  const inconnues = useMemo(() => variablesInconnues(`${textes[principale]} ${aAnglais ? textes[autre] : ''}`), [textes, principale, autre, aAnglais]);
  /**
   * « 2 SMS » dès que le texte dépasse un segment facturé — compté sur ce que
   * le client LIRA (« [client_first_name] » fait 19 caractères, « Marie » 5),
   * les variables inconnues gardées telles quelles : une estimation prudente.
   */
  const segments = useMemo(() => libelleSegments(remplacerVariables(texte, fr), fr), [texte, fr]);
  const lu = texteLu(texte, fr);

  /** Lignes du courriel, variables remplacées — pour l'aperçu compact. */
  const lignesApercu = useMemo(
    () => (estCourriel ? remplacerVariables(htmlVersTexte(body), fr).split(SAUT) : []),
    [body, estCourriel, fr],
  );

  /* « Insérer » place la variable LÀ OÙ EST LE CURSEUR (03-texto:237). Tant que
     personne n'a mis le curseur dans le champ, elle va à la fin. */
  const zone = useRef<HTMLTextAreaElement>(null);
  const curseurPose = useRef(false);
  const inserer = (cle: string) => {
    const el = zone.current;
    const variable = `[${cle}]`;
    const debut = el && curseurPose.current ? el.selectionStart : texte.length;
    const fin = el && curseurPose.current ? el.selectionEnd : texte.length;
    setTexte((t) => `${t.slice(0, debut)}${variable}${t.slice(fin)}`);
    // Le curseur reste juste après la variable : deux insertions de suite s'enchaînent.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(debut + variable.length, debut + variable.length);
    });
    curseurPose.current = true;
  };

  const enregistrerSms = async () => {
    if (!enregistrable) return;
    setEnregistrement(true);
    try {
      // UN message : celui de ce bloc (son rang, et le texte lu à l'ouverture).
      const cible = { rang, corpsLu: body };
      if (principale === 'fr' && !modifieAutre && !retirerAutre) {
        // Le cas courant : un seul texte change, l'autre langue (s'il y en a une) reste telle quelle.
        await updateRuleMessage(ruleId, 'send_sms', textes.fr, undefined, cible);
      } else {
        // Les langues modifiées en UNE écriture ; l'autre n'est retirée que sur l'ordre que l'écran a montré.
        const champ = (langue: 'fr' | 'en'): EcritureMessage => (langue === 'en' ? { body_en: textes.en } : { body: textes.fr });
        const ecriture: EcritureMessage = {
          ...(modifiePrincipale ? champ(principale) : {}),
          ...(modifieAutre && !retirerAutre ? champ(autre) : {}),
          ...(retirerAutre ? { retirer: autre } : {}),
        };
        await ecrireMessageDeRegle(ruleId, 'send_sms', ecriture, cible);
      }
      setEnregistre(true);
      setChoixAutre('retirer');
      setAutreDeplie(false);
      setTimeout(() => setEnregistre(false), 1800);
      onSaved();
      toast.success(fr ? 'Message enregistré' : 'Message saved');
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Enregistrement impossible' : 'Could not save'));
    } finally {
      setEnregistrement(false);
    }
  };

  /** « À la corbeille » : la même phrase sous le texto et sous le courriel. */
  const noteCorbeille = lectureSeule && (
    <p className="mt-2 text-[10px] text-text-tertiary">
      {fr
        ? 'Cette automatisation est à la corbeille : restaurez-la pour modifier ses messages.'
        : 'This automation is in the bin: restore it to edit its messages.'}
    </p>
  );

  if (estCourriel) {
    return (
      <div className="mt-3 pt-3 border-t border-outline/40" role="presentation" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <Mail size={11} className="text-text-tertiary" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {fr ? 'Courriel envoyé au client' : 'Email sent to client'}
            </p>
          </div>
          {!lectureSeule && (
            <button
              onClick={() => setEditeurOuvert(true)}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-primary text-white hover:bg-primary/90 transition-colors font-semibold"
            >
              <Pencil size={10} /> {fr ? 'Modifier' : 'Edit'}
            </button>
          )}
        </div>

        {/* Aperçu compact : les premières lignes suffisent à reconnaître le
            message ; le détail se voit dans l'éditeur. */}
        <div className="rounded-md border border-outline/50 bg-surface p-3">
          {subject && (
            <p className="text-[12px] font-semibold text-text-primary pb-1.5 mb-1.5 border-b border-outline/40">
              {remplacerVariables(subject, fr)}
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
        {noteCorbeille}

        {editeurOuvert && (
          <EmailPreviewEditor
            ruleId={ruleId}
            ruleName={ruleName}
            body={body}
            subject={subject ?? ''}
            fr={fr}
            onClose={() => setEditeurOuvert(false)}
            onSaved={onSaved}
            declencheur={declencheur}
          />
        )}
      </div>
    );
  }

  const nomChamp = fr ? 'Texto envoyé au client' : 'Text sent to client';
  const nomAutre = `${nomChamp} — ${nomAutreVersion(fr, autre)}`;
  const classeZone = 'w-full px-2.5 py-2 text-[12px] rounded-md bg-surface border border-outline/60 text-text-primary leading-relaxed focus:outline-none focus-visible:border-primary/60 resize-y read-only:bg-surface-secondary read-only:text-text-secondary';

  // ── SMS ──
  return (
    <div className="mt-3 pt-3 border-t border-outline/40" role="presentation" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mb-2">
        <MessageSquare size={11} className="text-text-tertiary" />
        {/* « Texto », comme le bandeau de la liste (« étapes texto »), l'aperçu
            d'un parcours et l'éditeur (« Envoyer un texto ») : un seul mot
            pour le même envoi sur le même écran (audit du 2026-10-01). */}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          {nomChamp}
        </p>
      </div>

      {/* Dans quelle langue les messages partent — donc quel texte est dans le champ.
          Dit seulement quand la question se pose : le texto a deux langues, ou le
          bureau envoie en anglais. */}
      {langueBureau !== undefined && (aAnglais || langueBureau === 'en') && (
        <p className="mb-1.5 text-[10px] leading-relaxed text-text-tertiary">
          {phraseLangueDesMessages(fr, langueBureau, principale, 'texto')}
        </p>
      )}

      <textarea
        ref={zone}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onFocus={() => { curseurPose.current = true; }}
        aria-label={nomChamp}
        readOnly={lectureSeule}
        rows={3}
        className={classeZone}
      />

      {/* Twilio facture par segment : sans compteur, un texte rallongé double
          la facture sans que personne ne le voie (calcul : lib/smsSegments). */}
      <p className="mt-1 text-[10px] text-text-tertiary">
        {texte.length} {fr ? 'caractères' : 'characters'}
        {segments && (
          <span className="text-amber-600 dark:text-amber-400">
            {' '}· {segments}
          </span>
        )}
      </p>

      {/* Un texto plafonne à 1 600 caractères : on le dit AVANT le clic, bouton grisé. */}
      {tropLong && (
        <p className="mt-1 text-[10px] text-danger">
          {fr
            ? 'Un texto fait 1 600 caractères au plus : raccourcissez-le pour l’enregistrer.'
            : 'A text is 1,600 characters at most: shorten it to save.'}
        </p>
      )}

      {/* Une variable que le serveur ne connaît pas est remplacée par du VIDE
          (`vars[key] ?? ''`) : « Bonjour [prenom], » part en « Bonjour , ».
          L'aperçu ci-dessous le montre, mais sans nommer le coupable — on le
          nomme ici, sinon l'utilisateur voit un texte bancal sans comprendre. */}
      {inconnues.length > 0 && (
        <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
          {fr
            ? `Variable inconnue : ${inconnues.map(variableLisible).join(', ')} — sera vide dans le message envoyé.`
            : `Unknown variable: ${inconnues.map(variableLisible).join(', ')} — will be empty in the sent message.`}
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        <Eye size={10} className="text-text-tertiary" />
        <span className="text-[10px] text-text-tertiary">
          {fr ? 'Le client lira :' : 'The client will read:'}
        </span>
        <span className="text-[11px] text-text-secondary italic">
          {lu.trim() ? lu : '—'}
        </span>
      </div>

      {!lectureSeule && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-text-tertiary mr-1">
            {fr ? 'Insérer :' : 'Insert:'}
          </span>
          {VARIABLES_PROPOSEES.map((v) => (
            <button
              key={v.cle}
              type="button"
              title={`[${v.cle}]`}
              onClick={() => inserer(v.cle)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
            >
              {fr ? v.fr : v.en}
            </button>
          ))}
        </div>
      )}

      {/* L'AUTRE LANGUE du texto : repliée, dépliable et modifiable. Périmée (le
          texte principal a changé, pas elle), elle se déplie d'elle-même et
          offre le choix — « Enregistrer » n'attend rien. */}
      {aAnglais && (
        <AutreVersionMessage
          id={idAutreVersion}
          fr={fr}
          langue={autre}
          perimee={autrePerimee && !lectureSeule}
          choix={choixAutre}
          onChoix={setChoixAutre}
          deplie={autreDeplie}
          onDeplie={setAutreDeplie}
          className="mt-3"
        >
          <textarea
            value={textes[autre]}
            onChange={(e) => setTextes((t) => ({ ...t, [autre]: e.target.value }))}
            aria-label={nomAutre}
            readOnly={lectureSeule}
            rows={3}
            className={classeZone}
          />
          <p className="text-[10px] text-text-tertiary">
            {textes[autre].length} {fr ? 'caractères' : 'characters'}
          </p>
        </AutreVersionMessage>
      )}

      {/* Un bouton grisé dit POURQUOI (P2-12). */}
      {vide && (
        <p className="mt-2 text-[10px] text-danger">
          {fr ? 'Le message ne peut pas être vide.' : 'The message cannot be empty.'}
        </p>
      )}
      {noteCorbeille}

      {!lectureSeule && (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={enregistrerSms}
            disabled={!enregistrable}
            className={cn(
              'px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5',
              enregistrable
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
              onClick={() => { setTextes(enBase); setChoixAutre('retirer'); setAutreDeplie(false); }}
              className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {fr ? 'Annuler' : 'Cancel'}
            </button>
          )}
          {/* Ce qu'« Enregistrer » va retirer, écrit à côté du bouton (même règle que le panneau d'étape). */}
          {autrePerimee && choixAutre === 'retirer' && (
            <AvisRetraitAutreVersion fr={fr} langue={autre} idBloc={idAutreVersion} />
          )}
        </div>
      )}
    </div>
  );
}
