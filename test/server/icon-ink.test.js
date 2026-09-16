const { proportionEncree, SEUIL_ENCRE } = require('../../lib/icon-ink');

/** Fabrique un bitmap BGRA uni. */
const uni = (largeur, hauteur, [b, v, r, a]) => {
  const px = Buffer.alloc(largeur * hauteur * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = b;
    px[i + 1] = v;
    px[i + 2] = r;
    px[i + 3] = a;
  }
  return px;
};

describe('proportionEncree', () => {
  test('un canevas blanc opaque ne compte aucune encre', () => {
    // c'est exactement ce qui a été livré avec la 2.0.0 : blanc, opaque, vide
    expect(proportionEncree(uni(16, 16, [255, 255, 255, 255]), 16, 16)).toBe(0);
  });

  test('un canevas entièrement transparent ne compte aucune encre', () => {
    expect(proportionEncree(uni(16, 16, [10, 20, 30, 0]), 16, 16)).toBe(0);
  });

  test('un canevas plein d’encre compte pour un', () => {
    expect(proportionEncree(uni(8, 8, [90, 47, 31, 255]), 8, 8)).toBe(1);
  });

  test('compte la proportion réellement encrée', () => {
    const px = uni(10, 10, [255, 255, 255, 255]);
    // vingt pixels sombres sur cent
    for (let i = 0; i < 20 * 4; i += 4) {
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
    }
    expect(proportionEncree(px, 10, 10)).toBeCloseTo(0.2, 5);
  });

  test('le seuil refuserait le rendu cassé et accepterait le bon', () => {
    // les deux mesures relevées sur les icônes réelles, avant et après
    expect(0.0086).toBeLessThan(SEUIL_ENCRE);
    expect(0.825).toBeGreaterThan(SEUIL_ENCRE);
  });
});
