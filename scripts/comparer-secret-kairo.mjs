#!/usr/bin/env node
/**
 * Compare le secret de handoff entre Lume et Kairo, sans jamais l'afficher.
 *
 * POURQUOI UN SCRIPT PLUTOT QU'UN COUP D'OEIL
 * Comparer deux chaines de 64 caracteres a l'oeil ne detecte pas un espace en
 * fin, un retour a la ligne, ou des guillemets ajoutes par l'editeur. Ces trois
 * pieges changent le HMAC sans rien changer a l'apparence.
 *
 * Le script compare les empreintes SHA256 : elles different des qu'un seul
 * octet change, et ne permettent pas de remonter a la valeur.
 *
 * USAGE
 *   node scripts/comparer-secret-kairo.mjs
 *   node scripts/comparer-secret-kairo.mjs "<chemin du .env de Kairo>"
 */
import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';

const CHEMIN_KAIRO_DEFAUT =
  'C:\\Users\\Rafba\\OneDrive\\Documents\\Ai automation dashboard\\backend\\.env';

const NOM = 'KAIRO_LUME_HANDOFF_SECRET';

/** Lit la variable dans un fichier .env, en signalant ce qui l'entoure. */
function lire(chemin) {
  if (!existsSync(chemin)) return { erreur: 'fichier introuvable' };
  const txt = readFileSync(chemin, 'utf8');
  const m = new RegExp(`^${NOM}=(.*)$`, 'm').exec(txt);
  if (!m) return { erreur: `${NOM} absent du fichier` };
  const brut = m[1];
  const propre = brut.trim().replace(/^["']|["']$/g, '');
  return {
    brut,
    propre,
    ligne: txt.slice(0, m.index).split('\n').length,
    espaces: brut !== brut.trim(),
    guillemets: /^["']|["']$/.test(brut.trim()),
    vide: propre.length === 0,
    sha: crypto.createHash('sha256').update(propre).digest('hex'),
    shaBrut: crypto.createHash('sha256').update(brut).digest('hex'),
  };
}

const lume = lire('.env.local');
const kairo = lire(process.argv[2] || CHEMIN_KAIRO_DEFAUT);

function afficher(nom, r) {
  console.log(`\n${nom}`);
  if (r.erreur) { console.log('  ✗ ' + r.erreur); return false; }
  console.log(`  ligne ${r.ligne}, ${r.propre.length} caractères`);
  if (r.vide) { console.log('  ✗ valeur vide'); return false; }
  if (r.espaces) console.log('  ⚠ espaces ou retour à la ligne autour de la valeur');
  if (r.guillemets) console.log('  ⚠ la valeur est entourée de guillemets — à retirer');
  console.log('  SHA256 : ' + r.sha);
  return true;
}

console.log('\nCOMPARAISON DU SECRET DE HANDOFF');
console.log('(les valeurs ne sont jamais affichées — seulement leurs empreintes)');

const okL = afficher('LUME  — .env.local', lume);
const okK = afficher('KAIRO — ' + (process.argv[2] || CHEMIN_KAIRO_DEFAUT), kairo);

console.log('\n' + '─'.repeat(64));
if (!okL || !okK) {
  console.log('IMPOSSIBLE DE COMPARER — corriger le point signalé ci-dessus.');
  process.exit(2);
}

if (lume.sha === kairo.sha) {
  console.log('✓ LES DEUX SECRETS SONT IDENTIQUES.');
  if (lume.espaces || kairo.espaces || lume.guillemets || kairo.guillemets) {
    console.log('');
    console.log('  ⚠ MAIS l\'un des fichiers porte des espaces ou des guillemets.');
    console.log('  Selon la bibliothèque qui lit le .env, ils peuvent être conservés');
    console.log('  dans la valeur — et alors le HMAC ne correspondra pas malgré');
    console.log('  cette empreinte identique. Les retirer des deux côtés.');
    console.log('  Empreinte de la valeur BRUTE (avec ce qui l\'entoure) :');
    console.log('    Lume  : ' + lume.shaBrut);
    console.log('    Kairo : ' + kairo.shaBrut);
  } else {
    console.log('  Aucun espace ni guillemet parasite. Le handoff peut fonctionner.');
  }
} else {
  console.log('✗ LES DEUX SECRETS DIFFÈRENT.');
  console.log('');
  console.log('  Copier la valeur de .env.local ligne ' + lume.ligne);
  console.log('  vers le .env de Kairo ligne ' + kairo.ligne + ', sans guillemets,');
  console.log('  sans espace et sans retour à la ligne au bout.');
  if (lume.propre.length !== kairo.propre.length) {
    console.log('');
    console.log(`  Indice : longueurs différentes (${lume.propre.length} contre ${kairo.propre.length}).`);
    console.log('  Souvent le signe d\'un collage tronqué ou d\'un caractère en trop.');
  }
  process.exit(1);
}

console.log('\nRAPPEL — la même valeur doit aussi être posée dans les variables');
console.log('Railway du service Lume : le .env.local n\'y est jamais lu.');
console.log('');
