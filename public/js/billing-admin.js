// 💸 MODAL DE PAGAMENTO PIX
// ==========================================

function openPixModal() {
  document.getElementById('pixModal').classList.remove('hidden');
  selectPlan(currentUser.plan || 'weekly');
  loadMyPayments();
}

function closePixModal() {
  document.getElementById('pixModal').classList.add('hidden');
}

function selectPlan(planId) {
  selectedPlan = planId;
  const plan = availablePlans.find(p => p.id === planId) || { label: 'R$ 20', price: 20 };

  document.querySelectorAll('.pix-plan-card').forEach(card => {
    if (card.dataset.plan === planId) {
      card.className = 'pix-plan-card bg-[#2563eb]/10 border-2 border-[#2563eb] rounded-xl p-3 text-center transition cursor-pointer';
    } else {
      card.className = 'pix-plan-card bg-[#0a0a0a] border-2 border-slate-700 rounded-xl p-3 text-center transition hover:border-[#2563eb] cursor-pointer';
    }
  });

  document.getElementById('btnJapagueiText').innerText = `Já paguei R$ ${plan.price}`;
}

async function loadMyPayments() {
  if (!authToken) return;
  try {
    const res = await fetch('/api/payments/mine', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();

    const pendingState = document.getElementById('pixPendingState');
    const payState = document.getElementById('pixPayState');

    if (data.pending) {
      pendingState.classList.remove('hidden');
      payState.classList.add('hidden');
    } else {
      pendingState.classList.add('hidden');
      payState.classList.remove('hidden');
    }
  } catch (e) {}
}

async function requestPayment() {
  const btn = document.getElementById('btnJapaguei');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

  try {
    const res = await fetch('/api/payments/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ plan: selectedPlan })
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 409) {
        document.getElementById('pixPendingState').classList.remove('hidden');
        document.getElementById('pixPayState').classList.add('hidden');
        return;
      }
      alert(data.error || 'Erro ao solicitar pagamento.');
      return;
    }

    document.getElementById('pixPendingState').classList.remove('hidden');
    document.getElementById('pixPayState').classList.add('hidden');
  } catch (e) {
    alert('Erro de conexão.');
  } finally {
    btn.disabled = false;
    const plan = availablePlans.find(p => p.id === selectedPlan) || { price: 20 };
    btn.innerHTML = `<i class="fa-brands fa-pix"></i> <span id="btnJapagueiText">Já paguei R$ ${plan.price}</span>`;
  }
}

function copyPixKey() {
  const pixInput = document.getElementById('pixKeyDisplay');
  navigator.clipboard.writeText(pixInput.value);
  alert('Chave PIX copiada para a área de transferência!');
}

// ==========================================
// 👑 CENTRAL DE CONTROLE DO ADMINISTRADOR
// ==========================================

function openAdminModal() {
  document.getElementById('adminModal').classList.remove('hidden');
  loadAdminData();
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.add('hidden');
}

async function loadAdminData() {
  try {
    // 1. Estatísticas
    const resStats = await fetch('/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const stats = await resStats.json();

    document.getElementById('admTotalUsers').innerText = stats.totalUsers || 0;
    document.getElementById('admActiveUsers').innerText = stats.activeSubscribers || 0;
    document.getElementById('admExpiredUsers').innerText = stats.expiredSubscribers || 0;
    document.getElementById('admTotalSearches').innerText = stats.totalSearches || 0;
    document.getElementById('admPendingPayments').innerText = stats.pendingPayments || 0;
    document.getElementById('admApprovedRevenue').innerText = Number(stats.approvedRevenue || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    document.getElementById('admConversionRate').innerText = `${stats.conversionRate || 0}%`;
    document.getElementById('admPixKeyInput').value = currentPixKey;

    // 2. Fila de Pagamentos
    const resPayments = await fetch('/api/admin/payments', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const { pending } = await resPayments.json();

    const paymentsSection = document.getElementById('adminPaymentsSection');
    const paymentsBody = document.getElementById('admPaymentsBody');

    if (pending && pending.length > 0) {
      paymentsSection.classList.remove('hidden');
      paymentsBody.innerHTML = pending.map(p => {
        const planNames = { weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral' };
        const planName = planNames[p.plan] || p.plan;
        const date = new Date(p.created_at).toLocaleString('pt-BR');
        return `
          <tr class="hover:bg-slate-900 transition">
            <td class="px-4 py-2.5">
              <div class="font-semibold text-slate-100">${escapeHtml(p.user_name)}</div>
              <div class="text-[10px] text-slate-400">${escapeHtml(p.user_email)}</div>
            </td>
            <td class="px-4 py-2.5 text-xs">${planName}</td>
            <td class="px-4 py-2.5 text-xs font-bold text-[#9abc8a]">R$ ${p.amount}</td>
            <td class="px-4 py-2.5 text-[11px] text-slate-400">${date}</td>
            <td class="px-4 py-2.5 text-right space-x-1">
              ${p.receipt_path ? `<button onclick="downloadReceipt('${escapeHtml(p.id)}')" class="bg-blue-600/20 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded text-[11px]">Comprovante</button>` : ''}
              <button onclick="adminApprovePayment('${p.id}')" class="bg-[#9abc8a] hover:bg-[#9abc8a]/80 text-[#0a0a0a] px-2.5 py-1 rounded text-[11px] font-semibold transition">
                <i class="fa-solid fa-check mr-0.5"></i> Aprovar
              </button>
              <button onclick="adminRejectPayment('${p.id}')" class="bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 px-2.5 py-1 rounded text-[11px] transition">
                <i class="fa-solid fa-xmark mr-0.5"></i> Recusar
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } else {
      paymentsSection.classList.add('hidden');
    }

    // 3. Lista de Usuários
    const adminQuery = new URLSearchParams({
      search: document.getElementById('admUserSearch')?.value || '',
      status: document.getElementById('admStatusFilter')?.value || 'all',
      plan: document.getElementById('admPlanFilter')?.value || 'all'
    });
    const resUsers = await fetch(`/api/admin/users?${adminQuery}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const { users } = await resUsers.json();

    const planNames = { weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral' };
    const tbody = document.getElementById('admUsersTableBody');
    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-500">Nenhum usuário cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map((u) => {
      const isBlocked = u.status === 'blocked';
      const isAdmin = u.role === 'admin';
      const planLabel = planNames[u.plan] || 'Semanal';

      let expireBadge = '';
      if (isAdmin) {
        expireBadge = '<span class="text-purple-400 font-semibold">👑 Administrador</span>';
      } else if (u.is_trial) {
        // Conta em teste grátis
        const expDate = new Date(u.subscription_expires_at);
        const now = new Date();
        const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
          expireBadge = `<span class="text-amber-400 font-medium">🎁 Teste grátis · ${diffDays} dia(s)</span>`;
        } else {
          expireBadge = '<span class="text-red-400 font-medium">🔴 Teste expirado</span>';
        }
      } else if (!u.subscription_expires_at) {
        expireBadge = '<span class="text-red-400 font-medium">🔴 Sem Assinatura</span>';
      } else {
        const expDate = new Date(u.subscription_expires_at);
        const now = new Date();
        const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

        if (diffDays > 0) {
          expireBadge = `<span class="text-[#9abc8a] font-medium">🟢 ${diffDays} dias (${expDate.toLocaleDateString('pt-BR')})</span>`;
        } else {
          expireBadge = `<span class="text-red-400 font-medium">🔴 Expirou há ${Math.abs(diffDays)} dias</span>`;
        }
      }

      return `
        <tr class="hover:bg-slate-900 transition">
          <td class="px-4 py-3">
            <div class="font-semibold text-slate-100">${escapeHtml(u.name)}</div>
            <div class="text-[11px] text-slate-400">${escapeHtml(u.email)}</div>
          </td>
          <td class="px-4 py-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-300">
              ${planLabel}
            </span>
          </td>
          <td class="px-4 py-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isBlocked ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-[#9abc8a]/20 text-[#9abc8a] border border-[#9abc8a]/30'}">
              ${isBlocked ? 'BLOQUEADO' : 'ATIVO'}
            </span>
          </td>
          <td class="px-4 py-3">${expireBadge}</td>
          <td class="px-4 py-3 font-mono text-slate-400">${u.total_searches || 0}</td>
          <td class="px-4 py-3 text-right space-x-1">
            ${!isAdmin ? `
              <button onclick="adminRenewUser('${u.id}', 7, 'weekly')" title="Adicionar 7 Dias (Semanal)" class="bg-[#9abc8a] hover:bg-[#9abc8a]/80 text-[#0a0a0a] px-2 py-1 rounded text-[11px] font-semibold transition">
                +7
              </button>
              <button onclick="adminRenewUser('${u.id}', 30, 'monthly')" title="Adicionar 30 Dias (Mensal)" class="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-[11px] font-semibold transition">
                +30
              </button>
              <button onclick="adminRenewUser('${u.id}', 90, 'quarterly')" title="Adicionar 90 Dias (Trimestral)" class="bg-purple-600 hover:bg-purple-500 text-white px-2 py-1 rounded text-[11px] font-semibold transition">
                +90
              </button>
              <button onclick="adminToggleStatus('${u.id}', '${isBlocked ? 'active' : 'blocked'}')" title="${isBlocked ? 'Desbloquear' : 'Bloquear'}" class="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2 py-1 rounded text-[11px] transition">
                ${isBlocked ? '<i class="fa-solid fa-lock-open text-[#9abc8a]"></i>' : '<i class="fa-solid fa-lock text-amber-400"></i>'}
              </button>
              <button onclick="adminDeleteUser('${u.id}')" title="Excluir Usuário" class="bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 px-2 py-1 rounded text-[11px] transition">
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : '<span class="text-slate-600 text-[11px] italic">Sem ações</span>'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar dados do admin:', err);
  }
}

async function adminRenewUser(userId, days, plan) {
  try {
    const res = await fetch(`/api/admin/users/${userId}/renew`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ days, plan })
    });

    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadAdminData();
    }
  } catch (e) {
    alert('Erro ao renovar plano.');
  }
}

async function adminApprovePayment(paymentId) {
  try {
    const res = await fetch(`/api/admin/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadAdminData();
    } else {
      alert(data.error || 'Erro ao aprovar.');
    }
  } catch (e) {
    alert('Erro ao aprovar pagamento.');
  }
}

async function adminRejectPayment(paymentId) {
  try {
    const res = await fetch(`/api/admin/payments/${paymentId}/reject`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadAdminData();
    } else {
      alert(data.error || 'Erro ao recusar.');
    }
  } catch (e) {
    alert('Erro ao recusar pagamento.');
  }
}

async function adminToggleStatus(userId, newStatus) {
  try {
    await fetch(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    loadAdminData();
  } catch (e) {
    alert('Erro ao alterar status.');
  }
}

async function adminDeleteUser(userId) {
  if (await window.SevenUI.confirm('Tem certeza que deseja excluir permanentemente este usuário?', 'Excluir usuário')) {
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      loadAdminData();
    } catch (e) {
      alert('Erro ao excluir usuário.');
    }
  }
}

async function saveAdminPixKey() {
  const pixKey = document.getElementById('admPixKeyInput').value.trim();
  if (!pixKey) return alert('Digite uma chave PIX válida.');

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ pixKey })
    });

    const data = await res.json();
    if (data.success) {
      currentPixKey = pixKey;
      document.getElementById('pixKeyDisplay').value = pixKey;
      alert('Chave PIX atualizada com sucesso!');
    }
  } catch (e) {
    alert('Erro ao salvar chave PIX.');
  }
}
