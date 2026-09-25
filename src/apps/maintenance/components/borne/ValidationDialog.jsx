// src/apps/maintenance/components/borne/ValidationDialog.jsx
// Validation d'une tâche sur la borne, 3 étapes — la signature en dernier, comme un registre :
//   1. Fait / Pas pu faire (+ commentaire, obligatoire pour « pas pu faire »)
//   2. Prénom (opérateurs actifs)
//   3. PIN → RPC maint_record_completion → confirmation visible
// PIN faux / opérateur bloqué = réponse métier de la RPC (pas une exception) : affichée ici.
// Fermeture automatique après 30 s sans interaction (rien ne reste à moitié saisi à l'écran).
import { useEffect, useReducer, useRef } from 'react';
import { X, Check, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react';
import PavePin from './PavePin';

const INACTIVITE_MS = 30_000;
const CONFIRMATION_MS = 3_500;
const HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

const initial = { etape: 'statut', statut: null, commentaire: '', operateur: null, pin: '', envoi: false, message: null, resultat: null };

function reducer(state, action) {
  switch (action.type) {
    case 'statut': return { ...state, statut: action.statut, message: null };
    case 'commentaire': return { ...state, commentaire: action.valeur };
    case 'vers_operateur': return { ...state, etape: 'operateur', message: null };
    case 'operateur': return { ...state, operateur: action.operateur, etape: 'pin', pin: '', message: null };
    case 'retour': return { ...state, etape: state.etape === 'pin' ? 'operateur' : 'statut', pin: '', message: null };
    case 'pin': return { ...state, pin: action.valeur };
    case 'envoi': return { ...state, envoi: true, message: null };
    case 'refus': return { ...state, envoi: false, pin: '', message: action.message, etape: action.etape || state.etape };
    case 'succes': return { ...state, envoi: false, etape: 'confirme', resultat: action.resultat };
    default: return state;
  }
}

function messageRefus(res) {
  if (res?.error === 'pin_invalid') {
    const n = res.remaining;
    return { message: `Code incorrect. Encore ${n} essai${n > 1 ? 's' : ''} avant blocage.` };
  }
  if (res?.error === 'locked') {
    const h = res.locked_until ? HEURE.format(new Date(res.locked_until)) : '';
    return { message: `Trop de codes erronés : bloqué${h ? ` jusqu'à ${h}` : ''}. Voir le responsable.`, etape: 'operateur' };
  }
  if (res?.error === 'no_pin') return { message: "Pas encore de code PIN : le responsable doit le définir.", etape: 'operateur' };
  return { message: "Enregistrement refusé. Réessayez ou prévenez le responsable." };
}

export default function ValidationDialog({ cible, operateurs, onFermer, onEnregistrer }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const minuteur = useRef(null);

  // Inactivité : toute interaction (pointer / clavier) relance le minuteur.
  useEffect(() => {
    const relancer = () => {
      clearTimeout(minuteur.current);
      minuteur.current = setTimeout(onFermer, INACTIVITE_MS);
    };
    relancer();
    window.addEventListener('pointerdown', relancer);
    window.addEventListener('keydown', relancer);
    return () => {
      clearTimeout(minuteur.current);
      window.removeEventListener('pointerdown', relancer);
      window.removeEventListener('keydown', relancer);
    };
  }, [onFermer]);

  useEffect(() => {
    if (s.etape !== 'confirme') return undefined;
    const id = setTimeout(onFermer, CONFIRMATION_MS);
    return () => clearTimeout(id);
  }, [s.etape, onFermer]);

  const envoyer = async (pin) => {
    dispatch({ type: 'envoi' });
    try {
      const res = await onEnregistrer({
        taskId: cible.tache.id,
        operatorId: s.operateur.id,
        pin,
        status: s.statut,
        comment: s.commentaire.trim(),
        dueDate: cible.echeance,
      });
      if (res?.ok) dispatch({ type: 'succes', resultat: res });
      else dispatch({ type: 'refus', ...messageRefus(res) });
    } catch (err) {
      const hors = typeof navigator !== 'undefined' && !navigator.onLine;
      dispatch({ type: 'refus', message: hors ? 'Hors ligne : validation impossible.' : `Erreur : ${err?.message || 'enregistrement impossible'}` });
    }
  };

  const commentaireManquant = s.statut === 'not_done' && s.commentaire.trim().length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl rounded-3xl bg-white p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            {cible.unite && <p className="text-base font-medium uppercase tracking-wide text-slate-500">{cible.unite.name}</p>}
            <h2 className="text-3xl font-bold text-slate-900">{cible.tache.label}</h2>
          </div>
          <button type="button" onClick={onFermer} className="p-3 rounded-xl hover:bg-slate-100" aria-label="Fermer">
            <X className="w-8 h-8 text-slate-500" />
          </button>
        </div>

        {s.etape === 'statut' && (
          <div className="mt-8 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={() => dispatch({ type: 'statut', statut: 'done' })}
                className={`h-28 rounded-2xl text-2xl font-bold flex items-center justify-center gap-3 border-4
                  ${s.statut === 'done' ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-800'}`}>
                <Check className="w-9 h-9" /> Fait
              </button>
              <button type="button" onClick={() => dispatch({ type: 'statut', statut: 'not_done' })}
                className={`h-28 rounded-2xl text-2xl font-bold flex items-center justify-center gap-3 border-4
                  ${s.statut === 'not_done' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-800'}`}>
                <AlertTriangle className="w-9 h-9" /> Pas pu faire
              </button>
            </div>
            <div>
              <label htmlFor="maint-commentaire" className="block text-lg font-medium text-slate-700">
                Commentaire {s.statut === 'not_done' ? '(obligatoire)' : '(facultatif)'}
              </label>
              <textarea id="maint-commentaire" rows={2} value={s.commentaire}
                onChange={(e) => dispatch({ type: 'commentaire', valeur: e.target.value })}
                placeholder={s.statut === 'not_done' ? 'Pourquoi ? (ex. pièce manquante)' : 'Ex. courroie usée, à surveiller'}
                className="mt-2 w-full rounded-xl border-2 border-slate-300 p-3 text-xl focus:border-blue-600 focus:outline-none" />
            </div>
            <button type="button" disabled={!s.statut || commentaireManquant}
              onClick={() => dispatch({ type: 'vers_operateur' })}
              className="w-full h-16 rounded-2xl bg-blue-700 text-white text-2xl font-bold disabled:opacity-40">
              Continuer
            </button>
          </div>
        )}

        {s.etape === 'operateur' && (
          <div className="mt-8 space-y-4">
            <p className="text-2xl font-semibold text-slate-800">Qui es-tu ?</p>
            {s.message && <p className="rounded-xl bg-amber-50 p-3 text-lg text-amber-800">{s.message}</p>}
            {operateurs.length === 0 && (
              <p className="text-lg text-slate-600">Aucun opérateur : le responsable doit en créer dans Paramètres → Maintenance.</p>
            )}
            <div className="grid grid-cols-3 gap-3">
              {operateurs.map((o) => (
                <button key={o.id} type="button" onClick={() => dispatch({ type: 'operateur', operateur: o })}
                  className="h-20 rounded-2xl bg-slate-100 hover:bg-slate-200 text-2xl font-semibold text-slate-900">
                  {o.first_name}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => dispatch({ type: 'retour' })}
              className="inline-flex items-center gap-2 text-lg text-slate-600 hover:text-slate-900">
              <ArrowLeft className="w-5 h-5" /> Retour
            </button>
          </div>
        )}

        {s.etape === 'pin' && (
          <div className="mt-6 space-y-5">
            <p className="text-2xl font-semibold text-slate-800 text-center">{s.operateur.first_name}, ton code PIN</p>
            {s.message && <p className="rounded-xl bg-amber-50 p-3 text-lg text-amber-800 text-center">{s.message}</p>}
            {s.envoi ? (
              <div className="flex justify-center py-16"><Loader2 className="w-12 h-12 animate-spin text-blue-700" /></div>
            ) : (
              <PavePin valeur={s.pin} onChange={(v) => dispatch({ type: 'pin', valeur: v })} onComplet={envoyer} />
            )}
            <button type="button" onClick={() => dispatch({ type: 'retour' })}
              className="inline-flex items-center gap-2 text-lg text-slate-600 hover:text-slate-900">
              <ArrowLeft className="w-5 h-5" /> Changer de prénom
            </button>
          </div>
        )}

        {s.etape === 'confirme' && (
          <div className="mt-10 mb-4 text-center">
            <div className={`mx-auto w-24 h-24 rounded-full flex items-center justify-center ${s.statut === 'done' ? 'bg-blue-100' : 'bg-amber-100'}`}>
              {s.statut === 'done' ? <Check className="w-14 h-14 text-blue-700" /> : <AlertTriangle className="w-12 h-12 text-amber-700" />}
            </div>
            <p className="mt-6 text-3xl font-bold text-slate-900">
              {s.statut === 'done' ? '✓ ' : ''}{cible.tache.label}
            </p>
            <p className="mt-2 text-2xl text-slate-700">
              {s.statut === 'done' ? 'Fait' : 'Pas pu faire'} — {s.operateur.first_name},{' '}
              {HEURE.format(new Date(s.resultat?.done_at || Date.now()))}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
