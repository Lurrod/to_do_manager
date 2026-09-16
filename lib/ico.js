/* ---------------------------------------------------------------------------
   Cahier — assemble un fichier .ico à partir de plusieurs PNG.

   Windows ne redimensionne pas gracieusement : une icône qui ne contient que
   du 256×256 est réduite à 16 px par l'Explorateur, et le trait fin du carnet
   s'y transforme en bouillie. Un .ico porte donc plusieurs tailles, et le
   système choisit celle qui tombe juste.

   Le format tient en trois blocs : un en-tête de 6 octets, un répertoire de
   16 octets par image, puis les images bout à bout. Les décalages sont écrits
   à la main — s'ils sont faux, le fichier est corrompu sans que rien ne le
   signale, d'où les tests.
   --------------------------------------------------------------------------- */

/** Octets de l'en-tête : réservé (2), type (2), nombre d'images (2). */
const ENTETE = 6;

/** Octets d'une entrée de répertoire. */
const TAILLE_ENTREE = 16;

/**
 * @param {{taille: number, png: Buffer}[]} images
 * @returns {Buffer} le contenu du .ico
 */
const assemblerIco = (images) => {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('Aucune image : un .ico vide ne serait pas un fichier valide.');
  }
  for (const { taille } of images) {
    if (!Number.isInteger(taille) || taille < 1 || taille > 256) {
      throw new Error(`Taille d'icône hors bornes : ${taille} (attendu 1 à 256).`);
    }
  }

  const entete = Buffer.alloc(ENTETE);
  entete.writeUInt16LE(0, 0); // réservé, toujours nul
  entete.writeUInt16LE(1, 2); // 1 = icône (2 serait un curseur)
  entete.writeUInt16LE(images.length, 4);

  const repertoire = Buffer.alloc(images.length * TAILLE_ENTREE);
  let decalage = ENTETE + repertoire.length;

  images.forEach((image, i) => {
    const p = i * TAILLE_ENTREE;
    // 256 ne tient pas dans un octet : le format le code par 0
    repertoire[p] = image.taille === 256 ? 0 : image.taille;
    repertoire[p + 1] = image.taille === 256 ? 0 : image.taille;
    repertoire[p + 2] = 0; // palette : aucune, l'image est en couleurs vraies
    repertoire[p + 3] = 0; // réservé
    repertoire.writeUInt16LE(1, p + 4); // plans
    repertoire.writeUInt16LE(32, p + 6); // bits par pixel, alpha compris
    repertoire.writeUInt32LE(image.png.length, p + 8);
    repertoire.writeUInt32LE(decalage, p + 12);
    decalage += image.png.length;
  });

  return Buffer.concat([entete, repertoire, ...images.map((i) => i.png)]);
};

module.exports = { ENTETE, TAILLE_ENTREE, assemblerIco };
