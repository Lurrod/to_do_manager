const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = parseInt(process.env.PORT, 10) || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const isRemoteUri = (uri) =>
  typeof uri === 'string' &&
  uri.length > 0 &&
  !uri.includes('127.0.0.1') &&
  !uri.includes('localhost');

let embeddedMongo = null;

async function resolveMongoUri() {
  if (isRemoteUri(process.env.MONGO_URI)) {
    return process.env.MONGO_URI;
  }

  const { MongoMemoryServer } = require('mongodb-memory-server');
  const dbPath = path.join(__dirname, 'data', 'db');
  fs.mkdirSync(dbPath, { recursive: true });

  console.log('Démarrage de MongoDB embarqué… (premier lancement : téléchargement ~100 Mo)');
  embeddedMongo = await MongoMemoryServer.create({
    instance: {
      dbPath,
      storageEngine: 'wiredTiger',
    },
  });
  console.log(`MongoDB embarqué prêt — données persistantes dans ${dbPath}`);
  return embeddedMongo.getUri();
}

async function shutdown(code = 0) {
  try {
    await mongoose.disconnect();
  } catch (_) {}
  if (embeddedMongo) {
    await embeddedMongo.stop({ doCleanup: false, force: false });
  }
  process.exit(code);
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  (async () => {
    try {
      const uri = await resolveMongoUri();
      await mongoose.connect(uri);
      console.log('MongoDB connecté');
    } catch (err) {
      console.error('Erreur de connexion à MongoDB:', err.message);
      await shutdown(1);
    }
  })();
}

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  dueDate: { type: Date, default: null },
  category: { type: String, default: '' },
});

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  color: { type: String, required: true },
});

const Task = mongoose.model('Task', taskSchema);
const Category = mongoose.model('Category', categorySchema);

app.post('/tasks', async (req, res) => {
  try {
    const task = new Task(req.body);
    await task.save();
    res.status(201).json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/tasks', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 5;
    const skip = (page - 1) * limit;

    const tasks = await Task.find().skip(skip).limit(limit);
    const totalTasks = await Task.countDocuments();

    res.status(200).json({
      tasks,
      totalPages: Math.max(1, Math.ceil(totalTasks / limit)),
      currentPage: page,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });
    res.status(200).json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });
    res.status(200).json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Tâche non trouvée' });
    res.status(200).json({ message: 'Tâche supprimée' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find();
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/categories', async (req, res) => {
  try {
    const category = new Category(req.body);
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/categories/:name', async (req, res) => {
  try {
    const category = await Category.findOneAndDelete({ name: req.params.name });
    if (!category) return res.status(404).json({ error: 'Catégorie non trouvée' });

    await Task.updateMany(
      { category: req.params.name },
      { $set: { category: '' } }
    );

    res.status(200).json({ message: 'Catégorie supprimée' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Serveur démarré sur http://localhost:${port}`);
  });
}

module.exports = app;
