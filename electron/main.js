/* ---------------------------------------------------------------------------
   Cahier — processus principal Electron.

   Le serveur Express tourne DANS ce processus : le charger ici plutôt que de
   l'engendrer évite d'embarquer un second exécutable Node et de gérer sa mort.

   Deux choses doivent être posées avant de le charger, et c'est tout l'enjeu
   de ce fichier :
     — où écrire les données (l'archive de l'application est en lecture seule) ;
     — où trouver mongod (rien ne doit se télécharger au premier lancement).
   --------------------------------------------------------------------------- */

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const { configurerMisesAJour } = require('../lib/updates');
const { BINAIRE_CACHE } = require('../lib/mongod-version');

/** Une seule instance : deux processus ouvriraient la même base, et WiredTiger la verrouille. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const EN_PAQUET = app.isPackaged;

/**
 * Emplacement des données, posé explicitement.
 *
 * `setName` ne suffit pas : Electron dérive le dossier du champ `name` du
 * package (`cahier`) en application empaquetée, et de « Electron » en
 * développement. Trois noms pour la même application, donc trois bases. On le
 * nomme une bonne fois.
 */
app.setName('Cahier');
app.setPath('userData', path.join(app.getPath('appData'), 'Cahier'));

/**
 * Données de l'utilisateur, hors de l'application.
 * `%APPDATA%\Cahier\db` — conservé lors d'une mise à jour, contrairement à
 * tout ce qui vit à côté de l'exécutable.
 */
const DOSSIER_DONNEES = path.join(app.getPath('userData'), 'db');

/**
 * Le binaire Mongo, empaqueté à côté de l'application.
 *
 * Sans cette variable, mongodb-memory-server irait le télécharger au premier
 * lancement : cent mégaoctets par le réseau, sur une application censée
 * fonctionner hors ligne.
 */
const MONGOD = EN_PAQUET
  ? path.join(process.resourcesPath, 'mongod.exe')
  : path.join(__dirname, '..', 'node_modules', '.cache', 'mongodb-memory-server', BINAIRE_CACHE);

process.env.CAHIER_DATA_DIR = DOSSIER_DONNEES;
process.env.NODE_ENV = 'production';

/**
 * mongodb-memory-server veut un dossier de travail, et le calcule par défaut
 * à côté de son propre module — c'est-à-dire **dans l'archive asar**, qui est
 * un fichier. Toute écriture y échoue par ENOTDIR. On le renvoie donc dehors,
 * même quand le binaire est déjà fourni et qu'il n'a rien à télécharger.
 */
process.env.MONGOMS_DOWNLOAD_DIR = path.join(app.getPath('userData'), 'mongodb-binaries');
process.env.MONGOMS_DISABLE_POSTINSTALL = '1';
fs.mkdirSync(process.env.MONGOMS_DOWNLOAD_DIR, { recursive: true });

if (fs.existsSync(MONGOD)) {
  process.env.MONGOMS_SYSTEM_BINARY = MONGOD;
} else {
  console.warn(`mongod introuvable à ${MONGOD} — il sera téléchargé.`);
}

let fenetre = null;
let serveur = null;
let arretEnCours = false;

/**
 * Relâche Mongo — une fois, quelle que soit la porte de sortie.
 *
 * Deux chemins mènent ici : la fermeture de la fenêtre et la pose d'une mise à
 * jour. Le second ne passe pas forcément par `before-quit` au bon moment, d'où
 * une fonction plutôt qu'un gestionnaire d'événement.
 */
const arreterServices = () => {
  if (arretEnCours || !serveur?.stopServices) return Promise.resolve();
  arretEnCours = true;
  return serveur.stopServices();
};

const creerFenetre = (url) => {
  fenetre = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    // la couleur du papier, pour que l'ouverture ne clignote pas en blanc
    backgroundColor: '#f6f1e4',
    title: 'Cahier',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      // la page n'a aucun besoin de Node : ne pas le lui donner
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  fenetre.once('ready-to-show', () => fenetre.show());
  fenetre.on('closed', () => {
    fenetre = null;
  });

  // un lien externe s'ouvre dans le navigateur, pas dans la fenêtre de l'app
  fenetre.webContents.setWindowOpenHandler(({ url: cible }) => {
    shell.openExternal(cible);
    return { action: 'deny' };
  });

  fenetre.loadURL(url);
};

app.whenReady().then(async () => {
  // pas de barre de menus : ce n'est pas un navigateur
  Menu.setApplicationMenu(null);

  try {
    serveur = require(path.join(__dirname, '..', 'server.js'));
    // les deux : le serveur peut écouter alors que la base a échoué, et une
    // fenêtre ouverte sur une application sans base ne montrerait que des
    // erreurs
    const [url] = await Promise.all([serveur.ready, serveur.dbReady]);
    creerFenetre(url);

    // après la fenêtre, jamais avant : la mise à jour ne doit pas retarder
    // l'ouverture du Cahier, ni l'empêcher si le réseau est absent.
    //
    // Rien ne s'affiche depuis ici : l'updater écrit dans l'état porté par le
    // serveur, et c'est la page qui en parle, avec ses mots et son papier.
    configurerMisesAJour({
      updater: autoUpdater,
      etat: serveur.etatMaj,
      enPaquet: EN_PAQUET,
      arreterServices,
    });
  } catch (error) {
    dialog.showErrorBox(
      'Le Cahier n’a pas pu démarrer',
      `${error.message}\n\nDonnées : ${DOSSIER_DONNEES}\nMongo : ${MONGOD}\n\n${error.stack || ''}`
    );
    app.quit();
  }
});

app.on('second-instance', () => {
  if (fenetre) {
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.focus();
  }
});

app.on('window-all-closed', () => {
  // fermer la fenêtre ferme le Cahier : il n'a rien à faire en arrière-plan
  // une fois qu'on l'a rangé
  app.quit();
});

/**
 * Mongo tient un verrou sur le dossier de données. Le laisser derrière soi
 * empêcherait le prochain lancement de s'ouvrir. On retarde donc la sortie le
 * temps de le relâcher — une seule fois, sans quoi `app.quit()` rappellerait
 * ce gestionnaire en boucle.
 */
app.on('before-quit', (event) => {
  if (arretEnCours || !serveur?.stopServices) return;
  event.preventDefault();
  // `.finally` ne consomme pas un rejet : sans ce `catch`, un arrêt de Mongo qui
  // échoue ferait sortir le Cahier sur une unhandledRejection
  arreterServices()
    .catch((erreur) => console.warn(`Arrêt des services : ${erreur?.message || erreur}`))
    .finally(() => app.quit());
});
