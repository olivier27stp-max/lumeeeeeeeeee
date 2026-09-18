/**
 * Fumée de coût — la preuve que le chemin réel marche, pour quelques cents.
 *   npm run qa:fumee
 *
 * Pourquoi ce script existe. Les 2 547 tests de la suite bouchonnent le SDK
 * (`vi.mock('@anthropic-ai/sdk')`) : ils tournent en 20 s pour 0 $, mais ils
 * ne prouvent PAS qu'un vrai appel part, qu'il revient, ni ce qu'il coûte. À
 * l'inverse, la batterie complète (`qa:lumi`, ~2 000 appels) prouve tout mais
 * coûte cher — c'est elle qui a brûlé 39 $ sur staging en sept jours.
 *
 * Ce script est l'entre-deux qui manquait : le minimum d'appels réels pour
 * démontrer que la chaîne tient, avec un plafond en dur et un devis affiché
 * AVANT de dépenser. Fait pour être lancé avant chaque déploiement.
 *
 * Ce qu'il vérifie, dans l'ordre (du gratuit au payant) :
 *   1. les étages à 0 token répondent bien sans modèle (FAQ, centre d'aide) ;
 *   2. les garde-fous refusent ce qu'ils doivent refuser (actions, données) ;
 *   3. le plafond journalier bloque réellement une fois atteint ;
 *   4. UN appel réel au modèle part, revient, et son coût est celui attendu.
 *
 * Les étapes 1 à 3 sont gratuites et tournent toujours. L'étape 4 est la
 * seule payante : elle est bornée à APPELS_MAX (défaut 3) sur Haiku, sortie
 * plafonnée, et s'annule si le devis dépasse PLAFOND_CENTS.
 *
 * Sortie : PASS / FAIL, et le coût réel mesuré depuis `usage` (jamais estimé).
 */
import { reponseFaqPour } from '../../server/lib/support/faq';
import { reponseAideDirecte } from '../../server/lib/support/articles-dabord';
import { verifierPlafond, ajouterDepense, reinitialiserPlafonds, plafondJourCents } from '../../server/lib/lumi/plafond-journalier';
import { coutEnCents } from '../../server/lib/lumi/tarifs';

/** Modèle le moins cher : on teste la PLOMBERIE, pas la qualité des réponses. */
const MODELE = process.env.QA_FUMEE_MODELE || 'claude-haiku-4-5-20251001';
/** Nombre maximal d'appels réels. Au-delà, ce n'est plus une fumée. */
const APPELS_MAX = Math.min(Number(process.env.QA_FUMEE_APPELS) || 3, 10);
/** Refus de démarrer si le devis dépasse ce montant (en cents). */
const PLAFOND_CENTS = Number(process.env.QA_FUMEE_PLAFOND_CENTS) || 5;
/** Sortie courte : on vérifie qu'une réponse revient, pas qu'elle soit belle. */
const MAX_TOKENS = 64;

const vert = (s: string) => `\x1b[32m${s}\x1b[0m`;
const rouge = (s: string) => `\x1b[31m${s}\x1b[0m`;
const gris = (s: string) => `\x1b[90m${s}\x1b[0m`;

let echecs = 0;
let coutTotalCents = 0;

function verifier(nom: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`  ${vert('✓')} ${nom}${detail ? gris(' · ' + detail) : ''}`);
  else { echecs++; console.log(`  ${rouge('✗')} ${nom}${detail ? ' · ' + detail : ''}`); }
}

// ── 1. Les étages gratuits répondent (0 token) ────────────────────────
console.log('\n1. Réponses sans modèle (0 token)');
{
  const faq = reponseFaqPour('mon paiement a échoué je fais quoi', 'fr');
  verifier('la FAQ répond à une question produit reformulée', faq?.id === 'billing-failed', faq?.id);

  const humain = reponseFaqPour('comment je parle à un humain', 'fr');
  verifier('la FAQ sait diriger vers un humain', humain?.id === 'talk-to-human', humain?.id);

  const aide = reponseAideDirecte('comment activer la double authentification', 'fr', { premierMessage: true });
  verifier('le centre d\'aide répond avant le modèle', !!aide, aide ? `score ${aide.score}` : 'aucune réponse');
}

// ── 2. Les garde-fous refusent (c'est le plus important) ──────────────
console.log('\n2. Garde-fous — doivent TOUS refuser');
{
  const dangereuses: Array<[string, string]> = [
    ['action sur une pièce précise', 'supprime la facture INV-0004'],
    ['action sur un client nommé', 'annule le job 33'],
    ['question sur les données du compte', 'combien j ai de clients'],
    ['correction en cours de conversation', 'att non pas celui la, l autre client'],
  ];
  for (const [nom, q] of dangereuses) {
    const parFaq = reponseFaqPour(q, 'fr');
    const parAide = reponseAideDirecte(q, 'fr', { premierMessage: true });
    verifier(`${nom} → descend au modèle`, !parFaq && !parAide,
      parFaq ? `FUITE FAQ ${parFaq.id}` : parAide ? 'FUITE aide' : '');
  }
}

// ── 3. Le plafond journalier bloque réellement ────────────────────────
console.log('\n3. Plafond journalier');
{
  reinitialiserPlafonds();
  const env = { LUMI_PLAFOND_JOUR_USD: '0.10' } as unknown as NodeJS.ProcessEnv;
  verifier('autorise sous le plafond', verifierPlafond('lumi', env).autorise);
  ajouterDepense('lumi', 10, env);
  verifier('REFUSE une fois le plafond atteint', !verifierPlafond('lumi', env).autorise);
  verifier('chaque source a son compteur', verifierPlafond('support', env).autorise);
  reinitialiserPlafonds();
  console.log(gris(`     plafond effectif par défaut : ${(plafondJourCents('lumi', process.env) / 100).toFixed(2)} $/jour/source`));
}

// ── 4. Le seul étage payant : un vrai appel ───────────────────────────
console.log('\n4. Appel réel au modèle');
if (!process.env.ANTHROPIC_API_KEY) {
  console.log(gris('  ignoré : ANTHROPIC_API_KEY absente (les étapes 1-3 suffisent à valider la logique)'));
} else {
  // Devis AVANT de dépenser : entrée courte + sortie au plafond, tarif plein.
  const devis = coutEnCents(MODELE, { input_tokens: 400, output_tokens: MAX_TOKENS, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) * APPELS_MAX;
  console.log(gris(`  modèle ${MODELE} · ${APPELS_MAX} appel(s) · devis max ${devis.toFixed(3)} ¢ (plafond ${PLAFOND_CENTS} ¢)`));
  if (devis > PLAFOND_CENTS) {
    echecs++;
    console.log(rouge(`  ✗ devis au-dessus du plafond — annulé (QA_FUMEE_PLAFOND_CENTS pour changer)`));
  } else {
    const { clientAnthropic } = await import('../../server/lib/lumi/llm');
    const questions = [
      'Réponds exactement : OK',
      'En trois mots maximum : à quoi sert une facture ?',
      'Réponds exactement : DEUX',
    ].slice(0, APPELS_MAX);

    for (const [i, q] of questions.entries()) {
      try {
        const debut = Date.now();
        const r = await clientAnthropic().messages.create({
          model: MODELE,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: q }],
        });
        const cout = coutEnCents(r.model, r.usage);
        coutTotalCents += cout;
        const texte = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('').trim();
        verifier(
          `appel ${i + 1} : réponse reçue`,
          texte.length > 0 && r.stop_reason !== 'refusal',
          `${Date.now() - debut} ms · ${r.usage.input_tokens} in / ${r.usage.output_tokens} out · ${cout.toFixed(4)} ¢ · « ${texte.slice(0, 28)} »`,
        );
      } catch (e: any) {
        echecs++;
        console.log(`  ${rouge('✗')} appel ${i + 1} a échoué · ${e?.status ?? ''} ${e?.message ?? e}`);
      }
    }
    // Le coût mesuré doit rester dans le devis : sinon un réglage a dérivé.
    verifier('coût réel sous le devis', coutTotalCents <= devis, `${coutTotalCents.toFixed(4)} ¢ mesurés`);
  }
}

// ── Verdict ───────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(58)}`);
console.log(`Coût réel de cette fumée : ${vert(`${coutTotalCents.toFixed(4)} ¢`)} (${(coutTotalCents / 100).toFixed(5)} $ US)`);
if (echecs) {
  console.log(rouge(`FAIL — ${echecs} vérification(s) en échec\n`));
  process.exit(1);
}
console.log(vert('PASS — chaîne vérifiée, garde-fous actifs\n'));
