/**
 * Carte.jsx — carte numérotée de la page du mail (Destinataires · Message · Envoi)
 * ============================================================================
 * Présentation seulement. Le numéro suit l'ordre des cartes affichées.
 * ============================================================================
 */

export default function Carte({ numero, titre, sousTitre = null, droite = null, children }) {
  return (
    <section className="rounded-xl border border-secondary-200 bg-white shadow-card">
      <header className="flex items-start justify-between gap-3 border-b border-secondary-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700">
            {numero}
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-secondary-900">{titre}</h2>
            {sousTitre && <p className="mt-0.5 text-sm text-secondary-500">{sousTitre}</p>}
          </div>
        </div>
        {droite}
      </header>
      <div className="space-y-6 px-5 py-5">{children}</div>
    </section>
  );
}
