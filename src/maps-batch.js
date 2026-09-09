import { recordDebugEvent } from './debug-state.js';

// Leave time for saving results before the job's 15-minute hard deadline.
export async function collectDetails(items, read, { signal, onProgress, now = Date.now, budgetMs = 7 * 60 * 1000 } = {}) {
  const deadline = now() + budgetMs;
  const results = [];
  let attempted = 0;
  let failed = 0;
  for (const item of items) {
    if (signal?.aborted) {
      const error = new Error('Busca cancelada pelo usuário.'); error.code = 'SEARCH_CANCELLED'; throw error;
    }
    if (now() >= deadline) break;
    let browserFailed = false;
    try {
      results.push(await read(item));
    } catch (error) {
      if (signal?.aborted || error.code === 'SEARCH_CANCELLED') throw error;
      if (!['SCRAPER_DETAILS_FAILED', 'SCRAPER_BROWSER_UNRESPONSIVE'].includes(error.code)) throw error;
      failed++;
      browserFailed = error.code === 'SCRAPER_BROWSER_UNRESPONSIVE';
      recordDebugEvent(`Detalhes não coletados: ${item.name || 'estabelecimento'} — ${error.message}`);
    }
    attempted++;
    onProgress?.({ phase: 'analyzing', found: items.length, analyzed: attempted, remaining: items.length - attempted });
    if (browserFailed) break;
  }
  if (signal?.aborted) {
    const error = new Error('Busca cancelada pelo usuário.'); error.code = 'SEARCH_CANCELLED'; throw error;
  }
  const pending = items.length - attempted;
  const incomplete = failed + pending;
  const warning = incomplete
    ? `Resultado parcial: ${incomplete} de ${items.length} estabelecimentos ficaram sem análise completa (${failed} com falha e ${pending} não analisados). Os leads com telefone coletados foram salvos.`
    : null;
  if (warning) recordDebugEvent(`Coleta parcial: ${failed} falhas, ${pending} pendentes; ${results.length} detalhes obtidos. Preparando validação e salvamento.`);
  return { results, warning, failed, pending };
}
