p = 'server/lib/lumi/generer-parcours.ts'
s = open(p, encoding='utf8').read()


def rep(o, n, compte=1):
    global s
    assert s.count(o) == compte, (o[:70], s.count(o))
    s = s.replace(o, n)


# ── 1. import ──
rep("import { VARIABLES_CONNUES, variablesInconnues, htmlVersTexte } from '../../../src/lib/emailBodyText';",
    "import { VARIABLES_CONNUES, variablesInconnues, htmlVersTexte } from '../../../src/lib/emailBodyText';\n"
    "import { TEXTES_ACTION_PROVISOIRE } from '../../../src/lib/sequenceTypes';")

# ── 2. messagesDuParcours + ceQuiAChange ──
debut = s.index("/**\n * Les messages au client d'un parcours, par étape : texto (corps) et")
fin = s.index("/** Le prompt système : le catalogue, la forme, et les interdits. */")
nouveau = r'''const sansEspaces = (t: string): string => t.replace(/\s+/g, ' ').trim();

/**
 * Les TEXTES D'EXEMPLE que l'éditeur pose quand on ajoute une étape à la main
 * (« Bonjour [client_name], c’est [company_name]. Merci ! ») ou à la création
 * (« À compléter »). L'utilisateur ne les a pas écrits.
 *
 * Vrai cas de prod (2026-10-01) : une étape « Envoyer un texto » fraîchement
 * ajoutée, puis « fais un message pour notifier le rep qui a envoyé le
 * devis ». Lumi a ajouté la notification… et gardé le texto d'exemple, sans
 * un mot : publié, chaque client qui ouvre son devis recevait « Bonjour X,
 * c’est Y. Merci ! ».
 */
const TEXTES_EXEMPLE: ReadonlySet<string> = new Set(
  [
    ...TEXTES_ACTION_PROVISOIRE,
    ...ACTIONS.flatMap((a) => a.champs)
      .filter((c) => c.type === 'zone' || c.type === 'texte')
      .flatMap((c) => [c.defaut_fr, c.defaut_en]),
  ].filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(sansEspaces),
);

interface MessageDuParcours {
  /** Identifiant de l'étape. */
  id: string;
  type: string;
  objet: string;
  corps: string;
  /** Le texte est encore l'exemple posé par l'éditeur. */
  exemple: boolean;
  /** Le message part au client (texto, courriel) — pas une note interne. */
  versClient: boolean;
  /** À qui va une notification interne (« responsable », « proprietaire »…). */
  pour: string;
}

/**
 * Les messages d'un parcours, par étape : texto (corps), courriel (objet +
 * corps en texte), notification interne (titre + détail), tâche (titre).
 */
function messagesDuParcours(steps: unknown): MessageDuParcours[] {
  const res: MessageDuParcours[] = [];
  for (const e of Array.isArray(steps) ? steps : []) {
    const etape = e as { id?: unknown; action?: { type?: unknown; config?: Record<string, unknown> } };
    const type = String(etape?.action?.type ?? '');
    if (!['send_sms', 'send_email', 'create_notification', 'create_task'].includes(type)) continue;
    const config = etape.action?.config ?? {};
    const interne = type === 'create_notification' || type === 'create_task';
    const objet = sansEspaces(String((interne ? config.title : config.subject) ?? ''));
    const corps = sansEspaces(type === 'send_email' ? htmlVersTexte(String(config.body ?? '')) : String(config.body ?? ''));
    res.push({
      id: String(etape.id ?? res.length),
      type,
      objet,
      corps,
      exemple: TEXTES_EXEMPLE.has(interne ? objet : corps),
      versClient: !interne,
      pour: String(config.destinataire ?? ''),
    });
  }
  return res;
}

/**
 * Les étapes dont le texte est encore l'exemple de l'éditeur : à réécrire ou
 * à retirer, jamais à garder telles quelles.
 */
export function etapesNonRedigees(steps: unknown): string[] {
  return messagesDuParcours(steps).filter((m) => m.exemple).map((m) => m.id);
}

const POUR_QUI: Record<string, { fr: string; en: string }> = {
  proprietaire: { fr: 'au propriétaire', en: 'to the owner' },
  responsable: { fr: 'au responsable du client', en: 'to the client owner' },
  equipe_du_deal: { fr: 'au rep assigné, aux propriétaires et aux admins', en: 'to the assigned rep, owners and admins' },
  membre: { fr: 'à un membre précis', en: 'to a specific member' },
};

/** Une ligne lisible pour un message : ce qui part, à qui, mot pour mot. */
function ligneMessage(m: MessageDuParcours, fr: boolean): string {
  const court = (t: string) => (t.length > 280 ? `${t.slice(0, 277)}…` : t);
  if (m.type === 'send_sms') return `• ${fr ? 'Texto' : 'Text'} : « ${court(m.corps)} »`;
  if (m.type === 'send_email') return `• ${fr ? 'Courriel' : 'Email'} — ${fr ? 'objet' : 'subject'} « ${m.objet} » : « ${court(m.corps)} »`;
  if (m.type === 'create_task') return `• ${fr ? 'Tâche' : 'Task'} : « ${court(m.objet)} »`;
  const pour = POUR_QUI[m.pour]?.[fr ? 'fr' : 'en'] ?? (fr ? 'à toute l’équipe' : 'to the whole team');
  const texte = m.corps ? `${m.objet} — ${m.corps}` : m.objet;
  return `• ${fr ? `Notification dans Lume, ${pour}` : `Notification in Lume, ${pour}`} : « ${court(texte)} »`;
}

/**
 * CE QUI A CHANGÉ, écrit par le serveur sous la phrase de Lumi.
 *
 * Mesuré en prod le 2026-09-30 : « plus court, plus intéressant » → « trop
 * long » → « tu l'as même pas changé le message ». Les textes changeaient à
 * chaque tour, mais Lumi répondait trois fois la MÊME phrase, qui décrivait
 * le parcours sans jamais citer un mot envoyé au client. Rejoué sur un
 * meilleur modèle, il finissait par « avouer » à tort que rien n'avait
 * changé : il ne voit pas l'écran. On ne s'en remet donc pas au modèle —
 * on compare avant/après et on montre le nouveau texte, ou on dit
 * franchement que rien n'a bougé.
 *
 * Depuis le 2026-10-01 : les notifications internes et les tâches sont
 * citées aussi (« fais un message pour notifier le rep » ne montrait pas le
 * message), une étape RETIRÉE est dite, et un texte d'exemple encore présent
 * et destiné au client est signalé — rien de ce qui part ne reste caché.
 */
export function ceQuiAChange(avant: unknown, apres: unknown, fr: boolean, voulaitModifier = true): string {
  const a = messagesDuParcours(avant);
  const b = messagesDuParcours(apres);
  const signature = (m: MessageDuParcours) => `${m.type}|${m.objet}|${m.corps}|${m.pour}`;
  const resteAvant = new Set(a);
  const nouveaux: MessageDuParcours[] = [];
  const sansPaire: MessageDuParcours[] = [];
  // 1. La même étape (même id, même type) : inchangée ou réécrite.
  for (const m of b) {
    const meme = [...resteAvant].find((x) => x.id === m.id && x.type === m.type);
    if (!meme) { sansPaire.push(m); continue; }
    resteAvant.delete(meme);
    if (signature(meme) !== signature(m)) nouveaux.push(m);
  }
  // 2. Une étape renumérotée par le modèle : même texte = inchangée.
  for (const m of sansPaire) {
    const jumeau = [...resteAvant].find((x) => signature(x) === signature(m));
    if (jumeau) resteAvant.delete(jumeau);
    else nouveaux.push(m);
  }
  // 3. Ce qui reste de l'ancien parcours a été retiré.
  const retires = [...resteAvant];

  const blocs: string[] = [];
  if (nouveaux.length) {
    const ordre = b.filter((m) => nouveaux.includes(m));
    blocs.push(`${fr ? 'Nouveau texte :' : 'New wording:'}\n${ordre.map((m) => ligneMessage(m, fr)).join('\n')}`);
  }
  if (retires.length) {
    blocs.push(`${fr ? 'Retiré du parcours :' : 'Removed from the journey:'}\n${retires.map((m) => ligneMessage(m, fr)).join('\n')}`);
  }
  // Un texte d'exemple qui partirait AU CLIENT : jamais en silence.
  const exemples = b.filter((m) => m.exemple && m.versClient);
  if (exemples.length) {
    blocs.push(fr
      ? `Attention : ${exemples.length > 1 ? 'ces étapes portent' : 'cette étape porte'} encore le texte d’exemple de l’éditeur, qui partirait tel quel au client :\n${exemples.map((m) => ligneMessage(m, fr)).join('\n')}\nDis-moi quoi écrire à la place, ou demande-moi de retirer l’étape.`
      : `Careful: ${exemples.length > 1 ? 'these steps still carry' : 'this step still carries'} the editor’s sample text, which would go to the client as is:\n${exemples.map((m) => ligneMessage(m, fr)).join('\n')}\nTell me what to write instead, or ask me to remove the step.`);
  }
  if (blocs.length) return `\n\n${blocs.join('\n\n')}`;
  const avaitUnParcours = Array.isArray(avant) && avant.length > 0;
  // Une question ou un refus ne change rien EXPRÈS (`modifie: false`) : la
  // phrase de Lumi suffit, « je n'ai rien changé » y sonnerait faux.
  if (voulaitModifier && avaitUnParcours && JSON.stringify(avant) === JSON.stringify(apres)) {
    return fr
      ? '\n\nJe n’ai rien changé au parcours. Dis-moi quel message modifier (le texto ou le courriel) et comment.'
      : '\n\nI did not change anything. Tell me which message to change (the text or the email) and how.';
  }
  return '';
}

'''
s = s[:debut] + nouveau + s[fin:]

# ── 3. le parcours actuel : les étapes non rédigées sont nommées ──
rep("""    messages.push({
      role: 'user',
      content: `Voici le parcours ACTUEL, à modifier (ne le reconstruis pas de zéro) :
${
        JSON.stringify(parcoursActuel).slice(0, 6_000)
      }`,
    });""",
    """    /*
     * Les étapes NON RÉDIGÉES sont nommées. Sans ça, « ne le reconstruis pas
     * de zéro » faisait garder au modèle le texto d'exemple d'une étape tout
     * juste ajoutée : il partait au client sans que personne ne l'ait écrit.
     */
    const exemples = etapesNonRedigees(parcoursActuel.steps);
    const consigneExemples = exemples.length
      ? `

ÉTAPE${exemples.length > 1 ? 'S' : ''} NON RÉDIGÉE${exemples.length > 1 ? 'S' : ''} : ${exemples.join(', ')}. Son texte est l'EXEMPLE que l'éditeur pose quand on ajoute une étape ; l'utilisateur ne l'a pas écrit et ne veut pas l'envoyer. Ne garde JAMAIS une telle étape telle quelle : si la demande porte sur ce message, RÉÉCRIS-le selon la demande ; sinon RETIRE l'étape et dis-le dans "resume". Un texte d'exemple ne doit jamais partir à un client.`
      : '';
    messages.push({
      role: 'user',
      content: `Voici le parcours ACTUEL, à modifier (ne le reconstruis pas de zéro) :
${
        JSON.stringify(parcoursActuel).slice(0, 6_000)
      }${consigneExemples}`,
    });""")

open(p, 'w', encoding='utf8', newline='\n').write(s)
print('ok')
