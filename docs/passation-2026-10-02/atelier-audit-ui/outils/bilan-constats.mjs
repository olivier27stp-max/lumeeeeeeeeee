// Assemble le tableau des constats de l'audit (fichiers des lots + registre) avec leur statut, en markdown.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const STATUT = {
  // sécurité / rôles
  'roles-01': '#862', 'roles-02': '#862', 'roles-03': '#862', 'roles-04': '#862',
  'roles-05': 'OUVERT — demande une migration (voir § 6)', 'roles-06': 'OUVERT — demande une migration (voir § 6)', 'roles-07': 'OUVERT — demande une migration (voir § 6)',
  'roles-08': '#870', 'roles-09': '#870', 'roles-10': '#870', 'roles-11': '#866', 'roles-12': '#870',
  'roles-13': '#870 (job prêt à facturer) — le texte anglais « New lead » des règles DÉJÀ semées reste (migration de données)',
  'roles-14': '#870 (plus de confirmation renvoyée si la visite n’a pas bougé) — reste : tout rôle peut l’annoncer',
  // liste
  'liste-01': '#859', 'liste-02': '#859', 'liste-03': '#870', 'liste-04': '#870', 'liste-05': '#870', 'liste-06': '#859', 'liste-07': '#870',
  'liste-08': '#870', 'liste-09': '#870', 'liste-10': '#870', 'liste-11': '#870', 'liste-12': 'NON FAIT — décision de produit', 'liste-13': '#870',
  'liste-14': '#870', 'liste-15': '#870', 'liste-16': '#859', 'liste-17': '#870',
  // éditeur
  'EDITEUR-01': '#859', 'EDITEUR-02': '#859', 'EDITEUR-03': '#859', 'EDITEUR-04': '#870', 'EDITEUR-05': '#870', 'EDITEUR-06': '#870', 'EDITEUR-HL1': '#859',
  'declencheurs-01': '#859', 'declencheurs-02': '#870', 'declencheurs-03': '#870', 'declencheurs-04': '#870', 'declencheurs-05': '#870',
  'declencheurs-06': '#870', 'declencheurs-07': '#870', 'declencheurs-08': '#870', 'declencheurs-09': '#870', 'declencheurs-10': '#859',
  'actions-01': '#859', 'actions-02': '#870', 'actions-03': '#870', 'actions-04': '#840', 'actions-05': '#866', 'actions-06': '#859', 'actions-07': '#870',
  // modèles
  'modeles-01': '#870', 'modeles-02': '#859', 'modeles-03': '#859', 'modeles-04': '#870', 'modeles-05': '#870', 'modeles-06': '#870', 'modeles-07': '#870',
  'modeles-08': '#870', 'modeles-09': '#870', 'modeles-10': '#870', 'modeles-11': '#859 / #870', 'modeles-12': '#859', 'modeles-13': 'OUVERT — libellé à décider (voir § 6)',
};
const lots = ['liste', 'editeur', 'declencheurs', 'actions', 'modeles', 'roles'];
const lignes = [];
for (const lot of lots) {
  const f = `D:/lume-uiaudit/sorties/${lot}/constats.jsonl`;
  if (!existsSync(f)) continue;
  for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    let c; try { c = JSON.parse(l); } catch { continue; }
    lignes.push({ id: c.id, gravite: c.gravite ?? '?', ecran: (c.ecran ?? '').replace(/\|/g, '/').slice(0, 70), quoi: `${(c.element ?? '').replace(/\|/g, '/').slice(0, 80)} — ${(c.observe ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 170)}`, statut: STATUT[c.id] ?? 'NON CLASSÉ' });
  }
}
const ordre = { bloquant: 0, majeur: 1, mineur: 2, cosmetique: 3 };
lignes.sort((a, b) => (ordre[a.gravite] ?? 9) - (ordre[b.gravite] ?? 9) || a.id.localeCompare(b.id));
const compte = {};
for (const l of lignes) { const k = l.gravite; compte[k] ??= { total: 0, corriges: 0 }; compte[k].total += 1; if (/^#\d+/.test(l.statut) && !/reste/.test(l.statut)) compte[k].corriges += 1; }
let md = '| N° | Gravité | Écran | Constat | Statut |\n|---|---|---|---|---|\n';
for (const l of lignes) md += `| ${l.id} | ${l.gravite} | ${l.ecran} | ${l.quoi} | ${l.statut} |\n`;
writeFileSync('D:/lume-uiaudit/sorties/tableau-constats.md', md);
console.log(JSON.stringify(compte), 'total', lignes.length, 'non classés', lignes.filter((l) => l.statut === 'NON CLASSÉ').map((l) => l.id).join(','));
