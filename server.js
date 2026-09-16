const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { exportShape, validateImport, HEX_COLOR } = require('./lib/portable');
const { toMarkdown, toCsv } = require('./lib/formats');

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
/**
 * Un corps trop gros ou un JSON malformé fait échouer bodyParser.json avant
 * même d'atteindre une route : sans ce middleware, Express répond avec sa
 * page HTML par défaut, qui contient la trace complète (chemins locaux
 * compris). Monté juste après les deux bodyParser, pour intercepter leurs
 * erreurs avant qu'elles ne tombent sur le gestionnaire par défaut.
 */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Corps de requête trop volumineux.' });
  }
  if (err instanceof SyntaxError && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide dans le corps de la requête.' });
  }
  return next(err);
});
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
      await migrateSchema();
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

  // --- vague 2 : structure ---
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
  tags: {
    type: [String],
    default: [],
    validate: [(v) => v.length <= 10, 'Maximum 10 étiquettes'],
  },
  order: { type: Number, default: 0, index: true },
  recurrence: {
    freq: { type: String, enum: ['', 'daily', 'weekly', 'monthly'], default: '' },
    interval: { type: Number, default: 1, min: 1, max: 99 },
    until: { type: Date, default: null },
  },

  // --- vague 4 : rappels ---
  reminder: {
    offset: { type: String, enum: ['', 'atDue', '1h', '1d'], default: '' },
    at: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
  },
});

taskSchema.index({ deletedAt: 1, createdAt: -1 });
taskSchema.index({ deletedAt: 1, dueDate: 1 });
taskSchema.index({ deletedAt: 1, category: 1 });
// la liste ne montre que les racines : ce filtre-là porte chaque page
taskSchema.index({ deletedAt: 1, parentId: 1, createdAt: -1 });

// la couleur est injectée telle quelle dans une déclaration CSS côté client :
// on n'accepte qu'une notation hexadécimale — même règle que côté import,
// définie une seule fois dans lib/portable.js pour ne pas diverger
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
const CREATE_FIELDS = [
  'title',
  'description',
  'dueDate',
  'category',
  'priority',
  'parentId',
  'recurrence',
];
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

/**
 * Compte les étapes de chaque racine en une seule requête. Les compter côté
 * client demanderait un appel par ligne affichée ; les compter ici coûte un
 * `$lookup` sur un champ indexé.
 */
const CHILD_COUNTS = [
  {
    $lookup: {
      from: 'tasks',
      let: { racine: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$parentId', '$$racine'] }, deletedAt: null } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            faites: { $sum: { $cond: ['$completed', 1, 0] } },
          },
        },
      ],
      as: 'etapes',
    },
  },
  {
    $addFields: {
      // `$ifNull` parce qu'une racine sans étape ne produit aucun groupe :
      // le tableau est alors vide, pas rempli de zéros
      childCount: { $ifNull: [{ $first: '$etapes.total' }, 0] },
      childDone: { $ifNull: [{ $first: '$etapes.faites' }, 0] },
    },
  },
];

/**
 * Vérifie qu'un rattachement est légal : le parent doit exister, ne pas être
 * lui-même une étape, et la tâche rattachée ne doit pas déjà en porter.
 * @returns {string|null} le message d'erreur, ou null si le rattachement est bon
 */
const parentageInvalide = async (parentId, enfantId = null) => {
  if (parentId === null || parentId === undefined || parentId === '') return null;

  if (enfantId && String(parentId) === String(enfantId)) {
    return 'Une tâche ne peut pas être sa propre étape : elle-même n’est pas un parent.';
  }

  const parent = await Task.findOne({ _id: parentId, deletedAt: null }).select('parentId').lean();
  if (!parent) return 'Parent introuvable.';
  if (parent.parentId) return 'Les étapes ne s’imbriquent que sur un seul niveau.';

  if (enfantId) {
    const aDesEtapes = await Task.exists({ parentId: enfantId, deletedAt: null });
    if (aDesEtapes) return 'Les étapes ne s’imbriquent que sur un seul niveau.';
  }

  return null;
};

/**
 * Une récurrence a besoin d'une échéance : c'est elle qu'on fait avancer.
 * Le contrôle porte sur l'état APRÈS modification — retirer l'échéance d'une
 * tâche déjà récurrente la laisserait sans ancrage, et la série s'arrêterait
 * sans que rien ne le dise.
 * @returns {string|null} le message d'erreur, ou null
 */
const recurrenceInvalide = (apres) => {
  const freq = apres?.recurrence?.freq;
  if (!freq) return null;
  if (!apres.dueDate) {
    return 'Une récurrence a besoin d’une échéance : c’est elle qui avance.';
  }
  return null;
};

/** Filtre de liste — statut, échéance, catégorie et recherche portent sur TOUTES les tâches. */
const buildFilter = (query) => {
  // seules les racines sont listées : compter les étapes rendrait la
  // pagination incohérente, une page de 5 pouvant n'afficher qu'un dossier
  const filter = { deletedAt: null, parentId: null };

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

/**
 * Migration au démarrage. Chaque clause ne vise que les documents à qui le
 * champ manque (`$exists: false`) : relancer le serveur ne réécrit donc rien,
 * et une base déjà à jour coûte quatre requêtes qui ne touchent aucune ligne.
 *
 * `reminder` appartient à la vague 4 mais part ici : ajouter deux champs
 * connus en deux migrations successives double le risque pour rien.
 */
async function migrateSchema() {
  const defauts = [
    [{ parentId: { $exists: false } }, { parentId: null }],
    [{ tags: { $exists: false } }, { tags: [] }],
    [
      { 'recurrence.freq': { $exists: false } },
      { recurrence: { freq: '', interval: 1, until: null } },
    ],
    [
      { 'reminder.offset': { $exists: false } },
      { reminder: { offset: '', at: null, sentAt: null } },
    ],
  ];

  for (const [cible, valeurs] of defauts) {
    await Task.updateMany(cible, { $set: valeurs });
  }

  // `order` ne peut pas être une constante : deux tâches partageant le même
  // rang rendraient le tri manuel instable. On part de la date d'écriture,
  // qui est déjà l'ordre que l'utilisateur a sous les yeux.
  const sansOrdre = await Task.find({ order: { $exists: false } })
    .select('_id createdAt')
    .lean();

  if (sansOrdre.length > 0) {
    await Task.bulkWrite(
      sansOrdre.map((t) => ({
        updateOne: {
          filter: { _id: t._id },
          update: { $set: { order: new Date(t.createdAt).getTime() } },
        },
      }))
    );
    console.log(`Migration : ${sansOrdre.length} tâche(s) mise(s) à jour`);
  }
}

/* --------------------------------------------------------------------------
   Tâches
   -------------------------------------------------------------------------- */

app.post('/tasks', async (req, res) => {
  try {
    const champs = pick(req.body, CREATE_FIELDS);
    const refus = await parentageInvalide(champs.parentId);
    if (refus) return res.status(400).json({ error: refus });

    const refusRecurrence = recurrenceInvalide(champs);
    if (refusRecurrence) return res.status(400).json({ error: refusRecurrence });

    const task = new Task(champs);
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
      // le comptage vient après la pagination : compter les étapes de toute la
      // base pour n'en afficher cinq serait du travail jeté
      ...CHILD_COUNTS,
      { $project: { noDue: 0, priorityRank: 0, etapes: 0 } },
    ]);

    res.status(200).json({ tasks, total, totalPages, currentPage });
  } catch (error) {
    fail(res, error);
  }
});

// déclaré avant /tasks/:id, sinon « children » serait pris pour un identifiant
app.get('/tasks/:id/children', async (req, res) => {
  try {
    const tasks = await Task.find({ parentId: req.params.id, deletedAt: null })
      .sort({ order: 1, createdAt: 1, _id: 1 })
      .lean();
    res.status(200).json({ tasks, total: tasks.length });
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
    const champs = pick(req.body, UPDATE_FIELDS);
    if (Object.hasOwn(champs, 'parentId')) {
      const refus = await parentageInvalide(champs.parentId, req.params.id);
      if (refus) return res.status(400).json({ error: refus });
    }

    // le contrôle porte sur l'état résultant, pas sur la seule modification
    const avant = await Task.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!avant) return res.status(404).json({ error: 'Tâche non trouvée' });

    const refusRecurrence = recurrenceInvalide({ ...avant, ...champs });
    if (refusRecurrence) return res.status(400).json({ error: refusRecurrence });

    const task = await Task.findOneAndUpdate({ _id: req.params.id, deletedAt: null }, champs, {
      new: true,
      runValidators: true,
    });
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });

    // cocher un dossier coche ce qu'il contient ; l'inverse n'est pas vrai —
    // un parent peut porter du travail propre au-delà de ses étapes, et le
    // cocher à la place de l'utilisateur serait décider pour lui
    if (Object.hasOwn(champs, 'completed') && !task.parentId) {
      await Task.updateMany(
        { parentId: task._id, deletedAt: null },
        { $set: { completed: champs.completed } }
      );
    }

    res.status(200).json(task);
  } catch (error) {
    fail(res, error);
  }
});

app.delete('/tasks/:id', async (req, res) => {
  try {
    // un seul horodatage pour toute la famille : c'est lui qui distingue
    // « emportée par son parent » de « jetée pour elle-même », et qui permet
    // de ne ressortir que la première au moment de restaurer
    const quand = new Date();
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { deletedAt: quand },
      { new: true }
    );
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });

    if (!task.parentId) {
      await Task.updateMany(
        { parentId: task._id, deletedAt: null },
        { $set: { deletedAt: quand } }
      );
    }

    res.status(200).json({ message: 'Tâche supprimée', task });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/tasks/:id/restore', async (req, res) => {
  try {
    // l'horodatage de la jetée est relu AVANT de l'effacer : c'est lui qui
    // désigne les étapes parties en même temps
    const jetee = await Task.findOne({ _id: req.params.id, deletedAt: { $ne: null } })
      .select('parentId deletedAt')
      .lean();
    if (!jetee) return res.status(404).json({ error: 'Tâche non trouvée dans la corbeille' });

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id },
      { deletedAt: null },
      { new: true }
    );

    if (!jetee.parentId) {
      // seules les étapes parties AVEC ce parent reviennent : l'égalité de
      // l'horodatage est ce qui les distingue de celles jetées auparavant,
      // qu'on ressusciterait sinon à l'insu de l'utilisateur
      await Task.updateMany(
        { parentId: task._id, deletedAt: jetee.deletedAt },
        { $set: { deletedAt: null } }
      );
    }

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

    // une étape n'est atteignable qu'à travers son parent : la laisser en base
    // créerait un document que plus aucune vue ne montre
    await Task.deleteMany({ parentId: task._id });

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
      const instantane = await collectExport();
      backup = writeBackup('avant-remplacement', instantane);
      try {
        await Promise.all([Task.deleteMany({}), Category.deleteMany({})]);
        await Task.insertMany(taskDocs);
        await Category.insertMany(categoryDocs);
      } catch (ecriture) {
        // l'insertion a heurté un obstacle que la validation n'a pas vu (une
        // collision d'identifiant échappée aux deux barrières précédentes, par
        // exemple) : la base est à moitié écrite, on la remet dans l'état
        // qu'a saisi l'instantané, juste avant l'effacement
        try {
          await Promise.all([Task.deleteMany({}), Category.deleteMany({})]);
          await Task.insertMany(instantane.tasks.map((raw) => new Task(raw)));
          await Category.insertMany(instantane.categories.map((raw) => new Category(raw)));
        } catch (remiseEnPlace) {
          console.error(ecriture);
          console.error(remiseEnPlace);
          return res.status(500).json({
            error:
              `Échec de l'import ET de la remise en place automatique de la base. ` +
              `Restaurez manuellement depuis la sauvegarde : ${backup}`,
          });
        }
        console.error(ecriture);
        return res.status(500).json({
          error:
            `Échec de l'import en cours d'écriture : la base a été remise dans son état ` +
            `d'origine. Sauvegarde disponible en cas de doute : ${backup}`,
        });
      }
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

app.get('/export.md', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ category: 1, createdAt: 1 }).lean();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cahier-${fileStamp()}.md"`);
    res.status(200).send(toMarkdown(tasks));
  } catch (error) {
    fail(res, error);
  }
});

app.get('/export.csv', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ createdAt: 1, _id: 1 }).lean();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cahier-${fileStamp()}.csv"`);
    res.status(200).send(toCsv(tasks));
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
// exposée pour les tests : la migration doit pouvoir être rejouée à volonté
module.exports.migrateSchema = migrateSchema;
