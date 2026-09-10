import { leadIdentity } from './lead-normalization.js';

export function newTargetState(saved) {
  return saved ? structuredClone(saved) : { version: 1, candidates: [], processed: [], results: [], exhausted: false };
}
function cancelled(signal) {
  if (signal?.aborted) {
    const error = new Error('Busca cancelada pelo usuário.'); error.code = 'SEARCH_CANCELLED'; throw error;
  }
}
export function technicalError(message = 'A fonte não confirmou o fim dos resultados.') {
  const error = new Error(`Busca interrompida; quantidade ainda não atingida. ${message} O progresso foi salvo e pode ser retomado.`);
  error.code = 'SEARCH_INTERRUPTED';
  return error;
}

// No total time budget: only the provider can confirm exhaustion. Failed detail
// reads are never marked processed, so a restart can retry them without repeats.
export async function collectToTarget(state, target, { discover, read, checkpoint, onProgress, signal }) {
  if (![50, 100, 150].includes(target)) throw new Error('Quantidade inválida.');
  cancelled(signal);
  if (!state.exhausted) {
    const discovery = await discover();
    cancelled(signal);
    const candidates = new Map(state.candidates.map((item) => [leadIdentity(item), item]));
    for (const item of discovery.candidates) candidates.set(leadIdentity(item), item);
    state.candidates = [...candidates.values()];
    state.exhausted = discovery.exhausted === true;
    await checkpoint(state);
  }
  const processed = new Set(state.processed);
  const results = new Map(state.results.filter((lead) => lead.whatsappPhone).map((lead) => [leadIdentity(lead), lead]));
  let errors = 0;
  for (const item of state.candidates) {
    cancelled(signal);
    if (results.size >= target) break;
    const key = leadIdentity(item);
    if (processed.has(key)) continue;
    let detail;
    try { detail = await read(item); }
    catch (error) {
      cancelled(signal);
      if (error.code === 'SEARCH_CANCELLED') throw error;
      if (!['SCRAPER_DETAILS_FAILED', 'SCRAPER_BROWSER_UNRESPONSIVE'].includes(error.code)) throw error;
      errors++;
      if (error.code === 'SCRAPER_BROWSER_UNRESPONSIVE') throw technicalError('O navegador deixou de responder.');
      continue;
    }
    cancelled(signal);
    processed.add(key);
    if (detail?.whatsappPhone) results.set(leadIdentity(detail), detail);
    state.processed = [...processed];
    state.results = [...results.values()].slice(0, target);
    await checkpoint(state);
    onProgress?.({ phase: 'analyzing', found: state.candidates.length, analyzed: processed.size, remaining: Math.max(0, target - state.results.length) });
  }
  cancelled(signal);
  if (state.results.length >= target) return { results: state.results.slice(0, target), completionReason: 'target_reached' };
  if (errors || state.candidates.some((item) => !processed.has(leadIdentity(item)))) throw technicalError('Há estabelecimentos cujos detalhes não puderam ser carregados.');
  if (!state.exhausted) throw technicalError();
  return { results: state.results, completionReason: 'source_exhausted', warning: `A lista disponibilizada pelo Google Maps para esta pesquisa foi esgotada: ${state.results.length} de ${target} leads com telefone foram encontrados.` };
}
