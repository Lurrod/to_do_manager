const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');

describe('API Tests for Tasks', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  let createdTaskId;

  test('Should create a new task', async () => {
    const response = await request(app)
      .post('/tasks')
      .send({
        title: 'Test Task',
        description: 'Description of the test task',
        dueDate: '2025-12-31T23:59:59Z',
        category: 'Test Category',
      });

    expect(response.statusCode).toBe(201);
    expect(response.body).toHaveProperty('_id');
    expect(response.body.title).toBe('Test Task');

    createdTaskId = response.body._id;
  });

  test('Should fetch all tasks', async () => {
    const response = await request(app).get('/tasks');

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('tasks');
    expect(response.body.tasks.length).toBeGreaterThan(0);
  });

  test('Should fetch a task by ID', async () => {
    const response = await request(app).get(`/tasks/${createdTaskId}`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('_id', createdTaskId);
  });

  test('Should update a task', async () => {
    const response = await request(app)
      .put(`/tasks/${createdTaskId}`)
      .send({
        title: 'Updated Task',
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.title).toBe('Updated Task');
  });

  test('Should delete a task', async () => {
    const response = await request(app).delete(`/tasks/${createdTaskId}`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('message', 'Tâche supprimée');
  });
});
