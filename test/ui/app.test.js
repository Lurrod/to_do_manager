import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/* ---------------------------------------------------------------------------
   app.js est un module à effets de bord : l'importer amorce l'application sur
   le DOM courant. On lui sert donc le vrai index.html et un faux serveur dont
   on peut retenir les réponses, pour vérifier ce qui se passe quand elles
   reviennent dans le désordre.
   --------------------------------------------------------------------------- */

// import.meta.url pointe sur http:// dans l'environnement de test : on part de
// la racine du projet, où vitest est lancé
const HTML = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>')).replace(
  /<script[\s\S]*?<\/script>/g,
  ''
);

const task = (title, extra = {}) => ({
  _id: `id-${title}`,
  title,
  description: '',
  completed: false,
  dueDate: null,
  category: '',
  priority: '',
  ...extra,
});

let server;

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

const listFor = (url) => {
  const params = new URL(url, 'http://test').searchParams;
  const q = (params.get('q') || '').toLowerCase();
  const status = params.get('status') || 'all';

  let tasks = server.tasks;
  if (q) tasks = tasks.filter((t) => t.title.toLowerCase().includes(q));
  if (status === 'done') tasks = tasks.filter((t) => t.completed);
  if (status === 'active') tasks = tasks.filter((t) => !t.completed);

  return { tasks, total: tasks.length, totalPages: 1, currentPage: 1 };
};

const idFrom = (url) => url.replace('/tasks/', '').replace('/restore', '');

/** Applique la mutation au faux serveur, comme le ferait l'API. */
const mutate = (url, method, body) => {
  const id = idFrom(url);

  if (method === 'DELETE') {
    const index = server.tasks.findIndex((t) => t._id === id);
    server.trash.push({ index, task: server.tasks[index] });
    server.tasks = server.tasks.filter((t) => t._id !== id);
    return { message: 'Tâche supprimée' };
  }

  if (method === 'POST' && url.endsWith('/restore')) {
    const entry = server.trash.pop();
    server.tasks = [
      ...server.tasks.slice(0, entry.index),
      entry.task,
      ...server.tasks.slice(entry.index),
    ];
    return entry.task;
  }

  if (method === 'PUT') {
    server.tasks = server.tasks.map((t) => (t._id === id ? { ...t, ...body } : t));
    return server.tasks.find((t) => t._id === id);
  }

  return {};
};

const bodyFor = (url, method, body) => {
  if (method !== 'GET') return mutate(url, method, body);
  if (url.startsWith('/tasks/stats')) return server.stats;
  if (url.startsWith('/tasks?')) return listFor(url);
  if (url.startsWith('/categories')) return server.categories;
  return {};
};

const boot = async () => {
  document.body.innerHTML = BODY;
  vi.resetModules();
  await import('../../public/js/app.js');
  await settle();
};

/** Laisse les promesses en attente se dénouer (et le debounce s'écouler). */
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const titles = () =>
  [...document.querySelectorAll('.task-title')].map((el) => el.textContent.trim());

const calls = (method = 'GET') => server.calls.filter((c) => c.method === method).map((c) => c.url);

beforeEach(() => {
  server = {
    tasks: [task('Relire le brief'), task('Arroser les plantes', { completed: true })],
    stats: { total: 2, done: 1, active: 1, byCategory: [{ category: 'Perso', count: 1 }] },
    categories: [{ _id: 'c1', name: 'Perso', color: '#2f7d51' }],
    calls: [],
    held: [],
    trash: [],
    hold: false,
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url, options = {}) => {
      const method = options.method || 'GET';
      server.calls.push({ url, method });

      // les listes peuvent être retenues pour rejouer un désordre de réponses
      if (server.hold && url.startsWith('/tasks?')) {
        return new Promise((resolve) => {
          server.held.push(() => resolve(ok(listFor(url))));
        });
      }
      const body = options.body ? JSON.parse(options.body) : null;
      return Promise.resolve(ok(bodyFor(url, method, body)));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('chargement initial', () => {
  test('affiche la page reçue et les compteurs du serveur', async () => {
    await boot();

    expect(titles()).toEqual(['Relire le brief', 'Arroser les plantes']);
    expect(document.getElementById('stat-total').textContent).toBe('2');
    expect(document.getElementById('stat-done').textContent).toBe('1');
    expect(document.getElementById('stat-active').textContent).toContain('1');
  });

  test('demande la première page avec le tri et les filtres par défaut', async () => {
    await boot();

    const url = calls().find((u) => u.startsWith('/tasks?'));
    const params = new URL(url, 'http://test').searchParams;
    expect(params.get('page')).toBe('1');
    expect(params.get('limit')).toBe('5');
    expect(params.get('sort')).toBe('creation');
    expect(params.get('status')).toBe('all');
  });

  test('les compteurs de catégorie viennent de /tasks/stats, pas de la page', async () => {
    await boot();

    const rows = [...document.querySelectorAll('.cat-item')].map((li) =>
      li.querySelector('.cat-count').textContent.trim()
    );
    expect(rows[0]).toBe('2'); // toutes les tâches
    expect(rows[1]).toBe('1'); // Perso, compté sur toute la base
  });

  test('barre les tâches terminées d’un trait', async () => {
    await boot();

    const done = document.querySelector('.task.is-done .task-title');
    expect(done.dataset.sketched).toBe('strike');
  });
});

describe('recherche', () => {
  test('envoie le terme au serveur après le délai de frappe', async () => {
    await boot();
    server.calls.length = 0;

    const input = document.getElementById('search-input');
    input.value = 'brief';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(250);

    const url = calls().find((u) => u.includes('q=brief'));
    expect(url).toBeDefined();
    expect(new URL(url, 'http://test').searchParams.get('page')).toBe('1');
    expect(titles()).toEqual(['Relire le brief']);
  });

  test('une réponse en retard n’écrase pas un résultat plus récent', async () => {
    await boot();
    server.hold = true;

    const input = document.getElementById('search-input');
    input.value = 'brief';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(200);

    input.value = 'plantes';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(200);

    expect(server.held).toHaveLength(2);

    // la seconde requête répond d'abord, la première arrive en retard
    server.held[1]();
    await settle();
    server.held[0]();
    await settle();

    expect(titles()).toEqual(['Arroser les plantes']);
  });
});

describe('filtres', () => {
  test('la pastille de statut relance une requête filtrée', async () => {
    await boot();
    server.calls.length = 0;

    document.querySelector('[data-filter="done"]').click();
    await settle();

    const url = calls().find((u) => u.startsWith('/tasks?'));
    expect(new URL(url, 'http://test').searchParams.get('status')).toBe('done');
    expect(titles()).toEqual(['Arroser les plantes']);
  });

  test('la pastille active est redessinée pleine', async () => {
    await boot();

    const pill = document.querySelector('[data-filter="done"]');
    pill.click();
    await settle();

    expect(pill.dataset.variant).toBe('solid');
    expect(document.querySelector('[data-filter="all"]').dataset.variant).toBeUndefined();
  });
});

describe('bascule optimiste', () => {
  test('coche la tâche à l’écran avant la réponse du serveur', async () => {
    await boot();
    server.hold = true;

    const item = [...document.querySelectorAll('.task')].find((li) =>
      li.querySelector('.task-title').textContent.includes('Relire')
    );
    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    // la liste est redessinée avant même que le PUT ait répondu
    expect(document.querySelectorAll('.task.is-done')).toHaveLength(2);
    expect(document.getElementById('stat-done').textContent).toBe('2');
    expect(document.getElementById('stat-active').textContent).toContain('0');

    const put = server.calls.find((c) => c.method === 'PUT');
    expect(put.url).toBe('/tasks/id-Relire le brief');
    expect(server.held.length).toBeGreaterThan(0); // le rafraîchissement est encore en vol
  });
});

describe('suppression annulable', () => {
  test('retire la carte, propose « Annuler », et restaure au clic', async () => {
    await boot();

    document.querySelector('.task .delete').click();
    await settle();

    expect(titles()).toEqual(['Arroser les plantes']);
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(true);

    const undo = document.querySelector('.toast-action');
    expect(undo.textContent).toBe('Annuler');

    undo.click();
    await settle();

    const restore = server.calls.find((c) => c.method === 'POST' && c.url.endsWith('/restore'));
    expect(restore.url).toBe('/tasks/id-Relire le brief/restore');
    expect(titles()).toEqual(['Relire le brief', 'Arroser les plantes']);
  });

  test('la note d’annulation disparaît une fois cliquée', async () => {
    await boot();

    document.querySelector('.task .delete').click();
    await settle();
    document.querySelector('.toast-action').click();
    await settle();

    expect(document.querySelector('.toast-action')).toBeNull();
  });
});

describe('état vide', () => {
  test('distingue une recherche sans résultat d’un cahier vierge', async () => {
    await boot();

    const input = document.getElementById('search-input');
    input.value = 'introuvable';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(250);

    expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.empty-title').textContent).toBe('Rien sous ce mot.');
    expect(document.querySelector('.empty-sub').textContent).toContain('introuvable');
  });
});
