/**
 * Import CSV de deals — analyse du fichier, côté navigateur.
 *
 * POURQUOI PAS LE SYSTÈME DE MIGRATION EXISTANT. `server/lib/migration/`
 * fait déjà de l'import (mappage de colonnes, détection de doublons, bot
 * d'approbation), mais c'est une machine conçue pour reprendre un CRM entier
 * — Jobber, HousecallPro — avec validation humaine et reprise après échec.
 * La faire tourner pour coller 40 lignes d'un Excel serait demander à
 * quelqu'un de remplir un dossier de migration pour ajouter des prospects.
 *
 * Ici : on lit le fichier, on montre ce qu'on a compris, l'utilisateur
 * confirme. L'écriture passe ensuite par `ingest_lead`, le MÊME chemin que
 * le formulaire public — donc même rapprochement par téléphone ou courriel,
 * même première étape ouverte, même idempotence. Un import ne crée jamais un
 * doublon d'un client déjà connu.
 *
 * L'analyse est ici plutôt que sur le serveur pour une raison simple :
 * l'utilisateur doit VOIR ce qui sera importé avant que quoi que ce soit ne
 * parte. Un aperçu qui exige un aller-retour réseau n'est pas un aperçu.
 */

export interface LigneImport {
  /** Numéro de ligne dans le fichier, pour désigner une erreur précisément. */
  ligne: number;
  prenom: string;
  nom: string;
  courriel: string;
  telephone: string;
  adresse: string;
  /** Ce qui empêche d'importer CETTE ligne. Vide = bonne. */
  probleme: string;
  /** Cellules brutes, dans l'ordre des en-têtes (champs personnalisés). */
  cellules?: string[];
}

export interface AnalyseCsv {
  lignes: LigneImport[];
  /** Colonnes du fichier qu'on n'a pas su relier — affichées pour information. */
  colonnesIgnorees: string[];
  /** Le fichier lui-même est inutilisable (vide, illisible). */
  erreur: string | null;
  /** En-têtes d'origine, et ceux déjà lus comme nom/courriel/téléphone/adresse. */
  entetes?: string[];
  indexReconnus?: number[];
}

/**
 * Découpe une ligne CSV en respectant les guillemets.
 *
 * Un `split(',')` casse sur « Tremblay, Jean » et sur toute adresse — qui en
 * contient presque toujours une. RFC 4180 : un guillemet doublé à l'intérieur
 * d'un champ cité représente un guillemet littéral.
 */
export function decouperLigne(ligne: string, separateur: string): string[] {
  const champs: string[] = [];
  let courant = '';
  let dansGuillemets = false;

  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (ligne[i + 1] === '"') { courant += '"'; i++; }
        else dansGuillemets = false;
      } else courant += c;
    } else if (c === '"') {
      dansGuillemets = true;
    } else if (c === separateur) {
      champs.push(courant);
      courant = '';
    } else courant += c;
  }
  champs.push(courant);
  return champs.map((c) => c.trim());
}

/**
 * Devine le séparateur.
 *
 * Excel en français écrit des CSV séparés par point-virgule — c'est ce que
 * reçoit la moitié des PME québécoises, et un import qui n'accepte que la
 * virgule leur renvoie « 1 colonne détectée » sans expliquer pourquoi.
 */
export function devinerSeparateur(premiereLigne: string): string {
  const pv = (premiereLigne.match(/;/g) ?? []).length;
  const vg = (premiereLigne.match(/,/g) ?? []).length;
  const tab = (premiereLigne.match(/\t/g) ?? []).length;
  if (tab > pv && tab > vg) return '\t';
  return pv > vg ? ';' : ',';
}

/**
 * Les noms de colonnes acceptés, par champ.
 *
 * Volontairement larges : le fichier vient d'un export Lume, d'un Jobber, ou
 * d'un Excel tapé à la main par quelqu'un qui écrit « Tel » ou « Téléphone ».
 * Refuser un fichier parce que l'en-tête dit « Courriel » au lieu de « Email »
 * ferait perdre plus de temps que la saisie manuelle.
 */
const SYNONYMES: Record<keyof Omit<LigneImport, 'ligne' | 'probleme' | 'cellules'>, string[]> = {
  prenom: ['prenom', 'prénom', 'first name', 'firstname', 'first_name', 'given name'],
  nom: ['nom', 'last name', 'lastname', 'last_name', 'surname', 'nom de famille'],
  courriel: ['courriel', 'email', 'e-mail', 'adresse courriel', 'mail'],
  telephone: ['telephone', 'téléphone', 'phone', 'tel', 'tél', 'mobile', 'cellulaire', 'phone number'],
  adresse: ['adresse', 'address', 'rue', 'street', 'adresse complète'],
};

/**
 * « Client », « Name », « Contact Name » : un seul champ qui porte le nom
 * complet. `contact name` vient de l'export d'opportunités de GoHighLevel —
 * sans lui, chaque ligne de leur fichier était rejetée « sans nom ».
 */
const NOM_COMPLET = [
  'client', 'nom complet', 'name', 'full name', 'contact', 'customer',
  'contact name', 'nom du contact', 'client name',
];

function normaliser(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Analyse un CSV et rend les lignes prêtes à importer.
 *
 * Une ligne sans AUCUN moyen de joindre la personne (ni courriel ni
 * téléphone) est marquée en problème plutôt que silencieusement ignorée :
 * l'utilisateur doit savoir que ces trois lignes-là ne partiront pas, et
 * pourquoi.
 */
/**
 * Découpe le fichier en ENREGISTREMENTS, pas en lignes de texte.
 *
 * Un champ entre guillemets peut contenir des sauts de ligne — c'est le cas
 * du champ « Notes » exporté par GoHighLevel, qui tient plusieurs phrases.
 * Un split naïf sur le retour à la ligne coupait au milieu : deux deals
 * devenaient quatre lignes bancales, toutes rejetées « sans nom ».
 *
 * On avance donc caractère par caractère en suivant l'état « dans des
 * guillemets ou non », comme le fait `decouperLigne` pour les colonnes.
 */
export function decouperEnregistrements(texte: string): string[] {
  const out: string[] = [];
  let courant = '';
  let dansGuillemets = false;

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];

    if (c === '"') {
      // Deux guillemets de suite = un guillemet littéral, pas une sortie.
      if (dansGuillemets && texte[i + 1] === '"') {
        courant += '""';
        i++;
        continue;
      }
      dansGuillemets = !dansGuillemets;
      courant += c;
      continue;
    }

    if (!dansGuillemets && (c === '\n' || c === '\r')) {
      // CRLF : on ne coupe qu'une seule fois.
      if (c === '\r' && texte[i + 1] === '\n') i++;
      if (courant.trim() !== '') out.push(courant);
      courant = '';
      continue;
    }

    courant += c;
  }

  if (courant.trim() !== '') out.push(courant);
  return out;
}

export function analyserCsv(texte: string): AnalyseCsv {
  // Le BOM d'Excel se colle au premier en-tête et casse la reconnaissance.
  const propre = texte.replace(/^﻿/, '');
  const brutes = decouperEnregistrements(propre);

  if (brutes.length === 0) return { lignes: [], colonnesIgnorees: [], erreur: 'fichier_vide' };
  if (brutes.length === 1) return { lignes: [], colonnesIgnorees: [], erreur: 'aucune_donnee' };

  const sep = devinerSeparateur(brutes[0]);
  const entetes = decouperLigne(brutes[0], sep).map(normaliser);

  const index: Partial<Record<keyof typeof SYNONYMES, number>> = {};
  for (const [champ, noms] of Object.entries(SYNONYMES)) {
    const i = entetes.findIndex((e) => noms.includes(e));
    if (i >= 0) index[champ as keyof typeof SYNONYMES] = i;
  }
  const iNomComplet = entetes.findIndex((e) => NOM_COMPLET.includes(e));

  const reconnues = new Set([...Object.values(index), iNomComplet].filter((i) => i >= 0));
  const colonnesIgnorees = decouperLigne(brutes[0], sep)
    .filter((_, i) => !reconnues.has(i))
    .filter((c) => c.trim() !== '');

  if (reconnues.size === 0) {
    return { lignes: [], colonnesIgnorees, erreur: 'aucune_colonne_reconnue' };
  }

  const lignes: LigneImport[] = brutes.slice(1).map((brute, n) => {
    const champs = decouperLigne(brute, sep);
    const lire = (c: keyof typeof SYNONYMES) => {
      const i = index[c];
      return i === undefined ? '' : (champs[i] ?? '');
    };

    let prenom = lire('prenom');
    let nom = lire('nom');

    // Un seul champ « Client » : le premier mot est le prénom, le reste le nom.
    if (!prenom && !nom && iNomComplet >= 0) {
      const complet = (champs[iNomComplet] ?? '').trim();
      const parties = complet.split(/\s+/);
      prenom = parties[0] ?? '';
      nom = parties.slice(1).join(' ');
    }

    const courriel = lire('courriel');
    const telephone = lire('telephone');

    let probleme = '';
    if (!prenom && !nom) probleme = 'sans_nom';
    else if (!courriel && !telephone) probleme = 'sans_contact';

    return {
      ligne: n + 2, // +2 : l'en-tête est la ligne 1, et on compte depuis 1.
      prenom, nom, courriel, telephone,
      adresse: lire('adresse'),
      probleme,
      cellules: champs,
    };
  });

  return { lignes, colonnesIgnorees, erreur: null, entetes: decouperLigne(brutes[0], sep), indexReconnus: [...reconnues] };
}
