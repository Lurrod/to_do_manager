/* ---------------------------------------------------------------------------
   Cahier — pose le binaire Mongo à un endroit connu avant l'empaquetage.

   Sans ce script, `electron-builder` allait chercher mongod dans le cache de
   mongodb-memory-server : un chemin qui dépend de ce que la machine a déjà
   téléchargé, donc un installeur qui ne se construit que sur le poste où il a
   déjà été construit une fois. Ici, la version est écrite noir sur blanc et le
   binaire atterrit toujours au même endroit.
   --------------------------------------------------------------------------- */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoBinary } = require('mongodb-memory-server');

const { VERSION_MONGOD: VERSION } = require('../lib/mongod-version');

/**
 * Empreinte du binaire effectivement embarqué, relevée à la main.
 *
 * Ce qu'elle garantit : toute construction, ici ou en CI, embarque **le même
 * octet pour octet** que celui qui a été vérifié à la main. Un binaire
 * différent — cache corrompu, miroir détourné, version qui glisse — arrête la
 * chaîne au lieu de partir dans un installeur public.
 *
 * Ce qu'elle ne garantit pas : elle n'est pas comparée à une empreinte publiée
 * par MongoDB. C'est une confiance posée au premier usage, pas une preuve
 * d'origine. Elle se relève délibérément à chaque montée de version.
 */
const EMPREINTE = '33302734bfaace51882185cbac1b34a03d4ef0dd29f9014e07b4152c7988672a';

const DESTINATION = path.join(__dirname, '..', 'resources', 'mongod.exe');

/**
 * Empreinte SHA-256 d'un fichier.
 * @param {string} chemin
 * @returns {string} en hexadécimal
 */
const empreinte = (chemin) =>
  crypto.createHash('sha256').update(fs.readFileSync(chemin)).digest('hex');

/**
 * Refuse un binaire qui n'est pas celui attendu.
 * @param {string} chemin
 * @param {string} [attendue]
 * @throws {Error} si l'empreinte diffère
 */
const verifier = (chemin, attendue = EMPREINTE) => {
  const obtenue = empreinte(chemin);
  if (obtenue !== attendue) {
    throw new Error(
      `Empreinte inattendue pour ${chemin}\n  attendue : ${attendue}\n  obtenue  : ${obtenue}\n` +
        `Si c'est une montée de version délibérée, relever EMPREINTE dans ${__filename}.`
    );
  }
  return chemin;
};

const poser = async () => {
  if (fs.existsSync(DESTINATION)) {
    // un fichier déjà là n'est pas une raison de lui faire confiance
    verifier(DESTINATION);
    console.log(`mongod ${VERSION} déjà en place et conforme — ${DESTINATION}`);
    return DESTINATION;
  }

  // ne jamais laisser une variable d'environnement traînante décider quel
  // binaire est empaqueté
  delete process.env.MONGOMS_SYSTEM_BINARY;

  console.log(`Téléchargement de mongod ${VERSION}…`);
  const source = await MongoBinary.getPath({ version: VERSION });

  fs.mkdirSync(path.dirname(DESTINATION), { recursive: true });
  fs.copyFileSync(source, DESTINATION);

  try {
    verifier(DESTINATION);
  } catch (erreur) {
    // ne pas laisser derrière soi un binaire refusé : la construction suivante
    // le trouverait en place et le croirait vérifié
    fs.rmSync(DESTINATION, { force: true });
    throw erreur;
  }

  console.log(`mongod posé et vérifié — ${DESTINATION}`);
  return DESTINATION;
};

if (require.main === module) {
  poser().catch((erreur) => {
    console.error(erreur.message);
    process.exit(1);
  });
}

module.exports = { VERSION, EMPREINTE, DESTINATION, empreinte, verifier, poser };
