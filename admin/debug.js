const form = document.getElementById('filters');
const status = document.getElementById('status');
const labels = { queued: 'Na fila', running: 'Em andamento', completed: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada', starting: 'Iniciando', collecting: 'Coletando', analyzing: 'Analisando' };
let busy = false;
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function memory(value) { return value == null ? 'Indisponível' : `${Math.round(value / 1048576)} MB`; }
async function refresh() {
  if (busy) return;
  busy = true;
  status.textContent = 'Atualizando…';
  try {
    const response = await fetch(`/api/admin/debug?email=${encodeURIComponent(document.getElementById('email').value.trim())}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) {
      if ([401, 403, 404].includes(response.status)) document.getElementById('auto').checked = false;
      throw new Error(response.status === 401 || response.status === 403 ? 'Acesso negado. Entre com a conta do administrador principal.' : 'Não foi possível carregar o diagnóstico.');
    }
    const data = await response.json();
    const metrics = document.getElementById('metrics'); metrics.replaceChildren();
    for (const [label, value] of [['Memória do Node', memory(data.runtime.processMemoryBytes)], ['Memória do contêiner', memory(data.runtime.containerMemoryBytes)], ['Limite do contêiner', memory(data.runtime.containerLimitBytes)], ['Tempo ligado', `${Math.floor(data.runtime.uptimeSeconds / 60)} min`]]) {
      const card = element('article', '', 'metric'); card.append(element('span', label), element('strong', value)); metrics.append(card);
    }
    const jobs = document.getElementById('jobs'); jobs.replaceChildren();
    for (const job of data.jobs) {
      const row = element('tr', '');
      for (const value of [new Date(job.created_at).toLocaleString('pt-BR') + '\n' + job.id, job.email + '\n' + job.query, job.source, (labels[job.status] || job.status) + '\n' + (labels[job.phase] || job.phase), `${job.found} / ${job.analyzed}`, job.error || '—']) row.append(element('td', value));
      jobs.append(row);
    }
    if (!data.jobs.length) { const row = element('tr', ''); const cell = element('td', 'Nenhuma busca encontrada para este filtro.'); cell.colSpan = 6; row.append(cell); jobs.append(row); }
    const events = document.getElementById('events'); events.replaceChildren();
    for (const event of data.events) events.append(element('div', `${new Date(event.at).toLocaleString('pt-BR')} · ${event.email}\n${event.query}\n${event.message}`, 'event'));
    if (!data.events.length) events.append(element('p', 'Nenhum evento registrado para este filtro nesta instância.'));
    status.textContent = `Atualizado às ${new Date(data.at).toLocaleTimeString('pt-BR')} · Node ${data.runtime.node}`;
    status.className = '';
  } catch (error) {
    document.getElementById('jobs').replaceChildren(); document.getElementById('events').replaceChildren(); document.getElementById('metrics').replaceChildren();
    status.textContent = error.message; status.className = 'error';
  } finally { busy = false; }
}
form.addEventListener('submit', (event) => { event.preventDefault(); refresh(); });
setInterval(() => { if (!document.hidden && document.getElementById('auto').checked) refresh(); }, 15000);
refresh();
