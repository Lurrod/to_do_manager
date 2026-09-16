const { sendNotification } = require('../../lib/notify');

describe('sendNotification', () => {
  test('passe le texte par l’environnement, jamais dans le script', async () => {
    const appels = [];
    const faux = (commande, args, options) => {
      appels.push({ commande, args, options });
      return { on: (evt, cb) => evt === 'close' && cb(0) };
    };

    await sendNotification(
      { title: 'Cahier', message: "L'échéance de « Dentiste » approche" },
      faux
    );

    const { args, options } = appels[0];
    // le message contient une apostrophe et des guillemets : s'il était
    // interpolé dans le script, celui-ci ne serait plus valide — et pire,
    // injectable
    expect(args.join(' ')).not.toContain('Dentiste');
    expect(options.env.CAHIER_TITRE).toBe('Cahier');
    expect(options.env.CAHIER_MESSAGE).toBe("L'échéance de « Dentiste » approche");
  });

  test('un échec du canal ne fait pas tomber l’appelant', async () => {
    const faux = () => {
      throw new Error('powershell introuvable');
    };

    await expect(sendNotification({ title: 'a', message: 'b' }, faux)).resolves.toBe(false);
  });

  test('renvoie true quand le canal a rendu la main sans erreur', async () => {
    const faux = () => ({ on: (evt, cb) => evt === 'close' && cb(0) });

    await expect(sendNotification({ title: 'a', message: 'b' }, faux)).resolves.toBe(true);
  });

  test('renvoie false sur un code de sortie non nul', async () => {
    const faux = () => ({ on: (evt, cb) => evt === 'close' && cb(1) });

    await expect(sendNotification({ title: 'a', message: 'b' }, faux)).resolves.toBe(false);
  });
});
