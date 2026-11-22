/**
 * ChantierCard.jsx - Majord'home Artisan
 * ============================================================================
 * Carte chantier pour le Kanban chantiers. Hauteur FIXE : chaque ligne est
 * toujours rendue (vide s'il n'y a rien à dire), les cartes sont donc identiques
 * d'une colonne à l'autre.
 *
 *   bande de gauche : ce que la colonne date (règles : src/lib/chantierCardDate.js)
 *   ligne 1 : nom + montant
 *   ligne 2 : objet du chantier (type d'équipement · libellé)
 *   lignes 3-4 : adresse complète (voie, puis code postal et ville)
 *   ligne 5 : commandes (Éq. / Mat.) + repères de devis ; sur un chantier réceptionné,
 *             les repères d'après-vente (PV, avis, contrat, facturé — src/lib/chantierApresVente.js)
 *
 * @version 2.0.0 - carte à hauteur fixe, bande selon la colonne (2026-11-17)
 * ============================================================================
 */

import { MapPin, Calendar, CalendarClock, CalendarPlus, Package, Check, Clock, AlertTriangle, MessageSquare, Loader2 } from 'lucide-react';
import { formatEuroCeil } from '@/lib/utils';
import { getChantierStatusConfig, getChantierAmount } from '@services/chantiers.service';
import { poseProvisoire } from '@/lib/installOrder';
import { bandeDeCarteChantier, adresseDeCarte, objetDeCarte } from '@/lib/chantierCardDate';
import { reperePv } from '@/lib/chantierApresVente';

const AMBRE = { backgroundColor: '#F59E0B14', borderColor: '#F59E0B40' };
/** Bande hachurée (pose provisoire : appros non reçues), même motif que le planning. */
const HACHURE = {
  ...AMBRE,
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(245, 158, 11, 0.18) 0 4px, transparent 4px 8px)',
};

/** Icône de la bande quand la colonne ne porte pas de date. */
const ICONES = {
  commande: Package,
  a_planifier: CalendarPlus,
  a_replanifier: CalendarClock,
  inconnue: Calendar,
};

function jourEtMois(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return { jour: d.getDate(), mois: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') };
}

/**
 * @param {Object} props
 * @param {Object} props.chantier
 * @param {Function} [props.onClick]
 * @param {Array|null} [props.reperes]        repères d'après-vente (chantier réceptionné), sinon null
 * @param {string|null} [props.avisBlocage]   pourquoi l'avis ne peut pas partir ; null = il peut
 * @param {Function} [props.onDemanderAvis]   absent = la personne ne peut pas envoyer de SMS
 * @param {boolean} [props.avisEnCours]
 */
export function ChantierCard({ chantier, onClick, reperes = null, avisBlocage = null, onDemanderAvis, avisEnCours = false }) {
  if (!chantier) return null;

  const name = `${chantier.last_name || ''} ${chantier.first_name || ''}`.trim() || 'Sans nom';
  const amount = getChantierAmount(chantier);
  const statusConfig = getChantierStatusConfig(chantier.chantier_status);
  const bande = bandeDeCarteChantier(chantier);
  const date = bande.date ? jourEtMois(bande.date) : null;
  const { voie, commune } = adresseDeCarte(chantier);
  const objet = objetDeCarte(chantier);

  // Pose provisoire : RDV posé avant réception des appros → bande hachurée ambre,
  // seulement là où la bande porte la date de pose (colonne Planifié).
  const provisoire = chantier.chantier_status === 'planification' && bande.repere === 'date' && poseProvisoire(chantier);
  const aReplanifier = bande.repere === 'a_replanifier';

  let bandeStyle = { backgroundColor: `${statusConfig.color}10`, borderColor: `${statusConfig.color}30` };
  let bandeCouleur = statusConfig.color;
  let bandeTitre = bande.libelle;
  if (aReplanifier) {
    bandeStyle = AMBRE;
    bandeCouleur = '#D97706';
  } else if (provisoire) {
    bandeStyle = HACHURE;
    bandeCouleur = '#B45309';
    bandeTitre = 'Pose provisoire : commandes non reçues';
  } else if (bande.repere === 'inconnue') {
    bandeCouleur = '#D1D5DB';
  }
  const Icone = ICONES[bande.repere] || Calendar;

  // PV envoyé au client et pas encore signé : visible sur la carte tant qu'elle n'est pas réceptionnée.
  const pvEnAttente = !reperes && reperePv(chantier).etat === 'en_cours';
  const plusieursDevis = Number(chantier.quotes_count) >= 2;
  const sansDevisValide = Number(chantier.validated_quotes_count) === 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(chantier)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(chantier); }
      }}
      className="w-full h-[124px] text-left bg-white rounded-lg border hover:shadow-md transition-shadow cursor-pointer
                 focus:outline-none focus:ring-2 focus:ring-blue-500 flex overflow-hidden"
    >
      {/* Bande de gauche : date de la colonne, ou icône quand elle n'en a pas */}
      <div
        className="flex flex-col items-center justify-center px-2 w-[44px] shrink-0 border-r"
        style={bandeStyle}
        title={bandeTitre}
      >
        {date ? (
          <>
            <span className="text-sm font-bold leading-none" style={{ color: bandeCouleur }}>{date.jour}</span>
            <span className="text-[11px] uppercase leading-tight" style={{ color: bandeCouleur }}>{date.mois}</span>
          </>
        ) : (
          <Icone className="h-4 w-4" style={{ color: bandeCouleur }} aria-label={bandeTitre} />
        )}
      </div>

      <div className="flex-1 min-w-0 p-2.5 flex flex-col">
        {/* Ligne 1 : nom + montant */}
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium text-sm leading-5 text-gray-900 truncate">{name}</p>
          <span className={`text-xs leading-5 font-semibold whitespace-nowrap ${amount > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
            {formatEuroCeil(amount)}
          </span>
        </div>

        {/* Ligne 2 : objet du chantier */}
        <p className="h-4 mt-0.5 text-xs leading-4 text-gray-500 truncate" title={objet || undefined}>{objet}</p>

        {/* Lignes 3-4 : adresse complète */}
        <div className="mt-1.5 flex items-start gap-1 min-w-0" title={[voie, commune].filter(Boolean).join(', ') || undefined}>
          <MapPin className={`h-3 w-3 mt-0.5 shrink-0 ${voie || commune ? 'text-gray-400' : 'text-gray-200'}`} />
          <div className="min-w-0 flex-1 text-xs leading-4 text-gray-600">
            <p className="h-4 truncate">{voie || (commune ? '' : 'Adresse non renseignée')}</p>
            <p className="h-4 truncate">{commune}</p>
          </div>
        </div>

        {/* Ligne 5 : après-vente d'un chantier réceptionné, sinon commandes + repères de devis */}
        {reperes ? (
          <div className="mt-auto flex items-center gap-1 min-w-0 overflow-hidden">
            {reperes.map((repere) => (
              repere.cle === 'avis' && onDemanderAvis && !avisBlocage ? (
                <button
                  key={repere.cle}
                  type="button"
                  disabled={avisEnCours}
                  onClick={(e) => { e.stopPropagation(); onDemanderAvis(chantier); }}
                  title="Demander un avis au client par SMS"
                  className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full font-bold shrink-0 border
                             border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100 disabled:opacity-60"
                >
                  {avisEnCours ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <MessageSquare className="h-2.5 w-2.5" />}
                  Avis
                </button>
              ) : <Repere key={repere.cle} repere={repere} />
            ))}
          </div>
        ) : (
        <div className="mt-auto flex items-center gap-1.5 min-w-0">
          <OrderIndicator label="Éq." nom="Équipement" status={chantier.equipment_order_status} />
          <OrderIndicator label="Mat." nom="Matériaux" status={chantier.materials_order_status} />
          <span className="flex-1" />
          {pvEnAttente && <Repere repere={reperePv(chantier)} />}
          {plusieursDevis && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold shrink-0" title="Devis groupés sur ce chantier">
              {chantier.quotes_count} devis
            </span>
          )}
          {sansDevisValide && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold truncate" title="Aucun devis validé sur ce chantier">
              sans devis validé
            </span>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

/** Pastille d'un repère d'après-vente : l'état se lit à l'icône et au remplissage, pas à la couleur seule. */
const REPERE_STYLES = {
  fait: { css: 'bg-emerald-500 text-white border-emerald-500', Icone: Check },
  en_cours: { css: 'bg-blue-50 text-blue-700 border-blue-200', Icone: Clock },
  attention: { css: 'bg-amber-100 text-amber-800 border-amber-300', Icone: AlertTriangle },
  a_faire: { css: 'bg-white text-gray-400 border-gray-200', Icone: null },
  inconnu: { css: 'bg-gray-50 text-gray-300 border-dashed border-gray-200', Icone: null },
};

function Repere({ repere }) {
  const { css, Icone } = REPERE_STYLES[repere.etat] || REPERE_STYLES.a_faire;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-full font-bold shrink-0 border ${css}`} title={repere.titre}>
      {Icone && <Icone className="h-2.5 w-2.5" />}
      {repere.libelle}
    </span>
  );
}

const ORDER_STYLES = {
  recu: { css: 'bg-emerald-500 text-white', etat: 'reçu' },
  commande: { css: 'bg-st-info text-white', etat: 'commandé' },
  na: { css: 'bg-gray-200 text-gray-400', etat: 'rien à recevoir' },
};

function OrderIndicator({ label, nom, status }) {
  const style = ORDER_STYLES[status] || { css: 'bg-gray-50 text-gray-300 border border-gray-200', etat: 'non renseigné' };
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${style.css}`} title={`${nom} : ${style.etat}`}>
      {label}
    </span>
  );
}

export default ChantierCard;
