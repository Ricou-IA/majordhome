/**
 * LienWaze — rend son contenu cliquable vers la navigation Waze (lien universel
 * `https://waze.com/ul`, calculé par src/lib/itineraire.js : coordonnées de la
 * fiche si elle est géocodée, sinon l'adresse en texte).
 *
 * Sur téléphone et tablette, le lien ouvre l'application Waze ; sur ordinateur,
 * le site. Sans adresse ni coordonnées, on rend `sinon` (par défaut : rien) —
 * jamais un lien mort.
 *
 * Le clic ne remonte pas : la carte client de la liste, cliquable en entier,
 * n'ouvre pas la fiche quand on vise l'adresse.
 */
import { formaterAdresse, lienWaze } from '@/lib/itineraire';

/**
 * @param {object} props
 * @param {string} [props.address]
 * @param {string} [props.postalCode]
 * @param {string} [props.city]
 * @param {number|string|null} [props.lat] - latitude géocodée (prime sur le texte)
 * @param {number|string|null} [props.lng]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} [props.sinon] - rendu quand rien ne permet de viser une destination
 * @param {import('react').ReactNode} props.children
 */
export function LienWaze({ address, postalCode, city, lat, lng, className = '', sinon = null, children }) {
  const adresse = formaterAdresse({ address, postalCode, city });
  const href = lienWaze({ adresse, lat, lng });
  if (!href) return sinon;

  const titre = adresse ? `Itinéraire vers ${adresse} (Waze)` : 'Itinéraire (Waze)';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={titre}
      aria-label={titre}
      className={className}
    >
      {children}
    </a>
  );
}

export default LienWaze;
