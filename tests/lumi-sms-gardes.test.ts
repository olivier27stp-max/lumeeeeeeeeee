/**
 * Lumi par texto a les MÊMES gardes que Lumi dans l'app (mission fiabilité, 2026-10-01).
 *
 * Avant : le texto appelait l'agent sans vérifier le droit d'utiliser Lumi, sans
 * filtrer les outils par rôle, sans restrictions dans le prompt, sans plafond
 * journalier, sans trace, et une note de mémoire s'écrivait sans « OUI ».
 * La garde d'exécution de chaque outil était la seule barrière.
 *
 * Garde statique : l'ordre et la présence de chaque garde dans le chemin du texto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SMS = readFileSync(resolve(__dirname, '../server/lib/sms/lumi-sms.ts'), 'utf8');
const avantLeTour = SMS.slice(0, SMS.indexOf('const resultat = await tourLumi({'));
const appel = SMS.slice(SMS.indexOf('const resultat = await tourLumi({'), SMS.indexOf('if (resultat.plafond)'));

describe('Lumi par texto — gardes', () => {
  it('le droit d’utiliser Lumi est vérifié AVANT tout appel au modèle', () => {
    expect(avantLeTour).toContain("hasPermission(role, 'external_agent.use')");
    expect(avantLeTour).toMatch(/if \(!role \|\| !hasPermission\(role, 'external_agent\.use'\)\) \{\s+return vide\(/);
  });

  it('le plafond journalier s’applique, avec un message qui ne parle pas de crédits', () => {
    expect(avantLeTour).toContain("verifierPlafond('lumi')");
    const bloc = avantLeTour.slice(avantLeTour.indexOf("verifierPlafond('lumi')"));
    expect(bloc.slice(0, 300)).not.toMatch(/crédit|credit/i);
  });

  it('seuls les outils du rôle sont remis au modèle, et le prompt dit ce que le rôle ne permet pas', () => {
    expect(avantLeTour).toContain('outilsPermis(role, voitLesMontants)');
    expect(avantLeTour).toContain('restrictionsDe(role, voitLesMontants, ctx.langue)');
    expect(appel).toContain('outilsPermis: permis');
    expect(SMS).toMatch(/focus: consignesSms\(ctx\.langue\),\s+restrictions,/);
  });

  it('aucune écriture ne part d’office : chacune attend le « OUI »', () => {
    expect(appel).toContain('ecrituresRestantes: 0');
  });

  it('le tour est compté au plafond journalier et tracé', () => {
    expect(appel).toContain("ajouterDepense('lumi'");
    expect(appel).toContain('journaliserTrace(ctx.admin');
    expect(appel).toContain("canal: 'sms'");
  });
});
