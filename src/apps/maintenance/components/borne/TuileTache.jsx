// src/apps/maintenance/components/borne/TuileTache.jsx
// Tuile d'une tâche sur la borne, lisible à 3 m. Trois états :
//   - à faire  : bouton, touche = valider ;
//   - en retard: bordure ambre + « depuis N jours » (palette deutan, jamais rouge/vert seul) ;
//   - saisie aujourd'hui : grisée, ✓ + prénom + heure (ou « Pas pu faire »), non cliquable.
import { Check, Clock, AlertTriangle } from 'lucide-react';

const HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

export default function TuileTache({ tache, unite, joursDeRetard, dernierCommentaire, log, operateur, onValider, desactive }) {
  if (log) {
    const pasFait = log.status === 'not_done';
    return (
      <div className="rounded-2xl bg-slate-800/60 border border-slate-700 p-5 opacity-80">
        <p className="text-xl font-semibold text-slate-300 line-through decoration-slate-500">{tache.label}</p>
        <p className={`mt-2 flex items-center gap-2 text-lg ${pasFait ? 'text-amber-300' : 'text-blue-300'}`}>
          {pasFait ? <AlertTriangle className="w-5 h-5" /> : <Check className="w-6 h-6" />}
          {pasFait ? 'Pas pu faire' : 'Fait'} — {operateur || '?'}, {HEURE.format(new Date(log.done_at))}
        </p>
        {pasFait && log.comment && <p className="mt-1 text-base text-slate-400 italic">« {log.comment} »</p>}
      </div>
    );
  }

  const enRetard = joursDeRetard > 0;
  return (
    <button
      type="button"
      disabled={desactive}
      onClick={onValider}
      className={`text-left rounded-2xl p-5 bg-white hover:bg-slate-50 active:bg-slate-100 shadow-lg transition
        disabled:opacity-50 disabled:cursor-not-allowed border-4 ${enRetard ? 'border-amber-400' : 'border-transparent'}`}
    >
      {unite && <p className="text-sm font-medium uppercase tracking-wide text-slate-500">{unite.name}</p>}
      <p className="text-2xl font-bold text-slate-900 leading-tight">{tache.label}</p>
      {tache.instructions && <p className="mt-1 text-base text-slate-600 line-clamp-2">{tache.instructions}</p>}
      {enRetard && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-base font-semibold text-amber-800">
          <Clock className="w-5 h-5" /> En retard depuis {joursDeRetard} jour{joursDeRetard > 1 ? 's' : ''}
        </p>
      )}
      {enRetard && dernierCommentaire && (
        <p className="mt-2 text-base text-slate-600 italic">Dernière note : « {dernierCommentaire} »</p>
      )}
    </button>
  );
}
