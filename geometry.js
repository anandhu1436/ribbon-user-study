export const patterns = [
  { id: 'flowing', name: 'Flowing bands', detail: 'Long, gently curved ribbons' },
  { id: 'slanted', name: 'Slanted bands', detail: 'Unevenly spaced, single direction' },
  { id: 'bent', name: 'Bent dashes', detail: 'Short strokes with a soft corner' },
  { id: 'staggered', name: 'Staggered bands', detail: 'Broken lengths, shared direction' }
];
export const deformations = [
  { id: 'shorten', name: 'Shorten', instruction: 'The tube becomes shorter, keeping its thickness.' },
  { id: 'stretch', name: 'Lengthen', instruction: 'The tube becomes longer, keeping its thickness.' },
  { id: 'pinch', name: 'Squeeze', instruction: 'The middle becomes narrower; the ends stay in place.' },
  { id: 'bend', name: 'Bend further', instruction: 'The tube bends further, keeping its centreline length.' }
];
export function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => { value = (1664525 * value + 1013904223) >>> 0; return value / 4294967296; };
}
export function model(kind = 'rest', amount = 0, shape = 'bent') {
  return { kind, amount, shape, length: 250 * (kind === 'shorten' ? 1 - .44 * amount : kind === 'stretch' ? 1 + .55 * amount : 1), angle: (shape === 'straight' ? .001 : 1.55) + (kind === 'bend' ? 1.25 * amount : 0) };
}
export function radiusAt(station, geometry) {
  return 32 * (geometry.kind === 'pinch' ? 1 - .58 * geometry.amount * Math.exp(-Math.pow((station - .51) / .19, 4)) : 1);
}
export function project(point, geometry) {
  const [station, transverse] = point;
  const theta = geometry.angle * station;
  const radius = radiusAt(station, geometry);
  const distance = geometry.length / geometry.angle;
  const depth = .28 * Math.sqrt(Math.max(0, 1 - transverse * transverse));
  return [distance * Math.sin(theta) + radius * (transverse * Math.sin(theta) + depth * Math.cos(theta)), distance * (Math.cos(theta) - 1) + radius * (transverse * Math.cos(theta) - depth * Math.sin(theta))];
}
export function outline(geometry) {
  const points = [];
  for (let step = 0; step <= 100; step++) points.push(project([step / 100, -1], geometry));
  for (let step = 0; step <= 40; step++) points.push(project([1, -1 + step / 20], geometry));
  for (let step = 100; step >= 0; step--) points.push(project([step / 100, 1], geometry));
  for (let step = 40; step >= 0; step--) points.push(project([0, -1 + step / 20], geometry));
  return points;
}
export function view(geometry) {
  const boundary = outline(geometry);
  const horizontal = boundary.map(point => point[0]);
  const vertical = boundary.map(point => point[1]);
  return { center: [(Math.min(...horizontal) + Math.max(...horizontal)) / 2, (Math.min(...vertical) + Math.max(...vertical)) / 2], scale: 1.35 };
}
export function screen(point, geometry, viewport = view(geometry)) {
  const projected = project(point, geometry);
  return [250 + (projected[0] - viewport.center[0]) * viewport.scale, 220 + (projected[1] - viewport.center[1]) * viewport.scale];
}
export function invert(point, geometry) {
  const viewport = view(geometry);
  let best = [0, 0];
  let distance = Infinity;
  const consider = (station, transverse) => {
    const candidate = [Math.max(.012, Math.min(.988, station)), Math.max(-.96, Math.min(.96, transverse))];
    const mapped = screen(candidate, geometry, viewport);
    const error = Math.hypot(mapped[0] - point[0], mapped[1] - point[1]);
    if (error < distance) { best = candidate; distance = error; }
  };
  for (let axial = 0; axial <= 40; axial++) for (let lateral = 0; lateral <= 20; lateral++) consider(axial / 40, -1 + lateral / 10);
  let axialStep = .025;
  let lateralStep = .1;
  for (let iteration = 0; iteration < 9; iteration++) {
    const center = [...best];
    for (const axial of [-1, 0, 1]) for (const lateral of [-1, 0, 1]) consider(center[0] + axial * axialStep, center[1] + lateral * lateralStep);
    axialStep *= .5; lateralStep *= .5;
  }
  return distance < 5 ? best : null;
}
function positions(count, random) {
  const gaps = Array.from({ length: count + 1 }, () => .55 + random() * 1.35);
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  let running = 0;
  return gaps.slice(0, -1).map(gap => (running += gap) / total);
}
export function makePattern(kind, seed = 2087, width = 5) {
  const random = randomGenerator(seed);
  const strokes = [];
  const push = (family, rank, points) => strokes.push({ id: `${kind}-${strokes.length}`, family, rank, width, points: points.filter(point => point[0] > .025 && point[0] < .975 && Math.abs(point[1]) < .91) });
  if (kind === 'flowing' || kind === 'staggered') {
    const centers = positions(kind === 'flowing' ? 8 : 7, random).map(value => -.9 + 1.8 * value);
    const sections = kind === 'flowing' ? [[.07, .94]] : [[.06, .31], [.38, .64], [.71, .95]];
    sections.forEach(([start, end], section) => centers.forEach((center, index) => {
      const low = start + random() * .025;
      const high = end - random() * .035;
      push(`long-${section}`, index, Array.from({ length: 60 }, (_, step) => {
        const station = low + (high - low) * step / 59;
        return [station, center + .045 * Math.sin(8 * station + .8) + .018 * Math.sin(19 * station)];
      }));
    }));
  } else {
    const lanes = kind === 'bent' ? [-.6, 0, .6] : [0];
    lanes.forEach((lane, laneIndex) => positions(kind === 'bent' ? 12 : 20, random).forEach((position, index) => {
      const anchor = .06 + .87 * position;
      const extent = kind === 'bent' ? .21 + random() * .035 : .76 + random() * .06;
      push(`across-${laneIndex}`, index, Array.from({ length: 48 }, (_, step) => {
        const lateral = -extent + 2 * extent * step / 47;
        const offset = kind === 'bent' ? .08 * lateral + .12 * (Math.sqrt(lateral * lateral + .002) - .045) : .075 * lateral + .018 * Math.sin(3 * lateral);
        return [anchor + offset, lane + lateral];
      }));
    }));
  }
  return strokes.filter(stroke => stroke.points.length > 3);
}
function perpendicularGap(left, right, geometry) {
  let total = 0;
  for (let step = 2; step < 18; step++) {
    const leftIndex = Math.round(step / 20 * (left.points.length - 1));
    const rightIndex = Math.round(step / 20 * (right.points.length - 1));
    const first = project(left.points[leftIndex], geometry);
    const second = project(right.points[rightIndex], geometry);
    const before = project(left.points[Math.max(0, leftIndex - 1)], geometry);
    const after = project(left.points[Math.min(left.points.length - 1, leftIndex + 1)], geometry);
    const tangent = [after[0] - before[0], after[1] - before[1]];
    total += Math.abs((second[0] - first[0]) * tangent[1] - (second[1] - first[1]) * tangent[0]) / Math.max(.001, Math.hypot(...tangent));
  }
  return total / 16;
}
function interpolateStroke(left, right, blend, identifier) {
  return { ...left, id: identifier, generated: true, rank: left.rank * (1 - blend) + right.rank * blend, points: Array.from({ length: 60 }, (_, step) => {
    const first = left.points[Math.round(step / 59 * (left.points.length - 1))];
    const second = right.points[Math.round(step / 59 * (right.points.length - 1))];
    return first.map((coordinate, axis) => coordinate * (1 - blend) + second[axis] * blend);
  }) };
}
export function adaptLegacy(strokes, geometry, reference) {
  const families = new Map();
  for (const stroke of strokes) {
    if (!families.has(stroke.family)) families.set(stroke.family, []);
    families.get(stroke.family).push(stroke);
  }
  const output = [];
  let added = 0;
  let removed = 0;
  for (const family of families.values()) {
    family.sort((left, right) => left.rank - right.rank);
    const retained = [];
    let insertionBudget = .5;
    let removalBudget = 0;
    for (let index = 0; index < family.length; index++) {
      const current = family[index];
      const previous = family[index - 1];
      const referenceGap = previous ? perpendicularGap(previous, current, reference) : 0;
      const ratio = referenceGap > .01 ? perpendicularGap(previous, current, geometry) / referenceGap : 1;
      if (ratio < .74) removalBudget += 1 - ratio;
      if (removalBudget >= 1 && index < family.length - 1) { removalBudget -= 1; removed++; continue; }
      retained.push(current);
      if (previous && ratio > 1.25) {
        insertionBudget += ratio - 1;
        const number = Math.min(3, Math.floor(insertionBudget));
        insertionBudget -= number;
        for (let sample = 1; sample <= number; sample++) {
          retained.push(interpolateStroke(previous, current, sample / (number + 1), `added-${current.id}-${sample}`));
          added++;
        }
      }
    }
    output.push(...retained);
  }
  return { strokes: output, added, removed };
}
function sampleStroke(stroke, fraction) {
  const location = fraction * (stroke.points.length - 1);
  const index = Math.min(stroke.points.length - 2, Math.floor(location));
  const blend = location - index;
  return stroke.points[index].map((coordinate, axis) => coordinate * (1 - blend) + stroke.points[index + 1][axis] * blend);
}
function localGap(left, right, fraction, geometry) {
  const first = project(sampleStroke(left, fraction), geometry);
  const second = project(sampleStroke(right, fraction), geometry);
  const before = project(sampleStroke(left, Math.max(0, fraction - .01)), geometry);
  const after = project(sampleStroke(left, Math.min(1, fraction + .01)), geometry);
  const tangent = [after[0] - before[0], after[1] - before[1]];
  return Math.abs((second[0] - first[0]) * tangent[1] - (second[1] - first[1]) * tangent[0]) / Math.max(.001, Math.hypot(...tangent));
}
export function adapt(strokes, geometry, reference) {
  const families = new Map();
  for (const stroke of strokes) {
    const key = stroke.family ?? stroke.id;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(stroke);
  }
  const output = [];
  let adjusted = false;
  let maximumSpacingChange = 0;
  for (const family of families.values()) {
    family.sort((left, right) => left.rank - right.rank);
    if (family.length < 2) { output.push(...family); continue; }
    const sampleCount = 81;
    let ratios = Array.from({ length: sampleCount }, (_, step) => family.slice(1).map((right, index) => {
      const fraction = step / (sampleCount - 1);
      const restGap = localGap(family[index], right, fraction, reference);
      return restGap > .05 ? Math.max(.2, Math.min(3, localGap(family[index], right, fraction, geometry) / restGap)) : 1;
    }));
    const longitudinal = family.every(stroke => {
      const first = stroke.points[0], last = stroke.points[stroke.points.length - 1];
      return Math.abs(last[0] - first[0]) * reference.length > 2 * Math.abs(last[1] - first[1]) * 32;
    });
    if (!longitudinal) {
      const interior = ratios.slice(8, -8);
      const averages = ratios[0].map((value, index) => interior.reduce((sum, section) => sum + section[index], 0) / interior.length);
      ratios = ratios.map(() => averages);
    }
    const change = Math.max(...ratios.flat().map(ratio => Math.abs(ratio - 1)));
    maximumSpacingChange = Math.max(maximumSpacingChange, change);
    if (change <= .08) { output.push(...family); continue; }
    adjusted = true;
    const sections = ratios.map((values, step) => {
      const phases = [0];
      values.forEach((value, index) => {
        const nearby = ratios.slice(Math.max(0, step - 2), Math.min(sampleCount, step + 3));
        const ratio = nearby.reduce((sum, section) => sum + section[index], 0) / nearby.length;
        const correction = Math.sign(ratio - 1) * Math.max(0, Math.abs(ratio - 1) - .05);
        phases.push(phases[phases.length - 1] + 1 + correction);
      });
      const offset = (family.length - 1 - phases[phases.length - 1]) / 2;
      return phases.map(phase => phase + offset);
    });
    const firstLevel = Math.ceil(Math.min(...sections.map(section => section[0])));
    const lastLevel = Math.floor(Math.max(...sections.map(section => section[section.length - 1])));
    for (let level = firstLevel; level <= lastLevel; level++) {
      let points = [];
      let startStep = 0;
      let fragment = 0;
      const finish = endStep => {
        if (points.length >= 3) output.push({ ...family[Math.max(0, Math.min(family.length - 1, level))], id: `phase-${family[0].id}-${level}-${fragment++}`, rank: level, generated: true, points, taperStart: startStep > 0, taperEnd: endStep < sampleCount - 1 });
        points = [];
      };
      sections.forEach((phases, step) => {
        if (level < phases[0] || level > phases[phases.length - 1]) { finish(step - 1); return; }
        const index = Math.max(1, phases.findIndex(phase => phase >= level));
        const blend = (level - phases[index - 1]) / (phases[index] - phases[index - 1]);
        const left = sampleStroke(family[index - 1], step / (sampleCount - 1));
        const right = sampleStroke(family[index], step / (sampleCount - 1));
        if (!points.length) startStep = step;
        points.push(left.map((coordinate, axis) => coordinate * (1 - blend) + right[axis] * blend));
      });
      finish(sampleCount - 1);
    }
  }
  return { strokes: output, added: Math.max(0, output.length - strokes.length), removed: Math.max(0, strokes.length - output.length), adjusted, maximumSpacingChange, method: 'local-spacing-phase/1' };
}
export function pathData(points, closed = false) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' ') + (closed ? ' Z' : '');
}
export function ribbonPolygon(points, width, taper = {}) {
  if (points.length < 2) return [];
  const left = [], right = [];
  points.forEach((point, index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const tangent = [after[0] - before[0], after[1] - before[1]];
    const norm = Math.max(.001, Math.hypot(...tangent));
    const fade = Math.min(taper.taperStart ? index / 3 : 1, taper.taperEnd ? (points.length - 1 - index) / 3 : 1, 1);
    const half = width * .5 * (index === 0 || index === points.length - 1 ? .72 : 1) * fade;
    left.push([point[0] - tangent[1] / norm * half, point[1] + tangent[0] / norm * half]);
    right.push([point[0] + tangent[1] / norm * half, point[1] - tangent[0] / norm * half]);
  });
  return [...left, ...right.reverse()];
}
export function svgDrawing(geometry, strokes, id, ghost = []) {
  const viewport = view(geometry);
  const translate = point => [250 + (point[0] - viewport.center[0]) * viewport.scale, 220 + (point[1] - viewport.center[1]) * viewport.scale];
  const boundary = pathData(outline(geometry).map(translate), true);
  let markup = `<defs><clipPath id="${id}-clip"><path d="${boundary}"/></clipPath></defs><path d="${boundary}" fill="#f8fafc" stroke="#687c8a" stroke-width="1.6"/>`;
  const strip = (stroke, isGhost) => {
    const points = stroke.points.map(point => screen(point, geometry, viewport));
    return `<path d="${pathData(ribbonPolygon(points, stroke.width, stroke), true)}" fill="${isGhost ? '#a8b6c1' : '#e65443'}" stroke="${isGhost ? 'none' : '#b33b32'}" stroke-width=".55" ${isGhost ? 'opacity=".42"' : ''}/>`;
  };
  markup += `<g clip-path="url(#${id}-clip)">${ghost.map(stroke => strip(stroke, true)).join('')}${strokes.map(stroke => strip(stroke, false)).join('')}</g>`;
  for (const station of [0, 1]) {
    const theta = geometry.angle * station;
    const radius = radiusAt(station, geometry);
    const center = project([station, 0], geometry);
    center[0] -= .28 * radius * Math.cos(theta); center[1] += .28 * radius * Math.sin(theta);
    const ring = Array.from({ length: 65 }, (_, step) => {
      const phi = step / 64 * 2 * Math.PI;
      return translate([center[0] + radius * (Math.cos(phi) * Math.sin(theta) + .28 * Math.sin(phi) * Math.cos(theta)), center[1] + radius * (Math.cos(phi) * Math.cos(theta) - .28 * Math.sin(phi) * Math.sin(theta))]);
    });
    markup += `<path d="${pathData(ring, true)}" fill="none" stroke="#687c8a" stroke-width="1.6"/>`;
  }
  return markup;
}
