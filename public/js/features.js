(function () {
  const API = window.SevenAPI;
  const UI = window.SevenUI;
  const selectedLeadIds = new Set();
  let currentSearchJobId = null;
  let currentView = 'leads';
  let installEvent = null;

  const statusLabels = {
    novo: 'Novo', contatado: 'Contatado', respondeu: 'Respondeu',
    reuniao: 'Reunião', proposta: 'Proposta', cliente: 'Cliente'
  };

  function openAuth(tab = 'login') {
    document.getElementById('landingScreen')?.classList.add('hidden');
    const auth = document.getElementById('authScreen');
    auth?.classList.remove('hidden');
    auth?.classList.add('flex');
    switchAuthTab(tab);
  }

  function closeAuth() {
    const auth = document.getElementById('authScreen');
    auth?.classList.add('hidden');
    auth?.classList.remove('flex');
    document.getElementById('landingScreen')?.classList.remove('hidden');
  }

  document.querySelectorAll('[data-open-auth]').forEach((button) => button.addEventListener('click', () => openAuth(button.dataset.openAuth)));
  document.querySelectorAll('[data-close-auth]').forEach((button) => button.addEventListener('click', closeAuth));

  async function handleRecoveryLinks() {
    const params = new URLSearchParams(location.search);
    if (params.get('verified')) {
      UI.notify(params.get('verified') === '1' ? 'Seu e-mail foi confirmado.' : 'O link de confirmação é inválido.', params.get('verified') === '1' ? 'success' : 'error');
      history.replaceState({}, '', '/');
    }
    if (params.get('reset')) {
      document.getElementById('forgotPasswordForm').classList.add('hidden');
      document.getElementById('resetPasswordForm').classList.remove('hidden');
      UI.openModal('resetPasswordModal');
    }
  }

  document.getElementById('btnForgotPassword')?.addEventListener('click', () => {
    document.getElementById('forgotPasswordForm').classList.remove('hidden');
    document.getElementById('resetPasswordForm').classList.add('hidden');
    UI.openModal('resetPasswordModal');
  });
  document.getElementById('forgotPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await API.post('/api/auth/forgot-password', { email: document.getElementById('forgotEmail').value });
      UI.notify(data.message, 'success');
      UI.closeModal('resetPasswordModal');
    } catch (error) { UI.notify(error.message, 'error'); }
  });
  document.getElementById('resetPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const token = new URLSearchParams(location.search).get('reset');
      const data = await API.post('/api/auth/reset-password', { token, password: document.getElementById('resetNewPassword').value });
      UI.notify(data.message, 'success');
      UI.closeModal('resetPasswordModal');
      history.replaceState({}, '', '/');
      openAuth('login');
    } catch (error) { UI.notify(error.message, 'error'); }
  });
  document.getElementById('btnAccount')?.addEventListener('click', () => UI.openModal('accountModal'));
  document.getElementById('changePasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await API.post('/api/auth/change-password', {
        currentPassword: document.getElementById('currentPassword').value,
        newPassword: document.getElementById('newPassword').value
      });
      UI.notify(data.message, 'success');
      event.target.reset();
      UI.closeModal('accountModal');
    } catch (error) { UI.notify(error.message, 'error'); }
  });

  function setView(view) {
    currentView = view;
    document.querySelectorAll('.workspace-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    const showLeads = view === 'leads';
    document.getElementById('workspacePanels')?.classList.toggle('hidden', !showLeads);
    document.getElementById('resultsPanel')?.classList.toggle('hidden', !showLeads);
    if (!showLeads) document.getElementById('searchProgress')?.classList.add('hidden');
    document.getElementById('productView')?.classList.toggle('hidden', showLeads);
    if (view === 'history') loadHistory();
    if (view === 'lists') loadLists();
    if (view === 'dashboard') loadDashboard();
    if (view === 'reminders') loadReminders();
  }
  document.querySelectorAll('.workspace-tab').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

  function productShell(title, subtitle, content, action = '') {
    document.getElementById('productView').innerHTML = `<section class="product-card"><div class="product-head"><div><h2>${UI.escapeHtml(title)}</h2><p>${UI.escapeHtml(subtitle)}</p></div>${action}</div>${content}</section>`;
  }

  async function loadHistory() {
    try {
      const { searches } = await API.get('/api/searches');
      const content = searches.length ? `<div class="product-grid">${searches.map((search) => `<article class="history-card"><div><strong>${UI.escapeHtml(search.query)}</strong><p>${new Date(search.createdAt).toLocaleString('pt-BR')} · ${search.totalLeads} leads</p></div><button data-load-search="${UI.escapeHtml(search.id)}">Abrir</button></article>`).join('')}</div>` : empty('Nenhuma pesquisa salva ainda.');
      productShell('Histórico de pesquisas', 'Cada nicho e cidade permanece separado.', content);
      document.querySelectorAll('[data-load-search]').forEach((button) => button.addEventListener('click', () => loadSearch(button.dataset.loadSearch)));
    } catch (error) { productShell('Histórico', '', empty(error.message)); }
  }

  async function loadSearch(searchId) {
    try {
      const data = await API.get(`/api/searches/${encodeURIComponent(searchId)}`);
      leadsData = (data.leads || []).map(normalizeLead);
      selectedLeadIds.clear();
      renderTable();
      setView('leads');
      await verifyWhatsAppNumbers();
      UI.notify(`Pesquisa “${data.search.query}” carregada.`, 'success');
    } catch (error) { UI.notify(error.message, 'error'); }
  }

  async function loadLists() {
    try {
      const { lists } = await API.get('/api/lists');
      const form = `<form id="createListForm" class="admin-filters"><input id="newListName" maxlength="80" placeholder="Ex.: Dentistas de Limeira" required><input id="newListDescription" maxlength="160" placeholder="Descrição opcional"><button type="submit">Criar lista</button></form>`;
      const cards = lists.length ? `<div class="product-grid">${lists.map((list) => `<article class="list-card"><div><strong>${UI.escapeHtml(list.name)}</strong><p>${list.leadCount} leads · ${UI.escapeHtml(list.description || '')}</p></div><div><button data-open-list="${UI.escapeHtml(list.id)}">Abrir</button>${selectedLeadIds.size ? `<button data-add-list="${UI.escapeHtml(list.id)}">+ selecionados</button>` : ''}</div></article>`).join('')}</div>` : empty('Crie sua primeira lista de prospecção.');
      productShell('Listas de prospecção', 'Agrupe oportunidades por cidade, nicho ou campanha.', `${form}<div style="height:14px"></div>${cards}`);
      document.getElementById('createListForm')?.addEventListener('submit', createList);
      document.querySelectorAll('[data-open-list]').forEach((button) => button.addEventListener('click', () => openList(button.dataset.openList)));
      document.querySelectorAll('[data-add-list]').forEach((button) => button.addEventListener('click', () => addSelectedToList(button.dataset.addList)));
    } catch (error) { productShell('Listas', '', empty(error.message)); }
  }

  async function createList(event) {
    event.preventDefault();
    try {
      await API.post('/api/lists', { name: document.getElementById('newListName').value, description: document.getElementById('newListDescription').value });
      UI.notify('Lista criada.', 'success');
      loadLists();
    } catch (error) { UI.notify(error.message, 'error'); }
  }
  async function openList(listId) {
    try {
      const { leads } = await API.get(`/api/leads?listId=${encodeURIComponent(listId)}`);
      leadsData = leads.map(normalizeLead); selectedLeadIds.clear(); renderTable(); setView('leads'); await verifyWhatsAppNumbers();
    } catch (error) { UI.notify(error.message, 'error'); }
  }
  async function addSelectedToList(listId) {
    try {
      await API.post(`/api/lists/${encodeURIComponent(listId)}/leads`, { leadIds: [...selectedLeadIds] });
      UI.notify('Leads adicionados à lista.', 'success');
      selectedLeadIds.clear(); loadLists();
    } catch (error) { UI.notify(error.message, 'error'); }
  }

  async function loadDashboard() {
    try {
      const data = await API.get('/api/dashboard');
      const metrics = `<div class="product-grid"><article class="metric-card"><span>Leads salvos</span><strong>${data.total}</strong></article><article class="metric-card"><span>Contatados</span><strong>${data.contacted}</strong></article><article class="metric-card"><span>Clientes</span><strong>${data.clients}</strong></article><article class="metric-card"><span>Conversão</span><strong>${data.conversionRate}%</strong></article><article class="metric-card"><span>Valor no funil</span><strong>${money(data.pipelineValue)}</strong></article></div>`;
      const max = Math.max(1, ...data.stages.map((item) => item.total));
      const pipeline = `<div class="pipeline-bars">${Object.keys(statusLabels).map((status) => { const item = data.stages.find((stage) => stage.status === status) || { total: 0 }; return `<div class="pipeline-row"><span>${statusLabels[status]}</span><div class="pipeline-track"><div class="pipeline-fill" style="width:${Math.round(item.total / max * 100)}%"></div></div><b>${item.total}</b></div>`; }).join('')}</div>`;
      const top = data.topSearches.length ? `<h3 style="margin:24px 0 10px;font-weight:800">Melhores nichos</h3><div class="product-grid">${data.topSearches.map((item) => `<article class="metric-card"><span>${UI.escapeHtml(item.query)}</span><strong>${item.leads}</strong><small>${item.searches} busca(s)</small></article>`).join('')}</div>` : '';
      productShell('Painel de resultados', 'Contratos, conversão, receita prevista e melhores nichos.', metrics + pipeline + top);
    } catch (error) { productShell('Resultados', '', empty(error.message)); }
  }

  async function loadReminders() {
    try {
      const { reminders } = await API.get('/api/reminders');
      updateReminderBadge(reminders);
      const content = reminders.length ? `<div class="product-grid">${reminders.map((lead) => `<article class="reminder-card"><div><strong>${UI.escapeHtml(lead.name)}</strong><p>${formatFollowUp(lead.nextFollowUp)} · ${statusLabels[lead.status] || lead.status}</p></div><button data-reminder-lead="${UI.escapeHtml(lead.id)}">Abrir lead</button></article>`).join('')}</div>` : empty('Nenhum acompanhamento agendado.');
      productShell('Lembretes de acompanhamento', 'Retome conversas no momento certo.', content);
      document.querySelectorAll('[data-reminder-lead]').forEach((button) => button.addEventListener('click', () => {
        const reminder = reminders.find((lead) => lead.id === button.dataset.reminderLead);
        if (reminder && !leadsData.some((lead) => lead.id === reminder.id)) leadsData.push(normalizeLead(reminder));
        setView('leads');
        renderTable();
        window.openLeadDetails(button.dataset.reminderLead);
      }));
    } catch (error) { productShell('Lembretes', '', empty(error.message)); }
  }

  function updateReminderBadge(reminders) {
    const due = reminders.filter((lead) => new Date(lead.nextFollowUp) <= new Date()).length;
    const badge = document.getElementById('reminderBadge');
    badge.textContent = due;
    badge.classList.toggle('hidden', due === 0);
  }

  function empty(message) { return `<div class="empty-state"><i class="fa-solid fa-layer-group"></i>${UI.escapeHtml(message)}</div>`; }
  function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function formatFollowUp(value) { return value ? new Date(value).toLocaleString('pt-BR') : 'Sem data'; }

  const originalRenderTable = renderTable;
  renderTable = function enhancedRenderTable() {
    originalRenderTable();
    renderMobileCards();
    bindSelectionControls();
  };

  function filteredLeads() {
    return leadsData.filter((item) => {
      if (currentFilter === 'no-site') return !item.hasWebsite;
      if (currentFilter === 'social-only') return item.isSocialMedia;
      if (currentFilter === 'with-site') return item.hasRealWebsite;
      if (currentFilter === 'no-whatsapp') return !item.whatsappPhone;
      return true;
    });
  }

  function renderMobileCards() {
    const container = document.getElementById('leadsCardList');
    if (!container) return;
    const visible = isPaidUser ? filteredLeads() : filteredLeads().slice(0, 5);
    const sourceBadges = {
      google_maps: '<span class="bg-blue-500/15 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium">Maps</span>',
      directories: '<span class="bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium">OSM BR</span>',
      all_world: '<span class="bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium">World</span>'
    };
    container.innerHTML = visible.map((lead) => `<article class="lead-card"><div class="lead-card-head"><div><h3>${UI.escapeHtml(lead.name)}</h3><p>${UI.escapeHtml(lead.address)}</p>${(lead.tags || []).map((tag) => `<span class="tag">${UI.escapeHtml(tag)}</span>`).join('')}</div><input type="checkbox" class="lead-select" data-lead-id="${UI.escapeHtml(lead.id)}" ${selectedLeadIds.has(lead.id) ? 'checked' : ''}></div><p>${statusLabels[lead.status] || 'Novo'} · ${UI.escapeHtml(lead.phone || 'Sem telefone')} ${sourceBadges[lead.source] || ''}</p><div class="lead-card-actions"><button class="wa" onclick="openLeadWhatsApp('${UI.escapeHtml(lead.id)}')" ${!lead.whatsappPhone ? 'disabled title="Telefone não disponível"' : 'title="O número será verificado ao abrir"'}><i class="fa-brands fa-whatsapp"></i> Abrir WhatsApp</button><button onclick="openLeadDetails('${UI.escapeHtml(lead.id)}')"><i class="fa-solid fa-pen"></i></button></div></article>`).join('');
  }

  function bindSelectionControls() {
    document.querySelectorAll('.lead-select').forEach((checkbox) => {
      checkbox.checked = selectedLeadIds.has(checkbox.dataset.leadId);
      checkbox.addEventListener('change', () => {
        checkbox.checked ? selectedLeadIds.add(checkbox.dataset.leadId) : selectedLeadIds.delete(checkbox.dataset.leadId);
        document.querySelectorAll(`.lead-select[data-lead-id="${CSS.escape(checkbox.dataset.leadId)}"]`).forEach((item) => { item.checked = checkbox.checked; });
        updateBulkActions();
      });
    });
    updateBulkActions();
  }
  document.getElementById('selectAllLeads')?.addEventListener('change', (event) => {
    filteredLeads().forEach((lead) => event.target.checked ? selectedLeadIds.add(lead.id) : selectedLeadIds.delete(lead.id));
    renderTable();
  });
  function updateBulkActions() {
    document.getElementById('bulkActions')?.classList.toggle('hidden', selectedLeadIds.size === 0);
    const count = document.getElementById('selectedLeadsCount'); if (count) count.textContent = selectedLeadIds.size;
  }

  window.openLeadDetails = function (leadId) {
    const lead = leadsData.find((item) => item.id === leadId);
    if (!lead) return UI.notify('Lead não encontrado.', 'error');
    document.getElementById('leadDetailsTitle').textContent = lead.name;
    document.getElementById('leadDetailsId').value = lead.id;
    document.getElementById('leadDetailsStatus').value = lead.status;
    document.getElementById('leadNotes').value = lead.notes || '';
    document.getElementById('leadTags').value = (lead.tags || []).join(', ');
    document.getElementById('leadEstimatedValue').value = lead.estimatedValue || '';
    document.getElementById('leadNextFollowUp').value = lead.nextFollowUp ? new Date(lead.nextFollowUp).toISOString().slice(0, 16) : '';
    UI.openModal('leadDetailsModal');
  };
  document.getElementById('leadDetailsForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const leadId = document.getElementById('leadDetailsId').value;
    const lead = leadsData.find((item) => item.id === leadId);
    if (!lead) return;
    const changes = {
      status: document.getElementById('leadDetailsStatus').value,
      notes: document.getElementById('leadNotes').value.trim(),
      tags: document.getElementById('leadTags').value.split(',').map((item) => item.trim()).filter(Boolean),
      nextFollowUp: document.getElementById('leadNextFollowUp').value ? new Date(document.getElementById('leadNextFollowUp').value).toISOString() : null,
      estimatedValue: Number(document.getElementById('leadEstimatedValue').value || 0)
    };
    try {
      const data = await API.patch(`/api/leads/${encodeURIComponent(leadId)}`, changes);
      Object.assign(lead, normalizeLead(data.lead));
      renderTable(); UI.closeModal('leadDetailsModal'); UI.notify('Lead atualizado.', 'success');
      loadReminders();
    } catch (error) { UI.notify(error.message, 'error'); }
  });

  document.getElementById('searchForm')?.addEventListener('submit', runSearchJob, true);
  function currentSearchPayload() {
    const categoryId = document.getElementById('searchCategory')?.value || '';
    return {
      source: document.getElementById('searchSource')?.value || 'google_maps',
      maxResults: Number(document.getElementById('searchMaxResults')?.value || 50),
      categoryId,
      customCategory: categoryId === 'custom' ? document.getElementById('searchCustomCategory')?.value.trim() : '',
      city: document.getElementById('searchCity')?.value.trim() || '',
      region: document.getElementById('searchRegion')?.value.trim() || '',
      country: document.getElementById('searchCountry')?.value.trim() || ''
    };
  }
  async function runSearchJob(event) {
    event.preventDefault(); event.stopImmediatePropagation();
    const payload = currentSearchPayload();
    const source = payload.source;
    if (!payload.categoryId || !payload.city || !payload.country || currentSearchJobId) return;
    const button = document.getElementById('btnSearch');
    button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';
    try {
      const location = await API.post('/api/places/search/resolve', payload);
      const confirmed = await UI.confirm(`Local encontrado: ${location.interpretedLocation}. Deseja iniciar a busca nessa região?`, 'Confirmar localização');
      if (!confirmed) return;
      document.getElementById('searchProgress').classList.remove('hidden');
      updateSearchProgress({ phase: 'queued', found: 0, analyzed: 0, remaining: 0, interpretedLocation: location.interpretedLocation }, source);
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando...';
      const { job } = await API.post('/api/places/search/start', payload);
      currentSearchJobId = job.id;
      while (currentSearchJobId) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const data = await API.get(`/api/places/search/jobs/${encodeURIComponent(job.id)}`);
        updateSearchProgress(data.job, source);
        if (data.job.status === 'completed') {
          leadsData = (data.job.results || []).map(normalizeLead);
          selectedLeadIds.clear(); isPaidUser = Boolean(data.job.hasActiveSubscription); renderTable();
          UI.notify(data.job.warning || `${leadsData.length} leads encontrados e salvos nesta pesquisa.`, data.job.warning ? 'info' : 'success');
          currentSearchJobId = null;
          await verifyWhatsAppNumbers();
          break;
        }
        if (data.job.status === 'failed' || data.job.status === 'cancelled') {
          throw new Error(data.job.error || (data.job.status === 'cancelled' ? 'Busca cancelada.' : 'A busca falhou.'));
        }
      }
    } catch (error) {
      currentSearchJobId = null;
      if (error.data?.expired) openPixModal();
      UI.notify(error.message, error.message.includes('cancelada') ? 'info' : 'error');
    } finally {
      button.disabled = false; button.innerHTML = '<span>Verificar local</span> <i class="fa-solid fa-location-dot"></i>';
      document.getElementById('searchProgress').classList.add('hidden');
    }
  }
  document.getElementById('btnCancelSearch')?.addEventListener('click', async () => {
    if (!currentSearchJobId) return;
    const id = currentSearchJobId; currentSearchJobId = null;
    try { await API.delete(`/api/places/search/jobs/${encodeURIComponent(id)}`); } catch {}
    UI.notify('Busca cancelada.', 'info');
  });
  function updateSearchProgress(job, source) {
    const sourceLabels = {
      google_maps: { queued: 'Aguardando início...', starting: 'Abrindo o Google Maps...', collecting: 'Coletando estabelecimentos...', analyzing: 'Analisando telefones e sites...', completed: 'Busca concluída' },
      directories: { queued: 'Aguardando início...', starting: 'Localizando a cidade...', collecting: 'Consultando o OpenStreetMap...', analyzing: 'Processando estabelecimentos...', completed: 'Busca concluída' },
      all_world: { queued: 'Aguardando início...', starting: 'Localizando a cidade no mundo...', location_confirmed: 'Localização confirmada.', collecting: 'Consultando estabelecimentos internacionais...', analyzing: 'Classificando os melhores resultados...', completed: 'Busca concluída' }
    };
    const labels = sourceLabels[source] || sourceLabels.google_maps;
    document.getElementById('searchProgressLabel').textContent = labels[job.phase] || 'Processando busca...';

    document.getElementById('searchFoundCount').textContent = job.found || 0;
    document.getElementById('searchAnalyzedCount').textContent = job.analyzed || 0;
    document.getElementById('searchRemainingCount').textContent = job.remaining || 0;

    const sourceNames = { google_maps: 'Google Maps', directories: 'OpenStreetMap Brasil', all_world: 'All World' };
    const title = document.getElementById('searchProgressTitle');
    const desc = document.getElementById('searchProgressDesc');
    if (title) title.textContent = `Extraindo de ${sourceNames[source] || source}...`;
    if (desc) {
      const descriptions = {
        google_maps: 'Obtendo telefones, sites e avaliações com tecnologia anti-bloqueio.',
        directories: 'Consultando estabelecimentos brasileiros cadastrados no OpenStreetMap.',
        all_world: 'Consultando estabelecimentos em qualquer cidade informada no mundo.'
      };
      desc.textContent = job.interpretedLocation ? `Pesquisando em ${job.interpretedLocation}.` : (descriptions[source] || 'Obtendo dados em segundo plano.');
    }
  }

  async function verifyWhatsAppNumbers() {
    const phones = [...new Set(leadsData.map((lead) => lead.whatsappPhone).filter(Boolean))];
    if (!phones.length) return;
    try {
      const verified = {};
      for (let index = 0; index < phones.length; index += 100) {
        const data = await API.post('/api/whatsapp/check', { phones: phones.slice(index, index + 100) });
        if (!data.connected) {
          leadsData.forEach((lead) => { lead.whatsappVerified = false; });
          renderTable();
          UI.notify('Conecte seu WhatsApp para verificar quais números possuem conta.', 'info');
          return;
        }
        Object.assign(verified, data.results || {});
      }
      leadsData.forEach((lead) => { lead.whatsappVerified = Boolean(verified[lead.whatsappPhone]); });
      renderTable();
    } catch (error) { UI.notify('Não foi possível verificar os números agora.', 'error'); }
  }

  function exportRows(rows, suffix) {
    if (!rows.length) return UI.notify('Nenhum lead para exportar.', 'error');
    const sourceLabels = {
      google_maps: 'Google Maps', directories: 'OpenStreetMap Brasil', all_world: 'All World'
    };
    const data = rows.map((lead) => ({ Empresa: lead.name, Fonte: sourceLabels[lead.source] || lead.source || 'Google Maps', Etapa: statusLabels[lead.status], Site: lead.website || '', Telefone: lead.phone, WhatsApp: lead.whatsappPhone || '', Avaliação: lead.rating, Endereço: lead.address, Etiquetas: (lead.tags || []).join(', '), Notas: lead.notes || '', 'Próximo contato': formatFollowUp(lead.nextFollowUp), 'Valor estimado': lead.estimatedValue || 0 }));
    const sheet = XLSX.utils.json_to_sheet(data); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Leads');
    XLSX.writeFile(book, `sevenleads_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  document.getElementById('btnExportExcel')?.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); exportRows(filteredLeads(), 'filtrados'); }, true);
  document.getElementById('btnExportSelected')?.addEventListener('click', () => exportRows(leadsData.filter((lead) => selectedLeadIds.has(lead.id)), 'selecionados'));
  document.getElementById('btnAddToList')?.addEventListener('click', () => setView('lists'));

  requestPayment = async function enhancedPaymentRequest() {
    const button = document.getElementById('btnJapaguei');
    button.disabled = true;
    try {
      const form = new FormData(); form.append('plan', selectedPlan);
      const receipt = document.getElementById('paymentReceipt')?.files?.[0]; if (receipt) form.append('receipt', receipt);
      const data = await API.upload('/api/payments/request', form);
      document.getElementById('pixPendingState').classList.remove('hidden'); document.getElementById('pixPayState').classList.add('hidden');
      UI.notify(data.message, 'success');
    } catch (error) { UI.notify(error.message, 'error'); }
    finally { button.disabled = false; const plan = availablePlans.find((item) => item.id === selectedPlan) || { price: 20 }; button.innerHTML = `<i class="fa-brands fa-pix"></i> <span id="btnJapagueiText">Já paguei R$ ${plan.price}</span>`; }
  };
  document.getElementById('paymentReceipt')?.addEventListener('change', (event) => { document.getElementById('paymentReceiptName').textContent = event.target.files?.[0]?.name || 'Nenhum arquivo selecionado'; });

  ['admUserSearch', 'admStatusFilter', 'admPlanFilter'].forEach((id) => document.getElementById(id)?.addEventListener(id === 'admUserSearch' ? 'input' : 'change', debounce(() => loadAdminData(), 250)));
  document.getElementById('btnAdminAudit')?.addEventListener('click', async () => {
    try {
      const { actions } = await API.get('/api/admin/actions');
      closeAdminModal();
      currentView = 'dashboard';
      document.querySelectorAll('.workspace-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === 'dashboard'));
      document.getElementById('workspacePanels')?.classList.add('hidden');
      document.getElementById('resultsPanel')?.classList.add('hidden');
      document.getElementById('productView')?.classList.remove('hidden');
      productShell('Histórico administrativo', 'Registro das alterações realizadas no sistema.', actions.length ? `<div class="product-grid">${actions.map((action) => `<article class="history-card"><div><strong>${UI.escapeHtml(action.action)}</strong><p>${UI.escapeHtml(action.adminName)} · ${new Date(action.created_at).toLocaleString('pt-BR')}</p></div><span>${UI.escapeHtml(action.target_type || '')}</span></article>`).join('')}</div>` : empty('Nenhuma ação registrada ainda.'));
    } catch (error) { UI.notify(error.message, 'error'); }
  });
  window.downloadReceipt = async function (paymentId) {
    try {
      const blob = await API.get(`/api/admin/payments/${encodeURIComponent(paymentId)}/receipt`);
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `comprovante-${paymentId}`; link.click(); URL.revokeObjectURL(url);
    } catch (error) { UI.notify(error.message, 'error'); }
  };

  function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

  const SOURCE_HINTS = {
    google_maps: '💡 <strong class="text-slate-400">Google Maps:</strong> Busca estabelecimentos com telefone, site e avaliação.',
    directories: '💡 <strong class="text-slate-400">OpenStreetMap Brasil:</strong> Use "nicho em cidade, UF".',
    all_world: '💡 <strong class="text-slate-400">All World:</strong> Use "nicho em cidade, país". Exemplos: "pizza in Los Angeles, USA" ou "hotel em Guatemala City, Guatemala". Dados de <a class="text-cyan-400 hover:underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>.'
  };
  document.getElementById('searchSource')?.addEventListener('change', (event) => {
    const hint = document.getElementById('sourceHint');
    if (hint) hint.innerHTML = SOURCE_HINTS[event.target.value] || SOURCE_HINTS.google_maps;
    const country = document.getElementById('searchCountry');
    if (country) {
      const brazilOnly = event.target.value === 'directories';
      country.readOnly = brazilOnly;
      if (brazilOnly) country.value = 'Brasil';
      country.placeholder = event.target.value === 'all_world' ? 'Ex.: Estados Unidos' : 'Ex.: Brasil';
    }
  });
  document.getElementById('searchCategory')?.addEventListener('change', (event) => {
    const customField = document.getElementById('customCategoryField');
    const customInput = document.getElementById('searchCustomCategory');
    const custom = event.target.value === 'custom';
    customField?.classList.toggle('hidden', !custom);
    if (customInput) customInput.required = custom;
  });

  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installEvent = event; document.getElementById('installPrompt')?.classList.remove('hidden'); });
  document.getElementById('btnInstallApp')?.addEventListener('click', async () => { if (!installEvent) return; await installEvent.prompt(); installEvent = null; document.getElementById('installPrompt').classList.add('hidden'); });
  document.getElementById('btnDismissInstall')?.addEventListener('click', () => document.getElementById('installPrompt')?.classList.add('hidden'));
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

  handleRecoveryLinks();
  setTimeout(() => { if (authToken) { loadReminders(); } }, 1400);
})();
