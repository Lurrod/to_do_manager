const { nextDueDate } = require('../../lib/recurrence');

/** Date locale lisible, pour que les tests ne dépendent pas du fuseau. */
const d = (iso) => new Date(iso);

describe('nextDueDate', () => {
  test('sans récurrence, il n’y a pas de suite', () => {
    expect(
      nextDueDate(d('2026-09-15T09:00:00'), { freq: '', interval: 1, until: null })
    ).toBeNull();
  });

  test('quotidienne : le lendemain, à la même heure', () => {
    const suite = nextDueDate(d('2026-09-15T09:30:00'), {
      freq: 'daily',
      interval: 1,
      until: null,
    });
    expect(suite.getFullYear()).toBe(2026);
    expect(suite.getMonth()).toBe(8);
    expect(suite.getDate()).toBe(16);
    expect(suite.getHours()).toBe(9);
    expect(suite.getMinutes()).toBe(30);
  });

  test('l’intervalle saute d’autant de pas', () => {
    const suite = nextDueDate(d('2026-09-15T09:00:00'), {
      freq: 'daily',
      interval: 3,
      until: null,
    });
    expect(suite.getDate()).toBe(18);
  });

  test('hebdomadaire : sept jours plus tard, même jour de la semaine', () => {
    const depart = d('2026-09-15T09:00:00');
    const suite = nextDueDate(depart, { freq: 'weekly', interval: 1, until: null });
    expect(suite.getDay()).toBe(depart.getDay());
    expect(suite.getDate()).toBe(22);
  });

  test('mensuelle : le même quantième le mois suivant', () => {
    const suite = nextDueDate(d('2026-09-15T09:00:00'), {
      freq: 'monthly',
      interval: 1,
      until: null,
    });
    expect(suite.getMonth()).toBe(9);
    expect(suite.getDate()).toBe(15);
  });

  test('mensuelle depuis un 31 : rabattue sur la fin du mois visé, pas débordée', () => {
    // sans garde, setMonth ferait glisser le 31 janvier au 3 mars
    const suite = nextDueDate(d('2026-01-31T09:00:00'), {
      freq: 'monthly',
      interval: 1,
      until: null,
    });
    expect(suite.getMonth()).toBe(1);
    expect(suite.getDate()).toBe(28);
  });

  test('mensuelle depuis un 31 vers un mois de 30 jours', () => {
    const suite = nextDueDate(d('2026-08-31T09:00:00'), {
      freq: 'monthly',
      interval: 1,
      until: null,
    });
    expect(suite.getMonth()).toBe(8);
    expect(suite.getDate()).toBe(30);
  });

  test('une date suivante au-delà de `until` arrête la série', () => {
    const suite = nextDueDate(d('2026-09-15T09:00:00'), {
      freq: 'weekly',
      interval: 1,
      until: d('2026-09-20T00:00:00'),
    });
    expect(suite).toBeNull();
  });

  test('`until` le jour même de la suite laisse passer', () => {
    const suite = nextDueDate(d('2026-09-15T09:00:00'), {
      freq: 'daily',
      interval: 1,
      until: d('2026-09-16T23:59:59'),
    });
    expect(suite).not.toBeNull();
  });

  test('sans échéance de départ, il n’y a rien à faire avancer', () => {
    expect(nextDueDate(null, { freq: 'daily', interval: 1, until: null })).toBeNull();
  });

  test('une fréquence inconnue ne produit rien plutôt qu’une date fausse', () => {
    expect(
      nextDueDate(d('2026-09-15T09:00:00'), { freq: 'yearly', interval: 1, until: null })
    ).toBeNull();
  });
});
