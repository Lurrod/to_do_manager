/* ---------------------------------------------------------------------------
   Accès HTTP. Tri, filtres et recherche sont des paramètres de requête :
   ils portent sur toute la base, pas sur la page affichée.
   --------------------------------------------------------------------------- */

const BASE_URL = '/';

const request = async (path, options = {}) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erreur ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
};

/** Les valeurs vides ne sont pas envoyées : le serveur applique ses défauts. */
const buildQuery = (query) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) params.set(key, value);
  });
  return params;
};

/**
 * @param {{page:number, limit:number, sort:string, status:string, category:string, q:string}} query
 */
export const listTasks = (query) => request(`tasks?${buildQuery(query)}`);

export const fetchStats = () => request('tasks/stats');

export const createTask = (task) =>
  request('tasks', { method: 'POST', body: JSON.stringify(task) });

export const updateTask = (id, patch) =>
  request(`tasks/${id}`, { method: 'PUT', body: JSON.stringify(patch) });

export const deleteTask = (id) => request(`tasks/${id}`, { method: 'DELETE' });

export const restoreTask = (id) => request(`tasks/${id}/restore`, { method: 'POST' });

export const listTrash = (query) => request(`tasks/trash?${buildQuery(query)}`);

export const purgeTask = (id) => request(`tasks/${id}/purge`, { method: 'DELETE' });

/** Étapes d'une tâche. Appelé au dépliage seulement : une liste n'en a pas besoin. */
export const listChildren = (id) => request(`tasks/${id}/children`);

/** Déplace une tâche : le serveur reçoit les voisines, pas un rang. */
export const moveTask = (id, voisines) =>
  request(`tasks/${id}/order`, { method: 'PATCH', body: JSON.stringify(voisines) });

export const listCategories = () => request('categories');

export const createCategory = (name, color) =>
  request('categories', { method: 'POST', body: JSON.stringify({ name, color }) });

export const deleteCategory = (name) =>
  request(`categories/${encodeURIComponent(name)}`, { method: 'DELETE' });

/* --------------------------------------------------------------------------
   Réglages
   -------------------------------------------------------------------------- */

export const fetchPreferences = () => request('preferences');

/** Patch partiel : ce qui n'est pas dit garde sa valeur enregistrée. */
export const savePreferences = (patch) =>
  request('preferences', { method: 'PUT', body: JSON.stringify(patch) });
