import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Date → YYYY-MM-DD (pour les <input type="date">)
export function formatDateForInput(dateString) {
  if (!dateString) return '';
  try {
    return new Date(dateString).toISOString().split('T')[0];
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

// "0612345678" → "06 12 34 56 78"
export function formatPhoneNumber(value) {
  if (!value) return '';
  const digits = value.replace(/\D/g, '').slice(0, 10);
  const parts = [];
  for (let i = 0; i < digits.length; i += 2) parts.push(digits.slice(i, i + 2));
  return parts.join(' ');
}
