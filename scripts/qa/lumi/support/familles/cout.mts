/**
 * Famille 9 — Coût.
 * Aucun verdict PASS / FAIL : un RELEVÉ. On relit dans le grand livre (ai_usage, source
 * « support ») et dans les traces (lumi_traces, canal « support ») ce que chaque question de la
 * batterie a coûté et quel étage y a répondu : part servie sans modèle (FAQ écrite, centre
 * d'aide, cache), coût moyen d'une question servie par le modèle, modèle utilisé.
 *
 * Le relevé porte sur les tours de la passe en cours et, quand le rapport est complété,
 * sur ceux des lancements précédents. Il rend « A RELIRE » : c'est un tableau à lire.
 */
import { sqlTracesSupport, sqlUsageSupport } from '../faits.mts';
import { attribuerUsage, bilanCout, completerEtages, type LigneTrace, type LigneUsage } from '../jugement.mts';
import type { Famille, Issue, Tour } from '../types.mts';

export const ID_COUT = 'cout.releve';

/** Le tableau du rapport (Markdown), à partir des tours relus. */
export function tableauCout(tours: Tour[]): string[] {
  const b = bilanCout(tours);
  const cents = (c: number): string => `${c.toFixed(3)} ¢`;
  const l: string[] = [];
  l.push(`${b.questions} question(s) ayant reçu une réponse : ${b.sans_modele} servie(s) sans modèle (${b.questions ? Math.round((b.sans_modele / b.questions) * 100) : 0} %), ${b.avec_modele} par le modèle, ${b.etage_inconnu} sans trace (transfert direct, ou trace non lue).`);
  l.push(`Coût total relu dans le grand livre : ${cents(b.cout_total_cents)} (${(b.cout_total_cents / 100).toFixed(4)} $ US) pour ${b.appels_modele} appel(s) au modèle ; coût moyen d’une question servie par le modèle : ${b.cout_moyen_avec_modele_cents === null ? '—' : cents(b.cout_moyen_avec_modele_cents)}.`);
  l.push(`Modèle(s) du grand livre : ${Object.entries(b.modeles).map(([m, n]) => `${m} (${n} question(s))`).join(', ') || 'aucun'}.`, '');
  l.push('| Étage | Questions | Coût |', '|---|---:|---:|');
  for (const e of b.par_etage) l.push(`| ${e.etage} | ${e.questions} | ${cents(e.cout_cents)} |`);
  l.push('', '| Test | Compte | Étage | Action | Outils | Modèle | Appels | Coût | Durée |', '|---|---|---:|---|---|---|---:|---:|---:|');
  for (const t of tours) l.push(`| ${t.test} | ${t.compte} | ${t.statut === 200 ? t.etage ?? '—' : `statut ${t.statut}`} | ${t.action ?? '—'} | ${t.outils.join(', ') || '—'} | ${t.modele ?? '—'} | ${t.appels_modele} | ${t.cout_cents === null ? '—' : cents(t.cout_cents)} | ${t.duree_ms} ms |`);
  return l;
}

export const cout: Famille = {
  nom: 'cout',
  titre: '9. Coût',
  prouve: 'Ce que la batterie a coûté et qui a répondu : part des questions servies sans modèle, coût moyen d’une question servie par le modèle, modèle utilisé — relus dans ai_usage et lumi_traces.',
  tests: [
    {
      id: ID_COUT, titre: 'Relevé du coût et de l’étage de chaque question de la batterie',
      fait: 'Aucune question n’est posée. On relit le grand livre du support (ai_usage, source « support ») pour les comptes et la fenêtre de la passe, et on rattache chaque ligne au tour qui l’a produite.',
      si_defaut: 'Sans objet : ce test ne juge pas, il mesure. Le tableau est dans le rapport (section « Coût »).',
      appels: 0,
      executer: async (ctx): Promise<Issue> => {
        const tours = ctx.tours();
        if (!tours.length) return { verdict: 'NON COUVERT', constats: ['aucun tour à relever : lancer la famille cout avec les autres, ou sur un rapport existant (--sortie)'], preuves: [] };
        const debut = tours.reduce((a, t) => (t.debut < a ? t.debut : a), tours[0].debut);
        const fin = tours.reduce((a, t) => (t.fin > a ? t.fin : a), tours[0].fin);
        const comptes = [...new Set(tours.map((t) => t.user_id))];
        const requete = sqlUsageSupport(ctx.org, comptes, debut, fin);
        const lignes = await ctx.sql<LigneUsage>(requete);
        const requeteTraces = sqlTracesSupport(ctx.org, comptes, debut, fin);
        const traces = await ctx.sql<LigneTrace>(requeteTraces);
        const complets = completerEtages(tours, traces.map((x) => ({ ...x, user_id: String(x.user_id), created_at: String(x.created_at) })));
        const { tours: relus, orphelines } = attribuerUsage(complets, lignes.map((l) => ({ user_id: String(l.user_id), model: String(l.model), cost_cents: Number(l.cost_cents), created_at: String(l.created_at) })));
        // Le relevé remplace, tour par tour, ce qui avait été lu à chaud (une écriture du grand livre a pu arriver après).
        tours.splice(0, tours.length, ...relus);
        const b = bilanCout(relus);
        return {
          verdict: 'A RELIRE',
          constats: [
            `${b.questions} question(s) relevée(s) : ${b.sans_modele} sans modèle, ${b.avec_modele} par le modèle, ${b.etage_inconnu} sans trace`,
            `coût total : ${b.cout_total_cents.toFixed(3)} ¢ US pour ${b.appels_modele} appel(s) au modèle ; moyenne par question servie par le modèle : ${b.cout_moyen_avec_modele_cents === null ? '—' : `${b.cout_moyen_avec_modele_cents.toFixed(3)} ¢`}`,
            `modèle(s) : ${Object.entries(b.modeles).map(([m, n]) => `${m} (${n})`).join(', ') || 'aucun'}`,
            ...(orphelines.length ? [`${orphelines.length} ligne(s) du grand livre dans la fenêtre sans tour de la batterie (ces comptes ont servi ailleurs) : ${orphelines.reduce((s, l) => s + l.cost_cents, 0).toFixed(3)} ¢, non comptées`] : []),
          ],
          a_relire: 'Relevé, pas un verdict : lire le tableau de la section « Coût ».',
          preuves: [
            { libelle: 'grand livre du support (SELECT ai_usage)', contenu: `${requete}\n→ ${lignes.length} ligne(s)` },
            { libelle: 'traces du support (SELECT lumi_traces)', contenu: `${requeteTraces}\n→ ${traces.length} trace(s)` },
          ],
        };
      },
    },
  ],
};
