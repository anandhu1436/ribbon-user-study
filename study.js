import { patterns, deformations, makePattern, randomGenerator } from './geometry.js';

export function createTrials(seed) {
  const random = randomGenerator(seed);
  const shuffled = items => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  };
  const assignments = shuffled(Array.from({ length: 16 }, (_, index) => index < 8));
  const comparisons = shuffled(patterns.flatMap((pattern, patternIndex) => deformations.map(condition => ({
    id: `preference-${pattern.id}-${condition.id}`, stage: 'preference', pattern: pattern.id, condition: condition.id, seed: 2087 + patternIndex * 101
  })))).map((trial, index) => ({ ...trial, mapping: assignments[index] ? { A: 'direct', B: 'adapted' } : { A: 'adapted', B: 'direct' } }));
  const conditions = shuffled(deformations);
  const drawings = shuffled(patterns.map((pattern, index) => ({
    id: `drawing-${pattern.id}`, stage: 'drawing', simple: true, pattern: pattern.id, condition: conditions[index].id, seed: seed + index * 101
  })));
  return [...comparisons, ...drawings];
}

export function trialSource(trial) {
  const strokes = makePattern(trial.pattern, trial.seed, 5);
  if (!trial.simple) return strokes;
  const count = { flowing: 6, slanted: 8, bent: 8, staggered: 6 }[trial.pattern];
  return Array.from({ length: count }, (_, index) => strokes[Math.round(index * (strokes.length - 1) / (count - 1))]);
}

export function preferenceResult(trial, choice) {
  if (!['A', 'B', 'tie'].includes(choice)) throw new Error('Select A, B, or no preference.');
  return { chosenLabel: choice, chosenMethod: choice === 'tie' ? null : trial.mapping[choice], mapping: { ...trial.mapping } };
}

export function restoreState(saved, fallback) {
  if (![1, 2].includes(saved?.version) || !saved.lab || !Array.isArray(saved.sessions)) return fallback;
  if (saved.version === 1 && saved.active) saved.active.trials.forEach(trial => { trial.stage = 'drawing'; });
  saved.version = 2;
  return saved;
}
