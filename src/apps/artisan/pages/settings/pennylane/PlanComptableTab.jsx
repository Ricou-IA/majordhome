// src/apps/artisan/pages/settings/pennylane/PlanComptableTab.jsx
// ============================================================================
// Plan comptable de GESTION (Eric, 2026-09-21) : parmi les comptes de vente
// (classe 7) lus dans Pennylane, ceux que Majord'home a le droit d'utiliser,
// PAR CONTEXTE (une colonne par contexte : Contrat, Devis… — registre
// `PENNYLANE_CHART_CONTEXTS`, le même plan sert à tous les types).
// **Pennylane est canonique** : numéro et libellé viennent de Pennylane, on ne
// fait que COCHER ici (pas d'alias).
//
// Stockage : `settings.pennylane.chart = [{ number, contexts: ['contrat', …] }]`
// (Pennylane décline chaque numéro par taux de TVA, la déclinaison est résolue à
// la facture). `org_update_settings` merge au niveau 1 → objet `pennylane` complet.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings, pennylaneChart, PENNYLANE_CHART_CONTEXTS } from '@hooks/useOrgSettings';
import { useLedgerAccounts } from '@hooks/usePennylane';

const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500';

/** Forme du formulaire : `{ [number]: string[] }` (contextes cochés), normalisée pour la comparaison. */
function pickForm(settings) {
  const out = {};
  for (const c of pennylaneChart(settings)) out[c.number] = [...c.contexts].sort();
  return out;
}

function chartForSave(form) {
  return Object.entries(form)
    .filter(([, ctx]) => ctx?.length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([number, ctx]) => ({ number, contexts: [...ctx].sort() }));
}

export default function PlanComptableTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const { accounts, isLoading: loadingAccounts, error: accountsError } = useLedgerAccounts();
  const [form, setForm] = useState({});
  const [initial, setInitial] = useState({});
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

  const selectedCount = Object.values(form).filter((ctx) => ctx?.length).length;
  const isDirty = useMemo(() => JSON.stringify(chartForSave(form)) !== JSON.stringify(chartForSave(initial)), [form, initial]);

  const isChecked = (number, key) => (form[number] || []).includes(key);
  const toggle = (number, key, checked) =>
    setForm((f) => {
      const current = f[number] || [];
      const next = checked ? (current.includes(key) ? current : [...current, key]) : current.filter((k) => k !== key);
      return { ...f, [number]: next };
    });

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
        Cochez, pour chaque contexte, les comptes de vente que Majord&apos;home peut utiliser. Numéros et libellés sont
        ceux de Pennylane, qui reste la référence : on ne les modifie pas ici.
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
        <div className="border border-secondary-200 rounded-md max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-secondary-50 text-xs text-secondary-500">
              <tr>
                <th className="text-left font-medium px-3 py-2 w-20">Compte</th>
                <th className="text-left font-medium px-3 py-2">Libellé Pennylane</th>
                {PENNYLANE_CHART_CONTEXTS.map((c) => (
                  <th key={c.key} className="text-center font-medium px-3 py-2 w-24" title={c.hint}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {visible.map((n) => {
                const any = (form[n.number] || []).length > 0;
                return (
                  <tr key={n.number} className={any ? 'bg-primary-50/40' : 'hover:bg-secondary-50'}>
                    <td className="px-3 py-2 font-mono text-secondary-900">{n.number}</td>
                    <td className="px-3 py-2 text-secondary-700 truncate max-w-0" title={n.label}>{n.label || '—'}</td>
                    {PENNYLANE_CHART_CONTEXTS.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked(n.number, c.key)}
                          onChange={(e) => toggle(n.number, c.key, e.target.checked)}
                          className={CHECKBOX_CLASS}
                          aria-label={`${c.label} : compte ${n.number}`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={2 + PENNYLANE_CHART_CONTEXTS.length} className="px-3 py-3 text-secondary-500">Aucun compte ne correspond.</td></tr>
              )}
            </tbody>
          </table>
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
