import { fileURLToPath } from 'node:url';

export default {
  test: {
    environment: 'happy-dom',
    include: ['test/ui/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      /**
       * Seuils posés juste sous le niveau atteint : ils ne récompensent rien,
       * ils empêchent de redescendre. On les relève quand la mesure les dépasse.
       *
       * Les branches sont à 79 % — sous la barre des 80 % que se donne le
       * projet. C'est une dette connue, pas un oubli.
       *
       * À lire avec une réserve : la mesure ne porte que sur les modules
       * atteints par les tests. Les écrans jamais importés (glisser-déposer,
       * corbeille, palette) ne pèsent pas dans ce pourcentage.
       */
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 88,
      },
    },
  },
  resolve: {
    alias: {
      // le navigateur charge drawably depuis /vendor/drawably (servi par Express) ;
      // en test, on pointe directement sur le paquet
      '/vendor/drawably': fileURLToPath(new URL('./node_modules/drawably', import.meta.url)),
    },
  },
};
