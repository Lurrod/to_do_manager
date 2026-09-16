const { rankBetween, renumber, NEEDS_RENUMBER, STEP } = require('../../lib/ordering');

describe('rankBetween', () => {
  test('entre deux voisines, le rang du milieu', () => {
    expect(rankBetween(100, 200)).toBe(150);
  });

  test('en tête de liste, un rang en dessous de la première', () => {
    expect(rankBetween(null, 100)).toBe(100 - STEP);
  });

  test('en fin de liste, un rang au-dessus de la dernière', () => {
    expect(rankBetween(100, null)).toBe(100 + STEP);
  });

  test('dans une liste vide, un rang de départ', () => {
    expect(rankBetween(null, null)).toBe(0);
  });

  test('deux voisines trop proches demandent une renumérotation', () => {
    // couper l'intervalle en deux finit par buter sur la précision des
    // flottants : sous ce seuil, deux tâches partageraient le même rang
    expect(rankBetween(1, 1 + 1e-9)).toBe(NEEDS_RENUMBER);
  });

  test('deux voisines identiques demandent une renumérotation', () => {
    expect(rankBetween(42, 42)).toBe(NEEDS_RENUMBER);
  });

  test('des voisines dans le désordre demandent une renumérotation', () => {
    // le client a envoyé un encadrement incohérent : on ne devine pas
    expect(rankBetween(200, 100)).toBe(NEEDS_RENUMBER);
  });
});

describe('renumber', () => {
  test('réécrit les rangs par pas réguliers, en gardant l’ordre', () => {
    expect(renumber(['a', 'b', 'c'])).toEqual([
      { _id: 'a', order: 0 },
      { _id: 'b', order: STEP },
      { _id: 'c', order: 2 * STEP },
    ]);
  });

  test('une liste vide ne produit rien', () => {
    expect(renumber([])).toEqual([]);
  });
});
