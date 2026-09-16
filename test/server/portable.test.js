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
    const shape = exportShape({
      tasks: [task()],
      categories: [],
      now: new Date('2026-09-16T06:00:00Z'),
    });

    expect(shape.app).toBe('cahier');
    expect(shape.schemaVersion).toBe(SCHEMA_VERSION);
    expect(shape.exportedAt).toBe('2026-09-16T06:00:00.000Z');
    expect(shape.tasks).toHaveLength(1);
    expect(shape.categories).toEqual([]);
  });
});

describe('validateImport', () => {
  test('accepte une charge utile bien formée', () => {
    const result = validateImport({
      tasks: [task()],
      categories: [{ name: 'Perso', color: '#2f7d51' }],
    });

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

  test('refuse deux tâches qui portent le même identifiant', () => {
    const { errors } = validateImport({ tasks: [task(), task()] });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/identifiant/i);
    expect(errors[0]).toContain('6aaa396cb6aaf45240b8b423');
  });

  test('deux tâches sans identifiant ne sont pas des doublons', () => {
    const sansId = { title: 'Une tâche' };

    expect(validateImport({ tasks: [sansId, sansId] }).errors).toEqual([]);
  });

  test('refuse deux catégories du même nom', () => {
    const { errors } = validateImport({
      categories: [
        { name: 'Perso', color: '#2f7d51' },
        { name: 'Perso', color: '#1f2f5c' },
      ],
    });

    expect(errors.some((e) => /nom.*déjà|déjà.*nom/i.test(e))).toBe(true);
  });

  test('refuse deux catégories qui partagent le même identifiant', () => {
    const { errors } = validateImport({
      categories: [
        { _id: '6aaa396cb6aaf45240b8b423', name: 'Perso', color: '#2f7d51' },
        { _id: '6aaa396cb6aaf45240b8b423', name: 'Travail', color: '#1f2f5c' },
      ],
    });

    expect(errors.some((e) => /identifiant/i.test(e))).toBe(true);
  });

  test('refuse deux tâches dont l’identifiant ne diffère que par la casse', () => {
    const { errors } = validateImport({
      tasks: [task(), task({ _id: '6AAA396CB6AAF45240B8B423' })],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/identifiant/i);
  });

  test('deux tâches aux identifiants réellement différents ne sont pas des doublons', () => {
    const { errors } = validateImport({
      tasks: [task(), task({ _id: '6aaa396cb6aaf45240b8b424' })],
    });

    expect(errors).toEqual([]);
  });

  test('retient les champs de structure ajoutés par la vague 2', () => {
    const { tasks } = validateImport({
      tasks: [
        task({
          parentId: '6aaa396cb6aaf45240b8b999',
          tags: ['maison'],
          order: 1234,
          recurrence: { freq: 'weekly', interval: 2, until: null },
          reminder: { offset: '1d', at: '2026-09-20T08:00:00.000Z', sentAt: null },
        }),
      ],
    });

    expect(tasks[0].parentId).toBe('6aaa396cb6aaf45240b8b999');
    expect(tasks[0].tags).toEqual(['maison']);
    expect(tasks[0].order).toBe(1234);
    expect(tasks[0].recurrence.freq).toBe('weekly');
    expect(tasks[0].reminder.offset).toBe('1d');
  });
});
