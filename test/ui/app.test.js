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

const idFrom = (url) => url.replace('/tasks/', '').replace('/restore', '').replace('/purge', '');

/** Applique la mutation au faux serveur, comme le ferait l'API. */
const mutate = (url, method, body) => {
  const id = idFrom(url);

  if (method === 'DELETE' && url.endsWith('/purge')) {
    const purged = url.replace('/tasks/', '').replace('/purge', '');
    server.trash = server.trash.filter((entry) => entry.task._id !== purged);
    return { message: 'Tâche supprimée définitivement' };
  }

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

  if (method === 'PATCH' && url.endsWith('/order')) {
    return { message: 'ordre mis à jour' };
  }

  if (method === 'PUT' && url === '/preferences') {
    server.preferences = Object.fromEntries(
      Object.entries(server.preferences).map(([section, reglages]) => [
        section,
        { ...reglages, ...(body[section] || {}) },
      ])
    );
    return server.preferences;
  }

  if (method === 'POST' && url.startsWith('/systeme/maj/')) return server.systeme;

  return {};
};

const bodyFor = (url, method, body) => {
  if (method !== 'GET') return mutate(url, method, body);
  if (url.startsWith('/preferences/schema')) return server.schema;
  if (url.startsWith('/preferences')) return server.preferences;
  if (url.startsWith('/systeme')) return server.systeme;
  if (/^\/tasks\/[^/]+\/children$/.test(url)) {
    const id = url.split('/')[2];
    return { tasks: server.children[id] || [], total: (server.children[id] || []).length };
  }
  if (url.startsWith('/tasks/stats')) return server.stats;
  if (url.startsWith('/tasks/trash')) {
    const tasks = server.trash.map((entry) => entry.task);
    return { tasks, total: tasks.length, totalPages: 1, currentPage: 1 };
  }
  if (url.startsWith('/tasks?')) return listFor(url);
  if (url.startsWith('/categories')) return server.categories;
  return {};
};

// app.js (et les modules qu'il importe en cascade, tel modal.js) posent des
// écouteurs sur `document`, qui survit au remplacement du <body> : sans ce
// suivi, chaque test traînerait les écouteurs de tous les tests précédents,
// qui rejoueraient leurs actions sur les données du test en cours.
let bootListeners = [];

const boot = async () => {
  document.body.innerHTML = BODY;
  // l'apparence est mise en miroir dans le stockage local : sans ce nettoyage,
  // un test ouvrirait la page sur l'apparence reglee par le precedent
  document.documentElement.removeAttribute('data-densite');
  document.documentElement.removeAttribute('data-crayon');
  localStorage.clear();
  vi.resetModules();

  const add = document.addEventListener.bind(document);
  const spy = vi.spyOn(document, 'addEventListener').mockImplementation((...args) => {
    bootListeners.push(args);
    add(...args);
  });
  await import('../../public/js/app.js');
  spy.mockRestore();

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
    children: {},
    hold: false,
    failNextPost: false,
    preferences: {
      apparence: { densite: 'confort', taille: 'normale', grain: true, crayon: true },
      ouverture: { statut: 'all', horizon: 'all', tri: 'creation' },
      misesAJour: { prevenir: true },
    },
    schema: {
      sections: { apparence: { titre: 'Apparence', note: null } },
      schema: {
        apparence: {
          densite: {
            libelle: 'Densité',
            type: 'choix',
            valeurs: [
              { valeur: 'confort', libelle: 'Confort' },
              { valeur: 'compact', libelle: 'Compact' },
            ],
            defaut: 'confort',
          },
        },
      },
    },
    systeme: {
      version: '3.0.1',
      dossierDonnees: 'C:\Cahier\db',
      maj: { etape: 'inactive', version: null, progression: 0, message: null },
    },
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url, options = {}) => {
      const method = options.method || 'GET';
      server.calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });

      if (server.failNextPost && method === 'POST' && url === '/tasks') {
        server.failNextPost = false;
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Erreur interne du serveur' }),
        });
      }

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
  bootListeners.forEach((args) => document.removeEventListener(...args));
  bootListeners = [];
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

describe('onglets temporels', () => {
  const lastListUrl = () =>
    calls()
      .filter((u) => u.startsWith('/tasks?'))
      .pop();

  test('la vue par défaut ne contraint pas l’échéance', async () => {
    await boot();
    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('due')).toBe('all');
  });

  test('cliquer un onglet relance la liste sur cet horizon, page 1', async () => {
    await boot();
    server.calls = [];

    document.querySelector('.due-pill[data-due="today"]').click();
    await settle();

    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('due')).toBe('today');
    expect(params.get('page')).toBe('1');
  });

  test('l’onglet « en retard » aligne le statut sur ce que compte le badge', async () => {
    await boot();
    server.calls = [];

    document.querySelector('.due-pill[data-due="overdue"]').click();
    await settle();

    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('due')).toBe('overdue');
    expect(params.get('status')).toBe('active');
    // l'interface ne doit pas afficher « Toutes » en filtrant sur « À faire »
    const statusPill = document.querySelector('.pill[data-filter="active"]');
    expect(statusPill.classList.contains('is-active')).toBe(true);
  });

  test('élargir le statut quitte l’horizon « en retard » au lieu de le faire mentir', async () => {
    await boot();
    document.querySelector('.due-pill[data-due="overdue"]').click();
    await settle();
    server.calls = [];

    document.querySelector('.pill[data-filter="done"]').click();
    await settle();

    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('status')).toBe('done');
    expect(params.get('due')).toBe('all');
    expect(
      document.querySelector('.due-pill[data-due="all"]').classList.contains('is-active')
    ).toBe(true);
  });

  test('revenir sur « à faire » ne quitte pas l’horizon : rien ne se contredit', async () => {
    await boot();
    document.querySelector('.due-pill[data-due="overdue"]').click();
    await settle();
    server.calls = [];

    document.querySelector('.pill[data-filter="active"]').click();
    await settle();

    const params = new URL(lastListUrl(), 'http://test').searchParams;
    expect(params.get('status')).toBe('active');
    expect(params.get('due')).toBe('overdue');
  });

  test('l’état de sélection est exposé aux aides techniques', async () => {
    await boot();
    document.querySelector('.due-pill[data-due="today"]').click();
    await settle();

    expect(document.querySelector('.due-pill[data-due="today"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(document.querySelector('.due-pill[data-due="all"]').getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  test('le badge nomme ce qu’il compte', async () => {
    server.stats = { ...server.stats, overdue: 2 };
    await boot();

    const pill = document.querySelector('.due-pill[data-due="overdue"]');
    expect(pill.getAttribute('aria-label')).toBe('En retard, 2 tâches');
  });

  test('les autres horizons laissent le statut tranquille', async () => {
    await boot();
    server.calls = [];

    document.querySelector('.due-pill[data-due="week"]').click();
    await settle();

    expect(new URL(lastListUrl(), 'http://test').searchParams.get('status')).toBe('all');
    expect(document.querySelector('.pill[data-filter="all"]').classList.contains('is-active')).toBe(
      true
    );
  });

  test('l’onglet actif est le seul marqué', async () => {
    await boot();
    document.querySelector('.due-pill[data-due="overdue"]').click();
    await settle();

    const active = [...document.querySelectorAll('.due-pill.is-active')].map(
      (el) => el.dataset.due
    );
    expect(active).toEqual(['overdue']);
  });

  test('le badge affiche le nombre de tâches en retard', async () => {
    server.stats = { ...server.stats, overdue: 3 };
    await boot();

    const badge = document.getElementById('due-overdue-count');
    expect(badge.textContent).toBe('3');
    expect(badge.hidden).toBe(false);
  });

  test('le badge disparaît quand rien n’est en retard', async () => {
    server.stats = { ...server.stats, overdue: 0 };
    await boot();

    expect(document.getElementById('due-overdue-count').hidden).toBe(true);
  });

  test('un horizon vide affiche un état vide qui le dit', async () => {
    server.tasks = [];
    server.stats = { total: 0, done: 0, active: 0, overdue: 0, byCategory: [] };
    await boot();

    document.querySelector('.due-pill[data-due="week"]').click();
    await settle();

    expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.empty-title').textContent).toBe('Rien sur cet horizon.');
  });
});

describe('saisie rapide', () => {
  const type = (value) => {
    const input = document.getElementById('task-title');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const posted = () => server.calls.filter((c) => c.method === 'POST' && c.url === '/tasks').length;

  test('l’aperçu montre ce qui a été compris', async () => {
    await boot();
    type('Dentiste demain 14h #Perso !haute');
    await settle();

    const chips = [...document.querySelectorAll('#quick-preview .chip')].map((el) =>
      el.textContent.trim()
    );
    expect(chips).toContain('demain');
    expect(chips).toContain('#Perso');
    expect(chips).toContain('!haute');
  });

  test('l’aperçu se vide quand le texte ne contient plus de motif', async () => {
    await boot();
    type('Dentiste demain');
    await settle();
    expect(document.getElementById('quick-preview').hidden).toBe(false);

    type('Dentiste');
    await settle();
    expect(document.getElementById('quick-preview').hidden).toBe(true);
  });

  test('envoyer poste le titre nettoyé et les champs déduits', async () => {
    await boot();
    type('Dentiste demain 14h #Perso !haute');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    const call = server.calls.find((c) => c.method === 'POST' && c.url === '/tasks');
    expect(call).toBeTruthy();
    expect(call.body.title).toBe('Dentiste');
    expect(call.body.category).toBe('Perso');
    expect(call.body.priority).toBe('high');
    expect(call.body.dueDate).not.toBeNull();
  });

  test('un choix fait à la souris l’emporte sur le texte', async () => {
    await boot();
    document.getElementById('task-priority').value = 'low';
    type('Dentiste !haute');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    const call = server.calls.find((c) => c.method === 'POST' && c.url === '/tasks');
    expect(call.body.priority).toBe('low');
  });

  test('un texte qui ne laisse aucun titre n’est pas envoyé', async () => {
    await boot();
    const before = posted();
    type('#Perso !haute');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    expect(posted()).toBe(before);
  });

  test('l’aperçu annonce la date à laquelle l’échéance retombe', async () => {
    await boot();
    type('Appel demain 14h');
    await settle();

    const resolved = document.querySelector('#quick-preview .chip[data-type="resolved"]');
    expect(resolved).toBeTruthy();
    expect(resolved.textContent).toContain('Demain');
  });

  test('un titre réduit aux étiquettes est refusé à voix haute', async () => {
    await boot();
    type('#Perso !haute');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    expect(document.querySelectorAll('#toast-container .toast').length).toBeGreaterThan(0);
    expect(document.activeElement.id).toBe('task-title');
  });

  test('une catégorie choisie à la souris l’emporte aussi', async () => {
    await boot();
    document.getElementById('task-category').value = 'Perso';
    type('Courses #Divers');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    const call = server.calls.find((c) => c.method === 'POST' && c.url === '/tasks');
    expect(call.body.category).toBe('Perso');
  });

  test('créer une tâche ne réinitialise pas le tri', async () => {
    await boot();
    const sort = document.getElementById('sort-select');
    sort.value = 'dueDate';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    server.calls = [];

    type('Courses');
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    expect(sort.value).toBe('dueDate');
    const url = server.calls.filter((c) => c.url.startsWith('/tasks?')).pop().url;
    expect(new URL(url, 'http://test').searchParams.get('sort')).toBe('dueDate');
  });

  test('un envoi qui échoue laisse l’aperçu intact', async () => {
    await boot();
    type('Dentiste demain');
    await settle();
    const before = document.getElementById('quick-preview').innerHTML;

    server.failNextPost = true;
    document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true }));
    await settle();

    expect(document.getElementById('quick-preview').innerHTML).toBe(before);
    expect(document.getElementById('quick-preview').hidden).toBe(false);
    expect(document.getElementById('task-title').value).toBe('Dentiste demain');
  });
});

describe('corbeille', () => {
  const trashFirstTask = async () => {
    document.querySelector('.task .delete').click();
    await settle();
  };

  test('ouvrir la corbeille liste les tâches supprimées', async () => {
    await boot();
    await trashFirstTask();

    document.getElementById('open-trash').click();
    await settle();

    expect(document.getElementById('trash-modal').classList.contains('active')).toBe(true);
    const rows = [...document.querySelectorAll('#trash-list .trash-title')].map((el) =>
      el.textContent.trim()
    );
    expect(rows).toEqual(['Relire le brief']);
  });

  test('restaurer remet la tâche dans la liste', async () => {
    await boot();
    await trashFirstTask();
    expect(titles()).not.toContain('Relire le brief');

    document.getElementById('open-trash').click();
    await settle();
    document.querySelector('#trash-list .trash-restore').click();
    await settle();

    expect(titles()).toContain('Relire le brief');
  });

  test('purger demande confirmation puis supprime définitivement', async () => {
    await boot();
    await trashFirstTask();

    document.getElementById('open-trash').click();
    await settle();
    document.querySelector('#trash-list .trash-purge').click();
    await settle();

    // premier clic : la ligne passe en mode confirmation, rien n'est envoyé
    expect(server.calls.some((c) => c.url.endsWith('/purge'))).toBe(false);

    document.querySelector('#trash-list .trash-purge').click();
    await settle();

    expect(server.calls.some((c) => c.url.endsWith('/purge'))).toBe(true);
    expect(document.querySelectorAll('#trash-list .trash-row')).toHaveLength(0);
  });

  test('une corbeille vide le dit', async () => {
    await boot();
    document.getElementById('open-trash').click();
    await settle();

    expect(document.getElementById('trash-empty').hidden).toBe(false);
  });

  test('purger la dernière ligne ne fait pas perdre le focus', async () => {
    await boot();
    await trashFirstTask();

    document.getElementById('open-trash').click();
    await settle();

    const purge = document.querySelector('#trash-list .trash-purge');
    purge.focus();
    purge.click();
    await settle();
    document.querySelector('#trash-list .trash-purge').click();
    await settle();

    // la ligne focalisée vient d'être détruite : le focus doit rester dans la
    // modale, pas retomber sur <body>
    expect(document.getElementById('trash-modal').contains(document.activeElement)).toBe(true);
    expect(document.activeElement.id).toBe('close-trash');
  });

  test('ouvrir la corbeille laisse openModal placer le focus', async () => {
    await boot();
    await trashFirstTask();

    document.getElementById('open-trash').click();
    await settle();

    // le garde hadFocus ne doit pas détourner le focus initial de openModal
    expect(document.getElementById('trash-modal').contains(document.activeElement)).toBe(true);
  });
});

describe('clavier', () => {
  const press = (key, options = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));

  test('n met le focus sur le champ de saisie', async () => {
    await boot();
    press('n');
    expect(document.activeElement.id).toBe('task-title');
  });

  test('les raccourcis ne se déclenchent pas depuis un champ', async () => {
    await boot();
    const search = document.getElementById('search-input');
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

    expect(document.activeElement.id).toBe('search-input');
  });

  test('j et k déplacent la sélection dans la liste', async () => {
    await boot();
    press('j');
    expect(document.querySelectorAll('.task')[0].classList.contains('is-cursor')).toBe(true);

    press('j');
    expect(document.querySelectorAll('.task')[1].classList.contains('is-cursor')).toBe(true);

    press('k');
    expect(document.querySelectorAll('.task')[0].classList.contains('is-cursor')).toBe(true);
  });

  test('x coche la tâche sous le curseur', async () => {
    await boot();
    press('j');
    press('x');
    await settle();

    const call = server.calls.find((c) => c.method === 'PUT');
    expect(call.body.completed).toBe(true);
  });

  test('Ctrl+K ouvre la palette', async () => {
    await boot();
    press('k', { ctrlKey: true });

    expect(document.getElementById('palette-modal').classList.contains('active')).toBe(true);
  });

  test('la palette filtre ses commandes', async () => {
    await boot();
    press('k', { ctrlKey: true });

    const input = document.getElementById('palette-input');
    input.value = 'retard';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const labels = [...document.querySelectorAll('#palette-list .palette-item')].map((el) =>
      el.textContent.trim()
    );
    expect(labels).toEqual(['Voir : en retard']);
  });

  test('la palette sauvegarde sans dépendre d’un bouton de la page', async () => {
    await boot();
    const clics = [];
    const vraiClic = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function () {
      clics.push({ href: this.getAttribute('href'), download: this.hasAttribute('download') });
    };

    try {
      press('k', { ctrlKey: true });
      const input = document.getElementById('palette-input');
      input.value = 'Sauvegarder';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#palette-list .palette-item').click();
      await settle();
    } finally {
      window.HTMLAnchorElement.prototype.click = vraiClic;
    }

    // le lien vit desormais dans les Réglages, donc nulle part tant qu'ils sont
    // fermés : la commande doit savoir télécharger toute seule
    expect(clics).toEqual([{ href: '/export', download: true }]);
  });

  test('choisir une commande de la palette l’exécute et ferme', async () => {
    await boot();
    press('k', { ctrlKey: true });

    const input = document.getElementById('palette-input');
    input.value = 'retard';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#palette-list .palette-item').click();
    await settle();

    expect(document.getElementById('palette-modal').classList.contains('active')).toBe(false);
    const url = calls()
      .filter((u) => u.startsWith('/tasks?'))
      .pop();
    expect(new URL(url, 'http://test').searchParams.get('due')).toBe('overdue');
  });
});

describe('palette au clavier', () => {
  const press = (key, target) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  /** Ouvre la palette et rend son champ, point de départ de chaque test. */
  const openPalette = async () => {
    await boot();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
    );
    return document.getElementById('palette-input');
  };

  const options = () => [...document.querySelectorAll('#palette-list [role="option"]')];

  test('la première commande est sélectionnée à l’ouverture', async () => {
    await openPalette();
    const rows = options();

    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    expect(rows.slice(1).every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  test('flèche bas et flèche haut déplacent la sélection, avec bouclage', async () => {
    const input = await openPalette();
    const last = options().length - 1;

    press('ArrowDown', input);
    expect(options()[1].getAttribute('aria-selected')).toBe('true');

    press('ArrowUp', input);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');

    press('ArrowUp', input); // depuis la première, on boucle vers la dernière
    expect(options()[last].getAttribute('aria-selected')).toBe('true');

    press('ArrowDown', input); // depuis la dernière, on boucle vers la première
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
  });

  test('Entrée exécute la commande sélectionnée et referme la palette', async () => {
    const input = await openPalette();
    press('ArrowDown', input); // sélectionne « Chercher »
    press('Enter', input);

    expect(document.getElementById('palette-modal').classList.contains('active')).toBe(false);
    expect(document.activeElement.id).toBe('search-input');
  });

  test('filtrer remet la sélection sur la première commande de la nouvelle liste', async () => {
    const input = await openPalette();
    press('ArrowDown', input);
    press('ArrowDown', input);
    expect(options()[2].getAttribute('aria-selected')).toBe('true');

    input.value = 'voir';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(options()[0].getAttribute('aria-selected')).toBe('true');
  });

  test('aucun résultat : pas de sélection, et Entrée ne fait rien', async () => {
    const input = await openPalette();
    input.value = 'introuvable';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(options()).toHaveLength(0);

    press('Enter', input);
    expect(document.getElementById('palette-modal').classList.contains('active')).toBe(true);
  });

  test('Échap continue de fermer la palette', async () => {
    const input = await openPalette();
    press('Escape', input);

    expect(document.getElementById('palette-modal').classList.contains('active')).toBe(false);
  });

  test('le clic à la souris fonctionne toujours, même sur une commande non sélectionnée', async () => {
    await openPalette();
    // la sélection clavier pointe toujours la première commande ; on clique la troisième
    document.querySelectorAll('#palette-list .palette-item')[2].click();
    await settle();

    expect(document.getElementById('palette-modal').classList.contains('active')).toBe(false);
    const url = calls()
      .filter((u) => u.startsWith('/tasks?'))
      .pop();
    expect(new URL(url, 'http://test').searchParams.get('due')).toBe('all');
  });

  test('aria-activedescendant pointe l’identifiant de la commande sélectionnée', async () => {
    const input = await openPalette();
    press('ArrowDown', input);
    const selected = options()[1];

    expect(selected.id).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBe(selected.id);
  });
});

describe('étapes', () => {
  test('une tâche qui porte des étapes affiche leur compte', async () => {
    server.tasks = [task('Devis', { childCount: 3, childDone: 1 })];
    await boot();

    expect(document.querySelector('.task-steps-count').textContent).toMatch(/1\s*\/\s*3/);
  });

  test('une tâche sans étape n’affiche pas de compte', async () => {
    server.tasks = [task('Simple', { childCount: 0, childDone: 0 })];
    await boot();

    expect(document.querySelector('.task-steps-count')).toBeNull();
  });

  test('déplier une tâche demande ses étapes et les affiche', async () => {
    server.tasks = [task('Devis', { childCount: 1, childDone: 0 })];
    server.children['id-Devis'] = [task('Verser l’acompte', { parentId: 'id-Devis' })];
    await boot();

    document.querySelector('.task-steps-toggle').click();
    await settle();

    const titres = [...document.querySelectorAll('.step-title')].map((e) => e.textContent.trim());
    expect(titres).toEqual(['Verser l’acompte']);
  });

  test('replier masque les étapes sans les redemander', async () => {
    server.tasks = [task('Devis', { childCount: 1, childDone: 0 })];
    server.children['id-Devis'] = [task('Une', { parentId: 'id-Devis' })];
    await boot();

    document.querySelector('.task-steps-toggle').click();
    await settle();
    const appelsApresOuverture = calls().filter((u) => u.includes('/children')).length;

    document.querySelector('.task-steps-toggle').click();
    await settle();

    expect(document.querySelectorAll('.step-title')).toHaveLength(0);
    expect(calls().filter((u) => u.includes('/children'))).toHaveLength(appelsApresOuverture);
  });
});

describe('récurrence', () => {
  test('une tâche récurrente porte un pictogramme', async () => {
    server.tasks = [
      task('Poubelles', { recurrence: { freq: 'weekly', interval: 1, until: null } }),
    ];
    await boot();

    const marque = document.querySelector('.task-recurrence');
    expect(marque).not.toBeNull();
    expect(marque.getAttribute('title')).toMatch(/semaine/i);
  });

  test('une tâche sans récurrence n’en porte pas', async () => {
    server.tasks = [task('Simple')];
    await boot();

    expect(document.querySelector('.task-recurrence')).toBeNull();
  });

  test('le composeur envoie la récurrence choisie', async () => {
    await boot();

    document.getElementById('task-title').value = 'Poubelles';
    document.getElementById('task-due-date').value = '2026-09-22T09:00';
    document.getElementById('task-recurrence').value = 'weekly';
    document
      .getElementById('task-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const creation = server.calls.find((c) => c.method === 'POST');
    expect(creation.body.recurrence.freq).toBe('weekly');
  });

  test('le champ de récurrence est désactivé tant qu’il n’y a pas d’échéance', async () => {
    await boot();

    const champ = document.getElementById('task-recurrence');
    expect(champ.disabled).toBe(true);

    const date = document.getElementById('task-due-date');
    date.value = '2026-09-22T09:00';
    date.dispatchEvent(new Event('input', { bubbles: true }));

    expect(champ.disabled).toBe(false);
  });
});

describe('rappels', () => {
  test('une tâche avec rappel porte un pictogramme', async () => {
    server.tasks = [task('Dentiste', { reminder: { offset: '1h', at: null, sentAt: null } })];
    await boot();

    const marque = document.querySelector('.task-reminder');
    expect(marque).not.toBeNull();
    expect(marque.getAttribute('title')).toMatch(/heure avant/i);
  });

  test('une tâche sans rappel n’en porte pas', async () => {
    server.tasks = [task('Simple')];
    await boot();

    expect(document.querySelector('.task-reminder')).toBeNull();
  });

  test('le champ de rappel est désactivé tant qu’il n’y a pas d’échéance', async () => {
    await boot();

    const champ = document.getElementById('task-reminder');
    expect(champ.disabled).toBe(true);

    const date = document.getElementById('task-due-date');
    date.value = '2026-09-22T09:00';
    date.dispatchEvent(new Event('input', { bubbles: true }));

    expect(champ.disabled).toBe(false);
  });

  test('le composeur envoie le rappel choisi', async () => {
    await boot();

    document.getElementById('task-title').value = 'Dentiste';
    document.getElementById('task-due-date').value = '2026-09-22T09:00';
    const champ = document.getElementById('task-reminder');
    champ.disabled = false;
    champ.value = '1h';
    document
      .getElementById('task-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    const creation = server.calls.find((c) => c.method === 'POST');
    expect(creation.body.reminder).toEqual({ offset: '1h' });
  });
});

describe('étiquettes à l’écran', () => {
  test('une tâche marquée affiche ses étiquettes', async () => {
    server.tasks = [task('Courses', { tags: ['maison', 'urgent'] })];
    await boot();

    const vues = [...document.querySelectorAll('.task-tag')].map((e) => e.textContent.trim());
    expect(vues).toEqual(['+maison', '+urgent']);
  });

  test('cliquer une étiquette filtre la liste dessus', async () => {
    server.tasks = [task('Courses', { tags: ['maison'] })];
    await boot();
    server.calls = [];

    document.querySelector('.task-tag').click();
    await settle();

    const url = calls()
      .filter((u) => u.startsWith('/tasks?'))
      .pop();
    expect(new URL(url, 'http://test').searchParams.get('tag')).toBe('maison');
  });

  test('une tâche sans étiquette n’affiche rien', async () => {
    server.tasks = [task('Simple')];
    await boot();

    expect(document.querySelector('.task-tag')).toBeNull();
  });
});

describe('glisser-déposer', () => {
  const dragTo = (source, cible) => {
    source.dispatchEvent(new Event('dragstart', { bubbles: true }));
    cible.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    cible.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    source.dispatchEvent(new Event('dragend', { bubbles: true }));
  };

  test('les lignes ne sont saisissables que sous le tri manuel', async () => {
    server.tasks = [task('A'), task('B')];
    await boot();

    expect(document.querySelector('.task').draggable).toBe(false);

    const tri = document.getElementById('sort-select');
    tri.value = 'manual';
    tri.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(document.querySelector('.task').draggable).toBe(true);
  });

  test('déposer une ligne envoie ses voisines au serveur', async () => {
    server.tasks = [task('A'), task('B'), task('C')];
    await boot();
    const tri = document.getElementById('sort-select');
    tri.value = 'manual';
    tri.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    server.calls = [];

    const lignes = document.querySelectorAll('.task');
    dragTo(lignes[2], lignes[0]);
    await settle();

    const appel = server.calls.find((c) => c.method === 'PATCH');
    expect(appel.url).toBe('/tasks/id-C/order');
    // déposé sur la première ligne : il n'y a personne au-dessus
    expect(appel.body).toEqual({ before: null, after: 'id-A' });
  });

  test('déposer une ligne sur elle-même ne demande rien au serveur', async () => {
    server.tasks = [task('A'), task('B')];
    await boot();
    const tri = document.getElementById('sort-select');
    tri.value = 'manual';
    tri.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    server.calls = [];

    const ligne = document.querySelector('.task');
    dragTo(ligne, ligne);
    await settle();

    expect(server.calls.find((c) => c.method === 'PATCH')).toBeUndefined();
  });
});

describe('restauration d’une sauvegarde', () => {
  /** Faux fichier : happy-dom n'a pas de sélecteur de fichiers. */
  const choisirFichier = (contenu) => {
    const champ = document.getElementById('reglages-fichier');
    Object.defineProperty(champ, 'files', {
      configurable: true,
      value: [{ text: async () => contenu }],
    });
    champ.dispatchEvent(new Event('change', { bubbles: true }));
  };

  /** Les deux gestes vivent dans les Réglages : il faut les ouvrir d'abord. */
  const ouvrirReglages = async () => {
    document.getElementById('open-settings').click();
    await settle();
  };

  test('le bouton Restaurer ouvre le sélecteur de fichiers', async () => {
    await boot();
    await ouvrirReglages();
    let ouvert = false;
    document.getElementById('reglages-fichier').click = () => {
      ouvert = true;
    };

    document.getElementById('reglages-restaurer').click();

    expect(ouvert).toBe(true);
  });

  test('« Sauvegarder » télécharge l’export sans passer par un bouton mort', async () => {
    await boot();
    await ouvrirReglages();

    const lien = document.getElementById('reglages-sauvegarder');
    expect(lien.getAttribute('href')).toBe('/export');
    expect(lien.hasAttribute('download')).toBe(true);
  });

  test('choisir une sauvegarde l’envoie en fusion, jamais en remplacement', async () => {
    await boot();
    await ouvrirReglages();
    server.calls = [];

    choisirFichier(
      JSON.stringify({ tasks: [{ title: 'Venue de la sauvegarde' }], categories: [] })
    );
    await settle();

    const envoi = server.calls.find((c) => c.url === '/import');
    expect(envoi).toBeDefined();
    // un bouton qui efface la base à un clic de distance serait un piège
    expect(envoi.body.mode).toBe('merge');
    expect(envoi.body.tasks).toHaveLength(1);
  });

  test('un fichier qui n’est pas une sauvegarde le dit sans planter', async () => {
    await boot();
    await ouvrirReglages();
    server.calls = [];

    choisirFichier('ceci n’est pas du JSON');
    await settle();

    expect(server.calls.find((c) => c.url === '/import')).toBeUndefined();
    expect(document.querySelector('.toast').textContent).toMatch(/sauvegarde du Cahier/i);
  });

  test('rouvrir les réglages ne double pas l’envoi', async () => {
    await boot();
    await ouvrirReglages();
    document.getElementById('close-settings').click();
    // le corps des réglages est réécrit à chaque ouverture : un branchement
    // qui s'accumulerait enverrait la sauvegarde deux fois, puis trois
    await ouvrirReglages();
    server.calls = [];

    choisirFichier(JSON.stringify({ tasks: [], categories: [] }));
    await settle();

    expect(server.calls.filter((c) => c.url === '/import')).toHaveLength(1);
  });
});

describe('page Réglages', () => {
  test('le bouton de l’en-tête ouvre les réglages, remplis de ce qui est enregistré', async () => {
    server.preferences.apparence.densite = 'compact';
    await boot();

    document.getElementById('open-settings').click();
    await settle();

    expect(document.getElementById('settings-modal').classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-reglage="apparence.densite"] select').value).toBe(
      'compact'
    );
  });

  test('changer un réglage l’envoie au serveur', async () => {
    await boot();
    document.getElementById('open-settings').click();
    await settle();
    server.calls = [];

    const select = document.querySelector('[data-reglage="apparence.densite"] select');
    select.value = 'compact';
    select.dispatchEvent(new Event('change'));
    await settle();

    const envoi = server.calls.find((c) => c.url === '/preferences' && c.method === 'PUT');
    expect(envoi.body).toEqual({ apparence: { densite: 'compact' } });
  });

  test('« Fermer » range la page', async () => {
    await boot();
    document.getElementById('open-settings').click();
    await settle();

    document.getElementById('close-settings').click();

    expect(document.getElementById('settings-modal').classList.contains('active')).toBe(false);
  });

  test('la palette sait ouvrir les réglages', async () => {
    await boot();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
    );
    document.getElementById('palette-input').value = 'réglages';
    document.getElementById('palette-input').dispatchEvent(new Event('input'));
    document.querySelector('.palette-item').click();
    await settle();

    expect(document.getElementById('settings-modal').classList.contains('active')).toBe(true);
  });

  test('hors application installée, le bandeau de mise à jour reste rangé', async () => {
    await boot();

    // dans un navigateur, il n'y a pas de version publiée : rien à annoncer
    expect(document.getElementById('maj-banner').hidden).toBe(true);
  });
});

describe('les reglages appliques', () => {
  test('la vue d’ouverture reglee decide de la premiere liste demandee', async () => {
    server.preferences.ouverture = { statut: 'active', horizon: 'week', tri: 'dueDate' };

    await boot();

    const premiere = calls().find((url) => url.startsWith('/tasks?'));
    const params = new URL(premiere, 'http://test').searchParams;
    expect(params.get('status')).toBe('active');
    expect(params.get('due')).toBe('week');
    expect(params.get('sort')).toBe('dueDate');
    // et une seule liste : passer par un clic sur les pastilles en demanderait deux
    expect(calls().filter((url) => url.startsWith('/tasks?'))).toHaveLength(1);
  });

  test('la vue reglee est celle que montrent les pastilles', async () => {
    server.preferences.ouverture = { statut: 'active', horizon: 'week', tri: 'dueDate' };

    await boot();

    expect(document.querySelector('.pill[data-filter="active"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(document.querySelector('.due-pill[data-due="week"]').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(document.getElementById('sort-select').value).toBe('dueDate');
  });

  test('ouvrir sur « en retard » n’ouvre pas aussi sur les taches rayees', async () => {
    server.preferences.ouverture = { statut: 'all', horizon: 'overdue', tri: 'creation' };

    await boot();

    // le retard se lit parmi ce qui reste a faire : les deux reglages sont
    // independants, la page doit les accorder plutot que de les subir
    const premiere = calls().find((url) => url.startsWith('/tasks?'));
    expect(new URL(premiere, 'http://test').searchParams.get('status')).toBe('active');
  });

  test('l’apparence reglee est posee sur la page', async () => {
    server.preferences.apparence = {
      densite: 'compact',
      taille: 'grande',
      grain: false,
      crayon: true,
    };

    await boot();

    expect(document.documentElement.dataset.densite).toBe('compact');
    expect(document.documentElement.dataset.taille).toBe('grande');
    expect(document.documentElement.dataset.grain).toBe('off');
  });

  test('changer l’apparence dans les reglages la pose aussitot', async () => {
    await boot();
    document.getElementById('open-settings').click();
    await settle();

    const select = document.querySelector('[data-reglage="apparence.densite"] select');
    select.value = 'compact';
    select.dispatchEvent(new Event('change'));
    await settle();

    // sans attendre un rechargement de la page
    expect(document.documentElement.dataset.densite).toBe('compact');
  });

  test('l’apparence est retenue pour le lancement suivant', async () => {
    server.preferences.apparence.densite = 'compact';
    await boot();

    expect(JSON.parse(localStorage.getItem('cahier.apparence')).densite).toBe('compact');
  });
});
