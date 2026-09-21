// src/apps/artisan/pages/settings/pennylane/PlanComptableTab.jsx
// ============================================================================
// Plan comptable de GESTION (Eric, 2026-09-21) : parmi les comptes de vente
// (classe 7) lus dans Pennylane, ceux que Majord'home a le droit d'utiliser.
// **Pennylane est canonique** : numéro et libellé viennent de Pennylane, on ne
// fait que COCHER ici (pas d'alias — retiré le soir même à la demande d'Eric).
// Source unique de tous les sélecteurs de compte : contrats d'entretien et
// pièces aujourd'hui, catalogue article (devis) demain.
//
// Stockage : `settings.pennylane.chart = [{ number }]` — des NUMÉROS (Pennylane
// décline chaque numéro par taux de TVA, la déclinaison est résolue à la facture).
// `org_update_settings` merge au niveau 1 → on renvoie l'objet `pennylane` complet.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings, pennylaneChart } from '@hooks/useOrgSettings';
import { useLedgerAccounts } from '@hooks/usePennylane';

const ERROR_CLASS = 'mt-1 text-xs text-red-600';

/** Forme du formulaire : liste triée des numéros cochés, comparable en JSON. */
function pickForm(settings) {
  return pennylaneChart(settings).map((c) => c.number).sort();
}

function chartForSave(numbers) {
  return [...numbers].sort().map((number) => ({ number }));
}

export default function PlanComptableTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const { accounts, isLoading: loadingAccounts, error: accountsError } = useLedgerAccounts();
  const [form, setForm] = useState([]);
  const [initial, setInitial] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const picked = pickForm(settings);
    setForm(picked);
    setInitial(picked);
  }, [settings]);

  // Un numéro une fois (Pennylane décline par TVA), trié
  const numbers = useMemo(() => {
    const byNumber = new Map();
    for (const a of accounts || []) {
      if (!byNumber.has(a.number)) byNumber.set(a.number, { number: a.number, label: a.label });
    }
    return [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number));
  }, [accounts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return numbers;
    return numbers.filter((n) => n.number.includes(q) || (n.label || '').toLowerCase().includes(q));
  }, [numbers, query]);

  const selectedCount = form.length;
  const isDirty = useMemo(() => JSON.stringify([...form].sort()) !== JSON.stringify([...initial].sort()), [form, initial]);

  const toggle = (number, checked) =>
    setForm((f) => (checked ? (f.includes(number) ? f : [...f, number]) : f.filter((n) => n !== number)));

  const handleSave = async () => {
    try {
      const pennylane = { ...(settings?.pennylane || {}), chart: chartForSave(form) };
      await save({ pennylane });
      toast.success('Plan comptable de gestion enregistré');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'enregistrement");
    }
  };

  if (isLoading) return <div className="card text-sm text-secondary-500">Chargement…</div>;

  return (
    <div className="card space-y-4">
      <p className="text-sm text-secondary-600">
        Cochez les comptes de vente que Majord&apos;home peut utiliser. Numéros et libellés sont ceux de Pennylane,
        qui reste la référence : on ne les modifie pas ici. Seuls les comptes cochés sont proposés dans les
        paramétrages (contrats d&apos;entretien, pièces, et demain les articles du catalogue).
      </p>

      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer par numéro ou libellé…"
          className="w-full sm:w-72 px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <span className="text-xs text-secondary-500 whitespace-nowrap">{selectedCount} compte{selectedCount > 1 ? 's' : ''} retenu{selectedCount > 1 ? 's' : ''}</span>
      </div>

      {accountsError && <p className={ERROR_CLASS}>Comptes Pennylane indisponibles : {accountsError.message || 'erreur'}</p>}
      {loadingAccounts && <p className="text-sm text-secondary-500">Lecture du plan comptable Pennylane…</p>}

      {!loadingAccounts && numbers.length > 0 && (
        <div className="border border-secondary-200 rounded-md divide-y divide-secondary-100 max-h-[32rem] overflow-y-auto">
          {visible.map((n) => {
            const checked = form.includes(n.number);
            return (
              <label key={n.number} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${checked ? 'bg-primary-50/40' : 'hover:bg-secondary-50'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(n.number, e.target.checked)}
                  className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                  aria-label={`Retenir le compte ${n.number}`}
                />
                <span className="w-16 font-mono text-sm text-secondary-900">{n.number}</span>
                <span className="flex-1 min-w-0 truncate text-sm text-secondary-700" title={n.label}>{n.label || '—'}</span>
              </label>
            );
          })}
          {visible.length === 0 && <p className="px-3 py-3 text-sm text-secondary-500">Aucun compte ne correspond.</p>}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button
          type="button"
          onClick={() => setForm(initial)}
          disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
