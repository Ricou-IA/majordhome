// src/apps/artisan/pages/settings/maintenance/OperateursTab.jsx
// Opérateurs de la borne (signataires, PAS des comptes de connexion) : prénom, actif,
// code PIN (défini / réinitialisé, jamais réaffiché — la base ne le rend pas), déblocage.
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, KeyRound, Unlock, Check, X } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useMaintenanceReferentiel, useMaintenanceMutations } from '@hooks/useMaintenance';

const HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

function SaisiePin({ onValider, onAnnuler, envoi }) {
  const [pin, setPin] = useState('');
  const valide = /^\d{4}$/.test(pin);
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (valide) onValider(pin); }}>
      <input autoFocus type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4 chiffres"
        className="w-28 rounded-lg border border-secondary-300 px-3 py-1.5 text-sm tracking-widest focus:border-primary-500 focus:outline-none" />
      <button type="submit" disabled={!valide || envoi} className="p-1.5 rounded-lg text-primary-700 hover:bg-primary-50 disabled:opacity-40" aria-label="Enregistrer le PIN">
        {envoi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
      <button type="button" onClick={onAnnuler} className="p-1.5 rounded-lg text-secondary-500 hover:bg-secondary-100" aria-label="Annuler">
        <X className="w-4 h-4" />
      </button>
    </form>
  );
}

export default function OperateursTab() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const referentiel = useMaintenanceReferentiel(orgId);
  const { saveOperator, setOperatorPin, unlockOperator } = useMaintenanceMutations(orgId);
  const [prenom, setPrenom] = useState('');
  const [pinPour, setPinPour] = useState(null);
  const operators = referentiel.data?.operators || [];

  const agir = async (promesse, succes) => {
    try {
      await promesse;
      toast.success(succes);
      return true;
    } catch (err) {
      toast.error(`Action impossible : ${err?.message || 'erreur inconnue'}`);
      return false;
    }
  };

  const ajouter = async (e) => {
    e.preventDefault();
    if (!prenom.trim()) return;
    if (await agir(saveOperator.mutateAsync({ first_name: prenom.trim(), sort_order: operators.length + 1 }),
      'Opérateur ajouté — définissez son code PIN')) setPrenom('');
  };

  const definirPin = async (op, pin) => {
    if (await agir(setOperatorPin.mutateAsync({ id: op.id, pin }), `Code PIN de ${op.first_name} enregistré`)) setPinPour(null);
  };

  if (referentiel.isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>;
  if (referentiel.isError) return <div className="card text-red-700">Impossible de charger les opérateurs.</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary-600">
        Les opérateurs signent les tâches sur la borne avec leur prénom et un code PIN à 4 chiffres.
        Ce ne sont pas des comptes de connexion. Après 5 codes erronés, l&apos;opérateur est bloqué 15 minutes.
      </p>

      <form onSubmit={ajouter} className="flex items-center gap-2">
        <input value={prenom} onChange={(e) => setPrenom(e.target.value)} placeholder="Prénom"
          className="rounded-lg border border-secondary-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        <button type="submit" disabled={!prenom.trim() || saveOperator.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
          <Plus className="w-4 h-4" /> Ajouter
        </button>
      </form>

      {operators.length === 0 ? (
        <div className="card text-secondary-600">Aucun opérateur.</div>
      ) : (
        <div className="card p-0 divide-y divide-secondary-100">
          {operators.map((op) => {
            const bloque = op.locked_until && new Date(op.locked_until) > new Date();
            return (
              <div key={op.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className={`font-medium ${op.active ? 'text-secondary-900' : 'text-secondary-400 line-through'}`}>{op.first_name}</p>
                  <p className="text-sm text-secondary-500">
                    {op.has_pin ? 'Code PIN défini' : <span className="text-amber-700">Pas de code PIN — ne peut pas signer</span>}
                    {bloque && <span className="text-amber-700"> · bloqué jusqu&apos;à {HEURE.format(new Date(op.locked_until))}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {pinPour === op.id ? (
                    <SaisiePin envoi={setOperatorPin.isPending} onValider={(pin) => definirPin(op, pin)} onAnnuler={() => setPinPour(null)} />
                  ) : (
                    <button type="button" onClick={() => setPinPour(op.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-primary-700 hover:bg-primary-50">
                      <KeyRound className="w-4 h-4" /> {op.has_pin ? 'Réinitialiser le PIN' : 'Définir le PIN'}
                    </button>
                  )}
                  {bloque && (
                    <button type="button" onClick={() => agir(unlockOperator.mutateAsync(op.id), `${op.first_name} débloqué`)}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-secondary-700 hover:bg-secondary-100">
                      <Unlock className="w-4 h-4" /> Débloquer
                    </button>
                  )}
                  <label className="inline-flex items-center gap-2 text-sm text-secondary-600">
                    <input type="checkbox" checked={op.active}
                      onChange={(e) => agir(saveOperator.mutateAsync({ id: op.id, active: e.target.checked }),
                        e.target.checked ? `${op.first_name} réactivé` : `${op.first_name} désactivé`)} />
                    Actif
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
