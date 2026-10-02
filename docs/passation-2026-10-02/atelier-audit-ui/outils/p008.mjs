// P-008 : l'avertissement « texte d'exemple » porte un code, et la liste demande confirmation avant de publier.
import { readFileSync, writeFileSync } from 'node:fs';
const racine = 'D:/lume-uiaudit/wt-lumi/';
const maj = (f, paires) => {
  let s = readFileSync(racine + f, 'utf8');
  for (const [a, b] of paires) { if (!s.includes(a)) throw new Error(`introuvable dans ${f} : ${a.slice(0, 70)}`); s = s.replace(a, b); }
  writeFileSync(racine + f, s);
  console.log(f, 'ok');
};
maj('src/lib/automationCatalogue.ts', [
  [`  gravite: 'bloquant' | 'avertissement';
}`, `  gravite: 'bloquant' | 'avertissement';
  /**
   * Le genre d'avertissement, quand un écran doit le reconnaître sans lire la
   * phrase. \`texte_exemple\` : une étape porte encore le texte d'exemple de
   * l'éditeur — la liste demande confirmation avant de publier.
   */
  code?: 'texte_exemple';
}`],
  [`        \`“\${modele.en}” still carries the sample text (“\${court}”)\${ou}: nobody wrote it.\`,
        'avertissement', etapeId,
      );
      break;`, `        \`“\${modele.en}” still carries the sample text (“\${court}”)\${ou}: nobody wrote it.\`,
        'avertissement', etapeId,
      );
      out[out.length - 1].code = 'texte_exemple';
      break;`],
]);
maj('src/lib/publicationAutomatisation.ts', [
  [`/** Seulement ce qui EMPÊCHE de publier. */`, `/**
 * Les étapes qui portent encore le texte d'exemple de l'éditeur — à montrer
 * AVANT de publier, là où aucune confirmation ne s'affichait (interrupteur et
 * lot de la liste). L'éditeur, lui, les liste déjà dans sa confirmation.
 */
export function textesDExemple(regle: RegleAPublier): ProblemePublication[] {
  return problemesPublication(regle).filter((p) => p.code === 'texte_exemple');
}

/** Seulement ce qui EMPÊCHE de publier. */`],
]);
maj('src/pages/Automations.tsx', [
  [`    setRestentAffichees((prev) => (prev.has(rule.id) ? prev : new Set(prev).add(rule.id)));
    const voulu = fileBascule.basculer(rule.id, rule.is_active);`, `    if (versActive && !(await confirmerTextesDExemple([rule]))) return;
    setRestentAffichees((prev) => (prev.has(rule.id) ? prev : new Set(prev).add(rule.id)));
    const voulu = fileBascule.basculer(rule.id, rule.is_active);`],
  [`  const handleToggle = async (rule: AutomationRule) => {`, `  /**
   * Publier une étape restée sur le TEXTE D'EXEMPLE de l'éditeur : on demande.
   *
   * L'interrupteur et le lot publiaient sans un mot ; le texte d'exemple
   * (« Bonjour [client_name], c'est [company_name]. Merci ! ») partait alors
   * à chaque client (audit du 2026-10-01, vécu en prod). Rien à signaler :
   * aucune fenêtre, comme avant.
   */
  const confirmerTextesDExemple = async (aPublier: AutomationRule[]): Promise<boolean> => {
    const concernees = aPublier
      .map((r) => ({ r, exemples: textesDExemple({ trigger_event: r.trigger_event, steps: r.steps, actions: r.actions, conditions: (r.conditions ?? null) as Record<string, unknown> | null, is_preset: r.is_preset, fr }) }))
      .filter((x) => x.exemples.length > 0);
    if (concernees.length === 0) return true;
    confirmationOuverte.current = true;
    try {
      return await confirmer({
        title: fr ? 'Publier avec le texte d’exemple ?' : 'Publish with the sample text?',
        message: [
          ...concernees.flatMap(({ r, exemples }) => exemples.map((e) => (concernees.length > 1 ? \`\${localizeAutomationName(r.name, language)} — \${e.message}\` : e.message))),
          fr
            ? 'Ce texte partira tel quel. Ouvrez l’automatisation pour l’écrire, ou publiez si c’est bien ce que vous voulez envoyer.'
            : 'This text will go out as is. Open the automation to write it, or publish if that is what you want to send.',
        ].join('\n\n'),
        confirmLabel: fr ? 'Publier quand même' : 'Publish anyway',
      });
    } finally {
      confirmationOuverte.current = false;
    }
  };

  const handleToggle = async (rule: AutomationRule) => {`],
  [`    if (cibles.length === 0) { setCochees(new Set()); return; }
    setLotEnCours(true);`, `    if (cibles.length === 0) { setCochees(new Set()); return; }
    if (actif && !(await confirmerTextesDExemple(cibles))) return;
    setLotEnCours(true);`],
  [`import { confirmer } from '../components/ui/ConfirmDialog';`, `import { confirmer } from '../components/ui/ConfirmDialog';
import { textesDExemple } from '../lib/publicationAutomatisation';`],
]);
