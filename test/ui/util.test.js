import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  dueStatus,
  escapeHtml,
  formatDate,
  greetingForHour,
  safeColor,
  toIso,
  toLocalDatetimeInput,
} from '../../public/js/util.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('escapeHtml', () => {
  test('neutralise les caractères de balisage', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    );
  });

  test('échappe aussi les apostrophes et les esperluettes', () => {
    expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
  });

  test('rend une chaîne vide pour null et undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('safeColor', () => {
  test('accepte les notations hexadécimales', () => {
    expect(safeColor('#fff', 'fallback')).toBe('#fff');
    expect(safeColor('#1f2f5c', 'fallback')).toBe('#1f2f5c');
    expect(safeColor('#1f2f5cAA', 'fallback')).toBe('#1f2f5cAA');
  });

  test('refuse toute valeur qui pourrait déborder de la déclaration CSS', () => {
    expect(safeColor('red; outline: 9999px solid #000', 'fallback')).toBe('fallback');
    expect(safeColor('url(https://exemple.fr/x.png)', 'fallback')).toBe('fallback');
    expect(safeColor(undefined, 'fallback')).toBe('fallback');
  });
});

describe('greetingForHour', () => {
  test.each([
    [3, 'Bonsoir'],
    [8, 'Bonjour'],
    [14, 'Bon après-midi'],
    [21, 'Bonsoir'],
  ])('%i h → %s', (hour, expected) => {
    expect(greetingForHour(hour)).toBe(expected);
  });
});

describe('dueStatus', () => {
  test('classe une échéance passée, proche ou lointaine', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));

    expect(dueStatus(null)).toBe('none');
    expect(dueStatus('pas une date')).toBe('none');
    expect(dueStatus('2026-06-14T12:00:00Z')).toBe('overdue');
    expect(dueStatus('2026-06-15T20:00:00Z')).toBe('soon');
    expect(dueStatus('2026-06-20T12:00:00Z')).toBe('ok');
  });
});

describe('formatDate', () => {
  test('nomme aujourd’hui, demain et hier', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00'));

    expect(formatDate('2026-06-15T18:30:00')).toMatch(/^Aujourd'hui · /);
    expect(formatDate('2026-06-16T09:00:00')).toMatch(/^Demain · /);
    expect(formatDate('2026-06-14T09:00:00')).toMatch(/^Hier · /);
  });

  test('rend null sur une date absente ou invalide', () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate('n’importe quoi')).toBeNull();
  });
});

describe('conversion des dates du formulaire', () => {
  test('fait l’aller-retour entre ISO et datetime-local', () => {
    const local = toLocalDatetimeInput('2026-06-15T18:30:00.000Z');
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(toIso(local)).toBe(new Date('2026-06-15T18:30:00.000Z').toISOString());
  });

  test('rend null ou une chaîne vide sur une entrée vide', () => {
    expect(toLocalDatetimeInput('')).toBe('');
    expect(toIso('')).toBeNull();
    expect(toIso('pas une date')).toBeNull();
  });
});
