// L'écran des formulaires : plusieurs formulaires, chacun vers son pipeline.
//
// CE QUE CES TESTS PROTÈGENT. Le serveur sait gérer plusieurs formulaires
// depuis #617, mais l'écran n'en montrait qu'un et n'offrait aucun moyen d'en
// créer un second. Le danger en branchant la liste : « Enregistrer » sans
// désigner de cible fait retomber le serveur sur le formulaire le plus
// ancien — éditer le deuxième écraserait donc le premier, questions et lien
// public perdus, sans le moindre avertissement.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const ecran = () => fs.readFileSync('src/pages/RequestFormSettings.tsx', 'utf8');
const api = () => fs.readFileSync('src/lib/requestFormsApi.ts', 'utf8');

describe("l'API sait parler de plusieurs formulaires", () => {
  it('expose une lecture au pluriel', () => {
    expect(api()).toContain('export async function fetchRequestForms');
  });

  it('retombe sur `form` si le serveur ne renvoie pas encore `forms`', () => {
    // Le serveur et l'écran ne se déploient pas à la même seconde : sans ce
    // repli, l'écran afficherait une liste vide alors qu'un formulaire existe.
    const s = api();
    expect(s).toContain('if (Array.isArray(forms)) return forms;');
    expect(s).toContain('return form ? [form] : [];');
  });

  it('la sauvegarde accepte id, creer et pipeline_id', () => {
    const s = api();
    const bloc = s.slice(s.indexOf('export async function upsertRequestForm'), s.indexOf('export async function regenerateApiKey'));
    expect(bloc).toContain('id?: string;');
    expect(bloc).toContain('creer?: boolean;');
    expect(bloc).toContain('pipeline_id?: string | null;');
  });

  it('régénérer une clé vise un formulaire précis', () => {
    const s = api();
    expect(s).toContain('regenerateApiKey(formId?: string)');
    expect(s).toContain('JSON.stringify(formId ? { id: formId } : {})');
  });
});

describe("l'écran ne peut pas écraser le mauvais formulaire", () => {
  it('la sauvegarde envoie TOUJOURS l id du formulaire ouvert', () => {
    // Le point le plus dangereux de tout ce chantier.
    expect(ecran()).toContain('id: form?.id,');
  });

  it('sans formulaire ouvert, elle demande une CRÉATION', () => {
    expect(ecran()).toContain("creer: !form?.id ? true : undefined,");
  });

  it('régénérer la clé vise le formulaire ouvert', () => {
    expect(ecran()).toContain('regenerateApiKey(form?.id)');
  });
});

describe('le pipeline du formulaire', () => {
  it('est chargé, affiché et sauvegardé', () => {
    const s = ecran();
    expect(s).toContain('setPipelineId(data.pipeline_id ?? null)');
    expect(s).toContain('pipeline_id: pipelineId,');
  });

  it('le menu ne s affiche que s il existe un pipeline', () => {
    // Proposer un réglage sans destination possible n'aide personne.
    expect(ecran()).toContain('pipelinesDispo.length > 0 &&');
  });

  it('« Pipeline par défaut » reste un choix explicite', () => {
    // Valeur vide = null = pipeline par défaut. C'est le comportement
    // d'avant ce chantier, il doit rester atteignable.
    const s = ecran();
    expect(s).toContain("setPipelineId(e.target.value || null)");
    expect(s).toMatch(/Pipeline par défaut/);
  });

  it('le menu est accessible', () => {
    // Le cliquet du projet : 0 champ sans label lié.
    const s = ecran();
    expect(s).toContain('htmlFor={`${id}-pipeline`}');
    expect(s).toContain('id={`${id}-pipeline`}');
  });
});

describe('la barre des formulaires', () => {
  it('liste les formulaires et offre d en créer un', () => {
    const s = ecran();
    expect(s).toContain('formulaires.map((f)');
    expect(s).toContain('onClick={nouveauFormulaire}');
    expect(s).toMatch(/Nouveau formulaire/);
  });

  it('ne s affiche pas quand il n y a qu un seul formulaire', () => {
    // Avec un seul, elle n'apprend rien et vole de la place.
    expect(ecran()).toContain('formulaires.length > 1 || !form');
  });

  it('la liste suit une création sans recharger la page', () => {
    const s = ecran();
    expect(s).toContain('setFormulaires((prev)');
    expect(s).toContain('if (i === -1) return [...prev, result];');
  });
});
