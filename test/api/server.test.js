process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../server');

jest.setTimeout(60000);

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  for (const name of Object.keys(mongoose.connection.collections)) {
    await mongoose.connection.collections[name].deleteMany({});
  }
});

describe('Tasks API', () => {
  test('POST /tasks creates a task', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({
        title: 'Acheter du lait',
        description: 'Avant 18h',
        dueDate: '2026-12-31T23:59:59Z',
        category: 'Courses',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('_id');
    expect(res.body.title).toBe('Acheter du lait');
    expect(res.body.completed).toBe(false);
  });

  test('POST /tasks returns 400 when title is missing', async () => {
    const res = await request(app).post('/tasks').send({ description: 'no title' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /tasks returns paginated list', async () => {
    for (let i = 0; i < 7; i += 1) {
      await request(app).post('/tasks').send({ title: `Task ${i}` });
    }

    const res = await request(app).get('/tasks?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(5);
    expect(res.body.totalPages).toBe(2);
    expect(res.body.currentPage).toBe(1);
  });

  test('GET /tasks/:id returns a single task', async () => {
    const created = await request(app).post('/tasks').send({ title: 'Solo' });
    const res = await request(app).get(`/tasks/${created.body._id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Solo');
  });

  test('GET /tasks/:id returns 404 for missing id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`/tasks/${fakeId}`);
    expect(res.status).toBe(404);
  });

  test('PUT /tasks/:id updates a task', async () => {
    const created = await request(app).post('/tasks').send({ title: 'Old' });
    const res = await request(app)
      .put(`/tasks/${created.body._id}`)
      .send({ title: 'New', completed: true });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New');
    expect(res.body.completed).toBe(true);
  });

  test('DELETE /tasks/:id removes a task', async () => {
    const created = await request(app).post('/tasks').send({ title: 'To delete' });
    const del = await request(app).delete(`/tasks/${created.body._id}`);
    expect(del.status).toBe(200);
    expect(del.body.message).toBe('Tâche supprimée');

    const after = await request(app).get(`/tasks/${created.body._id}`);
    expect(after.status).toBe(404);
  });
});

describe('Tasks API — tri, filtres et recherche serveur', () => {
  const seed = async () => {
    const rows = [
      { title: 'Payer le loyer', category: 'Perso', dueDate: '2026-01-10T09:00:00Z', priority: 'high' },
      { title: 'Relire le devis (v2)', description: 'urgent', category: 'Boulot', dueDate: '2026-01-05T09:00:00Z' },
      { title: 'Arroser les plantes', category: 'Perso' },
      { title: 'Appeler le garage', category: 'Boulot', dueDate: '2026-02-01T09:00:00Z', priority: 'low' },
      { title: 'Ranger le bureau', category: '' },
      { title: 'Sortir courir', category: 'Perso' },
    ];
    const created = [];
    for (const row of rows) {
      const res = await request(app).post('/tasks').send(row);
      created.push(res.body);
    }
    // une tâche terminée, pour les filtres de statut
    await request(app).put(`/tasks/${created[2]._id}`).send({ completed: true });
    return created;
  };

  test('le filtre de statut porte sur toutes les tâches, pas sur la page', async () => {
    await seed();
    const res = await request(app).get('/tasks?status=done&page=1&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].title).toBe('Arroser les plantes');
  });

  test('le filtre de catégorie porte sur toutes les tâches', async () => {
    await seed();
    const res = await request(app).get('/tasks?category=Boulot&limit=2');

    expect(res.body.total).toBe(2);
    expect(res.body.tasks.map((t) => t.category)).toEqual(['Boulot', 'Boulot']);
  });

  test('la recherche trouve une tâche hors de la première page', async () => {
    await seed();
    const res = await request(app).get('/tasks?q=courir&limit=2');

    expect(res.body.total).toBe(1);
    expect(res.body.tasks[0].title).toBe('Sortir courir');
  });

  test('la recherche couvre la description et échappe les caractères de regex', async () => {
    await seed();
    const description = await request(app).get('/tasks?q=urgent');
    expect(description.body.total).toBe(1);

    const parenthesis = await request(app).get('/tasks?q=' + encodeURIComponent('(v2)'));
    expect(parenthesis.status).toBe(200);
    expect(parenthesis.body.total).toBe(1);
  });

  test('le tri par échéance ordonne et renvoie les tâches sans date à la fin', async () => {
    await seed();
    const res = await request(app).get('/tasks?sort=dueDate&limit=100');

    const dated = res.body.tasks.filter((t) => t.dueDate).map((t) => t.title);
    expect(dated).toEqual(['Relire le devis (v2)', 'Payer le loyer', 'Appeler le garage']);
    expect(res.body.tasks.slice(0, 3).every((t) => t.dueDate)).toBe(true);
  });

  test('le tri par priorité classe haute, moyenne, basse puis aucune', async () => {
    await seed();
    const res = await request(app).get('/tasks?sort=priority&limit=100');

    expect(res.body.tasks[0].priority).toBe('high');
    expect(res.body.tasks[1].priority).toBe('low');
    expect(res.body.tasks.slice(2).every((t) => t.priority === '')).toBe(true);
  });

  test('la pagination est déterministe : aucune tâche répétée ni oubliée', async () => {
    await seed();
    const [first, second, third] = await Promise.all([
      request(app).get('/tasks?page=1&limit=2'),
      request(app).get('/tasks?page=2&limit=2'),
      request(app).get('/tasks?page=3&limit=2'),
    ]);

    const ids = [...first.body.tasks, ...second.body.tasks, ...third.body.tasks].map((t) => t._id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(first.body.totalPages).toBe(3);
  });

  test('une page au-delà du total retombe sur la dernière page', async () => {
    await seed();
    const res = await request(app).get('/tasks?page=99&limit=2');

    expect(res.body.currentPage).toBe(3);
    expect(res.body.tasks).toHaveLength(2);
  });

  test('limit est plafonné à 100', async () => {
    await seed();
    const res = await request(app).get('/tasks?limit=10000');

    expect(res.status).toBe(200);
    expect(res.body.tasks.length).toBeLessThanOrEqual(100);
  });

  test('GET /tasks/stats compte tout, y compris par catégorie', async () => {
    await seed();
    const res = await request(app).get('/tasks/stats');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 6, done: 1, active: 5 });
    const perso = res.body.byCategory.find((c) => c.category === 'Perso');
    expect(perso.count).toBe(3);
  });
});

describe('Tasks API — paramètres hostiles', () => {
  test('un opérateur Mongo passé en paramètre de catégorie est ignoré', async () => {
    await request(app).post('/tasks').send({ title: 'Classée', category: 'Boulot' });
    await request(app).post('/tasks').send({ title: 'Sans catégorie' });

    // Express transforme les crochets en objet : sans garde, ce filtre
    // deviendrait { category: { $regex: 'Boulot' } } et sélectionnerait
    const res = await request(app).get('/tasks?category[$regex]=Boulot');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  test('un opérateur passé en recherche est ignoré lui aussi', async () => {
    await request(app).post('/tasks').send({ title: 'Visible' });

    const res = await request(app).get('/tasks?q[$ne]=');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  test('un tri emprunté au prototype retombe sur le tri par défaut', async () => {
    await request(app).post('/tasks').send({ title: 'Ordre' });

    const res = await request(app).get('/tasks?sort=toString');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
  });

  test('un statut inconnu ne filtre rien plutôt que de tout masquer', async () => {
    await request(app).post('/tasks').send({ title: 'Ouverte' });

    const res = await request(app).get('/tasks?status[$ne]=done');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });
});

describe('Tasks API — validation et corbeille', () => {
  test('le client ne peut pas se déclarer terminé ni antidater à la création', async () => {
    const res = await request(app).post('/tasks').send({
      title: 'Champs interdits',
      completed: true,
      createdAt: '2000-01-01T00:00:00Z',
      deletedAt: '2000-01-01T00:00:00Z',
    });

    expect(res.status).toBe(201);
    expect(res.body.completed).toBe(false);
    expect(new Date(res.body.createdAt).getFullYear()).toBeGreaterThan(2020);
    expect(res.body.deletedAt).toBeNull();
  });

  test('PUT applique les validateurs du schéma', async () => {
    const created = await request(app).post('/tasks').send({ title: 'Valide' });
    const res = await request(app)
      .put(`/tasks/${created.body._id}`)
      .send({ title: 'x'.repeat(200) });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('PUT rejette une priorité inconnue', async () => {
    const created = await request(app).post('/tasks').send({ title: 'Priorité' });
    const res = await request(app).put(`/tasks/${created.body._id}`).send({ priority: 'urgentissime' });

    expect(res.status).toBe(400);
  });

  test('un identifiant malformé renvoie 400, pas 500', async () => {
    const res = await request(app).get('/tasks/pas-un-id');
    expect(res.status).toBe(400);
  });

  test('une tâche supprimée sort des listes puis se restaure', async () => {
    const created = await request(app).post('/tasks').send({ title: 'Repêchable' });

    await request(app).delete(`/tasks/${created.body._id}`);
    const listed = await request(app).get('/tasks');
    expect(listed.body.total).toBe(0);

    const restored = await request(app).post(`/tasks/${created.body._id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.deletedAt).toBeNull();

    const after = await request(app).get('/tasks');
    expect(after.body.total).toBe(1);
  });

  test('restaurer une tâche vivante renvoie 404', async () => {
    const created = await request(app).post('/tasks').send({ title: 'Bien vivante' });
    const res = await request(app).post(`/tasks/${created.body._id}/restore`);
    expect(res.status).toBe(404);
  });
});

describe('Categories API', () => {
  test('POST /categories creates a category', async () => {
    const res = await request(app)
      .post('/categories')
      .send({ name: 'Travail', color: '#f3a366' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Travail');
    expect(res.body.color).toBe('#f3a366');
  });

  test('POST /categories rejects duplicate names', async () => {
    await request(app).post('/categories').send({ name: 'Dup', color: '#000' });
    const res = await request(app).post('/categories').send({ name: 'Dup', color: '#fff' });
    expect(res.status).toBe(400);
  });

  test('POST /categories rejects a non-hex color', async () => {
    const res = await request(app)
      .post('/categories')
      .send({ name: 'Injection', color: 'red; outline: 9999px solid #000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Couleur invalide/);
  });

  test('POST /categories rejects missing fields', async () => {
    const res = await request(app).post('/categories').send({ name: 'Solo' });
    expect(res.status).toBe(400);
  });

  test('GET /categories lists categories', async () => {
    await request(app).post('/categories').send({ name: 'A', color: '#aaa' });
    await request(app).post('/categories').send({ name: 'B', color: '#bbb' });

    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('DELETE /categories/:name clears the category from associated tasks', async () => {
    await request(app).post('/categories').send({ name: 'Sport', color: '#0a0' });
    const task = await request(app)
      .post('/tasks')
      .send({ title: 'Run', category: 'Sport' });

    const del = await request(app).delete('/categories/Sport');
    expect(del.status).toBe(200);

    const after = await request(app).get(`/tasks/${task.body._id}`);
    expect(after.status).toBe(200);
    expect(after.body.category).toBe('');
  });

  test('DELETE /categories/:name returns 404 when missing', async () => {
    const res = await request(app).delete('/categories/Inexistante');
    expect(res.status).toBe(404);
  });
});
