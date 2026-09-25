import { rendreCourrielLume, dateLisible } from '../../server/lib/courriels/gabarit';
import nodemailer from 'nodemailer';
const html = rendreCourrielLume({
  langue: 'fr',
  preheader: 'Premier courriel envoyé par Amazon SES depuis lumecrm.net',
  titre: 'Amazon SES est en ligne',
  intro: 'Ce message est parti par Amazon SES, signé DKIM au nom de lumecrm.net, dans le gabarit commun à tous les courriels de Lume.',
  lignes: [
    { libelle: 'Fournisseur', valeur: 'Amazon SES · ca-central-1' },
    { libelle: 'Domaine', valeur: 'lumecrm.net · DKIM 2048 bits' },
    { libelle: 'Coût de cet envoi', valeur: '0,0001 $' },
    { libelle: 'Envoyé le', valeur: dateLisible(new Date().toISOString(), 'fr'), fort: true },
  ],
  bouton: { texte: 'Ouvrir Lume', url: 'https://lumecrm.net/day' },
  note: 'Si tu lis ceci dans ta boîte de réception, la chaîne complète fonctionne : SES, DKIM, gabarit et version texte.',
});
const t = nodemailer.createTransport({ host: 'email-smtp.ca-central-1.amazonaws.com', port: 587, secure: false, auth: { user: process.env.SES_SMTP_USER!, pass: process.env.SES_SMTP_PASS! } });
try {
  const i = await t.sendMail({ from: 'Lume CRM <noreply@lumecrm.net>', to: 'willhebert30@gmail.com', subject: 'Amazon SES est en ligne', html, text: 'Amazon SES est en ligne.' });
  console.log('ENVOI SES RÉUSSI —', i.messageId);
} catch (e: any) {
  const m = String(e?.message || '');
  console.log(m.includes('not verified') ? 'ENCORE REFUSÉ : clique le lien de confirmation dans ta boîte, puis redis-le-moi.' : `REFUS : ${m.slice(0, 160)}`);
}
