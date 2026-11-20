/**
 * pageUi.jsx — habillage commun des pages ouvertes au client sans compte (/pv/:token,
 * /rdv/:token) : coque (en-tête, pied, teintes de l'entreprise), titre, étape numérotée,
 * fiche, pastille de confirmation, boutons, alerte, écran de message, attente.
 * Aucune règle ici : les teintes viennent de `teintesDeMarque` (src/lib/pagePublique.js),
 * posées en variables CSS sur la coque et lues par les classes `[color:var(--marque…)]`.
 */
import { AlertTriangle, Check, Loader2, Phone } from 'lucide-react';
import { teintesDeMarque } from '@/lib/pagePublique';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-900 focus-visible:ring-offset-2';

/**
 * Coque de la page : bandeau à la couleur de l'entreprise, en-tête, contenu, pied.
 * `attente` : le nom n'est pas encore connu, l'en-tête montre une silhouette.
 */
export function PageCoque({ nom, logo, couleur, telephone, attente = false, children }) {
  const t = teintesDeMarque(couleur);
  return (
    <div
      className="min-h-screen bg-secondary-50 text-secondary-900 antialiased"
      style={{ '--marque': t.accent, '--marque-texte': t.surAccent, '--marque-doux': t.doux }}
    >
      <div className="h-1 bg-[color:var(--marque)]" aria-hidden="true" />
      <header className="border-b border-secondary-200 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:px-8">
          {attente ? (
            <div className="h-5 w-40 rounded bg-secondary-100" aria-hidden="true" />
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              {logo && <img src={logo} alt="" className="h-9 w-auto max-w-[120px] shrink-0 object-contain" />}
              <p className="truncate text-base font-semibold">{nom}</p>
            </div>
          )}
          {telephone && (
            <a
              href={`tel:${telephone.replace(/\s/g, '')}`}
              aria-label={`Appeler ${nom} au ${telephone}`}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-secondary-200 px-4 text-sm font-medium text-secondary-800 hover:bg-secondary-50 ${FOCUS}`}
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              <span className="sm:hidden">Appeler</span>
              <span className="hidden sm:inline">{telephone}</span>
            </a>
          )}
        </div>
      </header>

      {/* Largeur d'une feuille A4, comme la page de signature du contrat d'entretien. */}
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-8 sm:pt-10">
        {children}
        {telephone && (
          <footer className="mt-12 border-t border-secondary-200 pt-6 text-center text-sm text-secondary-600">
            Une question ? Appelez-nous au{' '}
            <a href={`tel:${telephone.replace(/\s/g, '')}`} className="font-medium text-secondary-900 underline underline-offset-2">
              {telephone}
            </a>
            .
          </footer>
        )}
      </main>
    </div>
  );
}

/** Titre de page : surtitre discret, titre, phrase d'accueil. */
export function PageTitre({ surtitre, titre, children }) {
  return (
    <div className="space-y-3">
      {surtitre && <p className="text-sm font-medium text-secondary-600">{surtitre}</p>}
      <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{titre}</h1>
      {children && <p className="max-w-prose text-base leading-relaxed text-secondary-700">{children}</p>}
    </div>
  );
}

/** Étape numérotée du procès-verbal. */
export function PageEtape({ numero, titre, aide, children }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--marque)] text-sm font-semibold text-[color:var(--marque-texte)]"
          >
            {numero}
          </span>
          <h2 className="text-lg font-semibold leading-snug">{titre}</h2>
        </div>
        {aide && <p className="text-sm leading-relaxed text-secondary-600">{aide}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Fiche : un titre facultatif puis des lignes « libellé / valeur », avec ou sans icône.
 * @param {{ titre?: string, lignes: { icone?: Function, libelle?: string, valeur: string, multiligne?: boolean }[] }} props
 */
export function PageFiche({ titre, lignes }) {
  const visibles = lignes.filter((l) => l && l.valeur);
  if (!titre && visibles.length === 0) return null;
  return (
    <div className="rounded-2xl border border-secondary-200 bg-white p-5 shadow-sm sm:p-6">
      {titre && <p className="text-lg font-semibold leading-snug">{titre}</p>}
      {visibles.length > 0 && (
        <dl className={`space-y-4 sm:grid sm:grid-cols-2 sm:gap-x-8 sm:gap-y-4 sm:space-y-0 ${titre ? 'mt-4 border-t border-secondary-100 pt-4' : ''}`}>
          {visibles.map((l, i) => {
            const Icone = l.icone;
            return (
              <div key={`${i}-${l.libelle || l.valeur}`} className={`flex items-start gap-3 ${l.multiligne ? 'sm:col-span-2' : ''}`}>
                {Icone && <Icone className="mt-0.5 h-5 w-5 shrink-0 text-secondary-400" aria-hidden="true" />}
                <div className="min-w-0">
                  {l.libelle && <dt className="text-sm text-secondary-600">{l.libelle}</dt>}
                  <dd className={`text-base ${l.multiligne ? 'whitespace-pre-line' : 'font-medium'}`}>{l.valeur}</dd>
                </div>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

/** Bouton principal, à la couleur de l'entreprise. */
export function PageBouton({ attente = false, libelleAttente = 'Enregistrement…', icone: Icone, children, ...props }) {
  return (
    <button
      type="button"
      disabled={attente}
      {...props}
      className={`inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl py-3 bg-[color:var(--marque)] px-5 text-base font-semibold text-[color:var(--marque-texte)] shadow-sm transition hover:brightness-95 active:brightness-90 disabled:opacity-60 ${FOCUS}`}
    >
      {attente
        ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : Icone && <Icone className="h-5 w-5" aria-hidden="true" />}
      {attente ? libelleAttente : children}
    </button>
  );
}

/** Bouton secondaire : contour, fond blanc. */
export function PageBoutonSecondaire({ attente = false, icone: Icone, children, ...props }) {
  return (
    <button
      type="button"
      disabled={attente}
      {...props}
      className={`inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl py-3 border border-secondary-300 bg-white px-5 text-base font-medium text-secondary-900 transition-colors hover:bg-secondary-100 disabled:opacity-60 ${FOCUS}`}
    >
      {attente
        ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : Icone && <Icone className="h-5 w-5" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Refus ou avertissement : icône et texte, jamais la couleur seule. */
export function PageAlerte({ children }) {
  return (
    <p className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-base text-amber-950" role="alert">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Écran de message (lien indisponible, PV pas encore prêt, signature enregistrée). */
export function PageMessage({ icone: Icone, titre, children, action }) {
  return (
    <section className="rounded-2xl border border-secondary-200 bg-white p-6 shadow-sm sm:p-8">
      {Icone && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-100 text-secondary-700">
          <Icone className="h-6 w-6" aria-hidden="true" />
        </span>
      )}
      <h1 className="mt-5 text-xl font-semibold leading-snug">{titre}</h1>
      {children && <p className="mt-2 text-base leading-relaxed text-secondary-700">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </section>
  );
}

/** Pastille de confirmation, à la couleur de l'entreprise. */
export function PageCoche() {
  return (
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--marque)] text-[color:var(--marque-texte)]">
      <Check className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

/**
 * Attente du premier chargement : la silhouette de la page, pas un texte seul.
 * `children` : une phrase visible quand l'attente peut durer (calcul des disponibilités).
 */
export function PageAttente({ libelle = 'Chargement', children }) {
  return (
    <div className="space-y-8" role="status" aria-label={libelle}>
      {children && <p className="text-base text-secondary-600">{children}</p>}
      <div className="animate-pulse space-y-8 motion-reduce:animate-none" aria-hidden="true">
        <div className="space-y-3">
          <div className="h-4 w-36 rounded bg-secondary-200" />
          <div className="h-8 w-4/5 rounded bg-secondary-200" />
          <div className="h-4 w-full rounded bg-secondary-200" />
          <div className="h-4 w-2/3 rounded bg-secondary-200" />
        </div>
        <div className="h-44 rounded-2xl border border-secondary-200 bg-white" />
        <div className="h-32 rounded-2xl border border-secondary-200 bg-white" />
      </div>
    </div>
  );
}
