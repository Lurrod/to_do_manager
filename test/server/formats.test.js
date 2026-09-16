const { toMarkdown, toCsv, csvCell } = require('../../lib/formats');

const task = (extra = {}) => ({
  _id: 'id-1',
  title: 'Relire le brief',
  description: '',
  completed: false,
  createdAt: '2026-09-10T08:00:00.000Z',
  dueDate: null,
  category: '',
  priority: '',
  deletedAt: null,
  ...extra,
});

describe('toMarkdown', () => {
  test('groupe par catégorie et coche ce qui est fait', () => {
    const md = toMarkdown([
      task({ title: 'Courses', category: 'Perso' }),
      task({ title: 'Brief', category: 'Travail', completed: true }),
    ]);

    expect(md).toContain('## Perso');
    expect(md).toContain('- [ ] Courses');
    expect(md).toContain('## Travail');
    expect(md).toContain('- [x] Brief');
  });

  test('range les tâches sans catégorie sous un intitulé explicite', () => {
    expect(toMarkdown([task()])).toContain('## Sans catégorie');
  });

  test('affiche l’échéance quand il y en a une', () => {
    const md = toMarkdown([task({ dueDate: '2026-12-25T09:00:00.000Z' })]);
    expect(md).toMatch(/— échéance 2026-12-25/);
  });

  test('laisse la corbeille dehors', () => {
    const md = toMarkdown([task({ title: 'Jetée', deletedAt: '2026-09-15T08:00:00.000Z' })]);
    expect(md).not.toContain('Jetée');
  });
});

describe('csvCell', () => {
  test('entoure de guillemets ce qui contient une virgule, un guillemet ou un saut de ligne', () => {
    expect(csvCell('simple')).toBe('simple');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(csvCell('deux\nlignes')).toBe('"deux\nlignes"');
  });

  test('neutralise une cellule que le tableur exécuterait comme une formule', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+33612345678')).toBe("'+33612345678");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@import')).toBe("'@import");
  });

  test('neutralise aussi une formule précédée d’un blanc de tête', () => {
    expect(csvCell('\t=SUM(A1:A9)')).toBe("'\t=SUM(A1:A9)");
    expect(csvCell('\r=1+1')).toBe("'\r=1+1");
    expect(csvCell('   =1+1')).toBe("'   =1+1");
  });

  test('ne préfixe pas une cellule qui commence par un espace sans déclencheur', () => {
    expect(csvCell(' bonjour')).toBe(' bonjour');
  });
});

describe('toCsv', () => {
  test('écrit un en-tête stable puis une ligne par tâche', () => {
    const lignes = toCsv([task({ title: 'Courses, urgentes' })]).split('\n');

    expect(lignes[0]).toBe(
      'id,title,description,completed,priority,category,dueDate,createdAt,deletedAt'
    );
    expect(lignes[1]).toContain('"Courses, urgentes"');
    expect(lignes).toHaveLength(2);
  });
});
