/**
 * Courriel de bienvenue — envoyé une fois, après confirmation de l'adresse.
 *
 * POURQUOI : après avoir cliqué le lien de vérification, le client arrivait
 * dans un espace vide sans rien recevoir. C'est pourtant le moment où il a le
 * plus besoin d'être guidé, et le seul où on est certain qu'il lit ses
 * courriels (il vient d'en ouvrir un).
 *
 * Volontairement PAS un message de remerciement : chaque courriel sans contenu
 * utile entraîne l'habitude de ne plus les ouvrir, et le jour où on envoie
 * quelque chose d'important il passe à la trappe. Celui-ci dit quoi faire.
 *
 * Le logo est chargé depuis le domaine canonique. La plupart des clients de
 * messagerie masquent les images distantes tant que le destinataire ne clique
 * pas « afficher les images » : le texte doit donc rester compréhensible sans
 * lui — c'est le cas, l'objet et la première ligne suffisent.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface WelcomeEmailData {
  /** Prénom du destinataire ; vide si inconnu — la salutation s'adapte. */
  name: string;
  /** Racine de l'application (FRONTEND_URL). */
  appUrl: string;
  /** Adresse à laquelle le client peut répondre. */
  supportEmail: string;
}

export function renderWelcomeEmail(data: WelcomeEmailData): string {
  const logoUrl = 'https://lumecrm.net/lume-logo-v2.png';
  const app = data.appUrl.replace(/\/$/, '');
  const salutation = data.name ? `Salut <strong>${escapeHtml(data.name)}</strong>,` : 'Salut,';

  const etape = (n: number, titre: string, texte: string) => `
    <tr>
      <td style="padding:13px 0;border-bottom:1px solid #eceef1;vertical-align:top;width:30px;">
        <div style="width:19px;height:19px;border-radius:50%;background:#111;color:#fff;font-size:11px;font-weight:700;line-height:19px;text-align:center;">${n}</div>
      </td>
      <td style="padding:13px 0;border-bottom:1px solid #eceef1;font-size:13.5px;color:#555;line-height:1.55;">
        <strong style="color:#16181d;">${titre}</strong> ${texte}
      </td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;">

    <img src="${logoUrl}" alt="Lume" style="height:34px;width:auto;display:block;margin:0 0 26px;" />

    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 14px;">${salutation}</p>

    <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 14px;">
      Ton compte est confirmé et ton espace de travail est prêt. Voici les trois
      choses à faire en premier — compte une quinzaine de minutes.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;border-top:1px solid #eceef1;">
      ${etape(1, 'Importe tes clients.', 'Depuis la page Clients, un fichier CSV suffit : le nom et un moyen de contact par ligne.')}
      ${etape(2, "Complète les infos de ton entreprise.", 'Logo, adresse et couleur apparaissent sur tes devis et factures.')}
      ${etape(3, 'Envoie ta première soumission.', "C'est le meilleur moyen de voir le parcours complet, jusqu'au paiement en ligne.")}
    </table>

    <a href="${escapeHtml(app)}" style="display:inline-block;margin-top:26px;padding:14px 32px;background:#111;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.5px;">
      Ouvrir mon espace
    </a>

    <p style="font-size:12px;color:#999;margin-top:30px;line-height:1.6;">
      Une question ? Réponds simplement à ce courriel — c'est une vraie personne
      qui lit. Tu peux aussi utiliser le bouton d'aide, en bas à droite dans
      l'application.
    </p>

  </div>
</body></html>`;
}
