/**
 * La mascotte seule, au pied des pages qu'un CLIENT d'une entreprise voit
 * (facture, soumission, contrat, paiement).
 *
 * Ces pages affichaient « Facture générée avec Lume » ou « Propulsé par
 * Lume ». Quand Coquin lavage facture Sophie, Sophie doit voir Coquin lavage :
 * le nom du fournisseur de logiciel n'a rien à y faire. Les courriels ont été
 * traités de la même façon (PR #536) — ne restait que les pages.
 *
 * Sans texte, sans lien : la pastille ne mène nulle part et ne s'explique pas.
 * `alt` vide pour qu'aucun mot n'apparaisse si l'image ne charge pas, et
 * `aria-hidden` pour qu'un lecteur d'écran ne l'annonce pas — elle ne porte
 * aucune information utile au client.
 */
export default function PastilleLume({ className = '' }: { className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <img
        src="/lume-mascotte-pastille.png"
        alt=""
        aria-hidden="true"
        width={26}
        height={26}
        className="rounded-full opacity-50"
      />
    </div>
  );
}
