process.env.NODE_ENV = 'test';

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const app = require('../../server');
const { DEFAUTS } = require('../../lib/preferences');

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

describe('Préférences', () => {
  test('un cahier neuf rend les réglages par défaut', async () => {
    const res = await request(app).get('/preferences');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAUTS);
  });

  test('un réglage enregistré est rendu au tour suivant', async () => {
    await request(app)
      .put('/preferences')
      .send({ apparence: { densite: 'compact' }, ouverture: { tri: 'dueDate' } });

    const res = await request(app).get('/preferences');

    expect(res.body.apparence.densite).toBe('compact');
    expect(res.body.ouverture.tri).toBe('dueDate');
  });

  test('deux enregistrements successifs se cumulent au lieu de s’écraser', async () => {
    await request(app)
      .put('/preferences')
      .send({ apparence: { densite: 'compact' } });
    await request(app)
      .put('/preferences')
      .send({ ouverture: { statut: 'active' } });

    const res = await request(app).get('/preferences');

    // le second patch ne parlait pas d'apparence : le premier doit survivre
    expect(res.body.apparence.densite).toBe('compact');
    expect(res.body.ouverture.statut).toBe('active');
  });

  test('un réglage inconnu n’est pas conservé', async () => {
    const res = await request(app)
      .put('/preferences')
      .send({ apparence: { densite: 'énorme' }, complot: true });

    expect(res.status).toBe(200);
    expect(res.body.apparence.densite).toBe(DEFAUTS.apparence.densite);
    expect(res.body.complot).toBeUndefined();
  });

  test('n’écrit qu’un seul document, quel que soit le nombre d’enregistrements', async () => {
    await request(app)
      .put('/preferences')
      .send({ apparence: { grain: false } });
    await request(app)
      .put('/preferences')
      .send({ apparence: { grain: true } });

    const total = await mongoose.connection.collection('preferences').countDocuments();

    expect(total).toBe(1);
  });
});
