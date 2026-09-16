/* ---------------------------------------------------------------------------
   Cahier — rendus lisibles : le cahier en Markdown, la base en CSV.
   Fonctions pures, sans base ni serveur.
   --------------------------------------------------------------------------- */

const SANS_CATEGORIE = 'Sans catégorie';

/** Jour seul : l'heure n'apporte rien à une liste qu'on relit. */
const jour = (value) => new Date(value).toISOString().slice(0, 10);

/**
 * Le cahier en Markdown, groupé par catégorie.
 * La corbeille reste dehors : c'est une lecture, pas une sauvegarde.
 */
const toMarkdown = (tasks) => {
  const vivantes = tasks.filter((t) => !t.deletedAt);
  const groupes = new Map();

  vivantes.forEach((task) => {
    const clef = task.category || SANS_CATEGORIE;
    if (!groupes.has(clef)) groupes.set(clef, []);
    groupes.get(clef).push(task);
  });

  const blocs = [...groupes.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([categorie, liste]) => {
      const lignes = liste.map((task) => {
        const case_ = task.completed ? '- [x]' : '- [ ]';
        const echeance = task.dueDate ? ` — échéance ${jour(task.dueDate)}` : '';
        return `${case_} ${task.title}${echeance}`;
      });
      return `## ${categorie}\n\n${lignes.join('\n')}`;
    });

  return `# Cahier\n\n${blocs.join('\n\n')}\n`;
};

const CSV_COLUMNS = [
  'id',
  'title',
  'description',
  'completed',
  'priority',
  'category',
  'dueDate',
  'createdAt',
  'deletedAt',
];

/**
 * Échappement RFC 4180, plus une neutralisation : une cellule qui commence par
 * `=`, `+`, `-` ou `@` est exécutée comme une formule par les tableurs. On la
 * préfixe d'une apostrophe. Cela déforme la valeur — acceptable pour un format
 * qu'on ne réimporte jamais, le JSON étant le format d'aller-retour.
 */
const csvCell = (value) => {
  const texte = value === null || value === undefined ? '' : String(value);
  const sûr = /^[=+\-@]/.test(texte) ? `'${texte}` : texte;
  return /[",\n]/.test(sûr) ? `"${sûr.replace(/"/g, '""')}"` : sûr;
};

const toCsv = (tasks) => {
  const lignes = tasks.map((task) =>
    [
      task._id,
      task.title,
      task.description,
      task.completed,
      task.priority,
      task.category,
      task.dueDate ? new Date(task.dueDate).toISOString() : '',
      task.createdAt ? new Date(task.createdAt).toISOString() : '',
      task.deletedAt ? new Date(task.deletedAt).toISOString() : '',
    ]
      .map(csvCell)
      .join(',')
  );

  return [CSV_COLUMNS.join(','), ...lignes].join('\n');
};

module.exports = { SANS_CATEGORIE, CSV_COLUMNS, toMarkdown, toCsv, csvCell };
