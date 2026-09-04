// 🔍 BUSCA MULTI-FONTE
// ==========================================

const SOURCE_BADGES = {
  google_maps: '<span class="bg-blue-500/15 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium" title="Google Maps">Maps</span>',
  directories: '<span class="bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium" title="OpenStreetMap Brasil">OSM BR</span>',
  all_world: '<span class="bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded text-[10px] font-medium" title="All World">World</span>'
};

// Carrega os leads já salvos no banco quando a tela abre (ou após login)
async function loadSavedLeads() {
  if (!authToken) return;
  try {
    const res = await fetch('/api/leads', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!res.ok) return;

    const data = await res.json();

    if (data.leads && data.leads.length) {
      leadsData = data.leads.map(normalizeLead);
      renderTable();
    }
  } catch (e) {
    console.error('Erro ao carregar leads salvos:', e);
  }
}

// Filtros da Tabela
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => {
      b.className =
        'filter-btn px-3 py-1 rounded-md bg-slate-800/70 border border-slate-700 text-slate-200 hover:bg-slate-700 font-medium flex items-center gap-1.5';
    });

    btn.className =
      'filter-btn active px-3 py-1 rounded-md bg-[#2563eb] text-white border border-[#2563eb] font-medium flex items-center gap-1.5';

    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

function normalizeLead(lead) {
  const valid = [
    'novo',
    'contatado',
    'respondeu',
    'reuniao',
    'proposta',
    'cliente'
  ];

  let status = lead.status;

  if (!valid.includes(status)) {
    status = 'novo';
  }

  return {
    ...lead,
    status,
    contacted: !!lead.contacted,
    messageVariations: Array.isArray(lead.messageVariations)
      ? lead.messageVariations
      : [],
    selectedMessage: lead.selectedMessage || null
  };
}

function sortLeadsByStatus(list) {
  return [...list].sort((a, b) => {
    const orderA = LEAD_STATUS_ORDER[a.status] ?? 0;
    const orderB = LEAD_STATUS_ORDER[b.status] ?? 0;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return String(a.name || '').localeCompare(
      String(b.name || ''),
      'pt-BR'
    );
  });
}

function rowClassForStatus(status) {
  if (
    status === 'contatado' ||
    status === 'respondeu'
  ) {
    return 'bg-blue-950/35 border-l-4 border-l-blue-500 hover:bg-blue-950/50 transition';
  }

  if (status === 'cliente') {
    return 'bg-emerald-950/35 border-l-4 border-l-emerald-500 hover:bg-emerald-950/50 transition';
  }

  if (
    status === 'reuniao' ||
    status === 'proposta'
  ) {
    return 'bg-purple-950/30 border-l-4 border-l-purple-500 hover:bg-purple-950/45 transition';
  }

  return 'hover:bg-slate-800/40 transition';
}

function statusBadge(status) {
  const colors = {
    novo:
      'bg-slate-700/60 text-slate-200 border-slate-600',

    contatado:
      'bg-blue-500/15 text-blue-300 border-blue-500/30',

    respondeu:
      'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',

    reuniao:
      'bg-purple-500/15 text-purple-300 border-purple-500/30',

    proposta:
      'bg-amber-500/15 text-amber-300 border-amber-500/30',

    cliente:
      'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  };

  return `<span class="${colors[status] || colors.novo} border px-2 py-0.5 rounded text-[11px] font-semibold">${LEAD_STATUS_LABEL[status] || 'Novo'}</span>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTable() {
  const filtered = sortLeadsByStatus(
    leadsData.filter((item) => {
      if (currentFilter === 'no-site') {
        return !item.hasWebsite;
      }

      if (currentFilter === 'social-only') {
        return item.isSocialMedia;
      }

      if (currentFilter === 'with-site') {
        return item.hasRealWebsite;
      }

      if (currentFilter === 'no-whatsapp') {
        return !item.whatsappPhone;
      }

      return true;
    })
  );

  document.getElementById('resultsCount').innerText =
    filtered.length;

  // Contador de progresso: X chamados / Y total
  const totalLeads = filtered.length;

  const contactedLeads = filtered.filter(
    (item) => item.contacted
  ).length;

  const progressContactedCount =
    document.getElementById(
      'progressContactedCount'
    );

  const progressTotal =
    document.getElementById(
      'progressTotal'
    );

  if (progressContactedCount) {
    progressContactedCount.innerText =
      contactedLeads;
  }

  if (progressTotal) {
    progressTotal.innerText =
      `${totalLeads} total`;
  }

  const progressContacted =
    document.getElementById(
      'progressContacted'
    );

  if (progressContacted) {
    if (
      totalLeads > 0 &&
      contactedLeads === totalLeads
    ) {
      progressContacted.className =
        'bg-[#9abc8a]/20 text-[#9abc8a] border border-[#9abc8a]/30 px-2.5 py-0.5 rounded-full font-medium';
    }
  }

  const tbody =
    document.getElementById(
      'leadsTableBody'
    );

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="px-4 py-8 text-center text-slate-500">
          Nenhum comércio encontrado para o filtro selecionado.
        </td>
      </tr>
    `;

    return;
  }

  const canSeeAll =
    isPaidUser;

  const visibleLeads =
    canSeeAll
      ? filtered
      : filtered.slice(0, 5);

  tbody.innerHTML =
    visibleLeads
      .map((lead) => {
        let siteBadge = '';

        const safeWebsite =
          window.SevenUI.safeUrl(
            lead.website
          );

        const safeMapsUrl =
          window.SevenUI.safeUrl(
            lead.mapsUrl
          );

        if (!lead.hasWebsite) {
          siteBadge =
            '<span class="bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded text-[11px] font-medium">Sem Site</span>';
        }

        else if (!safeWebsite) {
          siteBadge =
            '<span class="text-slate-500 text-[11px]">Link inválido</span>';
        }

        else if (lead.isSocialMedia) {
          siteBadge = `
            <a
              href="${escapeHtml(safeWebsite)}"
              target="_blank"
              rel="noopener noreferrer"
              class="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[11px] hover:underline inline-flex items-center gap-1 font-medium"
            >
              Rede Social
              <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
            </a>
          `;
        }

        else {
          siteBadge = `
            <a
              href="${escapeHtml(safeWebsite)}"
              target="_blank"
              rel="noopener noreferrer"
              class="bg-[#9abc8a]/10 text-[#9abc8a] border border-[#9abc8a]/20 px-2 py-0.5 rounded text-[11px] hover:underline inline-flex items-center gap-1 font-medium"
            >
              Site Próprio
              <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
            </a>
          `;
        }

        const safeId =
          escapeHtml(lead.id);

        const resetBtn =
          lead.status !== 'novo'
            ? `
              <button
                onclick="setLeadStatus('${safeId}', 'novo')"
                class="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2 py-1 rounded text-[11px]"
                title="Voltar para novo"
              >
                Resetar
              </button>
            `
            : '';

        return `
          <tr class="${rowClassForStatus(lead.status)}">

            <td class="px-3 py-3">
              <input
                type="checkbox"
                class="lead-select"
                data-lead-id="${safeId}"
                aria-label="Selecionar ${escapeHtml(lead.name)}"
              >
            </td>

            <td class="px-4 py-3 font-medium text-slate-100">

              ${
                lead.contacted
                  ? `
                    <span
                      class="inline-flex items-center gap-1.5 text-[#9abc8a]"
                      title="Já chamado no WhatsApp"
                    >
                      <i class="fa-solid fa-circle-check"></i>
                    </span>
                  `
                  : ''
              }

              <span
                class="${
                  lead.contacted
                    ? 'text-[#9abc8a]'
                    : 'text-slate-100'
                }"
              >
                ${escapeHtml(lead.name)}
              </span>

              ${SOURCE_BADGES[lead.source] || ''}

              ${
                safeMapsUrl
                  ? `
                    <a
                      href="${escapeHtml(safeMapsUrl)}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-xs text-slate-500 hover:text-[#2563eb] ml-1.5"
                      title="Ver detalhes"
                    >
                      <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                  `
                  : ''
              }

            </td>

            <td class="px-4 py-3">
              ${statusBadge(lead.status)}
            </td>

            <td class="px-4 py-3">
              ${siteBadge}
            </td>

            <td class="px-4 py-3 font-mono text-xs text-slate-300">
              ${escapeHtml(lead.phone)}
            </td>

            <td class="px-4 py-3 text-xs">
              ⭐ ${escapeHtml(lead.rating)}
              <span class="text-slate-500">
                (${escapeHtml(lead.totalRatings)})
              </span>
            </td>

            <td
              class="px-4 py-3 text-xs text-slate-400 max-w-xs truncate"
              title="${escapeHtml(lead.address)}"
            >
              ${escapeHtml(lead.address)}
            </td>

            <td class="px-4 py-3 text-right">

              <div class="flex flex-wrap justify-end gap-1">

                <button
                  onclick="openLeadWhatsApp('${safeId}')"
                  id="btn-lead-${safeId}"
                  class="glow-btn bg-[#2563eb] hover:bg-[#3b82f6] text-white px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition"
                  ${
                    !lead.whatsappPhone
                      ? 'disabled title="Telefone não disponível"'
                      : `title="${
                          lead.whatsappVerified === true
                            ? 'Número verificado no WhatsApp'
                            : 'O número será verificado ao abrir'
                        }"`
                  }
                >
                  <i class="fa-brands fa-whatsapp"></i>
                  <span>Abrir no WhatsApp</span>
                </button>

                <button
                  onclick="openLeadDetails('${safeId}')"
                  class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1 rounded text-[11px] font-medium"
                >
                  <i class="fa-solid fa-pen"></i>
                  Detalhes
                </button>

                ${resetBtn}

              </div>

            </td>

          </tr>
        `;
      })
      .join('');

  if (
    !canSeeAll &&
    filtered.length > 5
  ) {
    const hiddenCount =
      filtered.length - 5;

    tbody.innerHTML += `
      <tr>

        <td colspan="8" class="p-0">

          <div
            class="bg-[#0a0a0a] px-4 py-8 text-center border-t-2 border-dashed border-[#2563eb]/40"
          >

            <div
              class="w-12 h-12 mx-auto rounded-full bg-[#2563eb]/10 text-[#2563eb] flex items-center justify-center text-xl mb-3"
            >
              <i class="fa-solid fa-lock"></i>
            </div>

            <h4 class="text-sm font-bold text-white">
              Mais ${hiddenCount}
              resultado${hiddenCount > 1 ? 's' : ''}
              bloqueado${hiddenCount > 1 ? 's' : ''}
            </h4>

            <p
              class="text-xs text-slate-400 mt-1 max-w-xs mx-auto"
            >
              Destrave todos os resultados e o envio de mensagens com um plano pago.
            </p>

            <button
              onclick="openPixModal()"
              class="mt-4 bg-[#2563eb] hover:bg-[#3b82f6] text-white font-semibold text-xs px-5 py-2 rounded-lg transition inline-flex items-center gap-1.5 shadow-lg shadow-[#2563eb]/40"
            >
              <i class="fa-brands fa-pix"></i>
              Ver planos
            </button>

          </div>

        </td>

      </tr>
    `;
  }
}

// ==========================================
// 💬 MENSAGEM PERSONALIZADA
// ==========================================

async function ensureLeadMessage(lead) {
  const template =
    document.getElementById(
      'messageTemplate'
    );

  let message =
    (template?.value || '').trim();

  if (!message) {
    message = `Olá {nome}, tudo bem?

Vi o perfil de vocês e queria apresentar uma ideia rápida.`;
  }

  message = message
    .replace(
      /{nome}/g,
      lead.name || ''
    )
    .replace(
      /{endereco}/g,
      lead.address || ''
    );

  lead.selectedMessage =
    message;

  return message;
}

// ==========================================
// 📌 ALTERAR STATUS DO LEAD
// ==========================================

window.setLeadStatus = async (
  leadId,
  status
) => {
  const lead =
    leadsData.find(
      (l) => l.id === leadId
    );

  if (!lead) {
    return;
  }

  if (
    !Object.keys(
      LEAD_STATUS_ORDER
    ).includes(status)
  ) {
    return;
  }

  const previousStatus =
    lead.status;

  lead.status =
    status;

  renderTable();

  try {
    const response =
      await fetch(
        `/api/leads/${encodeURIComponent(leadId)}/status`,
        {
          method: 'PATCH',

          headers: {
            'Content-Type':
              'application/json',

            'Authorization':
              `Bearer ${authToken}`
          },

          body: JSON.stringify({
            status
          })
        }
      );

    if (!response.ok) {
      throw new Error(
        'Não foi possível salvar a etapa.'
      );
    }
  }

  catch (e) {
    lead.status =
      previousStatus;

    renderTable();

    alert(
      e.message ||
      'Erro ao salvar status.'
    );
  }
};

// ==========================================
// ✅ MARCAR COMO CONTATADO
// ==========================================

async function markLeadContactedRemote(
  leadId
) {
  const response =
    await fetch(
      `/api/leads/${encodeURIComponent(leadId)}/contact`,
      {
        method: 'POST',

        headers: {
          'Authorization':
            `Bearer ${authToken}`
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      'O WhatsApp abriu, mas não foi possível salvar o contato.'
    );
  }
}

// ==========================================
// 📱 VERIFICAR WHATSAPP
// ==========================================

async function verifyLeadWhatsApp(
  lead
) {
  try {
    const response =
      await fetch(
        '/api/whatsapp/check',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'Authorization':
              `Bearer ${authToken}`
          },

          body: JSON.stringify({
            phones: [
              lead.whatsappPhone
            ]
          })
        }
      );

    if (!response.ok) {
      return null;
    }

    const data =
      await response.json();

    if (!data.connected) {
      return null;
    }

    const values =
      Object.values(
        data.results || {}
      );

    const exists =
      data.results?.[
        lead.whatsappPhone
      ] ?? values[0];

    if (exists === true) {
      lead.whatsappVerified =
        true;
    }

    return typeof exists === 'boolean'
      ? exists
      : null;
  }

  catch {
    return null;
  }
}

// ==========================================
// 🟢 ABRIR WHATSAPP
// ==========================================

window.openLeadWhatsApp = async (
  leadId
) => {
  const lead =
    leadsData.find(
      (l) => l.id === leadId
    );

  if (
    !lead ||
    !lead.whatsappPhone
  ) {
    alert(
      'Telefone não disponível para este comércio.'
    );

    return;
  }

  const btn =
    document.getElementById(
      'btn-lead-' + leadId
    );

  if (btn) {
    btn.disabled =
      true;

    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Preparando...';
  }

  try {
    const verification =
      await verifyLeadWhatsApp(
        lead
      );

    if (
      verification === false
    ) {
      throw new Error(
        'Este número foi consultado e não possui uma conta ativa no WhatsApp.'
      );
    }

    // Pega exatamente o texto da caixa de mensagem
    const message =
      await ensureLeadMessage(
        lead
      );

    const res =
      await fetch(
        '/api/whatsapp/manual-link',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'Authorization':
              `Bearer ${authToken}`
          },

          body: JSON.stringify({
            phone:
              lead.whatsappPhone,

            message
          })
        }
      );

    const data =
      await res.json();

    if (
      !res.ok ||
      !data.url
    ) {
      if (
        data.requiresPayment
      ) {
        openPixModal();

        return;
      }

      throw new Error(
        data.error ||
        'Não foi possível montar o link do WhatsApp.'
      );
    }

    if (!lead.contacted) {
      try {
        await markLeadContactedRemote(
          leadId
        );

        lead.contacted =
          true;

        renderTable();
      }

      catch (err) {
        console.warn(
          'Não foi possível marcar o lead como contatado:',
          err
        );
      }
    }

    // Abre o WhatsApp na mesma aba
    window.location.assign(
      data.url
    );
  }

  catch (err) {
    console.error(
      'Erro ao abrir WhatsApp:',
      err
    );

    alert(
      err.message ||
      'Não foi possível abrir o WhatsApp.'
    );
  }

  finally {
    if (btn) {
      btn.disabled =
        false;

      btn.innerHTML =
        '<i class="fa-brands fa-whatsapp"></i> <span>Abrir no WhatsApp</span>';
    }
  }
};

// ==========================================
// 📥 EXPORTAR EXCEL
// ==========================================

document
  .getElementById(
    'btnExportExcel'
  )
  .addEventListener(
    'click',
    () => {
      if (
        leadsData.length === 0
      ) {
        alert(
          'Realize uma busca primeiro para exportar os dados.'
        );

        return;
      }

      const sourceLabels = {
        google_maps:
          'Google Maps',

        directories:
          'OpenStreetMap Brasil',

        all_world:
          'All World'
      };

      const formatted =
        leadsData.map(
          (item) => ({
            'Nome da Empresa':
              item.name,

            'Fonte':
              sourceLabels[
                item.source
              ] ||
              item.source ||
              'Google Maps',

            'Status do Site':
              !item.hasWebsite
                ? 'Sem Site'
                : item.isSocialMedia
                  ? 'Apenas Rede Social'
                  : 'Site Próprio',

            'URL do Site':
              item.website ||
              'Nenhum',

            'Telefone':
              item.phone,

            'WhatsApp Formatado':
              item.whatsappPhone ||
              'N/A',

            'Avaliação (Estrelas)':
              item.rating,

            'Total de Avaliações':
              item.totalRatings,

            'Endereço':
              item.address,

            'Link':
              item.mapsUrl,

            'Status do Lead':
              LEAD_STATUS_LABEL[
                item.status
              ] ||
              item.status,

            'Mensagem selecionada':
              item.selectedMessage ||
              ''
          })
        );

      const worksheet =
        XLSX.utils.json_to_sheet(
          formatted
        );

      const workbook =
        XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'Leads B2B'
      );

      const fileName =
        `sevenleads_${
          new Date()
            .toISOString()
            .slice(0, 10)
        }.xlsx`;

      XLSX.writeFile(
        workbook,
        fileName
      );
    }
  );

// ==========================================
