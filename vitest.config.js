import { fileURLToPath } from 'node:url';

export default {
  test: {
    environment: 'happy-dom',
    include: ['test/ui/**/*.test.js'],
  },
  resolve: {
    alias: {
      // le navigateur charge drawably depuis /vendor/drawably (servi par Express) ;
      // en test, on pointe directement sur le paquet
      '/vendor/drawably': fileURLToPath(new URL('./node_modules/drawably', import.meta.url)),
    },
  },
};
