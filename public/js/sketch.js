/* ---------------------------------------------------------------------------
   Couche drawably — tout le chrome dessiné de l'application passe par ici.

   Le HTML déclare ce qu'il veut : data-sketch="card|button|input|…" et, en
   option, data-variant / data-tone / data-stroke. `sketchAll(racine)` attache
   les croquis aux éléments qui n'en ont pas encore, y compris ceux créés à la
   volée par le rendu des tâches.
   --------------------------------------------------------------------------- */

import {
  drawablyBadge,
  drawablyButton,
  drawablyCard,
  drawablyCheckbox,
  drawablyCircle,
  drawablyDivider,
  drawablyHighlight,
  drawablyInput,
  drawablySelect,
  drawablyTextarea,
  drawablyUnderline,
  roughLine,
  roughRoundedRect,
  scribbleFill,
  variants,
  randomSeed,
} from '/vendor/drawably/dist/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ATTACHERS = {
  badge: drawablyBadge,
  button: drawablyButton,
  card: drawablyCard,
  checkbox: drawablyCheckbox,
  circle: drawablyCircle,
  divider: drawablyDivider,
  highlight: drawablyHighlight,
  input: drawablyInput,
  select: drawablySelect,
  textarea: drawablyTextarea,
  underline: drawablyUnderline,
};

/* Les grandes surfaces bougent peu (sinon la page entière frétille) ;
   les petits contrôles gardent le bouillonnement par défaut. */
const DEFAULTS = {
  card: { roughness: 0.85, boil: 0.16 },
  divider: { roughness: 1.1, boil: 0.25 },
  input: { roughness: 0.85, boil: 0.18 },
  textarea: { roughness: 0.85, boil: 0.18 },
  select: { roughness: 0.85, boil: 0.18 },
  badge: { roughness: 0.9, boil: 0.2 },
  circle: { roughness: 1.1, boil: 0.35 },
  underline: { roughness: 1.1, boil: 0.35 },
};

// WeakMap : les éléments recréés à chaque rendu ne sont pas retenus ici
const sketches = new WeakMap();

const optionsFor = (el) => {
  const { variant, tone, marker, stroke, roughness, boil } = el.dataset;
  const opts = {};
  if (variant) opts.variant = variant;
  if (tone) opts.tone = tone;
  if (marker) opts.marker = marker;
  if (stroke) {
    opts.stroke = stroke;
    opts.fill = stroke;
  }
  if (roughness) opts.roughness = Number(roughness);
  if (boil) opts.boil = Number(boil);
  return opts;
};

/** Attache le croquis déclaré par data-sketch. Sans effet si déjà attaché. */
export function sketch(el) {
  const kind = el?.dataset?.sketch;
  const attacher = ATTACHERS[kind];
  if (!attacher || sketches.has(el)) return null;

  try {
    const handle = attacher(el, { ...(DEFAULTS[kind] || {}), ...optionsFor(el) });
    sketches.set(el, handle);
    el.dataset.sketched = kind;
    return handle;
  } catch (error) {
    // le contrôle HTML natif reste utilisable : on perd le trait, pas la fonction
    console.warn(`drawably : « ${kind} » non attaché`, el, error);
    return null;
  }
}

/** Attache tous les croquis d'un sous-arbre (racine incluse). */
export function sketchAll(root = document) {
  if (root instanceof HTMLElement) sketch(root);
  root.querySelectorAll('[data-sketch]').forEach(sketch);
}

/** Détache le croquis d'un élément et nettoie les classes laissées par la lib. */
export function unsketch(el) {
  const handle = sketches.get(el);
  if (!handle) return;
  handle.destroy();
  sketches.delete(el);
  delete el.dataset.sketched;
  [...el.classList]
    .filter((cls) => cls.startsWith('drawably-button--'))
    .forEach((cls) => el.classList.remove(cls));
}

/**
 * Détache tous les croquis d'un sous-arbre. À appeler AVANT de jeter le DOM
 * correspondant : chaque croquis tient un ResizeObserver et des écouteurs de
 * pointeur sur son hôte, qu'il faut libérer explicitement.
 */
export function unsketchAll(root = document) {
  root.querySelectorAll('[data-sketched]').forEach(unsketch);
  if (root instanceof HTMLElement) unsketch(root);
}

/**
 * Redessine un croquis à partir de zéro. Indispensable pour un <select> dont
 * les options ont changé : la lib mesure la plus large une seule fois.
 */
export function resketch(el) {
  unsketch(el);
  return sketch(el);
}

/** Change la variante d'un bouton (survol → trait plein, actif → hachures). */
export function setVariant(el, variant) {
  if (!el || el.dataset.variant === variant) return;
  if (variant) el.dataset.variant = variant;
  else delete el.dataset.variant;
  resketch(el);
}

/**
 * Écrit du texte dans un élément décoré sans emporter son croquis : le SVG est
 * un enfant de l'hôte, un textContent brut l'effacerait.
 */
export function setText(el, text) {
  if (!el) return;
  const svg = el.querySelector(':scope > svg.drawably-svg');
  // conversion explicite : selon le moteur, un 0 passé tel quel devient ''
  el.textContent = text === null || text === undefined ? '' : String(text);
  if (svg) el.prepend(svg);
}

/* ------------------------------ tracés maison ------------------------------
   La lib expose son moteur pour les formes qu'elle ne fournit pas : le trait
   qui raye une tâche faite et la jauge d'avancement hachurée.
   -------------------------------------------------------------------------- */

const createSvg = () => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'drawably-svg');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
};

const paint = (svg, w, h, layers, opts) => {
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.textContent = '';
  for (const layer of layers) {
    const paths = variants(layer.gen, opts, opts.boil ? 3 : 1);
    paths.forEach((d, i) => {
      if (!d) return;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', paths.length > 1 ? `drawably-boil ${layer.className}` : layer.className);
      path.dataset.i = String(i);
      svg.append(path);
    });
  }
};

const hostSvg = (el) => {
  const existing = el.querySelector(':scope > svg.drawably-svg');
  if (existing) return existing;
  el.classList.add('drawably-host');
  const svg = createSvg();
  el.prepend(svg);
  return svg;
};

/** Raye un élément inline d'un trait de stylo (tâche terminée). */
export function strike(el, opts = {}) {
  if (!el || sketches.has(el)) return null;
  el.style.setProperty('--drawably-ink', opts.ink || 'var(--red-pen)');
  el.style.setProperty('--drawably-width', '2');
  const svg = hostSvg(el);
  const seed = opts.seed ?? randomSeed();

  const draw = () => {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;
    // le trait déborde de quelques pixels et retombe : une main ne s'arrête pas pile
    paint(svg, w, h, [
      { className: 'drawably-outline', gen: (o) => roughLine(-3, h * 0.62, w + 3, h * 0.52, o) },
    ], { seed, roughness: 1.3, boil: 0.4 });
  };

  draw();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
  ro?.observe(el);

  const handle = {
    resketch: draw,
    destroy() {
      ro?.disconnect();
      svg.remove();
      el.style.removeProperty('--drawably-ink');
      el.style.removeProperty('--drawably-width');
      el.classList.remove('drawably-host');
    },
  };
  sketches.set(el, handle);
  el.dataset.sketched = 'strike';
  return handle;
}

const seeds = new WeakMap();

/** Jauge d'avancement : cadre au trait, remplissage hachuré. */
export function progress(host, ratio) {
  if (!host) return;
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (!w || !h) return;

  if (!seeds.has(host)) seeds.set(host, randomSeed());
  const seed = seeds.get(host);
  const svg = hostSvg(host);

  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const inset = 4;
  const fillWidth = (w - inset * 2 - 2) * clamped;

  const layers = [
    { className: 'drawably-outline', gen: (o) => roughRoundedRect(2, 2, w - 4, h - 4, 4, o) },
  ];
  if (fillWidth > 3) {
    layers.push({
      className: 'drawably-scribble',
      gen: (o) => scribbleFill(inset + 1, inset + 1, fillWidth, h - inset * 2 - 2, o),
    });
  }

  paint(svg, w, h, layers, { seed, roughness: 0.8, boil: 0.2 });
}
