// src/apps/artisan/pages/settings/pennylane/PlanComptableTab.jsx
// ============================================================================
// Plan comptable de GESTION (Eric, 2026-09-21) : parmi les comptes de vente
// (classe 7) lus dans Pennylane, ceux que Majord'home a le droit d'utiliser, avec
// un alias facultatif. Source unique de tous les sélecteurs de compte : contrats
// d'entretien et pièces aujourd'hui, catalogue article (devis) demain.
//
// Stockage : `settings.pennylane.chart = [{ number, alias }]` — des NUMÉROS (Pennylane
// décline chaque numéro par taux de TVA, la déclinaison est résolue à la facture).
// `org_update_settings` merge au niveau 1 → on renvoie l'objet `pennylane` complet.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings, pennylaneChart } from '@hooks/useOrgSettings';
import { useLedgerAccounts } from '@hooks/usePennylane';

const INPUT_CLASS = 'w-full px-2 py-1 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

/** Forme du formulaire : `{ [number]: { checked, alias } }`, comparable en JSON. */
function pickForm(settings) {
  const out = {};
  for (const c of pennylaneChart(settings)) out[c.number] = { checked: true, alias: c.alias };
  return out;
}

function chartForSave(form) {
  return Object.entries(form)
    .filter(([, v]) => v?.checked)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([number, v]) => ({ number, alias: (v.alias || '').trim() }));
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

  const selectedCount = Object.values(form).filter((v) => v?.checked).length;
  const isDirty = useMemo(() => JSON.stringify(chartForSave(form)) !== JSON.stringify(chartForSave(initial)), [form, initial]);

  const toggle = (number, checked) =>
    setForm((f) => ({ ...f, [number]: { checked, alias: f[number]?.alias || '' } }));
  const setAlias = (number, alias) =>
    setForm((f) => ({ ...f, [number]: { checked: f[number]?.checked ?? true, alias } }));

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
        Cochez les comptes de vente que Majord&apos;home peut utiliser. Seuls ces comptes sont proposés dans les
        paramétrages (contrats d&apos;entretien, pièces, et demain les articles du catalogue). L&apos;alias est le nom
        que vous verrez à la place du libellé Pennylane.
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
            const row = form[n.number];
            const checked = !!row?.checked;
            return (
              <div key={n.number} className={`flex items-center gap-3 px-3 py-2 ${checked ? 'bg-primary-50/40' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(n.number, e.target.checked)}
                  className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                  aria-label={`Retenir le compte ${n.number}`}
                />
                <span className="w-16 font-mono text-sm text-secondary-900">{n.number}</span>
                <span className="flex-1 min-w-0 truncate text-sm text-secondary-600" title={n.label}>{n.label}</span>
                <input
                  type="text"
                  value={row?.alias || ''}
                  onChange={(e) => setAlias(n.number, e.target.value)}
                  disabled={!checked}
                  placeholder="Alias (facultatif)"
                  className={`${INPUT_CLASS} w-48 disabled:opacity-40`}
                />
              </div>
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
