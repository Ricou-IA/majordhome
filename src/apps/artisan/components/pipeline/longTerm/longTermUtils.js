/**
 * longTermUtils.js - Majord'home Artisan
 * ============================================================================
 * Utilitaires pour le module Suivi MT-LT.
 * ============================================================================
 */

import {
  Phone,
  Mail,
  MessageSquare,
  Users,
  StickyNote,
  HelpCircle,
} from 'lucide-react';

export const CHANNEL_CONFIG = {
  phone:   { label: 'Téléphone',  icon: Phone,         color: 'bg-amber-100 text-amber-700' },
  email:   { label: 'Email',      icon: Mail,          color: 'bg-blue-100 text-blue-700' },
  sms:     { label: 'SMS',        icon: MessageSquare, color: 'bg-cyan-100 text-cyan-700' },
  meeting: { label: 'Rendez-vous', icon: Users,        color: 'bg-violet-100 text-violet-700' },
  note:    { label: 'Note',       icon: StickyNote,    color: 'bg-gray-100 text-gray-700' },
};

export function getChannelConfig(channel) {
  return CHANNEL_CONFIG[channel] || { label: channel, icon: HelpCircle, color: 'bg-gray-100 text-gray-600' };
}

/**
 * Calcule la fraîcheur du suivi à partir de la dernière interaction (ou de la date
 * de mise en MT-LT si aucune interaction). Renvoie un niveau, un label et des classes Tailwind.
 *
 * 🟢 < 30j / 🟡 30-60j / 🟠 60-90j / 🔴 > 90j
 */
export function computeFreshness(lastInteractionAt, longTermStartedAt) {
  const ref = lastInteractionAt || longTermStartedAt;
  if (!ref) {
    return {
      level: 'unknown',
      days: null,
      label: '—',
      hasInteraction: false,
      classes: 'text-gray-400 bg-gray-50 border-gray-200',
      rowClasses: '',
      dot: 'bg-gray-300',
    };
  }
  const days = Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24));
  const hasInteraction = !!lastInteractionAt;
  const baseLabel = days === 0 ? "aujourd'hui" : `il y a ${days}j`;
  const label = hasInteraction ? baseLabel : `aucune interaction · ${baseLabel}`;

  if (days < 30) {
    return {
      level: 'fresh',
      days,
      label,
      hasInteraction,
      classes: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      rowClasses: '',
      dot: 'bg-emerald-500',
    };
  }
  if (days < 60) {
    return {
      level: 'medium',
      days,
      label,
      hasInteraction,
      classes: 'text-amber-700 bg-amber-50 border-amber-200',
      rowClasses: '',
      dot: 'bg-amber-500',
    };
  }
  if (days < 90) {
    return {
      level: 'stale',
      days,
      label,
      hasInteraction,
      classes: 'text-orange-700 bg-orange-50 border-orange-200',
      rowClasses: 'bg-orange-50/40',
      dot: 'bg-orange-500',
    };
  }
  return {
    level: 'forgotten',
    days,
    label,
    hasInteraction,
    classes: 'text-red-700 bg-red-50 border-red-200',
    rowClasses: 'bg-red-50/40',
    dot: 'bg-red-500',
  };
}

export function formatInteractionDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
