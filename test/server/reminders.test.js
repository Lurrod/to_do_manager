const { remindAtFor, RETARD_MAX_MS, messageGroupe } = require('../../lib/reminders');

const d = (iso) => new Date(iso);

describe('remindAtFor', () => {
  test('sans échéance, il n’y a rien à rappeler', () => {
    expect(remindAtFor(null, '1h')).toBeNull();
  });

  test('sans réglage, il n’y a pas de rappel', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), '')).toBeNull();
  });

  test('« à l’heure dite » tombe sur l’échéance', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), 'atDue').toISOString()).toBe(
      d('2026-09-20T09:00:00').toISOString()
    );
  });

  test('« une heure avant » retire soixante minutes', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), '1h').toISOString()).toBe(
      d('2026-09-20T08:00:00').toISOString()
    );
  });

  test('« la veille » retire vingt-quatre heures', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), '1d').toISOString()).toBe(
      d('2026-09-19T09:00:00').toISOString()
    );
  });

  test('un réglage inconnu ne produit rien plutôt qu’une heure fausse', () => {
    expect(remindAtFor(d('2026-09-20T09:00:00'), 'dans-3-lunes')).toBeNull();
  });
});

describe('messageGroupe', () => {
  test('une seule tâche : son titre', () => {
    expect(messageGroupe([{ title: 'Dentiste' }])).toBe('Dentiste');
  });

  test('plusieurs tâches : les titres séparés', () => {
    expect(messageGroupe([{ title: 'Dentiste' }, { title: 'Impôts' }])).toBe('Dentiste · Impôts');
  });

  test('au-delà de cinq, le reste est compté', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `T${i}` }));
    expect(messageGroupe(six)).toBe('T0 · T1 · T2 · T3 · T4 · et 1 autre');
  });

  test('au-delà de six, le pluriel suit', () => {
    const huit = Array.from({ length: 8 }, (_, i) => ({ title: `T${i}` }));
    expect(messageGroupe(huit)).toMatch(/et 3 autres$/);
  });
});

describe('RETARD_MAX_MS', () => {
  test('vaut sept jours', () => {
    expect(RETARD_MAX_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
