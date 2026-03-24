/**
 * DevisModal.jsx — Modal détail/édition d'un devis existant
 * ============================================================================
 * Affiche le devis avec ses lignes, permet les transitions de statut,
 * la génération PDF, la duplication, et la suppression.
 * ============================================================================
 */

import { useState } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useDevisDetail, useDevisLines, useDevisMutations } from '@hooks/useDevis';
import { computeQuoteTotals, devisService, QUOTE_TEMPLATE_FAMILIES } from '@services/devis.service';
import DevisStatusBadge from './DevisStatusBadge';
import DevisTvaSummary from './DevisTvaSummary';
import { formatEuro, formatDateFR } from '@/lib/utils';
import {
  X, Send, CheckCircle, XCircle, Copy, Trash2, Pencil,
  FileText, Download, Loader2, User, MapPin, Phone, Mail, BookmarkPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { leadsService } from '@services/leads.service';
import { ConfirmDialog } from '@components/ui/confirm-dialog';

export default function DevisModal({ quoteId, leadId, onClose, onStatusChange, onEdit }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { quote, isLoading: loadingQuote } = useDevisDetail(quoteId);
  const { lines, isLoading: loadingLines } = useDevisLines(quoteId);
  const {
    sendQuote, acceptQuote, refuseQuote, duplicateQuote, deleteQuote,
    isSending, isDeleting,
  } = useDevisMutations(leadId);

  const [pdfLoading, setPdfLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateFamily, setTemplateFamily] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  if (loadingQuote || loadingLines) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-xl p-12">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  if (!quote) return null;

  const totals = computeQuoteTotals(lines, quote.global_discount_percent);
  const isBrouillon = quote.status === 'brouillon';
  const isEnvoye = quote.status === 'envoye';

  const handleSend = async () => {
    try {
      const result = await sendQuote(quoteId);
      if (result?.error) throw result.error;
      toast.success('Devis marqué comme envoyé');
      onStatusChange?.();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const handleAccept = async () => {
    try {
      const result = await acceptQuote(quoteId);
      if (result?.error) throw result.error;

      // Auto-conversion lead → client si pas déjà lié
      if (quote?.lead_id && !quote?.client_id) {
        try {
          const convResult = await leadsService.convertLeadToClient(
            quote.lead_id,
            orgId,
            user?.id,
          );
          if (convResult?.data?.client && !convResult.data.skipped) {
            toast.success('Client CRM créé automatiquement');
          }
        } catch (convErr) {
          console.warn('[DevisModal] Auto-conversion lead→client:', convErr);
        }
      }

      toast.success('Devis accepté');
      onStatusChange?.();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const handleRefuse = async () => {
    try {
      const result = await refuseQuote(quoteId);
      if (result?.error) throw result.error;
      toast.success('Devis refusé');
      onStatusChange?.();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const handleDuplicate = async () => {
    try {
      const result = await duplicateQuote(quoteId, orgId);
      if (result?.error) throw result.error;
      toast.success('Devis dupliqué');
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const handleDelete = async () => {
    try {
      const result = await deleteQuote(quoteId);
      if (result?.error) throw result.error;
      toast.success('Devis supprimé');
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Erreur');
    }
  };

  const handleGeneratePdf = async () => {
    try {
      setPdfLoading(true);
      // Dynamic import to avoid loading react-pdf until needed
      const { generateDevisPdfBlob } = await import('./DevisPDF');
      const { devisService } = await import('@services/devis.service');

      const pdfData = {
        quoteNumber: quote.quote_number,
        date: quote.created_at,
        validityDate: quote.validity_date,
        subject: quote.subject,
        clientName: quote.client_display_name,
        clientAddress: quote.client_address,
        clientPostalCode: quote.client_postal_code,
        clientCity: quote.client_city,
        clientPhone: quote.client_phone,
        clientEmail: quote.client_email,
        lines: lines,
        globalDiscountPercent: quote.global_discount_percent,
        totals,
        conditions: quote.conditions,
      };

      const blob = await generateDevisPdfBlob(pdfData);
      const result = await devisService.uploadQuotePdf(quoteId, blob, orgId);
      if (result?.error) throw result.error;

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${quote.quote_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success('PDF généré et sauvegardé');
    } catch (err) {
      console.error('[DevisModal] PDF:', err);
      toast.error('Erreur lors de la génération du PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) return toast.error('Donnez un nom au devis type');
    try {
      setSavingTemplate(true);
      // Préparer les lignes sans IDs spécifiques
      const templateLines = lines.map((l) => ({
        line_type: l.line_type,
        supplier_product_id: l.supplier_product_id || null,
        supplier_id: l.supplier_id || null,
        supplier_name: l.supplier_name || null,
        designation: l.designation,
        description: l.description || '',
        reference: l.reference || '',
        quantity: l.quantity,
        unit: l.unit || 'pièce',
        purchase_price_ht: l.purchase_price_ht,
        unit_price_ht: l.unit_price_ht,
        tva_rate: l.tva_rate,
      }));

      const { error } = await devisService.createTemplate({
        orgId,
        userId: user?.id,
        name: templateName.trim(),
        description: templateDesc.trim() || null,
        family: templateFamily || null,
        lines: templateLines,
        globalDiscountPercent: quote.global_discount_percent,
      });

      if (error) throw error;
      toast.success('Devis type enregistré');
      setShowTemplateForm(false);
      setTemplateName('');
      setTemplateDesc('');
      setTemplateFamily('');
    } catch (err) {
      console.error('[DevisModal] saveTemplate:', err);
      toast.error(err?.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!quote.quote_pdf_path) return;
    try {
      const { devisService } = await import('@services/devis.service');
      const { url, error } = await devisService.getQuotePdfUrl(quote.quote_pdf_path);
      if (error) throw error;
      window.open(url, '_blank');
    } catch (err) {
      toast.error('Erreur lors du téléchargement');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary-600" />
            <div>
              <h2 className="text-lg font-semibold text-secondary-900">{quote.quote_number}</h2>
              {quote.subject && <p className="text-sm text-secondary-500">{quote.subject}</p>}
            </div>
            <DevisStatusBadge status={quote.status} />
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Client */}
          <div className="bg-secondary-50 rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-semibold text-secondary-400 uppercase">Client</h3>
            <div className="grid gap-1.5 text-sm">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-secondary-400" />
                <span className="font-medium">{quote.client_display_name || '—'}</span>
              </div>
              {quote.client_address && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-secondary-400" />
                  <span className="text-secondary-600">{[quote.client_address, quote.client_postal_code, quote.client_city].filter(Boolean).join(', ')}</span>
                </div>
              )}
              {quote.client_phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-secondary-400" />
                  <span className="text-secondary-600">{quote.client_phone}</span>
                </div>
              )}
              {quote.client_email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-secondary-400" />
                  <span className="text-secondary-600">{quote.client_email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Lines table */}
          <div>
            <h3 className="text-xs font-semibold text-secondary-400 uppercase mb-2">Lignes</h3>
            <div className="space-y-1">
              {lines.map((line) => {
                if (line.line_type === 'section_title') {
                  return (
                    <div key={line.id} className="py-1.5 px-2 bg-secondary-100 rounded text-xs font-semibold text-secondary-600 uppercase tracking-wider">
                      {line.designation}
                    </div>
                  );
                }
                return (
                  <div key={line.id} className="flex items-center justify-between py-1.5 px-2 text-sm border-b border-secondary-100">
                    <div className="flex-1 min-w-0">
                      <span className="text-secondary-900">{line.designation}</span>
                      {line.supplier_name && (
                        <span className="text-secondary-400 text-xs ml-2">{line.supplier_name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0 text-secondary-600">
                      <span>{line.quantity} × {formatEuro(line.unit_price_ht)}</span>
                      <span className="font-medium text-secondary-900 w-24 text-right">{formatEuro(line.total_ht)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals */}
          <DevisTvaSummary totals={totals} globalDiscountPercent={quote.global_discount_percent} />

          {/* Dates */}
          <div className="flex gap-6 text-sm text-secondary-500">
            <span>Créé le {formatDateFR(quote.created_at)}</span>
            {quote.validity_date && <span>Valable jusqu'au {formatDateFR(quote.validity_date)}</span>}
            {quote.sent_at && <span>Envoyé le {formatDateFR(quote.sent_at)}</span>}
            {quote.accepted_at && <span>Accepté le {formatDateFR(quote.accepted_at)}</span>}
          </div>

          {/* Conditions */}
          {quote.conditions && (
            <div>
              <h3 className="text-xs font-semibold text-secondary-400 uppercase mb-1">Conditions</h3>
              <p className="text-sm text-secondary-600 whitespace-pre-line">{quote.conditions}</p>
            </div>
          )}
        </div>

        {/* Template save form */}
        {showTemplateForm && (
          <div className="px-6 py-3 border-t bg-amber-50 space-y-2">
            <p className="text-sm font-medium text-secondary-700">Enregistrer en devis type</p>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Nom du devis type *"
              className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              autoFocus
            />
            <select
              value={templateFamily}
              onChange={(e) => setTemplateFamily(e.target.value)}
              className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">— Famille de produit —</option>
              {QUOTE_TEMPLATE_FAMILIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <input
              type="text"
              value={templateDesc}
              onChange={(e) => setTemplateDesc(e.target.value)}
              placeholder="Description (optionnel)"
              className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTemplateForm(false)} className="btn-secondary btn-sm">Annuler</button>
              <button onClick={handleSaveAsTemplate} disabled={savingTemplate} className="btn-primary btn-sm">
                {savingTemplate ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <BookmarkPlus className="w-4 h-4 mr-1" />}
                Enregistrer
              </button>
            </div>
          </div>
        )}

        {/* Footer — Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-white">
          <div className="flex gap-2">
            {/* Destructive actions */}
            <button onClick={() => setShowDeleteConfirm(true)} disabled={isDeleting} className="btn-secondary btn-sm text-red-600 hover:bg-red-50" title="Supprimer">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={handleDuplicate} className="btn-secondary btn-sm" title="Dupliquer">
              <Copy className="w-4 h-4" />
            </button>
            <button onClick={() => setShowTemplateForm(!showTemplateForm)} className="btn-secondary btn-sm" title="Enregistrer en devis type">
              <BookmarkPlus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2">
            {/* PDF */}
            <button onClick={handleGeneratePdf} disabled={pdfLoading} className="btn-secondary btn-sm">
              {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FileText className="w-4 h-4 mr-1" />}
              Générer PDF
            </button>
            {quote.quote_pdf_path && (
              <button onClick={handleDownloadPdf} className="btn-secondary btn-sm">
                <Download className="w-4 h-4 mr-1" /> PDF
              </button>
            )}

            {/* Modifier le devis */}
            {isBrouillon && (
              <button
                onClick={() => {
                  onEdit ? onEdit(quoteId) : toast.info('Édition du devis — à venir');
                }}
                className="btn-secondary btn-sm"
              >
                <Pencil className="w-4 h-4 mr-1" />
                Modifier
              </button>
            )}
            {isEnvoye && (
              <>
                <button onClick={handleRefuse} className="btn-secondary btn-sm text-red-600 hover:bg-red-50">
                  <XCircle className="w-4 h-4 mr-1" /> Refusé
                </button>
                <button onClick={handleAccept} className="btn-primary btn-sm">
                  <CheckCircle className="w-4 h-4 mr-1" /> Accepté
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Supprimer le devis"
        description={`Le devis ${quote?.quote_number || ''} sera définitivement supprimé. Cette action est irréversible.`}
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDelete}
        loading={isDeleting}
      />
    </div>
  );
}
