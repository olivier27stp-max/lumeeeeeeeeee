// La liste des automatisations tient sur une tablette : colonnes secondaires repliées par palier.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:/lume-uiaudit/wt-lumi/src/pages/Automations.tsx';
let s = readFileSync(f, 'utf8');
const r = (avant, apres) => { if (!s.includes(avant)) throw new Error('introuvable : ' + avant.slice(0, 70)); s = s.replace(avant, apres); };

r('<table className="w-full min-w-[980px] text-[13px]">',
  `{/* TABLETTE (mesuré sur un iPad le 2026-10-01) : une largeur minimale de
                  980 px poussait l'interrupteur, les messages et le menu « ⋮ » hors
                  écran dès 1024 px ; en portrait on ne voyait plus que « Nom ». Les
                  colonnes secondaires se replient par palier — compteurs à partir de
                  1024 px, dates à partir de 1280 px — et les actions restent là. */}
              <table className="w-full min-w-[440px] text-[13px]">`);
r("['declenches', fr ? 'Total déclenché' : 'Total enrolled', ''],", "['declenches', fr ? 'Total déclenché' : 'Total enrolled', 'hidden lg:table-cell'],");
r("['en_cours', fr ? 'En cours' : 'Active enrolled', ''],", "['en_cours', fr ? 'En cours' : 'Active enrolled', 'hidden lg:table-cell'],");
r("['modifiee', fr ? 'Modifiée le' : 'Last updated', 'hidden lg:table-cell'],", "['modifiee', fr ? 'Modifiée le' : 'Last updated', 'hidden xl:table-cell'],");
r("['creee', fr ? 'Créée le' : 'Created on', 'hidden lg:table-cell'],", "['creee', fr ? 'Créée le' : 'Created on', 'hidden xl:table-cell'],");
r(`<td className="px-3 py-3 tabular-nums text-primary">{stats ? (stats[rule.id]?.declenches ?? 0) : '—'}</td>`,
  `<td className="hidden px-3 py-3 tabular-nums text-primary lg:table-cell">{stats ? (stats[rule.id]?.declenches ?? 0) : '—'}</td>`);
r(`<td className="px-3 py-3 tabular-nums text-primary">{stats ? (stats[rule.id]?.en_cours ?? 0) : '—'}</td>`,
  `<td className="hidden px-3 py-3 tabular-nums text-primary lg:table-cell">{stats ? (stats[rule.id]?.en_cours ?? 0) : '—'}</td>`);
r(`<td className="hidden px-3 py-3 text-text-secondary lg:table-cell">{dateCourte(rule.updated_at)}</td>`,
  `<td className="hidden px-3 py-3 text-text-secondary xl:table-cell">{dateCourte(rule.updated_at)}</td>`);
r(`<td className="hidden px-3 py-3 text-text-secondary lg:table-cell">{dateCourte(rule.created_at)}</td>`,
  `<td className="hidden px-3 py-3 text-text-secondary xl:table-cell">{dateCourte(rule.created_at)}</td>`);
writeFileSync(f, s);
console.log('ok');
