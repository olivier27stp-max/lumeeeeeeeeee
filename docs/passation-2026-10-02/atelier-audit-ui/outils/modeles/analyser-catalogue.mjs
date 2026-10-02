// Analyse HORS LIGNE du catalogue tel que le serveur l'a renvoyé (GET /api/automations/templates,
// relevé le 2026-10-01 dans sorties/modeles/catalogue.json). Aucune requête : lecture du fichier.
//  1. textes sans version anglaise (le moteur envoie alors le français aux clients d'un bureau anglophone) ;
//  2. variables citées que le serveur ne sait pas remplir (liste VARIABLES_CONNUES de src/lib/emailBodyText.ts) ;
//  3. conditions du déclencheur et des étapes « si » (ce que l'aperçu affiche avec ses clés techniques) ;
//  4. canaux annoncés sur la carte contre canaux réellement présents dans les étapes.
import { readFileSync, writeFileSync } from 'node:fs';

const modeles = JSON.parse(readFileSync('D:/lume-uiaudit/sorties/modeles/catalogue.json', 'utf8')).modeles;
const src = readFileSync('D:/lume-uiaudit/wt/src/lib/emailBodyText.ts', 'utf8');
const bloc = src.slice(src.indexOf('export const VARIABLES_CONNUES'), src.indexOf('];', src.indexOf('export const VARIABLES_CONNUES')));
const CONNUES = new Set([...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
const CANAL = { send_sms: 'sms', send_email: 'courriel', create_task: 'tache', create_notification: 'notification', request_review: 'avis', move_deal_stage: 'pipeline' };

const rapport = { sans_anglais: [], variables_inconnues: [], conditions: [], canaux_manquants: [] };
for (const m of modeles) {
  const actions = m.steps ? m.steps.filter((e) => e.type === 'action').map((e) => e.action) : m.actions;
  for (const a of actions) {
    for (const [cle, v] of Object.entries(a.config ?? {})) {
      if (typeof v !== 'string' || !/^(body|subject|title|description|message)$/.test(cle) || !v.trim()) continue;
      if (typeof a.config[`${cle}_en`] !== 'string') rapport.sans_anglais.push({ modele: m.id, nom: m.nom.fr, action: a.type, champ: cle, texte: v.slice(0, 90) });
    }
    for (const [cle, v] of Object.entries(a.config ?? {})) {
      if (typeof v !== 'string' || !/^(body|subject|title|description|message)(_en)?$/.test(cle)) continue;
      const citees = [...v.matchAll(/[{[]([A-Za-z]\w*)[}\]]/g)].map((x) => x[1]);
      for (const c of new Set(citees)) if (!CONNUES.has(c) && !/^(client|deal|job|quote|invoice)_cf_/.test(c)) rapport.variables_inconnues.push({ modele: m.id, action: a.type, champ: cle, variable: c });
    }
  }
  if (Object.keys(m.conditions ?? {}).length) rapport.conditions.push({ modele: m.id, nom: m.nom.fr, ou: 'déclencheur', conditions: m.conditions });
  for (const e of m.steps ?? []) if (e.type === 'si') rapport.conditions.push({ modele: m.id, nom: m.nom.fr, ou: `étape ${e.id}`, conditions: e.conditions });
  const reels = [...new Set(actions.map((a) => CANAL[a.type]).filter(Boolean))];
  const manquants = reels.filter((c) => !m.canaux.includes(c));
  if (manquants.length) rapport.canaux_manquants.push({ modele: m.id, nom: m.nom.fr, annonces: m.canaux, presents_dans_les_etapes: reels, manquants, nb_etapes_annonce: m.nb_etapes, nb_etapes_reel: m.steps?.length });
}
writeFileSync('D:/lume-uiaudit/sorties/modeles/preuves/analyse-catalogue.json', JSON.stringify(rapport, null, 1));
console.log(`${modeles.length} modèles`);
console.log(`textes sans version anglaise : ${rapport.sans_anglais.length}`);
for (const x of rapport.sans_anglais) console.log(`  ${x.modele} · ${x.action}.${x.champ} : ${x.texte}`);
console.log(`variables inconnues : ${rapport.variables_inconnues.length}`);
for (const x of rapport.variables_inconnues) console.log(`  ${x.modele} · ${x.action}.${x.champ} : [${x.variable}]`);
console.log(`conditions (clés techniques) : ${rapport.conditions.length}`);
for (const x of rapport.conditions) console.log(`  ${x.modele} (${x.ou}) : ${JSON.stringify(x.conditions)}`);
console.log(`canaux manquants sur la carte : ${rapport.canaux_manquants.length}`);
for (const x of rapport.canaux_manquants) console.log(`  ${x.modele} : annoncés ${x.annonces.join('+')} ; manquants ${x.manquants.join('+')} ; étapes annoncées ${x.nb_etapes_annonce} / réelles ${x.nb_etapes_reel}`);
