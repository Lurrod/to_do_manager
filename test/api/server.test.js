process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../server');
const fs = require('fs');
const path = require('path');
const os = require('os');

// les sauvegardes automatiques ne doivent pas atterrir dans le dépôt
process.env.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cahier-backups-'));

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

  describe('GET /tasks — filtre temporel', () => {
    /** Échéance à J+offset, midi, pour rester loin des bornes de minuit. */
    const at = (offsetDays) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString();
    };

    beforeEach(async () => {
      await request(app).post('/tasks').send({ title: 'hier', dueDate: at(-1) });
      await request(app).post('/tasks').send({ title: 'aujourdhui', dueDate: at(0) });
      await request(app).post('/tasks').send({ title: 'dans3j', dueDate: at(3) });
      await request(app).post('/tasks').send({ title: 'dans30j', dueDate: at(30) });
      await request(app).post('/tasks').send({ title: 'sansdate' });
    });

    const titlesFor = async (query) => {
      const res = await request(app).get(`/tasks?limit=100&${query}`);
      expect(res.status).toBe(200);
      return res.body.tasks.map((t) => t.title).sort();
    };

    test('due=overdue ne renvoie que les échéances dépassées', async () => {
      expect(await titlesFor('due=overdue')).toEqual(['hier']);
    });

    test('due=today inclut le retard et le jour même', async () => {
      expect(await titlesFor('due=today')).toEqual(['aujourdhui', 'hier']);
    });

    test('due=week couvre sept jours, retard inclus', async () => {
      expect(await titlesFor('due=week')).toEqual(['aujourdhui', 'dans3j', 'hier']);
    });

    test('due=none ne renvoie que les tâches sans échéance', async () => {
      expect(await titlesFor('due=none')).toEqual(['sansdate']);
    });

    test('une valeur inconnue de due est ignorée', async () => {
      expect(await titlesFor('due=nimportequoi')).toHaveLength(5);
    });

    test('un opérateur Mongo injecté dans due est ignoré', async () => {
      expect(await titlesFor('due[$ne]=null')).toHaveLength(5);
    });

    test('due se combine avec le statut et la recherche', async () => {
      // chaque leurre n'est écarté que par un seul des trois filtres : si l'un
      // d'eux cesse d'agir, un intrus apparaît et le test tombe
      await request(app).post('/tasks').send({ title: 'hier futur', dueDate: at(30) });
      await request(app).post('/tasks').send({ title: 'course', dueDate: at(-1) });
      const fini = await request(app).post('/tasks').send({ title: 'hier fini', dueDate: at(-1) });
      await request(app).put(`/tasks/${fini.body._id}`).send({ completed: true });

      expect(await titlesFor('due=overdue&status=active&q=hier')).toEqual(['hier']);
    });
  });

  test('GET /tasks/stats compte les tâches en retard non terminées', async () => {
    const past = new Date();
    past.setDate(past.getDate() - 2);
    const future = new Date();
    future.setDate(future.getDate() + 2);

    await request(app).post('/tasks').send({ title: 'retard', dueDate: past.toISOString() });
    await request(app).post('/tasks').send({ title: 'a venir', dueDate: future.toISOString() });
    await request(app).post('/tasks').send({ title: 'sans date' });

    const done = await request(app)
      .post('/tasks')
      .send({ title: 'retard mais fini', dueDate: past.toISOString() });
    await request(app).put(`/tasks/${done.body._id}`).send({ completed: true });

    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    // la tâche terminée ne compte pas : elle n'est plus un rappel
    expect(res.body.overdue).toBe(1);
  });

  describe('corbeille', () => {
    /** Crée une tâche puis la supprime ; renvoie son identifiant. */
    const trashed = async (title) => {
      const created = await request(app).post('/tasks').send({ title });
      await request(app).delete(`/tasks/${created.body._id}`);
      return created.body._id;
    };

    test('GET /tasks/trash liste les tâches supprimées, la plus récente en tête', async () => {
      await trashed('premiere');
      await trashed('seconde');
      await request(app).post('/tasks').send({ title: 'vivante' });

      const res = await request(app).get('/tasks/trash');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.tasks.map((t) => t.title)).toEqual(['seconde', 'premiere']);
    });

    test('GET /tasks/trash pagine', async () => {
      await trashed('a');
      await trashed('b');
      await trashed('c');

      const res = await request(app).get('/tasks/trash?limit=2&page=2');
      expect(res.body.totalPages).toBe(2);
      expect(res.body.currentPage).toBe(2);
      expect(res.body.tasks).toHaveLength(1);
    });

    test('« trash » n’est pas confondu avec un identifiant', async () => {
      const res = await request(app).get('/tasks/trash');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('tasks');
    });

    test('DELETE /tasks/:id/purge supprime définitivement', async () => {
      const id = await trashed('a purger');

      const res = await request(app).delete(`/tasks/${id}/purge`);
      expect(res.status).toBe(200);

      const after = await request(app).get('/tasks/trash');
      expect(after.body.total).toBe(0);

      const restore = await request(app).post(`/tasks/${id}/restore`);
      expect(restore.status).toBe(404);
    });

    test('purger une tâche vivante est refusé', async () => {
      const created = await request(app).post('/tasks').send({ title: 'vivante' });

      const res = await request(app).delete(`/tasks/${created.body._id}/purge`);
      expect(res.status).toBe(404);

      const still = await request(app).get(`/tasks/${created.body._id}`);
      expect(still.status).toBe(200);
    });

    test('les tâches en corbeille ne remontent pas dans GET /tasks', async () => {
      await trashed('supprimee');
      const res = await request(app).get('/tasks?limit=100');
      expect(res.body.tasks).toHaveLength(0);
    });

    test('PUT ne peut pas poser deletedAt lui-même', async () => {
      const created = await request(app).post('/tasks').send({ title: 'vivante' });

      const res = await request(app)
        .put(`/tasks/${created.body._id}`)
        .send({ title: 'vivante', deletedAt: new Date().toISOString() });
      expect(res.status).toBe(200);

      // la liste blanche a écarté le champ : la tâche est toujours vivante
      const trash = await request(app).get('/tasks/trash');
      expect(trash.body.total).toBe(0);
      const still = await request(app).get(`/tasks/${created.body._id}`);
      expect(still.status).toBe(200);
    });

    test('supprimer deux fois ne mène pas à la suppression définitive', async () => {
      const created = await request(app).post('/tasks').send({ title: 'deux fois' });

      const first = await request(app).delete(`/tasks/${created.body._id}`);
      expect(first.status).toBe(200);

      const second = await request(app).delete(`/tasks/${created.body._id}`);
      expect(second.status).toBe(404);

      // toujours restaurable : rien n'a été détruit
      const trash = await request(app).get('/tasks/trash');
      expect(trash.body.total).toBe(1);
    });
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

describe('Export / import', () => {
  const seed = async () => {
    await request(app).post('/categories').send({ name: 'Perso', color: '#2f7d51' });
    const vivante = await request(app)
      .post('/tasks')
      .send({ title: 'Relire le brief', category: 'Perso', priority: 'high' });
    const jetee = await request(app).post('/tasks').send({ title: 'Ancienne' });
    await request(app).delete(`/tasks/${jetee.body._id}`);
    return { vivante: vivante.body, jetee: jetee.body };
  };

  test('GET /export renvoie tâches, catégories et version de schéma', async () => {
    await seed();

    const res = await request(app).get('/export');

    expect(res.status).toBe(200);
    expect(res.body.app).toBe('cahier');
    expect(res.body.schemaVersion).toBe(1);
    expect(typeof res.body.exportedAt).toBe('string');
    expect(res.body.categories.map((c) => c.name)).toEqual(['Perso']);
    // la corbeille fait partie de la sauvegarde : la perdre, c'est perdre
    // exactement ce qui était encore récupérable
    expect(res.body.tasks.map((t) => t.title).sort()).toEqual(['Ancienne', 'Relire le brief']);
  });

  test('GET /export conserve identifiants et dates, sans quoi l’aller-retour ment', async () => {
    const { vivante } = await seed();

    const res = await request(app).get('/export');
    const trouvee = res.body.tasks.find((t) => t.title === 'Relire le brief');

    expect(trouvee._id).toBe(vivante._id);
    expect(trouvee.createdAt).toBe(vivante.createdAt);
    expect(trouvee.deletedAt).toBeNull();
  });

  test('GET /export propose un nom de fichier au navigateur', async () => {
    const res = await request(app).get('/export');

    expect(res.headers['content-disposition']).toMatch(/attachment; filename="cahier-.*\.json"/);
  });

  test('POST /import en mode merge ajoute sans écraser l’existant', async () => {
    await seed();
    const avant = (await request(app).get('/export')).body;

    const res = await request(app)
      .post('/import')
      .send({
        mode: 'merge',
        tasks: [{ title: 'Venue de la sauvegarde' }],
        categories: [{ name: 'Travail', color: '#1f2f5c' }],
      });

    expect(res.status).toBe(200);
    const apres = (await request(app).get('/export')).body;
    expect(apres.tasks).toHaveLength(avant.tasks.length + 1);
    expect(apres.categories.map((c) => c.name)).toEqual(['Perso', 'Travail']);
  });

  test('POST /import en mode replace exige un en-tête de confirmation', async () => {
    await seed();

    const res = await request(app).post('/import').send({ mode: 'replace', tasks: [] });

    expect(res.status).toBe(428);
    expect(res.body.error).toMatch(/confirm/i);
    // et surtout : rien n'a été effacé
    const apres = (await request(app).get('/export')).body;
    expect(apres.tasks).toHaveLength(2);
  });

  test('un export réimporté en replace reproduit la base à l’identique', async () => {
    await seed();
    const avant = (await request(app).get('/export')).body;

    // on abîme la base entre les deux : sans cela le test passerait sans rien faire
    await request(app).post('/tasks').send({ title: 'Intrus' });
    await request(app).post('/categories').send({ name: 'Intruse', color: '#c8402f' });

    const res = await request(app)
      .post('/import')
      .set('X-Confirm', 'replace')
      .send({ mode: 'replace', tasks: avant.tasks, categories: avant.categories });

    expect(res.status).toBe(200);
    const apres = (await request(app).get('/export')).body;
    expect(apres.tasks).toEqual(avant.tasks);
    expect(apres.categories).toEqual(avant.categories);
  });

  test('un import malformé est refusé sans rien écrire', async () => {
    await seed();
    const avant = (await request(app).get('/export')).body;

    const res = await request(app)
      .post('/import')
      .set('X-Confirm', 'replace')
      .send({ mode: 'replace', tasks: [{ title: 'Correcte' }, { title: '' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tâche 2/i);
    const apres = (await request(app).get('/export')).body;
    expect(apres.tasks).toEqual(avant.tasks);
  });

  test('POST /import rejette un mode inconnu', async () => {
    const res = await request(app).post('/import').send({ mode: 'ecraser', tasks: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode/i);
  });

  test('un replace dépose une sauvegarde avant d’effacer', async () => {
    await seed();

    const res = await request(app)
      .post('/import')
      .set('X-Confirm', 'replace')
      .send({ mode: 'replace', tasks: [{ title: 'Seule survivante' }] });

    // on relit le fichier que la route dit avoir écrit, et pas « un fichier de
    // sauvegarde dans le dossier » : les tests partagent BACKUP_DIR, et piocher
    // le premier par ordre alphabétique revient à lire le plus ancien, déposé
    // par un autre test
    expect(path.basename(res.body.backup)).toMatch(/^avant-remplacement-/);
    const depose = JSON.parse(fs.readFileSync(res.body.backup, 'utf8'));
    expect(depose.tasks).toHaveLength(2);
  });

  test('réimporter normalise une tâche écrite avant l’ajout d’un champ au schéma', async () => {
    // écrite directement dans la collection : aucun défaut Mongoose appliqué,
    // comme les tâches créées avant que `priority` et `deletedAt` n'existent
    await mongoose.connection.collection('tasks').insertOne({
      title: 'Ancienne façon',
      createdAt: new Date('2026-01-02T08:00:00.000Z'),
    });

    const avant = (await request(app).get('/export')).body;
    const ancienne = avant.tasks.find((t) => t.title === 'Ancienne façon');
    expect(ancienne.priority).toBeUndefined();
    expect(ancienne.deletedAt).toBeUndefined();

    await request(app)
      .post('/import?mode=replace')
      .set('X-Confirm', 'replace')
      .send({ tasks: avant.tasks, categories: avant.categories });

    // l'import remplit les défauts du schéma : l'aller-retour ne reproduit pas
    // l'ABSENCE d'un champ, il la comble. C'est voulu — c'est ce que ferait une
    // migration — et c'est stable : un second aller-retour ne change plus rien.
    const apres = (await request(app).get('/export')).body;
    const normalisee = apres.tasks.find((t) => t.title === 'Ancienne façon');
    expect(normalisee._id).toBe(ancienne._id);
    expect(normalisee.priority).toBe('');
    expect(normalisee.deletedAt).toBeNull();

    const reExport = (await request(app).get('/export')).body;
    expect(reExport.tasks).toEqual(apres.tasks);

    // et surtout : une tâche sans `deletedAt` était déjà vue comme vivante,
    // elle l'est toujours après normalisation
    const liste = await request(app).get('/tasks?limit=50');
    expect(liste.body.tasks.some((t) => t.title === 'Ancienne façon')).toBe(true);
  });

  test('un aller-retour conserve la hiérarchie', async () => {
    const parentRes = await request(app).post('/tasks').send({ title: 'Devis' });
    await request(app)
      .post('/tasks')
      .send({ title: 'Verser l’acompte', parentId: parentRes.body._id });

    const avant = (await request(app).get('/export')).body;
    await request(app)
      .post('/import?mode=replace')
      .set('X-Confirm', 'replace')
      .send({ tasks: avant.tasks, categories: avant.categories });

    const etapes = await request(app).get(`/tasks/${parentRes.body._id}/children`);
    expect(etapes.body.tasks.map((t) => t.title)).toEqual(['Verser l’acompte']);
  });

  test('un fichier aux identifiants dupliqués est refusé avant d’effacer quoi que ce soit', async () => {
    await seed();
    const avant = (await request(app).get('/export')).body;
    const doublon = avant.tasks[0];

    const res = await request(app)
      .post('/import?mode=replace')
      .set('X-Confirm', 'replace')
      .send({ tasks: [doublon, doublon], categories: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/identifiant/i);
    // la base est intacte, et aucune sauvegarde n'a eu à servir
    const apres = (await request(app).get('/export')).body;
    expect(apres.tasks).toEqual(avant.tasks);
  });

  test('GET /export.md rend le cahier en Markdown', async () => {
    await seed();

    const res = await request(app).get('/export.md');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown/);
    expect(res.text).toContain('## Perso');
    expect(res.text).toContain('- [ ] Relire le brief');
    expect(res.text).not.toContain('Ancienne');
  });

  test('GET /export.csv rend un tableau à colonnes stables', async () => {
    await seed();

    const res = await request(app).get('/export.csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.split('\n')[0]).toBe(
      'id,title,description,completed,priority,category,dueDate,createdAt,deletedAt'
    );
  });

  test('un import replace avec deux categories de meme identifiant est refuse sans rien ecrire', async () => {
    await seed();
    const avant = (await request(app).get('/export')).body;
    const categorie = avant.categories[0];
    const doublon = { ...categorie, name: 'Autre nom' };

    const res = await request(app)
      .post('/import?mode=replace')
      .set('X-Confirm', 'replace')
      .send({ tasks: [], categories: [categorie, doublon] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/identifiant/i);
    const apres = (await request(app).get('/export')).body;
    expect(apres.tasks).toEqual(avant.tasks);
    expect(apres.categories).toEqual(avant.categories);
  });

  test('un replace qui echoue en cours d’ecriture remet la base dans son etat d’origine', async () => {
    await seed();
    const avant = (await request(app).get('/export')).body;

    const echecSimule = jest
      .spyOn(mongoose.model('Task'), 'insertMany')
      .mockRejectedValueOnce(new Error('echec simule'));

    try {
      const res = await request(app)
        .post('/import?mode=replace')
        .set('X-Confirm', 'replace')
        .send({ tasks: [{ title: 'Ne devrait pas rester' }], categories: [] });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/sauvegarde/i);
      // le chemin du fichier de sauvegarde doit figurer dans le message : c'est
      // le seul recours si la remise en place elle-meme echoue
      expect(res.body.error).toMatch(/avant-remplacement-.*\.json/);

      const apres = (await request(app).get('/export')).body;
      expect(apres.tasks).toEqual(avant.tasks);
      expect(apres.categories).toEqual(avant.categories);
    } finally {
      echecSimule.mockRestore();
    }
  });

  test('si la remise en place echoue aussi, la reponse dit ou est la sauvegarde', async () => {
    await seed();
    const avant = (await request(app).get('/export')).body;

    // deux rejets : le premier fait echouer l'ecriture, le second fait echouer
    // la remise en place. On atteint alors le dernier filet — le seul chemin ou
    // la base reste dans un etat indetermine, et ou le fichier depose sur le
    // disque est tout ce qui reste a l'utilisateur.
    const echecDouble = jest
      .spyOn(mongoose.model('Task'), 'insertMany')
      .mockRejectedValueOnce(new Error('echec d’ecriture simule'))
      .mockRejectedValueOnce(new Error('echec de remise en place simule'));
    // la route journalise les deux erreurs : attendu ici, on le tait pour
    // garder la sortie de test lisible
    const journal = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const res = await request(app)
        .post('/import?mode=replace')
        .set('X-Confirm', 'replace')
        .send({ tasks: [{ title: 'Ne devrait pas rester' }], categories: [] });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/manuellement/i);

      // l'assertion qui compte : le chemin annonce existe vraiment et contient
      // les donnees d'avant. Un message qui nomme un fichier absent ne vaut rien.
      const chemin = res.body.error.match(/([^\s:]*avant-remplacement-[^\s]*\.json)/)?.[1];
      expect(chemin).toBeTruthy();
      expect(fs.existsSync(chemin)).toBe(true);
      const sauvegarde = JSON.parse(fs.readFileSync(chemin, 'utf8'));
      expect(sauvegarde.tasks).toEqual(avant.tasks);
      expect(sauvegarde.categories).toEqual(avant.categories);

      // et rien d'interne ne fuit, par coherence avec le reste de l'API
      expect(res.body.error).not.toMatch(/node_modules|\bat\s+\w+\s*\(/);
    } finally {
      echecDouble.mockRestore();
      journal.mockRestore();
    }
  });
});

describe('Erreurs de lecture du corps (body-parser)', () => {
  test('un JSON malforme envoye a /import repond en JSON assaini, sans trace interne', async () => {
    const res = await request(app)
      .post('/import')
      .set('Content-Type', 'application/json')
      .send('{ ceci n\'est pas du JSON');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toContain('node_modules');
    expect(res.body.error).not.toContain('C:\\');
    expect(res.body.error).not.toContain('at ');
  });

  test('un corps trop volumineux envoye a POST /tasks repond en JSON assaini, sans trace interne', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send({ title: 'x'.repeat(40000) });

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).not.toContain('node_modules');
    expect(res.body.error).not.toContain('C:\\');
    expect(res.body.error).not.toContain('at ');
  });
});

describe('Migration de schéma', () => {
  const { migrateSchema } = require('../../server');

  test('donne les nouveaux champs aux tâches écrites avant eux', async () => {
    await mongoose.connection.collection('tasks').insertOne({
      title: 'Ancienne façon',
      createdAt: new Date('2026-01-02T08:00:00.000Z'),
    });

    await migrateSchema();

    const migree = await mongoose.connection
      .collection('tasks')
      .findOne({ title: 'Ancienne façon' });
    expect(migree.parentId).toBeNull();
    expect(migree.tags).toEqual([]);
    expect(migree.recurrence).toEqual({ freq: '', interval: 1, until: null });
    expect(migree.reminder).toEqual({ offset: '', at: null, sentAt: null });
    // l'ordre manuel part de la date d'écriture : le seul ordre que
    // l'utilisateur a déjà sous les yeux
    expect(migree.order).toBe(new Date('2026-01-02T08:00:00.000Z').getTime());
  });

  test('ne touche pas à une tâche déjà migrée', async () => {
    const creee = await request(app).post('/tasks').send({ title: 'Déjà moderne' });
    await mongoose.connection
      .collection('tasks')
      .updateOne({ title: 'Déjà moderne' }, { $set: { order: 42, tags: ['garder'] } });

    await migrateSchema();

    const apres = await mongoose.connection
      .collection('tasks')
      .findOne({ _id: new mongoose.Types.ObjectId(creee.body._id) });
    expect(apres.order).toBe(42);
    expect(apres.tags).toEqual(['garder']);
  });

  test('est rejouable sans rien changer', async () => {
    await mongoose.connection.collection('tasks').insertOne({
      title: 'Deux passages',
      createdAt: new Date('2026-01-03T08:00:00.000Z'),
    });

    await migrateSchema();
    const apresUn = await mongoose.connection
      .collection('tasks')
      .findOne({ title: 'Deux passages' });
    await migrateSchema();
    const apresDeux = await mongoose.connection
      .collection('tasks')
      .findOne({ title: 'Deux passages' });

    expect(apresDeux).toEqual(apresUn);
  });
});

describe('Sous-tâches', () => {
  /** Crée un parent et renvoie son identifiant. */
  const parent = async (title = 'Devis') => {
    const res = await request(app).post('/tasks').send({ title });
    return res.body._id;
  };

  test('POST /tasks accepte un parentId', async () => {
    const parentId = await parent();

    const res = await request(app).post('/tasks').send({ title: 'Verser l’acompte', parentId });

    expect(res.status).toBe(201);
    expect(res.body.parentId).toBe(parentId);
  });

  test('GET /tasks ne renvoie que les racines', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Verser l’acompte', parentId });

    const res = await request(app).get('/tasks?limit=50');

    expect(res.body.tasks.map((t) => t.title)).toEqual(['Devis']);
    // le total sert la pagination : il ne doit compter que ce qui est listé
    expect(res.body.total).toBe(1);
  });

  test('GET /tasks/:id/children liste les étapes, les plus anciennes en tête', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Première', parentId });
    await request(app).post('/tasks').send({ title: 'Seconde', parentId });

    const res = await request(app).get(`/tasks/${parentId}/children`);

    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t) => t.title)).toEqual(['Première', 'Seconde']);
  });

  test('une étape ne peut pas porter d’étape', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Étape', parentId });

    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Sous-étape', parentId: etape.body._id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/un seul niveau/i);
  });

  test('un parentId qui ne désigne rien est refusé', async () => {
    const fantome = new mongoose.Types.ObjectId().toString();

    const res = await request(app).post('/tasks').send({ title: 'Orpheline', parentId: fantome });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });

  test('on ne peut pas rattacher une tâche à elle-même', async () => {
    const parentId = await parent();

    const res = await request(app).put(`/tasks/${parentId}`).send({ parentId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/elle-même/i);
  });

  test('chaque racine porte le compte de ses étapes', async () => {
    const parentId = await parent();
    const faite = await request(app).post('/tasks').send({ title: 'Faite', parentId });
    await request(app).put(`/tasks/${faite.body._id}`).send({ completed: true });
    await request(app).post('/tasks').send({ title: 'À faire', parentId });

    const res = await request(app).get('/tasks?limit=50');
    const devis = res.body.tasks.find((t) => t.title === 'Devis');

    expect(devis.childCount).toBe(2);
    expect(devis.childDone).toBe(1);
  });

  test('une racine sans étape porte des compteurs à zéro, pas des champs absents', async () => {
    await parent('Seule');

    const res = await request(app).get('/tasks?limit=50');
    const seule = res.body.tasks.find((t) => t.title === 'Seule');

    expect(seule.childCount).toBe(0);
    expect(seule.childDone).toBe(0);
  });

  test('une étape à la corbeille ne compte plus', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Jetée', parentId });
    await request(app).delete(`/tasks/${etape.body._id}`);

    const res = await request(app).get('/tasks?limit=50');
    const devis = res.body.tasks.find((t) => t.title === 'Devis');

    expect(devis.childCount).toBe(0);
  });

  test('cocher un parent coche toutes ses étapes', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Une', parentId });
    await request(app).post('/tasks').send({ title: 'Deux', parentId });

    await request(app).put(`/tasks/${parentId}`).send({ completed: true });

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    expect(etapes.body.tasks.every((t) => t.completed)).toBe(true);
  });

  test('décocher un parent décoche ses étapes', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Une', parentId });
    await request(app).put(`/tasks/${parentId}`).send({ completed: true });

    await request(app).put(`/tasks/${parentId}`).send({ completed: false });

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    expect(etapes.body.tasks.every((t) => t.completed)).toBe(false);
  });

  test('cocher la dernière étape ne coche pas le parent', async () => {
    const parentId = await parent();
    const seule = await request(app).post('/tasks').send({ title: 'Seule étape', parentId });

    await request(app).put(`/tasks/${seule.body._id}`).send({ completed: true });

    // un parent peut porter du travail propre au-delà de ses étapes : le
    // cocher à sa place serait décider pour l'utilisateur
    const apres = await request(app).get(`/tasks/${parentId}`);
    expect(apres.body.completed).toBe(false);
  });

  test('modifier autre chose que `completed` ne touche pas aux étapes', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Une', parentId });

    await request(app).put(`/tasks/${parentId}`).send({ title: 'Devis revu' });

    const apres = await request(app).get(`/tasks/${etape.body._id}`);
    expect(apres.body.completed).toBe(false);
  });

  test('supprimer un parent envoie ses étapes à la corbeille avec lui', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Une', parentId });

    await request(app).delete(`/tasks/${parentId}`);

    const corbeille = await request(app).get('/tasks/trash?limit=50');
    expect(corbeille.body.tasks.map((t) => t.title).sort()).toEqual(['Devis', 'Une']);
  });

  test('restaurer un parent ressort les étapes parties avec lui', async () => {
    const parentId = await parent();
    await request(app).post('/tasks').send({ title: 'Une', parentId });
    await request(app).delete(`/tasks/${parentId}`);

    await request(app).post(`/tasks/${parentId}/restore`);

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    expect(etapes.body.tasks.map((t) => t.title)).toEqual(['Une']);
  });

  test('restaurer un parent ne ressuscite pas une étape jetée avant lui', async () => {
    const parentId = await parent();
    const jeteeAvant = await request(app).post('/tasks').send({ title: 'Jetée avant', parentId });
    await request(app).post('/tasks').send({ title: 'Partie avec', parentId });

    await request(app).delete(`/tasks/${jeteeAvant.body._id}`);
    await request(app).delete(`/tasks/${parentId}`);
    await request(app).post(`/tasks/${parentId}/restore`);

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    // « Jetée avant » avait été supprimée pour de bon par l'utilisateur :
    // la ressortir serait annuler une décision qu'il a prise
    expect(etapes.body.tasks.map((t) => t.title)).toEqual(['Partie avec']);
  });

  test('purger un parent purge ses étapes', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Une', parentId });
    await request(app).delete(`/tasks/${parentId}`);

    await request(app).delete(`/tasks/${parentId}/purge`);

    const restante = await mongoose.connection
      .collection('tasks')
      .findOne({ _id: new mongoose.Types.ObjectId(etape.body._id) });
    expect(restante).toBeNull();
  });

  test('supprimer une étape seule ne touche pas au parent', async () => {
    const parentId = await parent();
    const etape = await request(app).post('/tasks').send({ title: 'Une', parentId });

    await request(app).delete(`/tasks/${etape.body._id}`);

    const apres = await request(app).get(`/tasks/${parentId}`);
    expect(apres.status).toBe(200);
  });

  test('rattacher une tâche qui a déjà des étapes est refusé', async () => {
    const grandParent = await parent('Grand-parent');
    const pere = await parent('Père');
    await request(app).post('/tasks').send({ title: 'Fils', parentId: pere });

    const res = await request(app).put(`/tasks/${pere}`).send({ parentId: grandParent });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/un seul niveau/i);
  });
});

describe('Récurrence', () => {
  const dans = (jours, heure = 9) => {
    const d = new Date();
    d.setHours(heure, 0, 0, 0);
    d.setDate(d.getDate() + jours);
    return d.toISOString();
  };

  test('POST /tasks accepte une récurrence avec une échéance', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({
        title: 'Sortir les poubelles',
        dueDate: dans(1),
        recurrence: { freq: 'weekly', interval: 1, until: null },
      });

    expect(res.status).toBe(201);
    expect(res.body.recurrence.freq).toBe('weekly');
  });

  test('une récurrence sans échéance est refusée', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Sans ancrage', recurrence: { freq: 'daily', interval: 1, until: null } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/échéance/i);
  });

  test('retirer l’échéance d’une tâche récurrente est refusé', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({
        title: 'Récurrente',
        dueDate: dans(1),
        recurrence: { freq: 'daily', interval: 1, until: null },
      });

    const res = await request(app).put(`/tasks/${creee.body._id}`).send({ dueDate: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/échéance/i);
  });

  /** Crée une tâche récurrente et renvoie le corps de la réponse. */
  const recurrente = async (extra = {}) => {
    const res = await request(app)
      .post('/tasks')
      .send({
        title: 'Sortir les poubelles',
        dueDate: dans(1),
        recurrence: { freq: 'weekly', interval: 1, until: null },
        ...extra,
      });
    return res.body;
  };

  test('cocher une récurrente crée la suivante', async () => {
    const tache = await recurrente();

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    const suivante = liste.body.tasks.find((t) => t.title === 'Sortir les poubelles');
    expect(suivante).toBeDefined();
    expect(suivante._id).not.toBe(tache._id);
    expect(suivante.completed).toBe(false);
  });

  test('la suivante est calée sur l’échéance précédente, pas sur aujourd’hui', async () => {
    const tache = await recurrente({ dueDate: dans(-3) });

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    const suivante = liste.body.tasks.find((t) => t.title === 'Sortir les poubelles');
    const attendue = new Date(tache.dueDate);
    attendue.setDate(attendue.getDate() + 7);
    expect(new Date(suivante.dueDate).toISOString()).toBe(attendue.toISOString());
  });

  test('l’occurrence cochée reste en place, cochée', async () => {
    const tache = await recurrente();

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const ancienne = await request(app).get(`/tasks/${tache._id}`);
    expect(ancienne.body.completed).toBe(true);
    expect(ancienne.body.recurrence.freq).toBe('weekly');
  });

  test('la suivante reprend la récurrence à l’identique', async () => {
    const tache = await recurrente({ recurrence: { freq: 'daily', interval: 3, until: null } });

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    const suivante = liste.body.tasks.find((t) => t.title === 'Sortir les poubelles');
    expect(suivante.recurrence.freq).toBe('daily');
    expect(suivante.recurrence.interval).toBe(3);
  });

  test('une récurrence arrivée au bout de `until` ne régénère rien', async () => {
    const fin = new Date();
    fin.setDate(fin.getDate() + 2);
    const tache = await recurrente({
      recurrence: { freq: 'weekly', interval: 1, until: fin.toISOString() },
    });

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    expect(liste.body.tasks.find((t) => t.title === 'Sortir les poubelles')).toBeUndefined();
  });

  test('décocher une récurrente ne crée rien', async () => {
    const tache = await recurrente();
    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const avant = (await request(app).get('/tasks?limit=50')).body.total;
    await request(app).put(`/tasks/${tache._id}`).send({ completed: false });
    const apres = (await request(app).get('/tasks?limit=50')).body.total;

    expect(apres).toBe(avant);
  });

  test('cocher deux fois la même occurrence ne crée qu’une suivante', async () => {
    const tache = await recurrente();

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });
    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50');
    const toutes = liste.body.tasks.filter((t) => t.title === 'Sortir les poubelles');
    expect(toutes).toHaveLength(2);
  });

  test('la suivante reprend les étapes, décochées', async () => {
    const tache = await recurrente({ title: 'Courses' });
    const etape = await request(app).post('/tasks').send({ title: 'Pain', parentId: tache._id });
    await request(app).put(`/tasks/${etape.body._id}`).send({ completed: true });

    await request(app).put(`/tasks/${tache._id}`).send({ completed: true });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    const suivante = liste.body.tasks.find((t) => t.title === 'Courses');
    const etapes = await request(app).get(`/tasks/${suivante._id}/children`);
    expect(etapes.body.tasks.map((t) => t.title)).toEqual(['Pain']);
    expect(etapes.body.tasks[0].completed).toBe(false);
  });

  test('une fréquence inconnue est refusée', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({
        title: 'Bizarre',
        dueDate: dans(1),
        recurrence: { freq: 'yearly', interval: 1, until: null },
      });

    expect(res.status).toBe(400);
  });
});

describe('Étiquettes', () => {
  test('POST /tasks pose des étiquettes normalisées', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Courses', tags: [' Maison ', 'MAISON', 'urgent'] });

    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(['maison', 'urgent']);
  });

  test('PUT /tasks/:id remplace les étiquettes', async () => {
    const creee = await request(app).post('/tasks').send({ title: 'Courses', tags: ['maison'] });

    const res = await request(app).put(`/tasks/${creee.body._id}`).send({ tags: ['Bureau'] });

    expect(res.body.tags).toEqual(['bureau']);
  });

  test('GET /tasks?tag=… ne renvoie que les tâches marquées', async () => {
    await request(app).post('/tasks').send({ title: 'Avec', tags: ['maison'] });
    await request(app).post('/tasks').send({ title: 'Sans', tags: ['bureau'] });

    const res = await request(app).get('/tasks?limit=50&tag=maison');

    expect(res.body.tasks.map((t) => t.title)).toEqual(['Avec']);
  });

  test('le filtre par étiquette est insensible à la casse de la requête', async () => {
    await request(app).post('/tasks').send({ title: 'Avec', tags: ['maison'] });

    const res = await request(app).get('/tasks?limit=50&tag=MAISON');

    expect(res.body.tasks.map((t) => t.title)).toEqual(['Avec']);
  });

  test('un opérateur Mongo injecté dans tag est ignoré', async () => {
    await request(app).post('/tasks').send({ title: 'Une', tags: ['maison'] });
    await request(app).post('/tasks').send({ title: 'Deux' });

    const res = await request(app).get('/tasks?limit=50&tag[$ne]=null');

    expect(res.body.tasks).toHaveLength(2);
  });

  test('le filtre par étiquette se combine avec le statut', async () => {
    const faite = await request(app).post('/tasks').send({ title: 'Faite', tags: ['maison'] });
    await request(app).put(`/tasks/${faite.body._id}`).send({ completed: true });
    await request(app).post('/tasks').send({ title: 'À faire', tags: ['maison'] });

    const res = await request(app).get('/tasks?limit=50&tag=maison&status=active');

    expect(res.body.tasks.map((t) => t.title)).toEqual(['À faire']);
  });

  test('plus de dix étiquettes : les dix premières sont gardées', async () => {
    const douze = Array.from({ length: 12 }, (_, i) => `tag${i}`);

    const res = await request(app).post('/tasks').send({ title: 'Beaucoup', tags: douze });

    expect(res.status).toBe(201);
    expect(res.body.tags).toHaveLength(10);
  });
});

describe('Ordre manuel', () => {
  /** Crée trois tâches et renvoie leurs identifiants dans l'ordre de création. */
  const trois = async () => {
    const ids = [];
    for (const titre of ['A', 'B', 'C']) {
      const res = await request(app).post('/tasks').send({ title: titre });
      ids.push(res.body._id);
    }
    return ids;
  };

  const ordreManuel = async () => {
    const res = await request(app).get('/tasks?limit=50&sort=manual');
    return res.body.tasks.map((t) => t.title);
  };

  test('sort=manual trie par rang croissant', async () => {
    await trois();

    expect(await ordreManuel()).toEqual(['A', 'B', 'C']);
  });

  test('PATCH /tasks/:id/order déplace une tâche entre deux voisines', async () => {
    const [a, b, c] = await trois();

    const res = await request(app).patch(`/tasks/${c}/order`).send({ before: a, after: b });

    expect(res.status).toBe(200);
    expect(await ordreManuel()).toEqual(['A', 'C', 'B']);
  });

  test('déplacer en tête de liste', async () => {
    const [a, , c] = await trois();

    await request(app).patch(`/tasks/${c}/order`).send({ before: null, after: a });

    expect(await ordreManuel()).toEqual(['C', 'A', 'B']);
  });

  test('déplacer en fin de liste', async () => {
    const [a, , c] = await trois();

    await request(app).patch(`/tasks/${a}/order`).send({ before: c, after: null });

    expect(await ordreManuel()).toEqual(['B', 'C', 'A']);
  });

  test('un déplacement ne produit qu’une écriture', async () => {
    const [a, b, c] = await trois();
    const avant = await request(app).get('/tasks?limit=50&sort=manual');
    const rangsAvant = Object.fromEntries(avant.body.tasks.map((t) => [t.title, t.order]));

    await request(app).patch(`/tasks/${c}/order`).send({ before: a, after: b });

    const apres = await request(app).get('/tasks?limit=50&sort=manual');
    const rangsApres = Object.fromEntries(apres.body.tasks.map((t) => [t.title, t.order]));
    // A et B n'ont pas bougé : seule la tâche déplacée est réécrite
    expect(rangsApres.A).toBe(rangsAvant.A);
    expect(rangsApres.B).toBe(rangsAvant.B);
    expect(rangsApres.C).not.toBe(rangsAvant.C);
  });

  test('un identifiant de voisine inconnu est refusé', async () => {
    const [, , c] = await trois();
    const fantome = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .patch(`/tasks/${c}/order`)
      .send({ before: fantome, after: null });

    expect(res.status).toBe(400);
  });

  test('l’intervalle épuisé déclenche une renumérotation, et l’ordre est conservé', async () => {
    const [a, b, c] = await trois();
    await mongoose.connection.collection('tasks').updateOne({ title: 'A' }, { $set: { order: 1 } });
    await mongoose.connection
      .collection('tasks')
      .updateOne({ title: 'B' }, { $set: { order: 1 + 1e-9 } });

    const res = await request(app).patch(`/tasks/${c}/order`).send({ before: a, after: b });

    expect(res.status).toBe(200);
    expect(await ordreManuel()).toEqual(['A', 'C', 'B']);
    // et les rangs sont de nouveau espacés : le prochain dépôt tiendra
    const apres = await request(app).get('/tasks?limit=50&sort=manual');
    const rangs = apres.body.tasks.map((t) => t.order);
    expect(rangs[1] - rangs[0]).toBeGreaterThan(1);
  });

  test('déplacer une tâche qui n’existe pas répond 404', async () => {
    const fantome = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .patch(`/tasks/${fantome}/order`)
      .send({ before: null, after: null });

    expect(res.status).toBe(404);
  });
});

describe('Rappels', () => {
  const { sweepReminders } = require('../../server');

  const dans = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

  /** Collecte les notifications au lieu de les afficher. */
  const collecteur = () => {
    const envoyees = [];
    return { envoyees, envoyer: async (contenu) => envoyees.push(contenu) };
  };

  test('poser un rappel calcule son heure à partir de l’échéance', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(120), reminder: { offset: '1h' } });

    expect(res.status).toBe(201);
    const attendue = new Date(new Date(res.body.dueDate).getTime() - 60 * 60 * 1000);
    expect(new Date(res.body.reminder.at).toISOString()).toBe(attendue.toISOString());
  });

  test('un rappel sans échéance n’a pas d’heure', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Sans date', reminder: { offset: '1h' } });

    expect(res.body.reminder.at).toBeNull();
  });

  test('changer l’échéance recalcule l’heure du rappel', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(120), reminder: { offset: '1h' } });

    const res = await request(app).put(`/tasks/${creee.body._id}`).send({ dueDate: dans(300) });

    const attendue = new Date(new Date(res.body.dueDate).getTime() - 60 * 60 * 1000);
    expect(new Date(res.body.reminder.at).toISOString()).toBe(attendue.toISOString());
  });

  test('retirer le rappel efface son heure', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(120), reminder: { offset: '1h' } });

    const res = await request(app)
      .put(`/tasks/${creee.body._id}`)
      .send({ reminder: { offset: '' } });

    expect(res.body.reminder.at).toBeNull();
  });

  test('le balayage envoie les rappels échus et les marque', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(-30), reminder: { offset: 'atDue' } });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(1);
    expect(envoyees[0].message).toContain('Dentiste');
    const apres = await request(app).get(`/tasks/${creee.body._id}`);
    expect(apres.body.reminder.sentAt).not.toBeNull();
  });

  test('un rappel ne part qu’une fois, même si le balayage repasse', async () => {
    await request(app)
      .post('/tasks')
      .send({ title: 'Dentiste', dueDate: dans(-30), reminder: { offset: 'atDue' } });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });
    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(1);
  });

  test('un rappel à venir ne part pas', async () => {
    await request(app)
      .post('/tasks')
      .send({ title: 'Plus tard', dueDate: dans(300), reminder: { offset: 'atDue' } });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(0);
  });

  test('cocher une tâche avant l’heure du rappel empêche l’envoi', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Faite avant', dueDate: dans(-30), reminder: { offset: 'atDue' } });
    await request(app).put(`/tasks/${creee.body._id}`).send({ completed: true });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(0);
  });

  test('supprimer une tâche empêche son rappel', async () => {
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Jetée', dueDate: dans(-30), reminder: { offset: 'atDue' } });
    await request(app).delete(`/tasks/${creee.body._id}`);
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(0);
  });

  test('plusieurs rappels échus font une seule notification', async () => {
    for (const titre of ['Un', 'Deux', 'Trois']) {
      await request(app)
        .post('/tasks')
        .send({ title: titre, dueDate: dans(-30), reminder: { offset: 'atDue' } });
    }
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    // douze toasts d'affilée au lancement seraient du bruit
    expect(envoyees).toHaveLength(1);
    expect(envoyees[0].message).toContain('Un');
    expect(envoyees[0].message).toContain('Trois');
  });

  test('un rappel oublié depuis plus de sept jours est marqué sans rien afficher', async () => {
    const vieux = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const creee = await request(app)
      .post('/tasks')
      .send({ title: 'Oublié', dueDate: vieux, reminder: { offset: 'atDue' } });
    const { envoyees, envoyer } = collecteur();

    await sweepReminders({ now: new Date(), envoyer });

    expect(envoyees).toHaveLength(0);
    const apres = await request(app).get(`/tasks/${creee.body._id}`);
    // marqué quand même : sinon il resurgirait à chaque démarrage
    expect(apres.body.reminder.sentAt).not.toBeNull();
  });
});

describe('Santé du serveur', () => {
  test('GET /healthz dit que le serveur répond et que la base est là', async () => {
    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
  });

  test('GET /healthz ne demande pas d’identifiant et ne fuite rien', async () => {
    const res = await request(app).get('/healthz');

    // le lanceur l'interroge en boucle au démarrage : elle doit rester
    // triviale, et ne rien dire de la machine
    expect(Object.keys(res.body).sort()).toEqual(['db', 'status', 'uptime']);
    expect(JSON.stringify(res.body)).not.toMatch(/C:\|node_modules|mongodb:/);
  });
});

describe('Actions groupées', () => {
  /** Crée n tâches et renvoie leurs identifiants. */
  const creer = async (titres) => {
    const ids = [];
    for (const titre of titres) {
      const res = await request(app).post('/tasks').send({ title: titre });
      ids.push(res.body._id);
    }
    return ids;
  };

  test('cocher plusieurs tâches d’un coup', async () => {
    const ids = await creer(['A', 'B', 'C']);

    const res = await request(app).post('/tasks/bulk').send({ ids, action: 'complete' });

    expect(res.status).toBe(200);
    expect(res.body.modified).toBe(3);
    const liste = await request(app).get('/tasks?limit=50&status=done');
    expect(liste.body.total).toBe(3);
  });

  test('décocher plusieurs tâches d’un coup', async () => {
    const ids = await creer(['A', 'B']);
    await request(app).post('/tasks/bulk').send({ ids, action: 'complete' });

    await request(app).post('/tasks/bulk').send({ ids, action: 'uncomplete' });

    const liste = await request(app).get('/tasks?limit=50&status=active');
    expect(liste.body.total).toBe(2);
  });

  test('cocher un parent en groupe coche aussi ses étapes', async () => {
    const [parentId] = await creer(['Devis']);
    await request(app).post('/tasks').send({ title: 'Une étape', parentId });

    await request(app).post('/tasks/bulk').send({ ids: [parentId], action: 'complete' });

    const etapes = await request(app).get(`/tasks/${parentId}/children`);
    expect(etapes.body.tasks.every((t) => t.completed)).toBe(true);
  });

  test('supprimer plusieurs tâches d’un coup', async () => {
    const ids = await creer(['A', 'B']);

    const res = await request(app).post('/tasks/bulk').send({ ids, action: 'delete' });

    expect(res.body.modified).toBe(2);
    const corbeille = await request(app).get('/tasks/trash?limit=50');
    expect(corbeille.body.total).toBe(2);
  });

  test('une suppression groupée partage un horodatage, donc s’annule d’un geste', async () => {
    const ids = await creer(['A', 'B']);
    await request(app).post('/tasks/bulk').send({ ids, action: 'delete' });

    const corbeille = await request(app).get('/tasks/trash?limit=50');
    const horodatages = new Set(corbeille.body.tasks.map((t) => t.deletedAt));
    expect(horodatages.size).toBe(1);
  });

  test('changer la catégorie de plusieurs tâches', async () => {
    const ids = await creer(['A', 'B']);

    await request(app)
      .post('/tasks/bulk')
      .send({ ids, action: 'category', value: 'Perso' });

    const liste = await request(app).get('/tasks?limit=50&category=Perso');
    expect(liste.body.total).toBe(2);
  });

  test('changer la priorité de plusieurs tâches', async () => {
    const ids = await creer(['A', 'B']);

    await request(app).post('/tasks/bulk').send({ ids, action: 'priority', value: 'high' });

    const liste = await request(app).get('/tasks?limit=50');
    expect(liste.body.tasks.every((t) => t.priority === 'high')).toBe(true);
  });

  test('une priorité hors de la liste est refusée', async () => {
    const ids = await creer(['A']);

    const res = await request(app)
      .post('/tasks/bulk')
      .send({ ids, action: 'priority', value: 'urgentissime' });

    expect(res.status).toBe(400);
  });

  test('une action inconnue est refusée', async () => {
    const ids = await creer(['A']);

    const res = await request(app).post('/tasks/bulk').send({ ids, action: 'incendier' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action/i);
  });

  test('au-delà de cent identifiants, c’est refusé', async () => {
    const ids = Array.from({ length: 101 }, () => new mongoose.Types.ObjectId().toString());

    const res = await request(app).post('/tasks/bulk').send({ ids, action: 'complete' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100/);
  });

  test('une liste vide ne fait rien, sans erreur', async () => {
    const res = await request(app).post('/tasks/bulk').send({ ids: [], action: 'complete' });

    expect(res.status).toBe(200);
    expect(res.body.modified).toBe(0);
  });

  test('un opérateur Mongo injecté dans ids est refusé', async () => {
    const res = await request(app)
      .post('/tasks/bulk')
      .send({ ids: { $ne: null }, action: 'complete' });

    expect(res.status).toBe(400);
  });

  test('les tâches déjà à la corbeille sont ignorées', async () => {
    const ids = await creer(['A', 'B']);
    await request(app).delete(`/tasks/${ids[0]}`);

    const res = await request(app).post('/tasks/bulk').send({ ids, action: 'complete' });

    expect(res.body.modified).toBe(1);
  });
});
