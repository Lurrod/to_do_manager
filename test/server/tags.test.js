const { normalizeTags, MAX_TAGS, MAX_TAG_LENGTH } = require('../../lib/tags');

describe('normalizeTags', () => {
  test('met en minuscules et rogne les espaces', () => {
    expect(normalizeTags([' Maison ', 'COURSES'])).toEqual(['maison', 'courses']);
  });

  test('écarte les doublons, quelle que soit la casse', () => {
    expect(normalizeTags(['maison', 'Maison', 'MAISON'])).toEqual(['maison']);
  });

  test('écarte les entrées vides sans faire échouer le reste', () => {
    // une virgule en trop dans une saisie n'est pas une intention mal formée
    expect(normalizeTags(['maison', '', '   ', 'courses'])).toEqual(['maison', 'courses']);
  });

  test('tronque une étiquette trop longue plutôt que de la refuser', () => {
    const longue = 'a'.repeat(40);
    expect(normalizeTags([longue])[0]).toHaveLength(MAX_TAG_LENGTH);
  });

  test('garde les dix premières et laisse tomber le reste', () => {
    const douze = Array.from({ length: 12 }, (_, i) => `tag${i}`);
    expect(normalizeTags(douze)).toHaveLength(MAX_TAGS);
  });

  test('ce qui n’est pas un tableau donne une liste vide', () => {
    expect(normalizeTags('maison')).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
  });

  test('ce qui n’est pas une chaîne dans le tableau est écarté', () => {
    expect(normalizeTags(['maison', 42, null, { $ne: null }])).toEqual(['maison']);
  });

  test('l’ordre de première apparition est conservé', () => {
    expect(normalizeTags(['b', 'a', 'b'])).toEqual(['b', 'a']);
  });
});
