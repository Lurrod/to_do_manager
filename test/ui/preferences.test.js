import { describe, expect, test } from 'vitest';

const { initPreferences } = await import('../../public/js/preferences.js');

const DEFAUTS = {
  apparence: { densite: 'confort', taille: 'normale', grain: true, crayon: true },
  ouverture: { statut: 'all', horizon: 'all', tri: 'creation' },
  misesAJour: { prevenir: true },
};

/** Un faux serveur de réglages : il fusionne comme le vrai, section par section. */
const fauxServeur = (depart = DEFAUTS) => ({
  valeurs: depart,
  patchs: [],
  panne: null,
  async lire() {
    if (this.panne) throw this.panne;
    return this.valeurs;
  },
  async ecrire(patch) {
    if (this.panne) throw this.panne;
    this.patchs.push(patch);
    this.valeurs = Object.fromEntries(
      Object.entries(this.valeurs).map(([section, reglages]) => [
        section,
        { ...reglages, ...(patch[section] || {}) },
      ])
    );
    return this.valeurs;
  },
});

const armer = (serveur = fauxServeur()) => ({
  serveur,
  prefs: initPreferences({
    lire: () => serveur.lire(),
    ecrire: (patch) => serveur.ecrire(patch),
  }),
});

describe('magasin de réglages', () => {
  test('avant tout chargement, il ne prétend rien savoir', () => {
    const { prefs } = armer();

    expect(prefs.valeurs()).toBeNull();
  });

  test('charger rend les réglages et prévient les abonnés', async () => {
    const { prefs } = armer();
    const vus = [];
    prefs.surChangement((v) => vus.push(v));

    await prefs.charger();

    expect(prefs.valeurs().apparence.densite).toBe('confort');
    expect(vus).toHaveLength(1);
  });

  test('un serveur injoignable ne casse pas la page', async () => {
    const serveur = fauxServeur();
    serveur.panne = new Error('injoignable');
    const { prefs } = armer(serveur);

    await expect(prefs.charger()).resolves.toBeNull();

    // le Cahier s'ouvre quand même, avec l'apparence par défaut
    expect(prefs.valeurs()).toBeNull();
  });

  test('régler applique tout de suite, puis enregistre', async () => {
    const { prefs, serveur } = armer();
    await prefs.charger();
    const vus = [];
    prefs.surChangement((v) => vus.push(v.apparence.densite));

    await prefs.regler({ apparence: { densite: 'compact' } });

    // l'écran ne doit pas attendre l'aller-retour pour changer
    expect(vus[0]).toBe('compact');
    expect(serveur.patchs).toEqual([{ apparence: { densite: 'compact' } }]);
  });

  test('un enregistrement refusé remet l’écran dans l’état d’avant', async () => {
    const { prefs, serveur } = armer();
    await prefs.charger();
    serveur.panne = new Error('base injoignable');

    await expect(prefs.regler({ apparence: { densite: 'compact' } })).rejects.toThrow();

    // laisser l'écran compact alors que rien n'est enregistré serait mentir
    expect(prefs.valeurs().apparence.densite).toBe('confort');
  });

  test('régler ne touche pas aux sections dont le patch ne parle pas', async () => {
    const { prefs } = armer();
    await prefs.charger();

    await prefs.regler({ ouverture: { tri: 'priority' } });

    expect(prefs.valeurs().ouverture.tri).toBe('priority');
    expect(prefs.valeurs().apparence.densite).toBe('confort');
  });

  test('le serveur a le dernier mot sur ce qui a été enregistré', async () => {
    const serveur = fauxServeur();
    // le vrai serveur retombe sur le défaut quand la valeur ne lui dit rien
    serveur.ecrire = async () => ({
      ...DEFAUTS,
      apparence: { ...DEFAUTS.apparence, densite: 'confort' },
    });
    const { prefs } = armer(serveur);
    await prefs.charger();

    await prefs.regler({ apparence: { densite: 'inconnue' } });

    expect(prefs.valeurs().apparence.densite).toBe('confort');
  });
});
