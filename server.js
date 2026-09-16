const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

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
    const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(req.query.limit, DEFAULT_LIMIT)));
    const requestedPage = Math.max(1, toInt(req.query.page, 1));
    const filter = { deletedAt: { $ne: null } };

    const total = await Task.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(requestedPage, totalPages);

    const tasks = await Task.find(filter)
      .sort({ deletedAt: -1, _id: -1 })
      .skip((currentPage - 1) * limit)
      .limit(limit);

    res.status(200).json({ tasks, total, totalPages, currentPage });
  } catch (error) {
    fail(res, error);
  }
});

app.get('/tasks', async (req, res) => {
  try {
    const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(req.query.limit, DEFAULT_LIMIT)));
    const requestedPage = Math.max(1, toInt(req.query.page, 1));
    // recherche sur les clés propres : `?sort=toString` remonterait sinon un
    // membre du prototype et casserait l'étage $sort
    const requestedSort = asString(req.query.sort, 16);
    const sort = Object.hasOwn(SORTS, requestedSort) ? requestedSort : 'creation';

    const filter = buildFilter(req.query);
    // comptage puis page : deux requêtes, donc un total théoriquement décalé si
    // une écriture s'intercale. Acceptable ici (un seul utilisateur local) et
    // toujours plus juste que compter côté client sur la page affichée.
    const total = await Task.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    // supprimer le dernier élément d'une page ne doit pas laisser une page vide
    const currentPage = Math.min(requestedPage, totalPages);

    const tasks = await Task.aggregate([
      { $match: filter },
      SORT_FIELDS,
      { $sort: SORTS[sort] },
      { $skip: (currentPage - 1) * limit },
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
