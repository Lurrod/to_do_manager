const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { exportShape, validateImport } = require('./lib/portable');

const app = express();
const port = parseInt(process.env.PORT, 10) || 3000;
// boucle locale par défaut : l'API n'a pas d'authentification
const host = process.env.HOST || '127.0.0.1';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;
const MAX_SEARCH = 100;
// une tâche supprimée reste restaurable, puis disparaît pour de bon
const PURGE_AFTER_DAYS = 7;

// pas de CORS par défaut : le front est servi par ce même serveur. Ouvrir
// explicitement (CORS_ORIGIN=https://exemple.fr) pour un client externe.
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN }));
}
// une sauvegarde entière ne tient pas dans la limite prévue pour une tâche.
// Monté avant le parseur global, qui laissera passer une requête déjà lue.
app.use('/import', bodyParser.json({ limit: '8mb' }));
app.use(bodyParser.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));
// la lib drawably est servie telle quelle depuis node_modules (ESM, zero build)
app.use(
  '/vendor/drawably',
  express.static(path.join(__dirname, 'node_modules', 'drawably'))
);

const isRemoteUri = (uri) =>
  typeof uri === 'string' &&
  uri.length > 0 &&
  !uri.includes('127.0.0.1') &&
  !uri.includes('localhost');

let embeddedMongo = null;

async function resolveMongoUri() {
  if (isRemoteUri(process.env.MONGO_URI)) {
    return process.env.MONGO_URI;
  }

  const { MongoMemoryServer } = require('mongodb-memory-server');
  const dbPath = path.join(__dirname, 'data', 'db');
  fs.mkdirSync(dbPath, { recursive: true });

  console.log('Démarrage de MongoDB embarqué… (premier lancement : téléchargement ~100 Mo)');
  embeddedMongo = await MongoMemoryServer.create({
    instance: {
      dbPath,
      storageEngine: 'wiredTiger',
    },
  });
  console.log(`MongoDB embarqué prêt — données persistantes dans ${dbPath}`);
  return embeddedMongo.getUri();
}

async function shutdown(code = 0) {
  try {
    await mongoose.disconnect();
  } catch (_) {}
  if (embeddedMongo) {
    await embeddedMongo.stop({ doCleanup: false, force: false });
  }
  process.exit(code);
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  (async () => {
    try {
      const uri = await resolveMongoUri();
      await mongoose.connect(uri);
      console.log('MongoDB connecté');
      await purgeDeletedTasks();
    } catch (err) {
      console.error('Erreur de connexion à MongoDB:', err.message);
      await shutdown(1);
    }
  })();
}

/* --------------------------------------------------------------------------
   Modèles
   -------------------------------------------------------------------------- */

const PRIORITIES = ['', 'low', 'medium', 'high'];

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  dueDate: { type: Date, default: null },
  category: { type: String, default: '', trim: true, maxlength: 32 },
  priority: { type: String, enum: PRIORITIES, default: '' },
  // suppression douce : la corbeille rend le « Annuler » possible
  deletedAt: { type: Date, default: null },
});

taskSchema.index({ deletedAt: 1, createdAt: -1 });
taskSchema.index({ deletedAt: 1, dueDate: 1 });
taskSchema.index({ deletedAt: 1, category: 1 });

// la couleur est injectée telle quelle dans une déclaration CSS côté client :
// on n'accepte qu'une notation hexadécimale
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true, maxlength: 32 },
  color: {
    type: String,
    required: true,
    match: [HEX_COLOR, 'Couleur invalide : format attendu #rgb, #rrggbb ou #rrggbbaa'],
  },
});

const Task = mongoose.model('Task', taskSchema);
const Category = mongoose.model('Category', categorySchema);

/* --------------------------------------------------------------------------
   Utilitaires
   -------------------------------------------------------------------------- */

// liste blanche : le client ne pose jamais createdAt, deletedAt ni _id lui-même
const CREATE_FIELDS = ['title', 'description', 'dueDate', 'category', 'priority'];
const UPDATE_FIELDS = [...CREATE_FIELDS, 'completed'];

const pick = (source, fields) =>
  fields.reduce(
    (acc, field) => (source?.[field] === undefined ? acc : { ...acc, [field]: source[field] }),
    {}
  );

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Express transforme `?category[$ne]=null` en objet : injecté tel quel dans un
 * filtre, c'est un opérateur Mongo fourni par le client (et `aggregate` ne
 * caste rien, contrairement à `find`). Tout paramètre est donc ramené à une
 * chaîne avant usage.
 */
const asString = (value, max = 100) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Bornes de pagination, communes aux listes.
 * Le total est compté avant la page : deux requêtes, donc un total
 * théoriquement décalé si une écriture s'intercale. Acceptable ici (un seul
 * utilisateur local) et toujours plus juste que compter côté client sur la
 * page affichée.
 */
const paginate = (query, total) => {
  const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(query.limit, DEFAULT_LIMIT)));
  const totalPages = Math.max(1, Math.ceil(total / limit));
  // supprimer le dernier élément d'une page ne doit pas laisser une page vide
  const currentPage = Math.min(Math.max(1, toInt(query.page, 1)), totalPages);
  return { limit, totalPages, currentPage, skip: (currentPage - 1) * limit };
};

/* Bornes de journée en heure locale du serveur : le navigateur tourne sur la
   même machine, il n'y a donc aucun décalage à faire transiter. */
const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * Horizons emboîtés : `today` contient le retard, `week` contient `today`.
 * Une tâche en retard ne doit jamais disparaître d'une vue plus large — c'est
 * précisément l'oubli que ces vues servent à empêcher.
 * @returns {object|null} clause à fusionner dans le filtre, ou null si `due` est inconnu
 */
const dueClause = (due, now = new Date()) => {
  const start = startOfDay(now);
  if (due === 'overdue') return { dueDate: { $ne: null, $lt: start } };
  if (due === 'today') return { dueDate: { $ne: null, $lt: addDays(start, 1) } };
  if (due === 'week') return { dueDate: { $ne: null, $lt: addDays(start, 7) } };
  if (due === 'none') return { dueDate: null };
  return null;
};

/** Les détails internes restent dans les logs ; le client reçoit un message sûr. */
const fail = (res, error) => {
  if (error instanceof mongoose.Error.ValidationError) {
    const message = Object.values(error.errors)
      .map((e) => e.message)
      .join(' · ');
    return res.status(400).json({ error: message });
  }
  if (error instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: 'Identifiant ou valeur invalide' });
  }
  if (error && error.code === 11000) {
    return res.status(400).json({ error: 'Cette entrée existe déjà' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Erreur interne du serveur' });
};

/**
 * Tri déterministe : sans `sort()` explicite MongoDB ne garantit aucun ordre,
 * et paginer peut alors répéter ou sauter des documents. Le champ calculé
 * `noDue` renvoie les tâches sans échéance en fin de liste.
 */
const SORTS = {
  creation: { createdAt: -1, _id: -1 },
  dueDate: { noDue: 1, dueDate: 1, _id: 1 },
  priority: { priorityRank: 1, createdAt: -1, _id: -1 },
};

const SORT_FIELDS = {
  $addFields: {
    noDue: { $cond: [{ $eq: [{ $ifNull: ['$dueDate', null] }, null] }, 1, 0] },
    priorityRank: {
      $switch: {
        branches: [
          { case: { $eq: ['$priority', 'high'] }, then: 0 },
          { case: { $eq: ['$priority', 'medium'] }, then: 1 },
          { case: { $eq: ['$priority', 'low'] }, then: 2 },
        ],
        default: 3,
      },
    },
  },
};

/** Filtre de liste — statut, échéance, catégorie et recherche portent sur TOUTES les tâches. */
const buildFilter = (query) => {
  const filter = { deletedAt: null };

  const status = asString(query.status, 16);
  if (status === 'active') filter.completed = false;
  if (status === 'done') filter.completed = true;

  const category = asString(query.category, 32);
  if (category && category !== 'all') {
    filter.category = category === 'none' ? '' : category;
  }

  // asString neutralise ?due[$ne]=null : un objet devient chaîne vide, donc aucun filtre
  const due = dueClause(asString(query.due, 16));
  if (due) Object.assign(filter, due);

  const term = asString(query.q, MAX_SEARCH);
  if (term) {
    // le terme vient du client : il est échappé avant de devenir une regex
    const needle = new RegExp(escapeRegex(term), 'i');
    filter.$or = [{ title: needle }, { description: needle }];
  }

  return filter;
};

/** Vidange de la corbeille, au démarrage seulement (processus de bureau). */
async function purgeDeletedTasks() {
  try {
    const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const { deletedCount } = await Task.deleteMany({ deletedAt: { $ne: null, $lt: cutoff } });
    if (deletedCount) console.log(`Corbeille vidée : ${deletedCount} tâche(s)`);
  } catch (error) {
    console.error('Purge de la corbeille impossible:', error.message);
  }
}

/* --------------------------------------------------------------------------
   Tâches
   -------------------------------------------------------------------------- */

app.post('/tasks', async (req, res) => {
  try {
    const task = new Task(pick(req.body, CREATE_FIELDS));
    await task.save();
    res.status(201).json(task);
  } catch (error) {
    fail(res, error);
  }
});

// déclaré avant /tasks/:id, sinon « stats » serait pris pour un identifiant
app.get('/tasks/stats', async (req, res) => {
  try {
    const base = { deletedAt: null };
    const [total, done, overdue, byCategory] = await Promise.all([
      Task.countDocuments(base),
      Task.countDocuments({ ...base, completed: true }),
      // une tâche terminée n'est plus un rappel, même si son échéance est passée.
      // dueClause est réutilisé tel quel : le badge et l'onglet « en retard »
      // ne peuvent pas diverger sur ce que « en retard » veut dire.
      Task.countDocuments({ ...base, completed: false, ...dueClause('overdue') }),
      Task.aggregate([{ $match: base }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
    ]);

    res.status(200).json({
      total,
      done,
      active: total - done,
      overdue,
      byCategory: byCategory.map(({ _id, count }) => ({ category: _id || '', count })),
    });
  } catch (error) {
    fail(res, error);
  }
});

// déclaré avant /tasks/:id, sinon « trash » serait pris pour un identifiant
app.get('/tasks/trash', async (req, res) => {
  try {
    const filter = { deletedAt: { $ne: null } };
    const total = await Task.countDocuments(filter);
    const { limit, totalPages, currentPage, skip } = paginate(req.query, total);

    const tasks = await Task.find(filter)
      .sort({ deletedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({ tasks, total, totalPages, currentPage });
  } catch (error) {
    fail(res, error);
  }
});

app.get('/tasks', async (req, res) => {
  try {
    // recherche sur les clés propres : `?sort=toString` remonterait sinon un
    // membre du prototype et casserait l'étage $sort
    const requestedSort = asString(req.query.sort, 16);
    const sort = Object.hasOwn(SORTS, requestedSort) ? requestedSort : 'creation';

    const filter = buildFilter(req.query);
    const total = await Task.countDocuments(filter);
    const { limit, totalPages, currentPage, skip } = paginate(req.query, total);

    const tasks = await Task.aggregate([
      { $match: filter },
      SORT_FIELDS,
      { $sort: SORTS[sort] },
      { $skip: skip },
      { $limit: limit },
      { $project: { noDue: 0, priorityRank: 0 } },
    ]);

    res.status(200).json({ tasks, total, totalPages, currentPage });
  } catch (error) {
    fail(res, error);
  }
});

app.get('/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, deletedAt: null });
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });
    res.status(200).json(task);
  } catch (error) {
    fail(res, error);
  }
});

app.put('/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      pick(req.body, UPDATE_FIELDS),
      { new: true, runValidators: true }
    );
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });
    res.status(200).json(task);
  } catch (error) {
    fail(res, error);
  }
});

app.delete('/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });
    res.status(200).json({ message: 'Tâche supprimée', task });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/tasks/:id/restore', async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, deletedAt: { $ne: null } },
      { deletedAt: null },
      { new: true }
    );
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée dans la corbeille' });
    res.status(200).json(task);
  } catch (error) {
    fail(res, error);
  }
});

/**
 * Suppression définitive. Réservée à ce qui est déjà dans la corbeille : rien
 * d'irréversible ne doit être atteignable en un seul geste.
 */
app.delete('/tasks/:id/purge', async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, deletedAt: { $ne: null } });
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée dans la corbeille' });
    res.status(200).json({ message: 'Tâche supprimée définitivement', task });
  } catch (error) {
    fail(res, error);
  }
});

/* --------------------------------------------------------------------------
   Export / import
   -------------------------------------------------------------------------- */

/** Horodatage de nom de fichier : 2026-09-16T08-42-11, trié correctement à plat. */
const fileStamp = (date = new Date()) => date.toISOString().replace(/:/g, '-').slice(0, 19);

/**
 * Sauvegarde complète : tâches (corbeille comprise) et catégories, avec leurs
 * identifiants et leurs dates. C'est la seule forme qui se réimporte à
 * l'identique.
 */
const collectExport = async () => {
  const [tasks, categories] = await Promise.all([
    Task.find().sort({ createdAt: 1, _id: 1 }).lean(),
    Category.find().sort({ name: 1 }).lean(),
  ]);
  return exportShape({ tasks, categories });
};

app.get('/export', async (req, res) => {
  try {
    const payload = await collectExport();
    res.setHeader('Content-Disposition', `attachment; filename="cahier-${fileStamp()}.json"`);
    res.status(200).json(payload);
  } catch (error) {
    fail(res, error);
  }
});

/**
 * Dépose un instantané sur disque et renvoie son chemin.
 * Le dossier est relu à chaque appel, et non figé au chargement du module :
 * sinon la valeur dépendrait de l'ordre des `require` dans les tests, qui
 * doivent pouvoir écrire ailleurs que dans le dépôt.
 */
const writeBackup = (prefix, payload) => {
  const dir = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${prefix}-${fileStamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
};

/**
 * Remise en base d'une sauvegarde.
 *
 * `merge` ajoute sans toucher à l'existant ; `replace` reconstruit la base.
 * Mongo tourne ici sans jeu de réplicas, donc sans transaction : l'atomicité
 * est obtenue autrement — tout est validé avant la moindre écriture, et un
 * `replace` dépose l'état courant dans BACKUP_DIR juste avant d'effacer.
 */
app.post('/import', async (req, res) => {
  try {
    // le mode se donne en query ou dans le corps : un fichier d'export ne
    // contient pas de « mode », et il ne faut pas obliger à le rouvrir pour
    // l'y glisser avant de le remettre
    const mode = asString(req.query?.mode, 16) || asString(req.body?.mode, 16) || 'merge';
    if (mode !== 'merge' && mode !== 'replace') {
      return res.status(400).json({ error: 'Mode inconnu : « merge » ou « replace » attendu.' });
    }
    // un effacement complet ne doit pas tenir dans une requête qu'on lance par mégarde
    if (mode === 'replace' && req.get('X-Confirm') !== 'replace') {
      return res
        .status(428)
        .json({ error: 'Remplacement refusé : en-tête X-Confirm: replace requis.' });
    }

    const { tasks, categories, errors } = validateImport(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.slice(0, 5).join(' · ') });
    }

    // seconde barrière : le schéma Mongoose relit chaque document, toujours
    // sans écrire — un import est tout ou rien
    const taskDocs = tasks.map((raw) => new Task(raw));
    const categoryDocs = categories.map((raw) => new Category(raw));
    for (const [index, doc] of taskDocs.entries()) {
      const invalid = doc.validateSync();
      if (invalid) return res.status(400).json({ error: `Tâche ${index + 1} : ${invalid.message}` });
    }
    for (const [index, doc] of categoryDocs.entries()) {
      const invalid = doc.validateSync();
      if (invalid) {
        return res.status(400).json({ error: `Catégorie ${index + 1} : ${invalid.message}` });
      }
    }

    let backup = null;
    if (mode === 'replace') {
      backup = writeBackup('avant-remplacement', await collectExport());
      await Promise.all([Task.deleteMany({}), Category.deleteMany({})]);
      await Task.insertMany(taskDocs);
      await Category.insertMany(categoryDocs);
    } else {
      // merge : on n'écrase jamais, on complète. Un identifiant ou un nom déjà
      // pris est laissé tel qu'il est en base.
      // un doublon n'est pas une erreur ici : c'est une entrée déjà en base,
      // qu'on laisse telle quelle. Une écriture en lot signale ses doublons
      // dans `writeErrors` plutôt que dans un `code` de premier niveau.
      const ignorerDoublons = (e) => {
        const doublon = e.code === 11000 || (e.writeErrors || []).every((w) => w.err?.code === 11000);
        if (!doublon) throw e;
      };
      await Task.insertMany(taskDocs, { ordered: false }).catch(ignorerDoublons);
      await Category.insertMany(categoryDocs, { ordered: false }).catch(ignorerDoublons);
    }

    res.status(200).json({
      message: mode === 'replace' ? 'Base remplacée' : 'Sauvegarde fusionnée',
      tasks: taskDocs.length,
      categories: categoryDocs.length,
      backup,
    });
  } catch (error) {
    fail(res, error);
  }
});

/* --------------------------------------------------------------------------
   Catégories
   -------------------------------------------------------------------------- */

app.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find().sort({ name: 1 });
    res.status(200).json(categories);
  } catch (error) {
    fail(res, error);
  }
});

app.post('/categories', async (req, res) => {
  try {
    const category = new Category(pick(req.body, ['name', 'color']));
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    fail(res, error);
  }
});

app.delete('/categories/:name', async (req, res) => {
  try {
    const category = await Category.findOneAndDelete({ name: req.params.name });
    if (!category) return res.status(404).json({ error: 'Catégorie non trouvée' });

    await Task.updateMany({ category: req.params.name }, { $set: { category: '' } });

    res.status(200).json({ message: 'Catégorie supprimée' });
  } catch (error) {
    fail(res, error);
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, host, () => {
    console.log(`Serveur démarré sur http://${host}:${port}`);
  });
}

module.exports = app;
