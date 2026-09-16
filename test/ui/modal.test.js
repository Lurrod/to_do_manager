import { beforeEach, describe, expect, test } from 'vitest';

import { bindBackdrop, closeModal, isModalOpen, openModal } from '../../public/js/modal.js';

const MARKUP = `
  <button id="ouvrir">Modifier</button>
  <div id="modale" class="modal" role="dialog" aria-modal="true">
    <div class="modal-content">
      <input id="titre" />
      <button id="annuler" type="button">Annuler</button>
      <button id="enregistrer" type="button">Enregistrer</button>
    </div>
  </div>`;

const tab = (shiftKey = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));

let modal;
let opener;

beforeEach(() => {
  document.body.innerHTML = MARKUP;
  modal = document.getElementById('modale');
  opener = document.getElementById('ouvrir');
  opener.focus();
});

describe('ouverture', () => {
  test('affiche la boîte et donne le focus au premier champ', () => {
    openModal(modal);

    expect(modal.classList.contains('active')).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('titre'));
    expect(isModalOpen()).toBe(true);
  });
});

describe('piège de focus', () => {
  test('la tabulation depuis le dernier élément revient au premier', () => {
    openModal(modal);
    document.getElementById('enregistrer').focus();

    tab();

    expect(document.activeElement).toBe(document.getElementById('titre'));
  });

  test('Maj+Tab depuis le premier élément va au dernier', () => {
    openModal(modal);
    document.getElementById('titre').focus();

    tab(true);

    expect(document.activeElement).toBe(document.getElementById('enregistrer'));
  });

  test('un focus échappé hors de la boîte y est ramené', () => {
    openModal(modal);
    opener.focus();

    tab();

    expect(modal.contains(document.activeElement)).toBe(true);
  });
});

describe('fermeture', () => {
  test('Échap ferme et rend le focus au bouton d’origine', () => {
    openModal(modal);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(modal.classList.contains('active')).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(isModalOpen()).toBe(false);
  });

  test('la fermeture programmée rend aussi le focus', () => {
    openModal(modal);
    closeModal(modal);

    expect(document.activeElement).toBe(opener);
  });

  test('un clic sur le fond ferme, un clic dans la boîte non', () => {
    bindBackdrop(modal);
    openModal(modal);

    modal.querySelector('.modal-content').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isModalOpen()).toBe(true);

    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isModalOpen()).toBe(false);
  });

  test('la tabulation n’est plus piégée une fois la boîte fermée', () => {
    openModal(modal);
    closeModal(modal);

    opener.focus();
    tab();

    expect(document.activeElement).toBe(opener);
  });
});
