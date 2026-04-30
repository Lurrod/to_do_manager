process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');

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
