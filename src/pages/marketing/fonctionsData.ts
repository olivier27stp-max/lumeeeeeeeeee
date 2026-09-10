/**
 * Contenu des pages « En savoir plus » par fonction (/fonctions/:slug).
 * Six fonctions, une par métier que Lume remplace. Chaque entrée est
 * bilingue. Les captures viennent de l'app (staging, org de démo).
 */
export type Bi = { fr: string; en: string };

export interface FonctionPage {
  slug: string;
  job: Bi;
  title: Bi;
  lead: Bi;
  /** Capture d'écran réelle dans /public/landing */
  shot: string;
  shotAlt: Bi;
  /** Ce que ça fait, concrètement (6 points en 3 colonnes) */
  points: { t: Bi; d: Bi }[];
  /** Comment ça se passe, en trois temps */
  steps: { t: Bi; d: Bi }[];
  /** Ce que ça remplace */
  replaces: Bi[];
  faq: { q: Bi; a: Bi }[];
  /** Ancre de la page Fonctionnalités pour aller plus loin */
  featureAnchor: string;
}

export const FONCTIONS: FonctionPage[] = [
  {
    slug: 'clients',
    job: { fr: 'Administration', en: 'Admin' },
    title: { fr: 'Clients et demandes', en: 'Clients and requests' },
    lead: { fr: "Un client, une fiche, tout son historique. La demande arrive de ton site ou d'un texto, et le client n'est créé qu'une fois : il suit sur la soumission, la job, la facture et le reçu.", en: 'One client, one record, the whole history. The request comes from your website or a text, and the client is created once: it carries through the quote, the job, the invoice and the receipt.' },
    shot: '/landing/apercu-clients.webp',
    shotAlt: { fr: 'Liste des clients dans Lume', en: 'Client list in Lume' },
    points: [
      { t: { fr: 'Formulaire de demande sur ton site', en: 'Request form on your website' }, d: { fr: "Un formulaire à ton image, intégré à ton site. Chaque envoi devient une demande dans Lume, avec l'adresse et le service voulu.", en: 'A form in your colours, embedded on your site. Every submission becomes a request in Lume, with the address and the service wanted.' } },
      { t: { fr: 'Fiche complète', en: 'Complete record' }, d: { fr: 'Coordonnées, propriétés, notes internes, photos, contrats signés, historique des jobs et des paiements.', en: 'Contact details, properties, internal notes, photos, signed contracts, job and payment history.' } },
      { t: { fr: 'Plusieurs propriétés', en: 'Multiple properties' }, d: { fr: 'Un client, plusieurs adresses. La bonne propriété est reprise sur la soumission et la job.', en: 'One client, several addresses. The right property is carried onto the quote and the job.' } },
      { t: { fr: 'Portail client', en: 'Client portal' }, d: { fr: 'Le client approuve sa soumission, paie sa facture et revoit ses documents depuis un lien, sans compte à créer.', en: 'The client approves their quote, pays their invoice and reviews their documents from a link, no account needed.' } },
      { t: { fr: 'Recherche partout', en: 'Search everywhere' }, d: { fr: 'Un nom, un téléphone, une adresse, un numéro de facture : la recherche globale trouve tout.', en: 'A name, a phone number, an address, an invoice number: global search finds it all.' } },
      { t: { fr: 'Import de ta base actuelle', en: 'Import your current list' }, d: { fr: "On importe tes clients à partir d'un CSV ou d'un export de ton ancien outil, pendant l'intégration.", en: 'We import your clients from a CSV or an export of your old tool, during onboarding.' } },
    ],
    steps: [
      { t: { fr: 'La demande entre', en: 'The request comes in' }, d: { fr: 'Site, texto, appel. Elle apparaît dans Demandes avec ce que le client a rempli.', en: 'Website, text, call. It shows up in Requests with what the client filled in.' } },
      { t: { fr: 'Le client est créé', en: 'The client is created' }, d: { fr: "Une fois, avec sa propriété. Plus jamais retapé.", en: 'Once, with their property. Never retyped again.' } },
      { t: { fr: "L'historique se construit tout seul", en: 'The history builds itself' }, d: { fr: 'Chaque soumission, job, facture et message se range dans la fiche.', en: 'Every quote, job, invoice and message files itself in the record.' } },
    ],
    replaces: [{ fr: 'Le fichier Excel de clients', en: 'The client spreadsheet' }, { fr: 'Les contacts dans le cell perso', en: 'Contacts in a personal phone' }, { fr: "Les demandes perdues dans la boîte courriel", en: 'Requests lost in the inbox' }],
    faq: [
      { q: { fr: 'Est-ce que mes clients doivent créer un compte ?', en: 'Do my clients need an account?' }, a: { fr: "Non. Le portail s'ouvre par un lien sécurisé envoyé par courriel ou texto.", en: 'No. The portal opens from a secure link sent by email or text.' } },
      { q: { fr: "Combien de clients je peux avoir ?", en: 'How many clients can I have?' }, a: { fr: 'Aucune limite, dans tous les forfaits.', en: 'No limit, on every plan.' } },
    ],
    featureAnchor: 'request-form',
  },
  {
    slug: 'soumissions',
    job: { fr: 'Ventes', en: 'Sales' },
    title: { fr: 'Soumissions', en: 'Quotes' },
    lead: { fr: "Envoyée de la job, à partir d'un modèle, signée par le client sur son téléphone. Si elle traîne, Lume relance à ta place.", en: 'Sent from the job site, from a template, signed by the client on their phone. If it sits, Lume follows up for you.' },
    shot: '/landing/apercu-quotes.webp',
    shotAlt: { fr: 'Liste des soumissions dans Lume', en: 'Quote list in Lume' },
    points: [
      { t: { fr: 'Modèles et préréglages', en: 'Templates and presets' }, d: { fr: 'Tes services, tes prix, tes conditions. Une soumission part en quelques taps.', en: 'Your services, your prices, your terms. A quote goes out in a few taps.' } },
      { t: { fr: 'Mesure satellite', en: 'Satellite measuring' }, d: { fr: "Trace le terrain ou la toiture sur l'image satellite, la superficie entre dans la soumission.", en: 'Trace the lot or the roof on the satellite image, the area goes into the quote.' } },
      { t: { fr: 'Signature sur téléphone', en: 'Signature on the phone' }, d: { fr: 'Le client ouvre le lien, lit, signe. Tu es averti tout de suite.', en: 'The client opens the link, reads, signs. You are notified right away.' } },
      { t: { fr: 'Relance automatique', en: 'Automatic follow-up' }, d: { fr: "Sans réponse à J+3 : un texto ou un courriel part, poliment, sans que tu y penses.", en: 'No answer at day 3: a text or an email goes out, politely, without you thinking about it.' } },
      { t: { fr: 'Conversion en job', en: 'Conversion to job' }, d: { fr: 'Signée ? Elle devient une job à planifier, avec les mêmes lignes et le même client.', en: 'Signed? It becomes a job to schedule, with the same lines and the same client.' } },
      { t: { fr: 'Statuts clairs', en: 'Clear statuses' }, d: { fr: 'Brouillon, envoyée, ouverte, approuvée, refusée, expirée. Tu sais où chacune en est.', en: 'Draft, sent, opened, approved, declined, expired. You know where each one stands.' } },
    ],
    steps: [
      { t: { fr: 'Tu choisis un modèle', en: 'You pick a template' }, d: { fr: 'Le service, les quantités, la mesure satellite si besoin.', en: 'The service, the quantities, satellite measuring if needed.' } },
      { t: { fr: 'Le client reçoit un lien', en: 'The client gets a link' }, d: { fr: 'Par texto ou courriel. Il signe sur son téléphone.', en: 'By text or email. They sign on their phone.' } },
      { t: { fr: 'Lume relance ou convertit', en: 'Lume follows up or converts' }, d: { fr: 'Sans réponse, il relance. Signée, elle devient une job.', en: 'No answer, it follows up. Signed, it becomes a job.' } },
    ],
    replaces: [{ fr: 'Les soumissions dans Word', en: 'Quotes in Word' }, { fr: 'Les PDF envoyés le soir', en: 'PDFs sent at night' }, { fr: '« Je vous reviens » qui ne revient jamais', en: '“I’ll get back to you” that never comes' }],
    faq: [
      { q: { fr: 'La signature électronique est-elle valide ?', en: 'Is the electronic signature valid?' }, a: { fr: 'Oui. Nom, date, adresse IP et document sont conservés avec la soumission.', en: 'Yes. Name, date, IP address and document are kept with the quote.' } },
      { q: { fr: 'Je peux mettre des options ?', en: 'Can I add options?' }, a: { fr: 'Oui, des lignes optionnelles que le client coche avant de signer.', en: 'Yes, optional lines the client ticks before signing.' } },
    ],
    featureAnchor: 'notifications',
  },
  {
    slug: 'calendrier',
    job: { fr: 'Répartition', en: 'Dispatch' },
    title: { fr: 'Calendrier et dispatch', en: 'Calendar and dispatch' },
    lead: { fr: "La journée de chaque équipe, sur une carte. Une job se déplace en la glissant, le client est averti tout seul, et le trajet est calculé sur de vraies routes.", en: "Each crew's day, on a map. Drag a job to move it, the client is notified automatically, and the route is computed on real roads." },
    shot: '/landing/apercu-dispatch.webp',
    shotAlt: { fr: 'Carte de répartition dans Lume', en: 'Dispatch map in Lume' },
    points: [
      { t: { fr: 'Vue jour, semaine, mois', en: 'Day, week and month views' }, d: { fr: 'Par équipe ou pour toute la compagnie. Les jobs récurrentes se créent seules.', en: 'Per crew or for the whole company. Recurring jobs create themselves.' } },
      { t: { fr: 'Carte de répartition', en: 'Dispatch map' }, d: { fr: 'Toutes les jobs du jour sur la carte, par équipe, avec les équipes en direct.', en: "All of the day's jobs on the map, per crew, with crews live." } },
      { t: { fr: 'Trajets optimisés', en: 'Optimized routes' }, d: { fr: "L'ordre des jobs recalculé sur les vraies routes, pas à vol d'oiseau.", en: 'Job order recomputed on real roads, not as the crow flies.' } },
      { t: { fr: 'GPS en direct', en: 'Live GPS' }, d: { fr: 'Où est chaque équipe, maintenant. Avec le consentement de chacun.', en: 'Where each crew is, right now. With everyone’s consent.' } },
      { t: { fr: 'Checklists sur le terrain', en: 'Checklists in the field' }, d: { fr: 'Ce qui doit être fait sur place, coché sur le téléphone, avec photos avant et après.', en: 'What has to be done on site, ticked on the phone, with before and after photos.' } },
      { t: { fr: 'Client averti', en: 'Client notified' }, d: { fr: 'Déplacement, retard, équipe en route : le texto part tout seul.', en: 'Move, delay, crew on the way: the text goes out on its own.' } },
    ],
    steps: [
      { t: { fr: 'La job entre au calendrier', en: 'The job enters the calendar' }, d: { fr: 'Depuis une soumission signée ou créée à la main.', en: 'From a signed quote or created by hand.' } },
      { t: { fr: 'Tu assignes et tu glisses', en: 'You assign and drag' }, d: { fr: 'Une équipe, une plage. Le trajet se recalcule.', en: 'A crew, a slot. The route recomputes.' } },
      { t: { fr: 'Le terrain suit sur son téléphone', en: 'The field follows on their phone' }, d: { fr: 'Route, adresse, notes, checklist, heures.', en: 'Route, address, notes, checklist, hours.' } },
    ],
    replaces: [{ fr: 'Le tableau blanc du garage', en: 'The whiteboard in the garage' }, { fr: 'Les textos « t’es où ? »', en: 'The “where are you?” texts' }, { fr: 'Les jobs oubliées au changement de saison', en: 'Jobs forgotten at the change of season' }],
    faq: [
      { q: { fr: 'Le GPS suit mes employés en dehors des heures ?', en: 'Does GPS track my employees off hours?' }, a: { fr: "Non. Le suivi s'arrête à la déconnexion, et chaque employé donne son consentement dans l'app.", en: 'No. Tracking stops at sign-out, and each employee gives consent in the app.' } },
      { q: { fr: 'Ça marche sans réseau ?', en: 'Does it work without signal?' }, a: { fr: "La route et la job du jour restent visibles ; les changements se synchronisent au retour du réseau.", en: "The day's route and job stay visible; changes sync when the signal comes back." } },
    ],
    featureAnchor: 'scheduling',
  },
  {
    slug: 'messages',
    job: { fr: 'Service client', en: 'Customer service' },
    title: { fr: 'Messages', en: 'Messages' },
    lead: { fr: "Les textos des clients dans l'app, pas sur le cell perso. Un numéro dédié à ta compagnie, des rappels qui partent seuls, et toute l'équipe qui voit la même conversation.", en: "Client texts in the app, not on a personal phone. A number dedicated to your company, reminders that go out on their own, and the whole team seeing the same conversation." },
    shot: '/landing/apercu-messages.webp',
    shotAlt: { fr: 'Messagerie SMS dans Lume', en: 'SMS inbox in Lume' },
    points: [
      { t: { fr: 'Numéro dédié', en: 'Dedicated number' }, d: { fr: "Un numéro local à ta compagnie. Les clients textent, l'équipe répond de l'app.", en: 'A local number for your company. Clients text, the team answers from the app.' } },
      { t: { fr: 'Rappels de rendez-vous', en: 'Appointment reminders' }, d: { fr: "La veille, à l'heure que tu choisis. « Répondez OK pour confirmer. »", en: 'The day before, at the time you choose. “Reply OK to confirm.”' } },
      { t: { fr: 'Relances', en: 'Follow-ups' }, d: { fr: 'Soumission sans réponse, facture en retard : le message part tout seul, avec le lien.', en: 'Unanswered quote, overdue invoice: the message goes out on its own, with the link.' } },
      { t: { fr: 'Messages groupés', en: 'Batch messages' }, d: { fr: 'Tempête annoncée ? Un texto à tous les clients du jour, en une fois.', en: 'Storm coming? One text to all of today’s clients, at once.' } },
      { t: { fr: 'Courriels depuis la fiche', en: 'Emails from the record' }, d: { fr: 'Soumission, facture, reçu : envoyés et suivis, avec « ouvert par le client ».', en: 'Quote, invoice, receipt: sent and tracked, with “opened by the client”.' } },
      { t: { fr: 'Lumi répond', en: 'Lumi answers' }, d: { fr: "Un texto à 21 h ? Lumi propose un prix et un créneau, tu confirmes au matin.", en: 'A text at 9 PM? Lumi proposes a price and a time slot, you confirm in the morning.' } },
    ],
    steps: [
      { t: { fr: 'Le client texte ton numéro', en: 'The client texts your number' }, d: { fr: 'La conversation apparaît dans Messages, rattachée à sa fiche.', en: 'The conversation appears in Messages, attached to their record.' } },
      { t: { fr: "L'équipe répond de l'app", en: 'The team answers from the app' }, d: { fr: 'Depuis le bureau ou le camion. Tout le monde voit la même chose.', en: 'From the office or the truck. Everyone sees the same thing.' } },
      { t: { fr: 'Les rappels partent seuls', en: 'Reminders go out on their own' }, d: { fr: 'Rendez-vous, soumissions, factures. Tu ne fais rien.', en: 'Appointments, quotes, invoices. You do nothing.' } },
    ],
    replaces: [{ fr: 'Le cell perso du proprio', en: 'The owner’s personal phone' }, { fr: 'Les appels de confirmation un par un', en: 'Confirmation calls one by one' }, { fr: 'Les « je vous avais pas dit ? »', en: 'The “didn’t I tell you?”' }],
    faq: [
      { q: { fr: 'Les SMS sont inclus ?', en: 'Are texts included?' }, a: { fr: 'Le numéro dédié et les SMS bidirectionnels sont inclus à partir du forfait Scale.', en: 'The dedicated number and two-way texting are included from the Scale plan up.' } },
      { q: { fr: 'Je garde mon numéro actuel ?', en: 'Can I keep my current number?' }, a: { fr: "Tu peux le transférer, ou garder les deux : le numéro Lume pour les clients, le tien pour le reste.", en: 'You can port it, or keep both: the Lume number for clients, yours for everything else.' } },
    ],
    featureAnchor: 'notifications',
  },
  {
    slug: 'finances',
    job: { fr: 'Comptabilité', en: 'Accounting' },
    title: { fr: 'Finances et paie', en: 'Finances and payroll' },
    lead: { fr: "La facture part quand la job finit. Le client paie en ligne, la relance part seule à J+7, et le vendredi la paie est prête à partir des heures pointées sur le terrain.", en: 'The invoice goes out when the job ends. The client pays online, the follow-up goes out on its own at day 7, and on Friday payroll is ready from the hours clocked in the field.' },
    shot: '/landing/apercu-finances.webp',
    shotAlt: { fr: 'Finances dans Lume', en: 'Finances in Lume' },
    points: [
      { t: { fr: 'Facture à la fin de la job', en: 'Invoice when the job ends' }, d: { fr: 'Créée à partir de la job, avec ses lignes et les taxes du Québec. Envoyée par texto ou courriel.', en: 'Created from the job, with its lines and taxes. Sent by text or email.' } },
      { t: { fr: 'Paiement en ligne', en: 'Online payment' }, d: { fr: 'Carte ou PayPal, depuis le lien. Le paiement se rapproche tout seul de la facture.', en: 'Card or PayPal, from the link. The payment reconciles itself with the invoice.' } },
      { t: { fr: "Payées, en attente, en retard", en: 'Paid, pending, overdue' }, d: { fr: "Trois tuiles, un tableau. Tu sais ce qui rentre et ce qui traîne.", en: 'Three tiles, one table. You know what comes in and what sits.' } },
      { t: { fr: 'Feuilles de temps', en: 'Timesheets' }, d: { fr: "Les heures pointées sur le téléphone, par job. Tu approuves, c'est prêt pour la paie.", en: 'Hours clocked on the phone, per job. You approve, it is ready for payroll.' } },
      { t: { fr: 'Paie', en: 'Payroll' }, d: { fr: 'Périodes de paie, taux, primes. Le vendredi, la liste est prête.', en: 'Pay periods, rates, bonuses. On Friday, the list is ready.' } },
      { t: { fr: 'Export QuickBooks', en: 'QuickBooks export' }, d: { fr: "Factures et paiements exportés pour ton comptable, en un clic.", en: 'Invoices and payments exported for your accountant, in one click.' } },
    ],
    steps: [
      { t: { fr: 'La job est terminée', en: 'The job is done' }, d: { fr: 'Le terrain la marque terminée sur le téléphone.', en: 'The field marks it done on the phone.' } },
      { t: { fr: 'La facture part', en: 'The invoice goes out' }, d: { fr: 'Avec le lien de paiement. Relance automatique à J+7.', en: 'With the payment link. Automatic follow-up at day 7.' } },
      { t: { fr: 'Le vendredi, la paie', en: 'On Friday, payroll' }, d: { fr: 'Heures approuvées, paie prête, export comptable.', en: 'Hours approved, payroll ready, accounting export.' } },
    ],
    replaces: [{ fr: 'Les factures faites le soir', en: 'Invoices done at night' }, { fr: 'Le chèque qui « est dans la malle »', en: 'The cheque that “is in the mail”' }, { fr: 'Les heures reconstituées de mémoire', en: 'Hours rebuilt from memory' }],
    faq: [
      { q: { fr: 'Quels sont les frais de paiement en ligne ?', en: 'What are the online payment fees?' }, a: { fr: "Ceux de Stripe ou de PayPal, facturés par eux. Lume ne prend pas de commission sur tes paiements.", en: 'Stripe’s or PayPal’s, billed by them. Lume takes no commission on your payments.' } },
      { q: { fr: 'Ça remplace mon comptable ?', en: 'Does it replace my accountant?' }, a: { fr: "Non, ça lui donne des données propres. L'export QuickBooks lui évite la ressaisie.", en: 'No, it gives them clean data. The QuickBooks export saves them the retyping.' } },
    ],
    featureAnchor: 'payments',
  },
  {
    slug: 'lumi',
    job: { fr: 'Bras droit', en: 'Right hand' },
    title: { fr: "Lumi, l'assistant", en: 'Lumi, the assistant' },
    lead: { fr: "Un employé de plus, qui ne dort pas. Lumi lit tes jobs, tes clients et tes factures. Il propose, tu confirmes, et tout ce qu'il fait est journalisé.", en: 'One more employee, who never sleeps. Lumi reads your jobs, clients and invoices. It proposes, you confirm, and everything it does is logged.' },
    shot: '/landing/apercu-accueil.webp',
    shotAlt: { fr: "Tableau de bord avec le brief du matin", en: 'Dashboard with the morning brief' },
    points: [
      { t: { fr: 'Il répond aux clients', en: 'It answers clients' }, d: { fr: 'Un texto à 21 h reçoit un prix, un créneau, une soumission. Tu vois tout le lendemain matin.', en: 'A 9 PM text gets a price, a time slot, a quote. You see it all the next morning.' } },
      { t: { fr: 'Il replanifie', en: 'It reschedules' }, d: { fr: 'Pluie annoncée : la job glisse au lendemain, le client et l’équipe sont avertis.', en: 'Rain in the forecast: the job slides to the next day, client and crew are notified.' } },
      { t: { fr: 'Il relance', en: 'It follows up' }, d: { fr: 'Soumission sans réponse à J+3, facture en retard à J+7.', en: 'Unanswered quote at day 3, overdue invoice at day 7.' } },
      { t: { fr: 'Il te brief', en: 'It briefs you' }, d: { fr: 'Chaque matin : jobs, équipes, retards, argent qui rentre. En texte, ou à la voix.', en: 'Every morning: jobs, crews, overdue items, cash coming in. In text, or by voice.' } },
      { t: { fr: 'Il explique', en: 'It explains' }, d: { fr: '« Pourquoi mon mois est en baisse ? » Il compare, nomme les clients, propose.', en: '“Why is my month down?” It compares, names the clients, proposes.' } },
      { t: { fr: 'Il demande avant d’agir', en: 'It asks before acting' }, d: { fr: 'Lecture seule par défaut. Tout ce qui touche un client ou de l’argent attend ta confirmation.', en: 'Read-only by default. Anything that touches a client or money waits for your confirmation.' } },
    ],
    steps: [
      { t: { fr: 'Tu lui parles', en: 'You talk to it' }, d: { fr: 'Dans Lume, en texte ou à la voix. « Quoi de neuf ce matin ? »', en: 'In Lume, by text or voice. “What’s new this morning?”' } },
      { t: { fr: 'Il lit et il propose', en: 'It reads and proposes' }, d: { fr: 'Avec tes vraies données : jobs, clients, factures.', en: 'With your real data: jobs, clients, invoices.' } },
      { t: { fr: 'Tu confirmes, il exécute', en: 'You confirm, it acts' }, d: { fr: 'Job déplacée, SMS envoyé, facture relancée. Journalisé.', en: 'Job moved, text sent, invoice followed up. Logged.' } },
    ],
    replaces: [{ fr: 'Le rappel que tu te fais dans ta tête', en: 'The reminder you keep in your head' }, { fr: 'Le soir à revoir ce qui traîne', en: 'The evening spent reviewing what’s stuck' }, { fr: 'Les clients qui attendent une réponse jusqu’au lendemain', en: 'Clients waiting for an answer until the next day' }],
    faq: [
      { q: { fr: 'Lumi peut-il faire des erreurs ?', en: 'Can Lumi make mistakes?' }, a: { fr: "Oui, c'est une IA. C'est pourquoi il propose et tu confirmes, et que chaque action est journalisée.", en: 'Yes, it is an AI. That is why it proposes and you confirm, and every action is logged.' } },
      { q: { fr: 'Dans quels forfaits ?', en: 'Which plans?' }, a: { fr: 'Lumi en texte avec quota mensuel à partir de Scale ; en voix et illimité dans Autopilot.', en: 'Lumi in text with a monthly quota from Scale; voice and unlimited in Autopilot.' } },
    ],
    featureAnchor: 'ai-voice',
  },
];

export const findFonction = (slug: string | undefined) => FONCTIONS.find((f) => f.slug === slug);
