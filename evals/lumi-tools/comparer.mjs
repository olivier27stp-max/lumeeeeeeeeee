// Compare deux passes de la batterie (coût ET réponses), cas par cas.
//   node evals/lumi-tools/comparer.mjs <avant.json> <apres.json> [--reponses]
import { readFileSync } from 'node:fs';

const [fa, fb] = process.argv.slice(2);
const montrer = process.argv.includes('--reponses');
const A = JSON.parse(readFileSync(fa, 'utf8')).resultats;
const B = JSON.parse(readFileSync(fb, 'utf8')).resultats;
const a = new Map(A.map((r) => [r.id, r]));
const bon = (r) => r.verdict_outil === 'exact' && r.verdict_params !== 'faux';
const communs = B.filter((r) => a.has(r.id));
const somme = (rs) => rs.reduce((t, r) => t + r.cout_cents, 0);
const ligne = (nom, f) => {
  const b = communs.filter(f); if (!b.length) return;
  const av = b.map((r) => a.get(r.id));
  console.log(`${nom.padEnd(26)} ${String(b.length).padStart(3)} cas | bons ${av.filter(bon).length} → ${b.filter(bon).length} | coût moyen ${(somme(av) / b.length).toFixed(2)} → ${(somme(b) / b.length).toFixed(2)} ¢ (${((somme(b) / somme(av) - 1) * 100).toFixed(0)} %)`);
};
console.log(`avant : ${fa}\naprès : ${fb}\ncas communs : ${communs.length} ; nouveaux cas : ${B.length - communs.length}`);
ligne('toutes les demandes', () => true);
ligne('actions', (r) => r.type === 'action');
ligne('lectures', (r) => r.type === 'lecture');
ligne('clarifications', (r) => r.type === 'clarification');
ligne('sensibles', (r) => r.sensible);
console.log(`faux « c'est fait » : ${A.filter((r) => r.faux_fait).length} → ${B.filter((r) => r.faux_fait).length} | erreurs : ${A.filter((r) => r.verdict_outil === 'erreur').length} → ${B.filter((r) => r.verdict_outil === 'erreur').length}`);

const court = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 260);
console.log('\n── verdicts qui changent ──');
for (const r of communs) {
  const p = a.get(r.id);
  if (bon(p) === bon(r)) continue;
  console.log(`${bon(r) ? 'RÉPARÉ' : 'RECUL '} ${r.id} | attendu ${r.outil ?? '(clarification)'} | avant : ${p.proposition ?? '—'} [${p.lectures.join(',')}] | après : ${r.proposition ?? '—'} [${r.lectures.join(',')}]${r.params_manquants?.length ? ' | manque ' + r.params_manquants.join(',') : ''}\n   avant : ${court(p.reponse)}\n   après : ${court(r.reponse)}`);
}
console.log('\n── même verdict, mais outil ou lectures différents ──');
for (const r of communs) {
  const p = a.get(r.id);
  if (bon(p) !== bon(r)) continue;
  if (p.proposition === r.proposition && p.lectures.join() === r.lectures.join()) continue;
  console.log(`${r.id} | avant : ${p.proposition ?? '—'} [${p.lectures.join(',')}] → après : ${r.proposition ?? '—'} [${r.lectures.join(',')}]`);
}
const nouveaux = B.filter((r) => !a.has(r.id));
if (nouveaux.length) { console.log('\n── nouveaux cas ──'); for (const r of nouveaux) console.log(`${bon(r) ? 'bon ' : 'RATÉ'} ${r.id} | propose ${r.proposition ?? '—'} [${r.lectures.join(',')}] | ${r.cout_cents.toFixed(2)} ¢ | ${court(r.reponse)}`); }
if (montrer) { console.log('\n── toutes les réponses (après) ──'); for (const r of B) console.log(`\n[${bon(r) ? 'bon' : 'RATÉ'}] ${r.id} (${r.type}) — ${r.q}\n   → ${r.proposition ? 'CARTE ' + r.proposition + ' ' + JSON.stringify(r.args ?? {}).slice(0, 200) : ''} ${court(r.reponse)}`); }
