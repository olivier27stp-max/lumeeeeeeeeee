/**
 * Preuve du filet de sécurité — à lancer AVANT toute campagne du robot.
 *
 * Vérifie sur le VRAI chemin de code (celui que le serveur utilise) qu'aucun
 * message ne peut atteindre un vrai destinataire quand le mode QA est armé.
 *
 * Usage :
 *   npm run qa:verifier-filet
 */
import { envelopperTwilio, redirigerEmail, qaRedirectActif, qaRedirectResume } from '../../server/lib/qa-redirect';

const CLIENT_REEL = '+15145551234';
const COURRIEL_REEL = 'client.reel@exemple.com';

async function main() {
  console.log('\n═══ Vérification du filet de sécurité ═══\n');

  if (!qaRedirectActif()) {
    console.log('  Mode QA : INACTIF');
    console.log('');
    console.log('  Les messages partiraient aux VRAIS destinataires.');
    console.log('  Pour armer le filet, ajouter dans .env.local :');
    console.log('    QA_REDIRECT_TO=<ton numéro>');
    console.log('    QA_REDIRECT_EMAIL=<ton courriel>');
    console.log('');
    process.exit(1);
  }

  console.log(`  Mode QA : ACTIF — ${qaRedirectResume()}\n`);

  let ok = true;
  const verifier = (nom: string, reussi: boolean, detail: string) => {
    console.log(`  ${reussi ? '✓' : '✗'} ${nom}${detail ? ` — ${detail}` : ''}`);
    if (!reussi) ok = false;
  };

  // 1. SMS via l'enveloppe du client Twilio — le chemin des 8 sites d'appel.
  let captureSms: any = null;
  const client = envelopperTwilio({
    messages: { create: async (o: any) => { captureSms = o; return { sid: 'SM_test' }; } },
  })!;
  await client.messages.create({
    body: 'Rappel : votre rendez-vous est demain à 9 h.',
    from: '+15140000000',
    to: CLIENT_REEL,
  });

  verifier(
    'le SMS ne part PAS au client réel',
    captureSms?.to !== CLIENT_REEL,
    `destinataire final ${captureSms?.to}`,
  );
  verifier(
    'le destinataire d\'origine est visible dans le message',
    String(captureSms?.body || '').startsWith('[QA →'),
    String(captureSms?.body || '').slice(0, 60),
  );
  verifier(
    'le numéro complet du client n\'est pas recopié',
    !String(captureSms?.body || '').includes(CLIENT_REEL),
    'masqué',
  );

  // 2. Courriel via le point de passage unique.
  const mail = redirigerEmail(COURRIEL_REEL, 'Votre facture est prête');
  verifier(
    'le courriel ne part PAS au client réel',
    mail.to !== COURRIEL_REEL,
    `destinataire final ${mail.to}`,
  );
  verifier(
    'le destinataire d\'origine est visible dans l\'objet',
    mail.subject.startsWith('[QA →'),
    mail.subject.slice(0, 60),
  );

  console.log('');
  if (!ok) {
    console.log('  FILET PERCÉ — ne pas lancer le robot.\n');
    process.exit(1);
  }
  console.log('  Filet vérifié. Aucun message ne peut atteindre un vrai client.\n');
}

main().catch((e) => { console.error('Interrompu :', e.message); process.exit(2); });
