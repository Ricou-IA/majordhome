/**
 * MapPopup.jsx
 * Popup flottant affichant les détails d'un point CRM sélectionné
 */

import { X, Phone, Mail, MapPin, FileCheck, ExternalLink } from 'lucide-react';
import { CRM_POINT_TYPES } from '@/lib/territoire-config';

export default function MapPopup({ point, onClose, onViewDetail }) {
  if (!point) return null;

  const typeConfig = CRM_POINT_TYPES[point.type] || CRM_POINT_TYPES.client;

  const formatPhone = (phone) => {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
    }
    return phone;
  };

  return (
    <div className="absolute bottom-4 left-4 z-20 w-80 bg-white rounded-xl shadow-xl border border-secondary-200 overflow-hidden animate-fade-in">
      {/* Header avec badge type */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-100">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: typeConfig.color }}
          />
          <span className="text-xs font-medium text-secondary-500 uppercase tracking-wide">
            {typeConfig.label}
          </span>
          {point.clientNumber && (
            <span className="text-xs text-secondary-400">
              {point.clientNumber}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-secondary-100 text-secondary-400 hover:text-secondary-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-2">
        {/* Nom */}
        <h3 className="text-sm font-semibold text-secondary-900">
          {point.label}
        </h3>

        {/* Adresse */}
        {(point.city || point.postalCode) && (
          <div className="flex items-start gap-2 text-xs text-secondary-500">
            <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{[point.postalCode, point.city].filter(Boolean).join(' ')}</span>
          </div>
        )}

        {/* Téléphone */}
        {point.phone && (
          <div className="flex items-center gap-2 text-xs text-secondary-500">
            <Phone className="w-3.5 h-3.5 shrink-0" />
            <a href={`tel:${point.phone}`} className="hover:text-primary-600 transition-colors">
              {formatPhone(point.phone)}
            </a>
          </div>
        )}

        {/* Email */}
        {point.email && (
          <div className="flex items-center gap-2 text-xs text-secondary-500">
            <Mail className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{point.email}</span>
          </div>
        )}

        {/* Contrat */}
        {point.hasContract && (
          <div className="flex items-center gap-2">
            <FileCheck className="w-3.5 h-3.5 text-violet-500 shrink-0" />
            <span className="text-xs font-medium text-violet-600">Contrat actif</span>
          </div>
        )}

        {/* Montant (leads/devis) */}
        {point.amount && (
          <div className="text-xs font-medium text-secondary-700">
            Montant estimé : {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(point.amount)}
          </div>
        )}

        {/* Status (leads) */}
        {point.status && point.type === 'lead' && (
          <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
            {point.status}
          </span>
        )}
      </div>

      {/* Footer — Voir la fiche */}
      {onViewDetail && (
        <div className="px-4 py-3 border-t border-secondary-100 bg-secondary-50">
          <button
            onClick={() => onViewDetail(point)}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-primary-700 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Voir la fiche
          </button>
        </div>
      )}
    </div>
  );
}
