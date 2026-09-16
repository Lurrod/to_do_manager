const { SCHEMA_VERSION, exportShape, validateImport } = require('../../lib/portable');

const task = (extra = {}) => ({
  _id: '6aaa396cb6aaf45240b8b423',
  title: 'Relire le brief',
  description: '',
  completed: false,
  createdAt: '2026-09-10T08:00:00.000Z',
  dueDate: null,
  category: '',
  priority: '',
  deletedAt: null,
  ...extra,
});

describe('exportShape', () => {
  test('enveloppe les données avec une version de schéma', () => {
    const shape = exportShape({ tasks: [task()], categories: [], now: new Date('2026-09-16T06:00:00Z') });

    expect(shape.app).toBe('cahier');
    expect(shape.schemaVersion).toBe(SCHEMA_VERSION);
    expect(shape.exportedAt).toBe('2026-09-16T06:00:00.000Z');
    expect(shape.tasks).toHaveLength(1);
    expect(shape.categories).toEqual([]);
  });
});

describe('validateImport', () => {
  test('accepte une charge utile bien formée', () => {
    const result = validateImport({ tasks: [task()], categories: [{ name: 'Perso', color: '#2f7d51' }] });

    expect(result.errors).toEqual([]);
    expect(result.tasks).toHaveLength(1);
    expect(result.categories).toHaveLength(1);
  });

  test('refuse une charge utile qui n’est pas un objet', () => {
    expect(validateImport(null).errors[0]).toMatch(/objet/i);
    expect(validateImport('non').errors[0]).toMatch(/objet/i);
  });

  test('refuse des tâches qui ne sont pas un tableau', () => {
    expect(validateImport({ tasks: 'non' }).errors[0]).toMatch(/tableau/i);
  });

  test('signale la ligne fautive, pas seulement l’échec', () => {
    const { errors } = validateImport({ tasks: [task(), task({ title: '' })] });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/tâche 2/i);
  });

  test('ne retient que les champs de la liste blanche', () => {
    const { tasks } = validateImport({ tasks: [task({ injecte: 'oui' })] });

    expect(tasks[0]).not.toHaveProperty('injecte');
    // l'identifiant et les dates, eux, sont bien repris : sans eux l'aller-retour ment
    expect(tasks[0]._id).toBe('6aaa396cb6aaf45240b8b423');
    expect(tasks[0].createdAt).toBe('2026-09-10T08:00:00.000Z');
  });

  test('refuse plus de 10 000 tâches', () => {
    const { errors } = validateImport({ tasks: new Array(10001).fill(task()) });

    expect(errors[0]).toMatch(/10 000/);
  });

  test('refuse une catégorie sans couleur hexadécimale', () => {
    const { errors } = validateImport({ categories: [{ name: 'Perso', color: 'rouge' }] });

    expect(errors[0]).toMatch(/catégorie 1/i);
  });
});
