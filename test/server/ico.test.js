const { assemblerIco, ENTETE, TAILLE_ENTREE } = require('../../lib/ico');

/** Un faux PNG : seule sa longueur compte pour l'assemblage. */
const fauxPng = (octets, marque) => Buffer.alloc(octets, marque);

describe('assemblerIco', () => {
  test('écrit un en-tête ICO conforme', () => {
    const ico = assemblerIco([{ taille: 32, png: fauxPng(100, 1) }]);

    expect(ico.readUInt16LE(0)).toBe(0); // réservé
    expect(ico.readUInt16LE(2)).toBe(1); // type 1 = icône
    expect(ico.readUInt16LE(4)).toBe(1); // une image
  });

  test('la longueur totale suit l’en-tête, le répertoire et les images', () => {
    const images = [
      { taille: 16, png: fauxPng(80, 1) },
      { taille: 256, png: fauxPng(900, 2) },
    ];

    const ico = assemblerIco(images);

    expect(ico.length).toBe(ENTETE + 2 * TAILLE_ENTREE + 80 + 900);
  });

  test('256 s’écrit 0 — un octet ne peut pas porter 256', () => {
    const ico = assemblerIco([{ taille: 256, png: fauxPng(10, 1) }]);

    expect(ico[ENTETE]).toBe(0); // largeur
    expect(ico[ENTETE + 1]).toBe(0); // hauteur
  });

  test('les décalages pointent réellement sur chaque image', () => {
    const images = [
      { taille: 16, png: fauxPng(40, 0xaa) },
      { taille: 32, png: fauxPng(70, 0xbb) },
      { taille: 48, png: fauxPng(55, 0xcc) },
    ];

    const ico = assemblerIco(images);

    images.forEach((image, i) => {
      const entree = ENTETE + i * TAILLE_ENTREE;
      const longueur = ico.readUInt32LE(entree + 8);
      const decalage = ico.readUInt32LE(entree + 12);

      expect(longueur).toBe(image.png.length);
      // l'octet trouvé à ce décalage doit être celui de CETTE image
      expect(ico.slice(decalage, decalage + longueur)).toEqual(image.png);
    });
  });

  test('déclare 32 bits par pixel et un plan', () => {
    const ico = assemblerIco([{ taille: 48, png: fauxPng(10, 1) }]);

    expect(ico.readUInt16LE(ENTETE + 4)).toBe(1); // plans
    expect(ico.readUInt16LE(ENTETE + 6)).toBe(32); // bits par pixel
  });

  test('refuse une liste vide', () => {
    expect(() => assemblerIco([])).toThrow(/aucune image/i);
  });

  test('refuse une taille hors bornes', () => {
    expect(() => assemblerIco([{ taille: 512, png: fauxPng(10, 1) }])).toThrow(/taille/i);
    expect(() => assemblerIco([{ taille: 0, png: fauxPng(10, 1) }])).toThrow(/taille/i);
  });
});
