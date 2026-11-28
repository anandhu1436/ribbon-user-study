import { patterns, deformations, model, makePattern, adapt, screen, invert, svgDrawing } from './geometry.js';
import { createTrials, trialSource, trialCandidates, preferenceResult, restoreState } from './study.js';
import { studyConfig } from './config.js';
import { submissionEndpoint, sendSession } from './submission.js';

const $ = selector => document.querySelector(selector);
const STORAGE = 'adaptive-ribbons-study-v1';
const clone = value => JSON.parse(JSON.stringify(value));
const initial = { version: 2, lab: { pattern: 'bent', condition: 'shorten', amount: .85, width: 5, shape: 'bent', adapted: false, edit: false, custom: null }, sessions: [], active: null };
let state = clone(initial);
let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  state = restoreState(saved, state);
} catch { storageAvailable = false; }
let mode = 'study';
let tool = 'draw';
let undoStack = [];
let redoStack = [];
let gesture = null;
let activeStroke = null;
let toastTimer;
let endpoint = '';
let endpointError = '';
try { endpoint = submissionEndpoint(studyConfig.submissionUrl); } catch (error) { endpointError = error.message; }
const uploading = new Set();
const endSessionButton = document.createElement('button');
endSessionButton.id = 'end-session';
endSessionButton.className = 'quiet full';
endSessionButton.textContent = 'End session early';
$('#study-controls').append(endSessionButton);
$('#study-tab').textContent = 'User study';
$('#study-controls .eyebrow').textContent = 'CHOOSE, THEN DRAW';
$('#study-controls h2').textContent = 'Two short stages';
$('#study-controls .hint').textContent = 'First choose between A and B in 16 comparisons. Then draw four simple patterns with only 6–8 reference ribbons.';
$('#start-study').textContent = 'Start two-stage study';
$('#start-study').insertAdjacentHTML('beforebegin', '<label id="upload-consent-label" class="check" hidden><input id="upload-consent" type="checkbox"> I agree to send my name or participant code, choices, drawings, notes, and timings to the study server when I finish or end early.</label>');
$('.study-footer').insertAdjacentHTML('beforebegin', '<section id="submission-panel" class="submission-panel" aria-label="Response submission"><p id="submission-status" role="status"></p><button id="retry-submission" hidden>Retry upload</button></section>');
$('#upload-consent-label').hidden = !endpoint;
const dataNotice = endpoint ? `With your agreement, your name or participant code, responses, and drawings will be sent to ${new URL(endpoint).origin} when you finish or end early. They are private to the researcher. A copy stays in this browser. Wait for upload confirmation; download JSON as a backup. You may use a pseudonym or participant code instead of your real name. No login or email is required.` : 'Online collection is not configured. Responses stay in this browser; download JSON to share them with the researcher.';
$('#study-introduction > .hint').textContent = dataNotice;
$('#participant').closest('label').firstChild.textContent = 'Name or participant code ';
$('#participant').placeholder = 'Your name, pseudonym, or code';
$('#participant').closest('label').nextElementSibling.textContent = 'No login needed. A pseudonym or participant code is welcome. ' + (endpoint ? 'This study includes private online submission.' : 'Online collection is not yet configured.');
const dataHelp = [...$('#help-dialog').querySelectorAll('h3')].find(heading => heading.textContent === 'Your data');
dataHelp.nextElementSibling.textContent = dataNotice + ' Drawings are stored as stroke coordinates so the researcher can reconstruct and compare them later. Download a backup before clearing browser data.';
const studyHelp = [...$('#help-dialog').querySelectorAll('h3')].find(heading => heading.textContent === 'Drawing study');
studyHelp.textContent = 'Two-stage user study';
studyHelp.nextElementSibling.textContent = 'Stage 1: four patterns × four deformations, shuffled per session. Direct deformation and adaptation appear anonymously as A and B, with balanced randomized positions. Choose either or No preference. Stage 2: four blank-target drawing tasks with only 6–8 reference ribbons, without suggested answers. Drawings may be influenced by the earlier comparisons; this is not an independent unprimed drawing study. Both stages use a bent cylinder, 85% deformation, and fixed ribbon width. No response is labelled correct.';
$('#study-progress').insertAdjacentHTML('afterbegin', '<div id="preference-controls" hidden><p class="hint">Which result do you prefer for this deformation?</p><div class="choice-buttons" role="group" aria-label="Preferred result"><button data-choice="A" aria-pressed="false">Prefer A</button><button data-choice="B" aria-pressed="false">Prefer B</button><button data-choice="tie" aria-pressed="false">No preference</button></div></div>');
$('.canvas-grid').insertAdjacentHTML('beforebegin', `<div id="comparison-grid" hidden>${['Original', 'A', 'B'].map(label => `<section class="canvas-panel"><div class="panel-heading"><h2>${label}</h2></div><svg id="comparison-${label}" viewBox="0 0 500 440" role="img" aria-label="${label === 'Original' ? 'Reference pattern' : `Option ${label}`} tubes"></svg></section>`).join('')}</div><section id="stage-break" hidden><p class="eyebrow">STAGE 1 COMPLETE</p><h2>Now, draw your own answer</h2><p>Four short drawing tasks. Each reference has just 6–8 ribbons. Draw the arrangement you would like on the changed tube; you may add, remove, or reposition ribbons.</p><p>No suggested answers are shown in this stage.</p><button id="begin-drawing" class="primary">Begin drawing stage</button></section>`);

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}
function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); storageAvailable = true; }
  catch { storageAvailable = false; notify('Browser storage unavailable or full. Download JSON to keep your work.'); }
  $('#storage-note').textContent = storageAvailable ? ' · local backup in this browser' : ' · not saved to browser; download now';
}
function renderSubmission() {
  const session = state.sessions.find(item => item.id === state.active?.id);
  const status = session?.submission?.status;
  $('#submission-panel').hidden = mode !== 'study';
  $('#submission-status').textContent = endpointError ? `Online collection configuration error: ${endpointError}` : !endpoint ? 'Online submission is not configured. Download JSON to keep your responses.' : !session ? 'Online collection is enabled. Please read the data notice and agree before starting.' : !session.remoteConsent ? 'This older session is local-only; it will not be uploaded automatically.' : status === 'sent' ? 'Responses and drawings uploaded successfully. You may also download a backup.' : status === 'sending' ? 'Uploading responses and drawings… Please keep this page open.' : status === 'failed' ? `Not uploaded. ${session.submission.error} Your local responses are retained.` : session.finishedAt || session.endedEarlyAt ? 'Responses are saved locally and waiting to upload.' : 'Responses are saved locally during the study and will upload when you finish.';
  $('#retry-submission').hidden = !(session?.remoteConsent?.endpoint === endpoint && (session.finishedAt || session.endedEarlyAt) && status !== 'sent');
  $('#retry-submission').disabled = uploading.has(session?.id);
}
async function uploadSession(session) {
  if (!endpoint || session.remoteConsent?.endpoint !== endpoint || (!session.finishedAt && !session.endedEarlyAt) || session.submission?.status === 'sent' || uploading.has(session.id)) return;
  uploading.add(session.id);
  session.submission = { status: 'sending' }; persist(); renderSubmission();
  try {
    const receipt = await sendSession(session, endpoint);
    session.submission = { status: 'sent', receivedAt: receipt.receivedAt, sessionId: receipt.sessionId };
  } catch (error) { session.submission = { status: 'failed', error: error.message }; }
  finally { uploading.delete(session.id); persist(); renderSubmission(); }
}
$('#retry-submission').onclick = () => { const session = state.sessions.find(item => item.id === state.active?.id); if (session) void uploadSession(session); };
function resumeUploads() { for (const session of state.sessions) void uploadSession(session); }
window.addEventListener('online', resumeUploads);
function currentTrial() { return state.active?.trials[Math.min(state.active.index, state.active.trials.length - 1)]; }
function context() {
  if (mode === 'study' && state.active) {
    const trial = currentTrial();
    const source = trialSource(trial);
    const reference = model('rest');
    const target = model(trial.condition, .85);
    return { source, reference, target, targetStrokes: state.active.draft.strokes, trial, candidates: trialCandidates(trial) };
  }
  const lab = state.lab;
  const source = lab.custom || makePattern(lab.pattern, 2087, lab.width);
  const reference = model('rest', 0, lab.shape);
  const target = model(lab.condition, lab.amount, lab.shape);
  const adapted = adapt(source, target, reference);
  return { source, reference, target, targetStrokes: lab.adapted && !lab.custom ? adapted.strokes : source, adapted };
}
function drawingList() { return mode === 'study' ? state.active.draft.strokes : state.lab.custom; }
function setDrawing(strokes) { if (mode === 'study') state.active.draft.strokes = strokes; else state.lab.custom = strokes; }
function remember() { undoStack.push(clone(drawingList())); if (undoStack.length > 80) undoStack.shift(); redoStack = []; }
function editable(canvas) {
  return mode === 'lab' ? state.lab.edit && canvas.id === 'reference-canvas' : Boolean(state.active && !state.active.finished && !state.active.awaitingDrawing && currentTrial().stage === 'drawing' && canvas.id === 'target-canvas');
}
function drawCanvases() {
  const scene = context();
  if (mode === 'study' && scene.trial?.stage === 'preference') {
    $('#comparison-Original').innerHTML = svgDrawing(scene.reference, scene.source, 'comparison-reference');
    for (const label of ['A', 'B']) $(`#comparison-${label}`).innerHTML = svgDrawing(scene.target, scene.candidates[scene.trial.mapping[label]], `comparison-${label}`);
  }
  $('#reference-canvas').innerHTML = svgDrawing(scene.reference, scene.source, 'reference');
  const targetStrokes = mode === 'study' && !state.active ? [] : scene.targetStrokes;
  $('#target-canvas').innerHTML = svgDrawing(scene.target, targetStrokes, 'target');
  $('#reference-count').textContent = `${scene.source.length} ribbons`;
  $('#target-count').textContent = `${targetStrokes.length} ribbons`;
  for (const canvas of [$('#reference-canvas'), $('#target-canvas')]) {
    canvas.classList.toggle('drawing', editable(canvas));
    canvas.classList.toggle('erasing', editable(canvas) && tool === 'erase');
  }
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
}
function render() {
  const lab = state.lab;
  const inStudy = mode === 'study';
  const running = inStudy && state.active && !state.active.finished;
  const studyHome = inStudy && !running;
  const choosing = Boolean(running && currentTrial().stage === 'preference');
  const stageBreak = Boolean(running && state.active.awaitingDrawing);
  $('#study-introduction').hidden = !studyHome;
  $('.workspace-bar').hidden = studyHome;
  $('.workspace-footer').hidden = studyHome;
  $('#welcome-start').innerHTML = state.active?.finished ? 'Thank you for taking part. Check the submission status below and download a backup. Select <strong>Start another session</strong> for a new participant; previous responses will be kept.' : 'To begin, enter your name or a participant code, agree to submission, and select <strong>Start two-stage study</strong>. No login is required.';
  $('#comparison-grid').hidden = !choosing || stageBreak;
  $('.canvas-grid').hidden = studyHome || choosing || stageBreak;
  $('#stage-break').hidden = !stageBreak;
  $('#preference-controls').hidden = !choosing;
  $('#intentional-empty').closest('label').hidden = choosing;
  $('#study-mode-label').textContent = choosing ? 'Stage 1 · A/B preference' : 'Stage 2 · your drawing';
  $('#export-svg').disabled = stageBreak;
  $('#lab-tab').classList.toggle('active', !inStudy); $('#lab-tab').setAttribute('aria-pressed', String(!inStudy));
  $('#lab-tab').disabled = !studyConfig.patternLabEnabled || Boolean(state.active && !state.active.finished);
  $('#lab-tab').title = studyConfig.patternLabEnabled ? '' : 'Temporarily disabled for the user study';
  $('#study-tab').classList.toggle('active', inStudy); $('#study-tab').setAttribute('aria-pressed', String(inStudy));
  $('#lab-controls').hidden = inStudy; $('#study-controls').hidden = !inStudy;
  $('#result-switch').hidden = inStudy; $('#study-mode-label').hidden = !inStudy;
  $('#drawing-toolbar').hidden = !((running && !choosing && !stageBreak) || (!inStudy && lab.edit));
  $('#heading').textContent = inStudy ? choosing ? 'Which pattern do you prefer?' : running ? 'How would you redraw the ribbons?' : state.active?.finished ? 'Thank you for participating.' : 'Welcome to the user study.' : 'Same surface. A new rhythm.';
  $('#description').textContent = inStudy ? studyHome ? 'Help us understand how people expect ribbon sketches to change when a shape deforms.' : choosing ? 'Compare both results with the original. There is no correct answer.' : 'Preserve what matters to you: density, spacing, rhythm, or individual strokes.' : 'Loosely parallel red ribbons, with irregular spacing and visible width. No crosshatching.';
  $('#workspace-title').textContent = inStudy ? choosing ? 'Compare the changed tube' : 'Participant drawing workspace' : 'Pattern exploration';
  $('#target-overline').textContent = inStudy ? 'YOUR DRAWING' : 'DEFORMED';
  const condition = inStudy && state.active ? currentTrial().condition : lab.condition;
  $('#target-heading').textContent = { shorten: 'Shortened tube', stretch: 'Lengthened tube', pinch: 'Squeezed tube', bend: 'Further-bent tube' }[condition];
  $('#reference-caption').textContent = !inStudy && lab.edit ? 'Draw on this tube to create your own reference pattern.' : 'The starting arrangement stays fixed.';
  $('#target-caption').textContent = inStudy ? running ? 'Draw the pattern you expect. There is no prescribed answer.' : state.active?.finished ? 'Session complete. Download your responses below.' : 'Start a session to draw on the blank target.' : lab.adapted && !lab.custom ? 'A spacing-based proposal: retain, insert, or remove ribbons.' : 'Every original ribbon is carried through the deformation.';
  const scene = context();
  $('#method-note').textContent = inStudy ? choosing ? 'Choose A, B, or No preference. Both options use exactly the same tube deformation.' : 'No suggested answers are shown during drawing. Your drawing is the response.' : lab.custom ? 'Custom reference: direct deformation only. Automatic adaptation is limited to the preset families to avoid connecting unrelated strokes.' : lab.adapted ? `${scene.adapted.added} added · ${scene.adapted.removed} removed. Only matching stroke families are interpolated; separate ribbons are never stitched together.` : 'Switch to Adapt pattern to see an illustrative spacing-based proposal.';
  $('#adapted-button').disabled = Boolean(lab.custom);
  $('#direct-button').classList.toggle('selected', !lab.adapted || Boolean(lab.custom));
  $('#adapted-button').classList.toggle('selected', lab.adapted && !lab.custom);
  $('#direct-button').setAttribute('aria-pressed', String(!lab.adapted || Boolean(lab.custom)));
  $('#adapted-button').setAttribute('aria-pressed', String(lab.adapted && !lab.custom));
  $('#amount').value = lab.amount * 100; $('#amount-label').textContent = `${Math.round(lab.amount * 100)}%`;
  $('#width').value = lab.width; $('#width-label').textContent = `${lab.width} px`;
  $('#shape').value = lab.shape; $('#edit-reference').checked = lab.edit;
  $('#deformation-hint').textContent = deformations.find(item => item.id === lab.condition).instruction;
  document.querySelectorAll('[data-pattern]').forEach(button => { const selected = button.dataset.pattern === lab.pattern; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  document.querySelectorAll('[data-condition]').forEach(button => { const selected = button.dataset.condition === lab.condition; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  $('#start-study').hidden = Boolean(state.active); $('#study-progress').hidden = !running || stageBreak; $('#new-study').hidden = !state.active?.finished;
  endSessionButton.hidden = !running;
  $('#participant').disabled = Boolean(state.active);
  $('#upload-consent').disabled = Boolean(state.active);
  if (state.active) $('#upload-consent').checked = Boolean(state.sessions.find(item => item.id === state.active.id)?.remoteConsent);
  if (state.active) $('#participant').value = state.active.participant;
  if (running) {
    const stageTrials = state.active.trials.filter(trial => trial.stage === currentTrial().stage);
    $('#trial-label').textContent = `${choosing ? 'Comparison' : 'Drawing'} ${stageTrials.indexOf(currentTrial()) + 1} of ${stageTrials.length}`;
    $('#progress').max = state.active.trials.length;
    $('#progress').value = state.active.index;
    $('#study-instruction').textContent = deformations.find(item => item.id === currentTrial().condition).instruction;
    $('#save-next').textContent = state.active.index === state.active.trials.length - 1 ? 'Save & finish' : 'Save & next';
    $('#confidence').value = state.active.draft.confidence;
    $('#notes').value = state.active.draft.notes;
    $('#intentional-empty').checked = state.active.draft.intentionalEmpty;
    document.querySelectorAll('[data-choice]').forEach(button => { const selected = button.dataset.choice === state.active.draft.choice; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  }
  const count = state.sessions.reduce((sum, session) => sum + session.responses.length, 0);
  $('#saved-count').textContent = `${count} response${count === 1 ? '' : 's'} saved`;
  $('#draw-tool').classList.toggle('selected', tool === 'draw'); $('#draw-tool').setAttribute('aria-pressed', String(tool === 'draw'));
  $('#erase-tool').classList.toggle('selected', tool === 'erase'); $('#erase-tool').setAttribute('aria-pressed', String(tool === 'erase'));
  drawCanvases();
  renderSubmission();
}
function switchMode(nextMode) { if (nextMode === 'lab' && (!studyConfig.patternLabEnabled || state.active && !state.active.finished)) return; finishGesture(); mode = nextMode; undoStack = []; redoStack = []; render(); }
$('#lab-tab').onclick = () => switchMode('lab'); $('#study-tab').onclick = () => switchMode('study');
$('#pattern-buttons').innerHTML = patterns.map((pattern, index) => `<button class="pattern-button" data-pattern="${pattern.id}" title="${pattern.detail}"><svg viewBox="0 0 48 34" aria-hidden="true">${Array.from({ length: 4 }, (_, line) => `<path d="M${3 + line * 9},29 Q${8 + line * 9},${index === 2 ? 24 : 15} ${12 + line * 9},4" fill="none" stroke="#da594a" stroke-width="3.1" ${index === 3 ? 'stroke-dasharray="7 3"' : ''}/>`).join('')}</svg><span>${pattern.name}</span></button>`).join('');
$('#deformation-buttons').innerHTML = deformations.map(item => `<button data-condition="${item.id}">${item.name}</button>`).join('');
document.querySelectorAll('[data-pattern]').forEach(button => button.onclick = () => {
  if (state.lab.custom?.length && !confirm('Replace your custom reference with this preset?')) return;
  state.lab.pattern = button.dataset.pattern; state.lab.custom = null; state.lab.edit = false; undoStack = []; redoStack = []; persist(); render();
});
document.querySelectorAll('[data-condition]').forEach(button => button.onclick = () => { state.lab.condition = button.dataset.condition; persist(); render(); });
$('#amount').oninput = event => { state.lab.amount = Number(event.target.value) / 100; drawCanvases(); render(); };
$('#amount').onchange = persist;
$('#width').oninput = event => { state.lab.width = Number(event.target.value); if (state.lab.custom) state.lab.custom.forEach(stroke => stroke.width = state.lab.width); render(); };
$('#width').onchange = persist;
$('#shape').onchange = event => { state.lab.shape = event.target.value; persist(); render(); };
$('#direct-button').onclick = () => { state.lab.adapted = false; persist(); render(); };
$('#adapted-button').onclick = () => { state.lab.adapted = true; persist(); render(); };
$('#edit-reference').onchange = event => {
  state.lab.edit = event.target.checked;
  if (state.lab.edit && !state.lab.custom) state.lab.custom = clone(makePattern(state.lab.pattern, 2087, state.lab.width));
  undoStack = []; redoStack = []; persist(); render();
};
$('#reset-reference').onclick = () => {
  if (state.lab.custom?.length && !confirm('Discard custom reference edits and restore the preset?')) return;
  state.lab.custom = null; state.lab.edit = false; undoStack = []; redoStack = []; persist(); render();
};
function draft() { return { strokes: [], choice: '', notes: '', confidence: '', intentionalEmpty: false, startedAt: new Date().toISOString(), drawingMs: 0 }; }
document.querySelectorAll('[data-choice]').forEach(button => button.onclick = () => {
  if (!state.active || state.active.finished || currentTrial().stage !== 'preference') return;
  state.active.draft.choice = button.dataset.choice; persist(); render();
});
$('#begin-drawing').onclick = () => {
  if (!state.active?.awaitingDrawing || state.active.finished) return;
  state.active.awaitingDrawing = false; state.active.draft = draft(); persist(); render();
};
$('#start-study').onclick = () => {
  if (endpointError) { notify('The submission endpoint needs to be fixed before starting.'); return; }
  if (endpoint && !$('#upload-consent').checked) { notify('Please agree to online submission before starting this study.'); return; }
  const seedArray = new Uint32Array(1); crypto.getRandomValues(seedArray);
  const seed = seedArray[0];
  const trials = createTrials(seed);
  const participant = $('#participant').value.trim() || `P-${seed.toString(36).slice(0, 6)}`;
  const identifier = `session-${Date.now()}-${seed}`;
  state.active = { id: identifier, participant, seed, trials, index: 0, draft: draft(), finished: false };
  state.sessions.push({ id: identifier, protocolVersion: 2, generatorVersion: '1.3.0', participant, seed, trialOrder: clone(trials), startedAt: new Date().toISOString(), responses: [], ...(endpoint ? { remoteConsent: { endpoint, acceptedAt: new Date().toISOString(), noticeVersion: 1 } } : {}) });
  undoStack = []; redoStack = []; tool = 'draw'; persist(); render(); notify('Stage 1: compare A and B, then save your preference.');
};
$('#save-next').onclick = () => {
  if (!state.active || state.active.finished || state.active.awaitingDrawing) return;
  finishGesture();
  const active = state.active;
  const choosing = currentTrial().stage === 'preference';
  if (choosing && !active.draft.choice) { notify('Choose A, B, or No preference before continuing.'); return; }
  if (!choosing && !active.draft.strokes.length && !active.draft.intentionalEmpty) { notify('Draw a pattern, or confirm that you intentionally want no ribbons.'); return; }
  if (!choosing && active.draft.strokes.length && active.draft.intentionalEmpty) { notify('Your drawing contains ribbons. Uncheck “no ribbons” or clear the drawing.'); return; }
  const scene = context();
  const session = state.sessions.find(item => item.id === active.id);
  const answer = choosing ? { ...preferenceResult(currentTrial(), active.draft.choice), candidates: clone(scene.candidates), identicalCandidates: svgDrawing(scene.target, scene.candidates.direct, 'identical') === svgDrawing(scene.target, scene.candidates.adapted, 'identical') } : { drawnStrokes: clone(active.draft.strokes), intentionalEmpty: active.draft.intentionalEmpty };
  session.responses.push({ stage: currentTrial().stage, trial: clone(currentTrial()), trialNumber: active.index + 1, savedAt: new Date().toISOString(), startedAt: active.draft.startedAt, elapsedWallMs: Date.now() - new Date(active.draft.startedAt).getTime(), drawingMs: active.draft.drawingMs, sourceGeometry: scene.reference, targetGeometry: scene.target, originalStrokes: clone(scene.source), ...answer, ribbonWidth: 5, confidence: active.draft.confidence ? Number(active.draft.confidence) : null, notes: active.draft.notes });
  active.index++;
  if (active.index >= active.trials.length) { active.finished = true; session.finishedAt = new Date().toISOString(); notify('Study complete. Check submission status and download a backup.'); }
  else { active.draft = draft(); active.awaitingDrawing = choosing && currentTrial().stage === 'drawing'; if (active.awaitingDrawing) active.draft.startedAt = null; notify('Response saved in this browser.'); }
  undoStack = []; redoStack = []; persist(); render();
  if (active.finished) void uploadSession(session);
};
$('#new-study').onclick = () => { state.active = null; $('#participant').value = ''; $('#upload-consent').checked = false; persist(); render(); };
endSessionButton.onclick = () => {
  if (!state.active || state.active.finished || !confirm('End this session? Saved responses and this unfinished drawing will remain available in the JSON download.')) return;
  finishGesture();
  const session = state.sessions.find(item => item.id === state.active.id);
  session.endedEarlyAt = new Date().toISOString();
  session.unfinishedDraft = { trial: clone(currentTrial()), ...clone(state.active.draft) };
  state.active.finished = true; persist(); render();
  void uploadSession(session);
};
for (const [selector, property] of [['#notes', 'notes'], ['#confidence', 'confidence'], ['#intentional-empty', 'intentionalEmpty']]) {
  $(selector).oninput = event => { if (!state.active) return; state.active.draft[property] = property === 'intentionalEmpty' ? event.target.checked : event.target.value; persist(); };
}
function eventPoint(event, canvas) {
  const point = new DOMPoint(event.clientX, event.clientY);
  return point.matrixTransform(canvas.getScreenCTM().inverse());
}
function distanceToSegment(point, first, second) {
  const delta = [second[0] - first[0], second[1] - first[1]];
  const denominator = delta[0] ** 2 + delta[1] ** 2;
  const blend = denominator ? Math.max(0, Math.min(1, ((point[0] - first[0]) * delta[0] + (point[1] - first[1]) * delta[1]) / denominator)) : 0;
  return Math.hypot(point[0] - first[0] - blend * delta[0], point[1] - first[1] - blend * delta[1]);
}
function erase(point, geometry) {
  let closest = Infinity; let index = -1;
  drawingList().forEach((stroke, strokeIndex) => {
    const points = stroke.points.map(item => screen(item, geometry));
    for (let sample = 1; sample < points.length; sample++) {
      const distance = distanceToSegment(point, points[sample - 1], points[sample]);
      if (distance < closest && distance < stroke.width / 2 + 7) { closest = distance; index = strokeIndex; }
    }
  });
  if (index >= 0) drawingList().splice(index, 1);
}
function appendPointer(event) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const position = eventPoint(event, gesture.canvas);
  const coordinates = [position.x, position.y];
  if (tool === 'erase') { erase(coordinates, gesture.geometry); drawCanvases(); return; }
  const material = invert(coordinates, gesture.geometry);
  if (!material) { activeStroke = null; return; }
  if (!activeStroke) {
    activeStroke = { id: `draw-${Date.now()}-${drawingList().length}`, family: 'manual', rank: drawingList().length, width: mode === 'study' ? 5 : state.lab.width, points: [material] };
    drawingList().push(activeStroke);
  } else {
    const previous = screen(activeStroke.points[activeStroke.points.length - 1], gesture.geometry);
    if (Math.hypot(previous[0] - coordinates[0], previous[1] - coordinates[1]) > 1.3) activeStroke.points.push(material);
  }
  drawCanvases();
}
function finishGesture() {
  if (!gesture) return;
  setDrawing(drawingList().filter(stroke => stroke.points.length > 1));
  if (mode === 'study') state.active.draft.drawingMs += Date.now() - gesture.started;
  if (gesture.canvas.hasPointerCapture(gesture.pointerId)) gesture.canvas.releasePointerCapture(gesture.pointerId);
  gesture = null; activeStroke = null; persist(); drawCanvases();
}
for (const canvas of [$('#reference-canvas'), $('#target-canvas')]) {
  canvas.addEventListener('pointerdown', event => {
    if (!editable(canvas) || gesture || event.button !== 0) return;
    event.preventDefault();
    const scene = context();
    remember();
    gesture = { canvas, pointerId: event.pointerId, geometry: canvas.id === 'reference-canvas' ? scene.reference : scene.target, started: Date.now() };
    canvas.setPointerCapture(event.pointerId);
    appendPointer(event);
  });
  canvas.addEventListener('pointermove', event => { if (gesture?.canvas === canvas) appendPointer(event); });
  canvas.addEventListener('pointerup', finishGesture);
  canvas.addEventListener('pointercancel', finishGesture);
}
$('#draw-tool').onclick = () => { tool = 'draw'; render(); };
$('#erase-tool').onclick = () => { tool = 'erase'; render(); };
$('#undo').onclick = () => { if (!undoStack.length) return; redoStack.push(clone(drawingList())); setDrawing(undoStack.pop()); persist(); drawCanvases(); };
$('#redo').onclick = () => { if (!redoStack.length) return; undoStack.push(clone(drawingList())); setDrawing(redoStack.pop()); persist(); drawCanvases(); };
$('#clear').onclick = () => { if (!drawingList()?.length || !confirm('Clear this drawing? You can undo this action.')) return; remember(); setDrawing([]); persist(); drawCanvases(); };
document.addEventListener('keydown', event => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !$('#drawing-toolbar').hidden) { event.preventDefault(); $(event.shiftKey ? '#redo' : '#undo').click(); }
});
function download(contents, mime, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('#export-json').onclick = () => {
  finishGesture();
  download(JSON.stringify({ schema: 'adaptive-ribbon-study/2', exportedAt: new Date().toISOString(), description: 'Pilot: 16 blinded randomized A/B preferences followed by 4 simplified drawings. chosenMethod records direct/adapted; null means no preference. Each trial records adaptationVersion; missing means legacy whole-ribbon budgets. Existing sessions retain their original stimuli. Coordinates are material [s,u], s in [0,1], u in [-1,1]. Width is in 500x440 SVG viewBox units. elapsedWallMs includes idle time; drawingMs measures pointer gestures. Drawing may be primed by the preceding comparison stage.', generatorVersion: '1.3.0', adaptationSettings: { method: 'local-spacing-phase/2', activation: .08, deadband: .05, samples: 81, bending: { activation: .01, deadband: .005, localWeight: .2, preserveCount: true } }, sessionData: state.sessions, activeDraft: state.active, lab: state.lab }, null, 2), 'application/json', `ribbon-responses-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
};
$('#export-svg').onclick = () => {
  finishGesture(); const scene = context();
  if (mode === 'study' && scene.trial?.stage === 'preference') {
    const panels = ['Original', 'A', 'B'].map((label, index) => `<g transform="translate(${index * 520 + 10},55)"><text x="20" y="-20" font-family="sans-serif" font-size="20">${label}</text>${svgDrawing(label === 'Original' ? scene.reference : scene.target, label === 'Original' ? scene.source : scene.candidates[scene.trial.mapping[label]], `export-${label}`)}</g>`).join('');
    download(`<svg xmlns="http://www.w3.org/2000/svg" width="1560" height="510"><rect width="1560" height="510" fill="white"/>${panels}</svg>`, 'image/svg+xml', `ribbon-comparison-${Date.now()}.svg`); return;
  }
  const right = mode === 'study' && !state.active ? [] : scene.targetStrokes;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="510" viewBox="0 0 1040 510"><title>Original ribbon pattern and deformed result</title><rect width="1040" height="510" fill="white"/><text x="30" y="35" font-family="sans-serif" font-size="20" fill="#263d49">Original pattern</text><text x="550" y="35" font-family="sans-serif" font-size="20" fill="#263d49">${mode === 'study' ? 'Participant drawing' : state.lab.adapted && !state.lab.custom ? 'Adapted proposal' : 'Deformed pattern'}</text><g transform="translate(10,55)">${svgDrawing(scene.reference, scene.source, 'export-reference')}</g><g transform="translate(530,55)">${svgDrawing(scene.target, right, 'export-target')}</g></svg>`;
  download(svg, 'image/svg+xml', `ribbon-pattern-${Date.now()}.svg`);
};
$('#help-button').onclick = () => $('#help-dialog').showModal();
$('#close-help').onclick = () => $('#help-dialog').close();
window.addEventListener('pagehide', () => { finishGesture(); persist(); });
render();
resumeUploads();
if (!storageAvailable) notify('Browser storage could not be loaded. Export your work before leaving.');
