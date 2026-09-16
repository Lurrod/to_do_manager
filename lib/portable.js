/* ---------------------------------------------------------------------------
   Cahier — forme portable des données : ce qui sort dans un export, et ce
   qu'un import a le droit de faire entrer. Aucun accès à la base ici : ce
   module ne manipule que des objets simples, pour être testable seul.
   --------------------------------------------------------------------------- */

const SCHEMA_VERSION = 1;

/** Au-delà, ce n'est plus une sauvegarde de cahier personnel mais un déni de service. */
const MAX_TASKS = 10000;
const MAX_CATEGORIES = 500;

/**
 * Liste blanche d'import : sur-ensemble assumé de CREATE_FIELDS.
 * `_id`, `createdAt` et `deletedAt` en font partie — sans eux, réimporter un
 * export ne reproduit pas la base, et le critère d'acceptation du chantier
 * tombe. Ces champs restent inatteignables par POST /tasks.
 */
const IMPORT_TASK_FIELDS = [
  '_id',
  'title',
  'description',
  'completed',
  'createdAt',
  'dueDate',
  'category',
  'priority',
  'deletedAt',
  // vague 2 — sans eux, réimporter une sauvegarde aplatirait la hiérarchie et
  // perdrait l'ordre manuel, les étiquettes et les récurrences
  'parentId',
  'tags',
  'order',
  'recurrence',
  // vague 4
  'reminder',
];

const IMPORT_CATEGORY_FIELDS = ['_id', 'name', 'color'];

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Reprend les seuls champs listés, en ignorant tout le reste. */
const pickFields = (source, fields) =>
  fields.reduce(
    (acc, field) => (source?.[field] === undefined ? acc : { ...acc, [field]: source[field] }),
    {}
  );

/** Valeurs présentes plus d'une fois dans `values`, chacune une seule fois dans le résultat. */
const duplicatedValues = (values) => {
  const seen = new Set();
  const duplicated = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return [...duplicated];
};

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

/**
 * Un identifiant hexadécimal de 24 caractères désigne le même document Mongo
 * quelle que soit sa casse : `6AAA…` et `6aaa…` collisionnent à l'insertion.
 * On les compare donc en minuscules. Ce qui n'a pas cette forme est comparé
 * tel quel — Mongoose le rejettera de toute façon plus loin par un CastError.
 */
const normalizeId = (value) =>
  typeof value === 'string' && OBJECT_ID.test(value) ? value.toLowerCase() : value;

/** Enveloppe d'export : les données, plus de quoi les relire dans dix ans. */
const exportShape = ({ tasks, categories, now = new Date() }) => ({
  app: 'cahier',
  schemaVersion: SCHEMA_VERSION,
  exportedAt: new Date(now).toISOString(),
  tasks,
  categories,
});

/**
 * Valide une charge utile d'import sans rien écrire.
 * @returns {{tasks: object[], categories: object[], errors: string[]}}
 *   `errors` vide signifie « prêt à écrire ». Sinon, rien ne doit être écrit :
 *   un import est tout ou rien.
 */
const validateImport = (payload) => {
  const errors = [];
  const empty = { tasks: [], categories: [], errors };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('Charge utile invalide : un objet est attendu.');
    return empty;
  }

  const rawTasks = payload.tasks === undefined ? [] : payload.tasks;
  const rawCategories = payload.categories === undefined ? [] : payload.categories;

  if (!Array.isArray(rawTasks)) {
    errors.push('Champ « tasks » invalide : un tableau est attendu.');
    return empty;
  }
  if (!Array.isArray(rawCategories)) {
    errors.push('Champ « categories » invalide : un tableau est attendu.');
    return empty;
  }
  if (rawTasks.length > MAX_TASKS) {
    errors.push(`Trop de tâches : ${rawTasks.length} pour un maximum de 10 000.`);
    return empty;
  }
  if (rawCategories.length > MAX_CATEGORIES) {
    errors.push(`Trop de catégories : ${rawCategories.length} pour un maximum de 500.`);
    return empty;
  }

  // une ligne déjà fautive pour son propre compte (titre manquant, couleur
  // invalide…) n'entre pas dans la recherche de doublons ci-dessous : elle a
  // déjà son message, inutile de la signaler deux fois pour deux raisons
  // différentes
  const validTaskRow = [];
  const tasks = rawTasks.map((raw, index) => {
    const kept = pickFields(raw, IMPORT_TASK_FIELDS);
    // le titre est le seul champ sans lequel une tâche n'existe pas ; le reste
    // est laissé au schéma Mongoose, qui sait déjà le valider
    const titreManquant = typeof kept.title !== 'string' || kept.title.trim() === '';
    if (titreManquant) {
      errors.push(`Tâche ${index + 1} : titre manquant.`);
    }
    validTaskRow.push(!titreManquant);
    return kept;
  });

  const validCategoryRow = [];
  const categories = rawCategories.map((raw, index) => {
    const kept = pickFields(raw, IMPORT_CATEGORY_FIELDS);
    const nomManquant = typeof kept.name !== 'string' || kept.name.trim() === '';
    if (nomManquant) {
      errors.push(`Catégorie ${index + 1} : nom manquant.`);
    }
    const couleurInvalide = typeof kept.color !== 'string' || !HEX_COLOR.test(kept.color);
    if (couleurInvalide) {
      errors.push(`Catégorie ${index + 1} : couleur invalide (format #rgb ou #rrggbb attendu).`);
    }
    validCategoryRow.push(!nomManquant && !couleurInvalide);
    return kept;
  });

  // le typage et les bornes sont validés ligne par ligne ci-dessus, mais un
  // `_id` ou un nom en double ne se voit qu'en regardant le lot dans son
  // ensemble — et validateSync() de Mongoose, lui aussi ligne par ligne, ne
  // le verra pas non plus. Sans cette barrière, un `replace` efface la base
  // avant que l'insertion échoue sur le doublon, la laissant à moitié remplie.
  const taskIds = tasks
    .filter((t, index) => t._id !== undefined && validTaskRow[index])
    .map((t) => normalizeId(t._id));
  for (const id of duplicatedValues(taskIds)) {
    errors.push(`Identifiant en double dans les tâches : ${id}.`);
  }

  const categoryIds = categories
    .filter((c, index) => c._id !== undefined && validCategoryRow[index])
    .map((c) => normalizeId(c._id));
  for (const id of duplicatedValues(categoryIds)) {
    errors.push(`Identifiant en double dans les catégories : ${id}.`);
  }

  const categoryNames = categories
    .filter((c, index) => validCategoryRow[index])
    .map((c) => c.name);
  for (const name of duplicatedValues(categoryNames)) {
    errors.push(`Catégorie en double : le nom « ${name} » est déjà utilisé dans ce fichier.`);
  }

  return { tasks, categories, errors };
};

module.exports = {
  SCHEMA_VERSION,
  MAX_TASKS,
  MAX_CATEGORIES,
  IMPORT_TASK_FIELDS,
  IMPORT_CATEGORY_FIELDS,
  HEX_COLOR,
  exportShape,
  validateImport,
};
