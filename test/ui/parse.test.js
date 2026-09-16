import { describe, expect, test } from 'vitest';
import { parseQuickEntry } from '../../public/js/parse.js';

/* Horloge figée : mercredi 16 septembre 2026, 10h00 locales.
   Les assertions portent sur les champs de date locaux, jamais sur la chaîne
   ISO — sinon le fuseau de la machine ferait osciller le test. */
const NOW = new Date(2026, 8, 16, 10, 0, 0);

const parse = (text, categories = []) => parseQuickEntry(text, { now: NOW, categories });

const at = (result) => {
  const d = new Date(result.dueDate);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
};

describe('parseQuickEntry — titre', () => {
  test('sans motif, tout est le titre et rien n’est daté', () => {
    const r = parse('Relire le brief');
    expect(r.title).toBe('Relire le brief');
    expect(r.dueDate).toBeNull();
    expect(r.category).toBe('');
    expect(r.priority).toBe('');
    expect(r.tokens).toEqual([]);
  });

  test('les segments reconnus sortent du titre', () => {
    const r = parse('Dentiste demain 14h #Santé !haute');
    expect(r.title).toBe('Dentiste');
  });

  test('une entrée vide ne casse pas', () => {
    expect(parse('').title).toBe('');
    expect(parseQuickEntry(null, { now: NOW }).title).toBe('');
  });

  test('le titre est tronqué à 120 caractères', () => {
    expect(parse('a'.repeat(200)).title).toHaveLength(120);
  });
});

describe('parseQuickEntry — dates relatives', () => {
  test('demain sans heure tombe à 9h', () => {
    expect(at(parse('Courses demain'))).toEqual([2026, 9, 17, 9, 0]);
  });

  test('après-demain', () => {
    expect(at(parse('Courses après-demain'))).toEqual([2026, 9, 18, 9, 0]);
  });

  test('aujourd’hui garde le jour même', () => {
    expect(at(parse('Courses aujourd’hui'))).toEqual([2026, 9, 16, 9, 0]);
  });

  test('auj est accepté', () => {
    expect(at(parse('Courses auj 18h'))).toEqual([2026, 9, 16, 18, 0]);
  });

  test('dans 3 jours', () => {
    expect(at(parse('Relancer dans 3 jours'))).toEqual([2026, 9, 19, 9, 0]);
  });

  test('dans 2 semaines', () => {
    expect(at(parse('Relancer dans 2 semaines'))).toEqual([2026, 9, 30, 9, 0]);
  });
});

describe('parseQuickEntry — jours de semaine', () => {
  test('mardi vise la prochaine occurrence', () => {
    expect(at(parse('Réunion mardi'))).toEqual([2026, 9, 22, 9, 0]);
  });

  test('le jour courant vise la semaine suivante, jamais aujourd’hui', () => {
    expect(at(parse('Réunion mercredi'))).toEqual([2026, 9, 23, 9, 0]);
  });
});

describe('parseQuickEntry — dates numériques', () => {
  test('jour/mois à venir reste sur l’année en cours', () => {
    expect(at(parse('Facture le 12/11'))).toEqual([2026, 11, 12, 9, 0]);
  });

  test('jour/mois déjà passé bascule sur l’année suivante', () => {
    expect(at(parse('Facture le 12/03'))).toEqual([2027, 3, 12, 9, 0]);
  });

  test('une année explicite est respectée telle quelle', () => {
    expect(at(parse('Facture le 12/03/2027'))).toEqual([2027, 3, 12, 9, 0]);
  });

  test('une date impossible est laissée dans le titre', () => {
    const r = parse('Diviser 31/02');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('Diviser 31/02');
  });
});

describe('parseQuickEntry — heures', () => {
  test('heure et minutes', () => {
    expect(at(parse('Appel demain 14h30'))).toEqual([2026, 9, 17, 14, 30]);
  });

  test('« à 9h » est accepté', () => {
    expect(at(parse('Appel demain à 9h'))).toEqual([2026, 9, 17, 9, 0]);
  });

  test('une heure seule encore à venir désigne aujourd’hui', () => {
    expect(at(parse('Appel 18h'))).toEqual([2026, 9, 16, 18, 0]);
  });

  test('une heure seule déjà passée désigne demain', () => {
    expect(at(parse('Appel 8h'))).toEqual([2026, 9, 17, 8, 0]);
  });

  test('une heure impossible reste dans le titre', () => {
    const r = parse('Compter 42h');
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('Compter 42h');
  });
});

describe('parseQuickEntry — catégorie et priorité', () => {
  test('#catégorie est extraite', () => {
    expect(parse('Vaccin #Santé').category).toBe('Santé');
  });

  test('la casse est recalée sur une catégorie connue', () => {
    expect(parse('Vaccin #sante', ['Santé']).category).toBe('Santé');
  });

  test('une catégorie inconnue est gardée telle quelle', () => {
    expect(parse('Vaccin #Divers', ['Santé']).category).toBe('Divers');
  });

  test('!haute, !moyenne, !basse', () => {
    expect(parse('X !haute').priority).toBe('high');
    expect(parse('X !moyenne').priority).toBe('medium');
    expect(parse('X !basse').priority).toBe('low');
  });

  test('!1 !2 !3 sont des synonymes', () => {
    expect(parse('X !1').priority).toBe('high');
    expect(parse('X !2').priority).toBe('medium');
    expect(parse('X !3').priority).toBe('low');
  });

  test('un ! isolé n’est pas une priorité', () => {
    const r = parse('Bravo !');
    expect(r.priority).toBe('');
    expect(r.title).toBe('Bravo !');
  });
});

describe('parseQuickEntry — aperçu', () => {
  test('les tokens se lisent dans l’ordre où l’utilisateur a tapé', () => {
    const r = parse('Dentiste demain 14h #Santé !haute');
    expect(r.tokens).toEqual([
      { type: 'date', text: 'demain' },
      { type: 'date', text: '14h' },
      { type: 'category', text: '#Santé' },
      { type: 'priority', text: '!haute' },
    ]);
  });
});

describe('parseQuickEntry — ne pas mutiler le titre', () => {
  /* Un motif à moitié consommé laisse un fragment orphelin dans le champ, sous
     les yeux de l'utilisateur. Mieux vaut ne rien reconnaître du tout. */

  test('#12/03 n’est pas une catégorie et ne laisse pas « /03 »', () => {
    const r = parse('Truc #12/03');
    expect(r.title).toBe('Truc #12/03');
    expect(r.category).toBe('');
    expect(r.dueDate).toBeNull();
  });

  test('!1/2 n’est pas une priorité et ne laisse pas « /2 »', () => {
    const r = parse('Truc !1/2');
    expect(r.title).toBe('Truc !1/2');
    expect(r.priority).toBe('');
  });

  test('une catégorie trop longue n’est pas tronquée puis recollée', () => {
    const long = 'a'.repeat(40);
    const r = parse(`Truc #${long} fin`);
    expect(r.title).toBe(`Truc #${long} fin`);
    expect(r.category).toBe('');
  });

  test('« il y a 3h » garde son « a »', () => {
    expect(parse('Reunion il y a 3h').title).toBe('Reunion il y a');
  });

  test('« Le » majuscule est reconnu comme amorce de date', () => {
    const r = parse('Facture Le 12/11');
    expect(r.title).toBe('Facture');
  });
});

describe('parseQuickEntry — divers', () => {
  test('« ce lundi » est accepté', () => {
    expect(at(parse('Réunion ce lundi'))).toEqual([2026, 9, 21, 9, 0]);
  });

  test('une seule catégorie est retenue, la seconde reste dans le titre', () => {
    const r = parse('Truc #Un #Deux');
    expect(r.category).toBe('Un');
    expect(r.title).toBe('Truc #Deux');
  });

  test('l’horloge fournie n’est jamais modifiée', () => {
    const clock = new Date(2026, 8, 16, 10, 0, 0);
    const before = clock.getTime();
    parseQuickEntry('Courses demain 14h', { now: clock });
    expect(clock.getTime()).toBe(before);
  });
});
