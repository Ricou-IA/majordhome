/**
 * AdresseItineraire — adresse client cliquable : le texte ouvre l'itinéraire
 * Google Maps, le bouton « Waze » lance Waze. Composant présentationnel partagé
 * (carte RDV, en-tête d'intervention, modales chantier et entretien).
 *
 * Les liens sont calculés par src/lib/itineraire.js (pur, testé). Sans adresse
 * ni coordonnées, rien n'est rendu.
 */
import { MapPin, Navigation } from 'lucide-react';
import { lienGoogleMaps, lienWaze } from '@/lib/itineraire';

/**
 * @param {object} props
 * @param {string} props.adresse - adresse sur une ligne (cf. formaterAdresse)
 * @param {number|string|null} [props.lat] - latitude géocodée (prime sur le texte)
 * @param {number|string|null} [props.lng]
 * @param {boolean} [props.sansIcone] - l'appelant dessine déjà l'épingle
 * @param {string} [props.className] - classes du conteneur (taille de texte, couleur)
 */
export function AdresseItineraire({ adresse, lat, lng, sansIcone = false, className = 'text-sm text-gray-600' }) {
  const maps = lienGoogleMaps({ adresse, lat, lng });
  const waze = lienWaze({ adresse, lat, lng });
  if (!maps || !adresse) return null;

  return (
    <div className={`flex items-start gap-1.5 ${className}`}>
      {!sansIcone && <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <a
          href={maps}
          target="_blank"
          rel="noopener noreferrer"
          title="Itinéraire dans Google Maps"
          className="text-blue-700 hover:underline"
        >
          {adresse}
        </a>
        {waze && (
          <a
            href={waze}
            target="_blank"
            rel="noopener noreferrer"
            title="Itinéraire dans Waze"
            aria-label="Itinéraire dans Waze"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-600 hover:border-blue-300 hover:text-blue-700 transition-colors"
          >
            <Navigation className="w-3 h-3" aria-hidden="true" />
            Waze
          </a>
        )}
      </span>
    </div>
  );
}
