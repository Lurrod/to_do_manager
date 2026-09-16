import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { deleteTask, listTasks, restoreTask, updateTask } from '../../public/js/api.js';

const ok = (body = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ok({ tasks: [] }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calledUrl = () => new URL(fetch.mock.calls[0][0], 'http://localhost');

describe('listTasks', () => {
  test('envoie tri, filtres et recherche au serveur', async () => {
    await listTasks({
      page: 2,
      limit: 5,
      sort: 'dueDate',
      status: 'done',
      category: 'Boulot',
      q: 'devis',
    });

    const { pathname, searchParams } = calledUrl();
    expect(pathname).toBe('/tasks');
    expect(searchParams.get('page')).toBe('2');
    expect(searchParams.get('sort')).toBe('dueDate');
    expect(searchParams.get('status')).toBe('done');
    expect(searchParams.get('category')).toBe('Boulot');
    expect(searchParams.get('q')).toBe('devis');
  });

  test('omet les paramètres vides plutôt que d’envoyer des chaînes nulles', async () => {
    await listTasks({ page: 1, limit: 5, sort: 'creation', status: 'all', category: 'all', q: '' });

    expect(calledUrl().searchParams.has('q')).toBe(false);
  });

  test('encode les valeurs qui contiennent des caractères spéciaux', async () => {
    await listTasks({ page: 1, q: 'devis (v2) & co' });

    expect(calledUrl().searchParams.get('q')).toBe('devis (v2) & co');
  });
});

describe('mutations', () => {
  test('updateTask envoie un PUT au bon identifiant', async () => {
    await updateTask('abc123', { completed: true });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/tasks/abc123');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ completed: true });
  });

  test('deleteTask et restoreTask visent la corbeille', async () => {
    await deleteTask('abc123');
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');

    fetch.mockClear();
    await restoreTask('abc123');
    expect(fetch.mock.calls[0][0]).toBe('/tasks/abc123/restore');
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('erreurs', () => {
  test('remonte le message d’erreur du serveur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Couleur invalide' }),
      }))
    );

    await expect(listTasks({ page: 1 })).rejects.toThrow('Couleur invalide');
  });

  test('retombe sur le code HTTP quand le corps n’est pas exploitable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('pas du JSON');
        },
      }))
    );

    await expect(listTasks({ page: 1 })).rejects.toThrow('Erreur 500');
  });
});
