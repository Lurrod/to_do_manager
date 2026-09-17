/* ---------------------------------------------------------------------------
   Cahier — restauration d'une sauvegarde depuis l'interface.

   Le bouton fusionne, il ne remplace pas : il ajoute ce qui manque et ne
   touche à rien d'existant. Mettre un bouton qui efface la base à un clic de
   distance serait poser un piège ; le remplacement exact reste accessible en
   ligne de commande, où il se demande explicitement.

   Ce module ne sait pas où vivent ses boutons : il reçoit la racine dans
   laquelle les chercher. Les Réglages réécrivent leur corps à chaque
   ouverture, et un branchement fait une fois pour toutes au chargement du
   module ne trouverait rien — ou trouverait les éléments d'avant.

   L'envoi au serveur est injecté lui aussi : ces tests n'ouvrent aucune
   connexion.
   --------------------------------------------------------------------------- */

/**
 * Télécharge la sauvegarde sans passer par un bouton de la page.
 *
 * Le lien vit dans les Réglages, donc nulle part tant qu'ils sont fermés. La
 * palette de commandes, elle, s'ouvre de partout : elle a besoin d'un chemin
 * qui ne suppose aucun élément à l'écran.
 *
 * @param {Document} [doc] injecté pour que les tests n'aient pas à toucher au
 *   document global
 */
export const telechargerSauvegarde = (doc = document) => {
  const lien = doc.createElement('a');
  lien.setAttribute('href', '/export');
  lien.setAttribute('download', '');
  doc.body.appendChild(lien);
  lien.click();
  lien.remove();
};

/**
 * Câble « Restaurer… » dans une racine donnée.
 *
 * @param {object} deps
 * @param {ParentNode} deps.racine où chercher le bouton et le champ fichier
 * @param {(contenu: object) => Promise<{tasks: number}>} deps.importer
 * @param {() => Promise<void>} deps.rafraichir relit la liste après fusion
 * @param {(message: string, variante?: string) => void} deps.toast
 */
export const brancherSauvegarde = ({ racine, importer, rafraichir, toast }) => {
  const bouton = racine.querySelector('#reglages-restaurer');
  const champFichier = racine.querySelector('#reglages-fichier');
  if (!bouton || !champFichier) return;

  bouton.addEventListener('click', () => champFichier.click());

  champFichier.addEventListener('change', async () => {
    const fichier = champFichier.files?.[0];
    // le champ est remis à zéro tout de suite : sans ça, rechoisir le même
    // fichier après un échec ne déclencherait aucun événement
    champFichier.value = '';
    if (!fichier) return;

    try {
      const contenu = JSON.parse(await fichier.text());
      const corps = await importer({ ...contenu, mode: 'merge' });

      toast(`Sauvegarde fusionnée : ${corps.tasks} tâche(s) lue(s).`, 'info');
      await rafraichir();
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? "Ce fichier n'est pas une sauvegarde du Cahier."
          : error.message;
      toast(message, 'error');
    }
  });
};
