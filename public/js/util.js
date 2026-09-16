/* ---------------------------------------------------------------------------
   Utilitaires : échappement, dates, modales, toasts.
   --------------------------------------------------------------------------- */

import { sketchAll, unsketchAll } from './sketch.js';

export const $ = (id) => document.getElementById(id);

export const escapeHtml = (str) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Les couleurs de catégorie viennent de la base : on ne les injecte dans une
 * feuille de style qu'après les avoir reconnues comme couleur hexadécimale.
 */
export const safeColor = (value, fallback) => (HEX_COLOR.test(String(value)) ? value : fallback);

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const formatDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, now)) return `Aujourd'hui · ${time}`;
  if (sameDay(d, tomorrow)) return `Demain · ${time}`;
  if (sameDay(d, yesterday)) return `Hier · ${time}`;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const dueStatus = (iso) => {
  if (!iso) return 'none';
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return 'none';
  const now = Date.now();
  if (due < now) return 'overdue';
  if (due - now < 24 * 60 * 60 * 1000) return 'soon';
  return 'ok';
};

export const toLocalDatetimeInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const toIso = (datetimeLocal) => {
  if (!datetimeLocal) return null;
  const d = new Date(datetimeLocal);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

export const greetingForHour = (hour) => {
  if (hour < 5) return 'Bonsoir';
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
};

const TOAST_MS = 3100;
// une note qui propose « Annuler » doit rester lisible plus longtemps
const TOAST_ACTION_MS = 6000;

/**
 * Note collée en bas de page, encadrée au crayon.
 * @param {{label: string, onClick: () => void}} [action] bouton optionnel
 */
export const toast = (message, variant = 'info', action = null) => {
  const container = $('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast ${variant}${action ? ' toast--action' : ''}`;
  el.dataset.sketch = 'card';
  el.dataset.roughness = '1';

  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    unsketchAll(el);
    el.remove();
  };

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn toast-action';
    button.dataset.sketch = 'button';
    button.dataset.tone = 'neutral';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismiss();
      action.onClick();
    });
    el.append(button);
  }

  container.appendChild(el);
  sketchAll(el);
  timer = setTimeout(dismiss, action ? TOAST_ACTION_MS : TOAST_MS);
};
