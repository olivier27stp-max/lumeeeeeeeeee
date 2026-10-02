// Jetable : ouvre un onglet sur MON bureau de test (jeu « declencheurs »).
import { ouvrir, admin, inventaire } from '../nav.mjs';
export { admin, inventaire };
export const ORG_A = '085a9403-afb6-4f9c-98f6-afa9a5e3d9bd';
export const ORG_B = '98ae9daa-da2f-43b5-bae7-dedf27037bda';
export const CAP = 'D:/lume-uiaudit/sorties/declencheurs/captures';
export async function ouvrirA(o = {}) {
  return ouvrir({ compte: 'qa-auto-proprio-a+declencheurs@lume-qa.test', org: ORG_A, ...o });
}
export async function ouvrirB(o = {}) {
  return ouvrir({ compte: 'qa-auto-proprio-b+declencheurs@lume-qa.test', org: ORG_B, ...o });
}
export async function cap(page, nom) {
  const chemin = `${CAP}/${nom}.png`;
  await page.screenshot({ path: chemin });
  return chemin;
}
