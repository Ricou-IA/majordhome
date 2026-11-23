/**
 * AccueilJournee.jsx — bloc « Aujourd'hui » de la page d'accueil : les RDV du jour,
 * ou ceux du prochain jour qui en a (règle : journeeAffichee, src/lib/accueil.js).
 * Affichage seul. Une lecture en échec se dit, elle ne s'affiche jamais « aucun RDV ».
 */

import { AlertTriangle, Loader2, MapPin, Navigation } from 'lucide-react';
import { getAppointmentTypeConfig } from '@services/appointments.service';
import { Vide } from '@components/pipeline/dashboard/Tableau';
import { Card, CardHeader } from '@components/ui/card';
import { Avatar } from '@components/ui/avatar';
import { Tag } from '@components/ui/tag';
import { LienWaze } from '@apps/artisan/components/shared/LienWaze';
import { personnesDuRdv, lieuDuRdv, rdvEnCours } from '@/lib/accueil';

const jourEnClair = (iso) => {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

function Personnes({ personnes }) {
  if (personnes.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      {personnes.map((p) => (
        <li key={p.cle} className="inline-flex items-center gap-1.5 text-sm text-secondary-600">
          {/* Couleur de la personne (planning), pas une couleur de statut. */}
          <Avatar nom={p.nom} id={p.cle} couleur={p.couleur} taille={24} />
          {p.nom}
        </li>
      ))}
    </ul>
  );
}

function LigneRdv({ rdv, equipe, maintenant }) {
  const type = getAppointmentTypeConfig(rdv.appointment_type);
  const client = [rdv.client_name, rdv.client_first_name].filter(Boolean).join(' ');
  const lieu = lieuDuRdv(rdv);
  const enCours = rdvEnCours(rdv, maintenant);
  const aUneAdresse = !!(rdv.address || rdv.postal_code || rdv.city);
  return (
    <li className={`flex items-start gap-4 px-5 py-3 ${enCours ? 'bg-primary-50' : ''}`}>
      <p className="w-24 shrink-0 text-sm tabular-nums text-secondary-900">
        <span className="font-semibold">{rdv.scheduled_start?.slice(0, 5) || '—'}</span>
        {rdv.scheduled_end && <span className="text-secondary-500"> – {rdv.scheduled_end.slice(0, 5)}</span>}
      </p>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-secondary-900">
          {client || rdv.subject || 'Sans titre'}
          <span className="font-normal text-secondary-500"> · {type.label}</span>
        </p>
        {lieu && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-secondary-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {lieu}
          </p>
        )}
        <Personnes personnes={personnesDuRdv(rdv, equipe)} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {enCours && <Tag>En cours</Tag>}
        {aUneAdresse && (
          <LienWaze
            address={rdv.address}
            postalCode={rdv.postal_code}
            city={rdv.city}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-secondary-500 hover:bg-secondary-100 hover:text-secondary-900 lg:h-9 lg:w-9"
          >
            <Navigation className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Itinéraire</span>
          </LienWaze>
        )}
      </div>
    </li>
  );
}

/**
 * @param {Object} props
 * @param {{ date: string, estAujourdhui: boolean, rdvs: Object[], conges: Object[] }} props.journee  cf. journeeAffichee
 * @param {Object[]} props.equipe  teamList de useAppointments
 * @param {boolean} props.isLoading
 * @param {Error|null} props.error
 * @param {string} props.finDeLecture  dernier jour lu (`YYYY-MM-DD`), pour dire jusqu'où rien n'est posé
 */
export function AccueilJournee({ journee, equipe, isLoading, error, finDeLecture }) {
  const enConges = [...new Map(journee.conges.flatMap((c) => personnesDuRdv(c, equipe)).map((p) => [p.cle, p])).values()];
  const nombre = journee.rdvs.length;
  const maintenant = new Date();

  let titre = 'Aujourd’hui';
  let precision = null;
  if (!isLoading && !error) {
    if (!journee.estAujourdhui) {
      titre = `Prochains RDV · ${jourEnClair(journee.date)}`;
      precision = 'Aucun RDV aujourd’hui.';
    } else if (nombre > 0) {
      precision = `${nombre} RDV`;
    }
  }

  return (
    <Card as="section" className="overflow-hidden">
      <CardHeader
        title={titre}
        subtitle={precision}
      />
      {error ? (
        <p className="flex items-start gap-2 border-t border-secondary-100 px-5 py-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Le planning n’a pas pu être chargé. Ouvrez le planning pour voir les RDV.
        </p>
      ) : isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-secondary-400" />
        </div>
      ) : nombre === 0 ? (
        <Vide>Aucun RDV posé d’ici au {jourEnClair(finDeLecture)}.</Vide>
      ) : (
        <>
          <ul className="divide-y divide-secondary-100 border-t border-secondary-100">
            {journee.rdvs.map((rdv) => <LigneRdv key={rdv.id} rdv={rdv} equipe={equipe} maintenant={maintenant} />)}
          </ul>
          {enConges.length > 0 && (
            <p className="border-t border-secondary-100 px-5 py-2.5 text-sm text-secondary-600">
              En congés : {enConges.map((p) => p.nom).join(', ')}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

export default AccueilJournee;
