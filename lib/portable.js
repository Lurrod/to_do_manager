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
];

const IMPORT_CATEGORY_FIELDS = ['_id', 'name', 'color'];

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Reprend les seuls champs listés, en ignorant tout le reste. */
const pickFields = (source, fields) =>
  fields.reduce(
    (acc, field) => (source?.[field] === undefined ? acc : { ...acc, [field]: source[field] }),
    {}
  );

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

  const tasks = rawTasks.map((raw, index) => {
    const kept = pickFields(raw, IMPORT_TASK_FIELDS);
    // le titre est le seul champ sans lequel une tâche n'existe pas ; le reste
    // est laissé au schéma Mongoose, qui sait déjà le valider
    if (typeof kept.title !== 'string' || kept.title.trim() === '') {
      errors.push(`Tâche ${index + 1} : titre manquant.`);
    }
    return kept;
  });

  const categories = rawCategories.map((raw, index) => {
    const kept = pickFields(raw, IMPORT_CATEGORY_FIELDS);
    if (typeof kept.name !== 'string' || kept.name.trim() === '') {
      errors.push(`Catégorie ${index + 1} : nom manquant.`);
    }
    if (typeof kept.color !== 'string' || !HEX_COLOR.test(kept.color)) {
      errors.push(`Catégorie ${index + 1} : couleur invalide (format #rgb ou #rrggbb attendu).`);
    }
    return kept;
  });

  return { tasks, categories, errors };
};

module.exports = {
  SCHEMA_VERSION,
  MAX_TASKS,
  MAX_CATEGORIES,
  IMPORT_TASK_FIELDS,
  IMPORT_CATEGORY_FIELDS,
  exportShape,
  validateImport,
};
