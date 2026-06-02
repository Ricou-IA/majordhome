import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Date | string → YYYY-MM-DD (pour les <input type="date">)
export function formatDateForInput(dateOrString) {
  if (!dateOrString) return '';
  try {
    const d = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

// Date → "1 janvier 2026"
export function formatDateFR(dateString) {
  if (!dateString) return '-';
  try {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

// Date → "1 janv. 2026"
export function formatDateShortFR(dateString) {
  if (!dateString) return '-';
  try {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

// Date → "1 janv. 2026, 14:30"
export function formatDateTimeFR(dateString) {
  if (!dateString) return '-';
  try {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

// Date → relatif fr : "à l'instant", "dans 6 minutes", "il y a 2 heures", "demain",
// "il y a 3 jours". Au-delà d'une semaine → date courte ("9 juin 2026").
// Renvoie null si la date est absente/invalide (le caller décide du fallback).
export function formatRelativeFR(dateString) {
  if (!dateString) return null;
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return null;
    const diffMs = d.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    if (absMs < MIN) return "à l'instant";
    const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
    if (absMs < HOUR) return rtf.format(Math.round(diffMs / MIN), 'minute');
    if (absMs < DAY) return rtf.format(Math.round(diffMs / HOUR), 'hour');
    if (absMs < 7 * DAY) return rtf.format(Math.round(diffMs / DAY), 'day');
    return formatDateShortFR(dateString);
  } catch {
    return null;
  }
}

// "0612345678" → "06 12 34 56 78"
export function formatPhoneNumber(value) {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 10);
  const parts = [];
  for (let i = 0; i < digits.length; i += 2) parts.push(digits.slice(i, i + 2));
  return parts.join(' ');
}

// 1234.5 → "1 235 €"
export function formatEuro(amount) {
  if (!amount && amount !== 0) return '-';
  const n = parseFloat(amount);
  const hasDecimals = n % 1 !== 0;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(n);
}

// 1234.01 → "1 235 €" — arrondi au plafond, sans décimales.
// Utilisé pour les KPI Kanban (cartes + totaux colonne) côté Pipeline et Chantiers.
export function formatEuroCeil(amount) {
  if (!amount && amount !== 0) return '-';
  return formatEuro(Math.ceil(parseFloat(amount)));
}

// "09:00" + 60 → "10:00"
export function computeEndTime(startTime, durationMinutes) {
  if (!startTime || !durationMinutes) return '';
  const [h, m] = startTime.split(':').map(Number);
  const totalMin = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

// "09:00", "10:30" → 90
export function computeDuration(startTime, endTime) {
  if (!startTime || !endTime) return 60;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff : 60;
}
