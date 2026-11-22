/**
 * CarteDestinataires.jsx — carte « À qui ? » de la page du mail
 * ============================================================================
 * Le groupe de destinataires (segments enregistrés, rangés Clients / Prospects),
 * le nombre de personnes à qui CE mail partira (sans celles qui l'ont déjà reçu),
 * vingt exemples, et la création d'un groupe sur place (administrateur).
 * Nombre inconnu (chargement, erreur) : rien d'affiché, jamais 0.
 * En lecture (séquence) : le groupe réglé, avec le lien vers les Réglages.
 * Présentation seulement : tout vient de `useEnvoiDeLaPage` et de `src/lib/mailPage.js`.
 * ============================================================================
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Loader2, Plus, Users } from 'lucide-react';
import { selectClass } from '@apps/artisan/components/FormFields';
import SegmentBuilderDrawer from '../SegmentBuilderDrawer';
import Carte from './Carte';

const LIEN = 'inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';

function Nombre({ d }) {
  if (d.etatSegment.etat !== 'ok') return null;
  if (d.nombreEnLecture) {
    return <p className="flex items-center gap-2 text-sm text-secondary-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Calcul du nombre de destinataires…</p>;
  }
  if (typeof d.nombre !== 'number') {
    return <p className="text-sm text-secondary-500">{d.phraseInconnu}</p>;
  }
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 text-sm text-secondary-800">
        <Users className="h-4 w-4 text-primary-700" aria-hidden="true" />
        <span>
          <span className="text-base font-semibold">{d.nombre.toLocaleString('fr-FR')}</span>
          {` personne${d.nombre > 1 ? 's recevront' : ' recevra'} ce mail.`}
        </span>
      </p>
      {d.dejaServis > 0 && (
        <p className="text-sm text-secondary-500">
          {d.dejaServis.toLocaleString('fr-FR')} {d.dejaServis > 1 ? 'ont' : 'a'} déjà reçu ce mail et ne le {d.dejaServis > 1 ? 'recevront' : 'recevra'} pas une seconde fois.
        </p>
      )}
    </div>
  );
}

function Exemples({ e }) {
  if (!e.ouverts) return null;
  if (e.enLecture) return <p className="flex items-center gap-2 text-sm text-secondary-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Chargement des exemples…</p>;
  if (e.enErreur) return <p className="text-sm text-secondary-500">Les exemples n’ont pas pu être lus.</p>;
  if (!e.lignes.length) return <p className="text-sm text-secondary-500">Personne dans ce groupe pour ce mail.</p>;
  return (
    <ul className="max-h-64 divide-y divide-secondary-100 overflow-y-auto rounded-lg border border-secondary-200 text-sm">
      {e.lignes.slice(0, 20).map((r) => (
        <li key={r.recipient_id ?? r.email} className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
          <span className="text-secondary-800">{r.display_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—'}</span>
          <span className="text-secondary-500">{r.email}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {object} props
 * @param {number} props.numero
 * @param {ReturnType<typeof import('./useEnvoiDeLaPage').useEnvoiDeLaPage>['destinataires']} props.d
 */
export default function CarteDestinataires({ numero, d }) {
  const lecture = d.mode === 'lecture';
  const { clients, prospects } = d.ranges;
  // Un segment choisi qui n'est plus proposé (archivé, disparu) reste affiché dans la liste, pour ce qu'il est.
  const horsListe = d.segmentId && d.etatSegment.etat !== 'ok';

  return (
    <Carte numero={numero} titre="À qui ?" sousTitre={lecture ? 'Le groupe réglé pour ce mail.' : 'Le groupe de personnes qui recevra ce mail.'}>
      {lecture ? (
        <div className="space-y-3">
          <p className="text-sm text-secondary-800">{d.etatSegment.segment?.name || 'Aucun groupe réglé.'}</p>
          <Link to="/settings/communication" className={LIEN}>
            Régler ce mail dans Réglages → E-mails & SMS
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <label htmlFor="mail-segment" className="block text-sm font-medium text-secondary-700">Groupe de destinataires</label>
          {d.enErreur ? (
            <p className="text-sm text-secondary-500">Les groupes de destinataires n’ont pas pu être lus. Réessayez dans un instant.</p>
          ) : (
            <select
              id="mail-segment"
              value={d.segmentId ?? ''}
              onChange={(e) => d.actions.choisir(e.target.value)}
              disabled={d.enLecture || d.occupe}
              className={selectClass}
            >
              <option value="">{d.enLecture ? 'Chargement…' : 'Choisir un groupe…'}</option>
              {horsListe && <option value={d.segmentId}>{d.etatSegment.segment?.name ? `${d.etatSegment.segment.name} (archivé)` : 'Groupe supprimé'}</option>}
              {clients.length > 0 && (
                <optgroup label="Clients">
                  {clients.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              )}
              {prospects.length > 0 && (
                <optgroup label="Prospects">
                  {prospects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              )}
            </select>
          )}
          {!d.enregistreSurCampagne && d.segmentId && (
            <p className="text-sm text-secondary-500">Ce choix vaut pour votre envoi : il ne change pas le groupe réglé pour ce mail.</p>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {d.etatSegment.etat === 'ok' && (
              <button type="button" onClick={d.actions.basculerExemples} className={LIEN} aria-expanded={d.exemples.ouverts}>
                {d.exemples.ouverts ? 'Masquer les exemples' : 'Voir des exemples'}
              </button>
            )}
            {d.peutCreer && (
              <button type="button" onClick={d.actions.ouvrirDessin} disabled={d.occupe} className={LIEN}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nouveau groupe de destinataires (segment)
              </button>
            )}
          </div>
        </div>
      )}

      {d.etatSegment.raison && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
          <span>{d.etatSegment.raison}</span>
        </p>
      )}
      <Nombre d={d} />
      <Exemples e={d.exemples} />

      {d.dessinSegment && (
        <SegmentBuilderDrawer onClose={d.actions.fermerDessin} onSaved={d.actions.segmentCree} />
      )}
    </Carte>
  );
}
