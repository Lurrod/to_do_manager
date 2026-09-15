import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import {
  progress,
  setText,
  setVariant,
  sketch,
  sketchAll,
  strike,
  unsketch,
  unsketchAll,
} from '../../public/js/sketch.js';

// l'environnement de test ne fait pas de mise en page : on simule une taille, sinon aucun tracé
// n'est calculé et les assertions ne veulent plus rien dire.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { get: () => 160 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { get: () => 32 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 160 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get: () => 32 });
});

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  unsketchAll(document.body);
});

const svgIn = (el) => el.querySelector(':scope > svg.drawably-svg');

describe('attache et détache', () => {
  test('pose un croquis SVG et marque l’élément', () => {
    document.body.innerHTML = '<button data-sketch="button">Ajouter</button>';
    const button = document.querySelector('button');

    sketch(button);

    expect(svgIn(button)).not.toBeNull();
    expect(button.dataset.sketched).toBe('button');
    expect(button.classList.contains('drawably-button')).toBe(true);
  });

  test('n’attache jamais deux fois le même élément', () => {
    document.body.innerHTML = '<div data-sketch="card"></div>';
    const card = document.querySelector('div');

    sketch(card);
    sketch(card);

    expect(card.querySelectorAll(':scope > svg.drawably-svg')).toHaveLength(1);
  });

  test('unsketch retire le SVG et la marque', () => {
    document.body.innerHTML = '<div data-sketch="card"></div>';
    const card = document.querySelector('div');

    sketch(card);
    unsketch(card);

    expect(svgIn(card)).toBeNull();
    expect(card.dataset.sketched).toBeUndefined();
  });

  test('un type inconnu est ignoré sans jeter', () => {
    document.body.innerHTML = '<div data-sketch="licorne"></div>';
    const el = document.querySelector('div');

    expect(() => sketch(el)).not.toThrow();
    expect(el.dataset.sketched).toBeUndefined();
  });
});

describe('sous-arbres', () => {
  const tree = `
    <ul id="liste">
      <li data-sketch="card">
        <span data-sketch="checkbox"><input type="checkbox" /></span>
        <button data-sketch="button">Modifier</button>
      </li>
      <li data-sketch="card"><span data-sketch="badge">tag</span></li>
    </ul>`;

  test('sketchAll attache tout le sous-arbre', () => {
    document.body.innerHTML = tree;
    sketchAll(document.getElementById('liste'));

    expect(document.querySelectorAll('[data-sketched]')).toHaveLength(5);
  });

  test('unsketchAll libère tout avant que le DOM soit jeté', () => {
    document.body.innerHTML = tree;
    const liste = document.getElementById('liste');
    sketchAll(liste);

    unsketchAll(liste);

    expect(document.querySelectorAll('[data-sketched]')).toHaveLength(0);
    expect(document.querySelectorAll('svg.drawably-svg')).toHaveLength(0);
  });

  test('un élément détaché puis réattaché repart proprement', () => {
    document.body.innerHTML = '<div data-sketch="card"></div>';
    const card = document.querySelector('div');

    sketchAll(document.body);
    unsketchAll(document.body);
    sketchAll(document.body);

    expect(card.querySelectorAll(':scope > svg.drawably-svg')).toHaveLength(1);
  });
});

describe('setText', () => {
  test('remplace le texte sans emporter le croquis', () => {
    document.body.innerHTML = '<b data-sketch="circle">0</b>';
    const counter = document.querySelector('b');
    sketch(counter);

    setText(counter, 42);

    expect(svgIn(counter)).not.toBeNull();
    expect(counter.textContent).toBe('42');
  });

  test('un textContent brut, lui, efface le SVG (le piège que setText évite)', () => {
    document.body.innerHTML = '<b data-sketch="circle">0</b>';
    const counter = document.querySelector('b');
    sketch(counter);

    counter.textContent = '42';

    expect(svgIn(counter)).toBeNull();
  });
});

describe('setVariant', () => {
  test('redessine le bouton avec la nouvelle variante', () => {
    document.body.innerHTML = '<button data-sketch="button">Toutes</button>';
    const pill = document.querySelector('button');
    sketch(pill);

    setVariant(pill, 'solid');

    expect(pill.dataset.variant).toBe('solid');
    expect(pill.classList.contains('drawably-button--solid')).toBe(true);
    expect(pill.classList.contains('drawably-button--outline')).toBe(false);
  });
});

describe('tracés maison', () => {
  test('strike barre le titre et se détache comme les autres croquis', () => {
    document.body.innerHTML = '<span class="task-title">Fini</span>';
    const title = document.querySelector('.task-title');

    strike(title);

    expect(svgIn(title).querySelectorAll('path').length).toBeGreaterThan(0);
    expect(title.dataset.sketched).toBe('strike');

    unsketchAll(document.body);
    expect(svgIn(title)).toBeNull();
  });

  test('la jauge dessine un cadre, et des hachures dès qu’il y a de l’avancement', () => {
    document.body.innerHTML = '<div id="jauge"></div>';
    const track = document.getElementById('jauge');

    progress(track, 0);
    const emptyPaths = svgIn(track).querySelectorAll('path').length;

    progress(track, 0.75);
    const filledPaths = svgIn(track).querySelectorAll('path').length;

    expect(emptyPaths).toBeGreaterThan(0);
    expect(filledPaths).toBeGreaterThan(emptyPaths);
  });
});
