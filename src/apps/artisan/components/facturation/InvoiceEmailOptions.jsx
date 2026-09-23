// src/apps/artisan/components/facturation/InvoiceEmailOptions.jsx
// ============================================================================
// Bloc présentationnel « Envoyer la facture par e-mail » — consommé par
// FacturerEntretienDialog (après création) et SendInvoiceEmailDialog (renvoi
// depuis la carte). Ne calcule rien : `availability` et `rows` viennent des
// modèles purs `invoiceEmailAvailability` / `certificateAttachmentRows`
// (`src/lib/invoiceEmailModel.js`).
// ============================================================================
import { INVOICE_EMAIL_REASONS } from '@/lib/invoiceEmailModel';

/**
 * @param {object} p
 * @param {{ visible: boolean, enabled: boolean, reason: string|null }} p.availability
 * @param {string|null|undefined} p.email
 * @param {boolean} p.checked
 * @param {(checked: boolean) => void} p.onCheckedChange
 * @param {Array<{ id, label, sublabel, attachable, defaultChecked, badge }>} p.rows
 * @param {Set<string>} p.selectedIds
 * @param {(id: string) => void} p.onToggleCertificate
 * @param {boolean} p.loadingCertificates
 */
export default function InvoiceEmailOptions({
  availability,
  email,
  checked,
  onCheckedChange,
  rows,
  selectedIds,
  onToggleCertificate,
  loadingCertificates,
}) {
  if (!availability.visible) return null;

  return (
    <div className="mt-3 border border-gray-200 rounded-md p-3 text-sm">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked && availability.enabled}
          disabled={!availability.enabled}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Envoyer la facture par e-mail à <strong>{email || 'au client'}</strong>
        </span>
      </label>
      {!availability.enabled && (
        <p className="mt-1 text-xs text-amber-700">{INVOICE_EMAIL_REASONS[availability.reason]}</p>
      )}

      {availability.enabled && checked && (
        <div className="mt-2 pl-6 space-y-1.5">
          <p className="text-xs text-gray-500">Pièces jointes : la facture</p>
          {loadingCertificates ? (
            <p className="text-xs text-gray-500">Chargement des certificats…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-500">Aucun certificat pour cette intervention.</p>
          ) : (
            <ul className="space-y-1">
              {rows.map((row) => (
                <li key={row.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    disabled={!row.attachable}
                    onChange={() => onToggleCertificate(row.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-gray-900">{row.label}</span>
                    {row.sublabel && <span className="text-gray-500"> · {row.sublabel}</span>}
                    {row.badge && (
                      <span
                        className={`ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          row.badge === 'non signé' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {row.badge}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
