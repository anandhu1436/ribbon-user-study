export function submissionEndpoint(value) {
  if (!value) return '';
  const address = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname);
  if ((address.protocol !== 'https:' && !(local && address.protocol === 'http:')) || address.username || address.password || address.hash) throw new Error('Submission URL must use HTTPS (HTTP is allowed only on localhost).');
  return address.href;
}

export function sessionPayload(session) {
  if (!session.finishedAt && !session.endedEarlyAt) throw new Error('Only ended sessions can be submitted.');
  const { id, protocolVersion, participant, seed, trialOrder, startedAt, finishedAt, endedEarlyAt, responses, unfinishedDraft, remoteConsent } = session;
  return { schema: 'adaptive-ribbon-submission/1', generatorVersion: '1.1.0', session: { id, protocolVersion, participant, seed, trialOrder, startedAt, finishedAt, endedEarlyAt, responses, unfinishedDraft, remoteConsent } };
}

export async function sendSession(session, endpoint, request = fetch) {
  const destination = submissionEndpoint(endpoint);
  if (!destination || session.remoteConsent?.endpoint !== destination) throw new Error('This session has not consented to this collection endpoint.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await request(destination, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sessionPayload(session)), signal: controller.signal, credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}). Keep your JSON backup and retry.`);
    const receipt = await response.json();
    if (receipt.sessionId !== session.id || receipt.saved !== true) throw new Error('Server did not confirm this session was saved.');
    return receipt;
  } finally { clearTimeout(timeout); }
}
