/* ---------------------------------------------------------------------------
   Cahier — la version de MongoDB embarquée, écrite une seule fois.

   Elle était répétée dans le script d'empaquetage, dans le chemin de repli du
   processus Electron et dans les clés de cache de la CI. Quatre endroits pour
   un même nombre, dont trois qu'on oublie le jour où il change.

   Ce module vit dans `lib/` et non dans `scripts/` parce que l'application
   empaquetée n'embarque pas `scripts/` : l'importer de là ferait planter l'app
   installée sans jamais rien casser en développement.
   --------------------------------------------------------------------------- */

/** Version de mongod téléchargée, empaquetée et attendue au lancement. */
const VERSION_MONGOD = '8.2.6';

/** Nom du binaire tel que mongodb-memory-server le pose dans son cache. */
const BINAIRE_CACHE = `mongod-x64-win32-${VERSION_MONGOD}.exe`;

module.exports = { VERSION_MONGOD, BINAIRE_CACHE };
