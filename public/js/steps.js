/* ---------------------------------------------------------------------------
   Cahier — étapes d'une tâche : rendu de la sous-liste et bascule d'ouverture.
   Ne lit jamais `state` ; le cache ne vit que pour un rendu de liste.
   --------------------------------------------------------------------------- */

import * as api from './api.js';
import { sketchAll, unsketchAll } from './sketch.js';
import { escapeHtml, toast } from './util.js';

/** Étapes déjà chargées, par identifiant de parent. Le dépliage ne demande
    donc le serveur qu'une fois par tâche et par rendu. */
let stepsCache = {};

/** Vide le cache : à appeler en tête de chaque rendu de liste, pour ne pas
    rouvrir sur des étapes périmées. */
export const resetSteps = () => {
  stepsCache = {};
};

const renderSteps = (row, steps) => {
  const liste = document.createElement('ul');
  liste.className = 'step-list';
  steps.forEach((step) => {
    const li = document.createElement('li');
    li.className = `step${step.completed ? ' is-done' : ''}`;
    li.innerHTML = `<span class="step-title">${escapeHtml(step.title)}</span>`;
    liste.appendChild(li);
  });
  row.appendChild(liste);
  sketchAll(liste);
};

export const toggleSteps = async (row, id) => {
  const ouverte = row.querySelector('.step-list');
  if (ouverte) {
    unsketchAll(ouverte);
    ouverte.remove();
    return;
  }

  try {
    if (!stepsCache[id]) {
      const { tasks } = await api.listChildren(id);
      stepsCache[id] = tasks || [];
    }
    renderSteps(row, stepsCache[id]);
  } catch (error) {
    toast(error.message, 'error');
  }
};
