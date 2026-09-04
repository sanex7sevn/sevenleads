// 🔑 GESTÃO DE AUTENTICAÇÃO E SESSÃO
// ==========================================

function switchAuthTab(tab) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const tabBtnLogin = document.getElementById('tabBtnLogin');
  const tabBtnRegister = document.getElementById('tabBtnRegister');
  const authAlert = document.getElementById('authAlert');
  authAlert.classList.add('hidden');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    tabBtnLogin.className = 'flex-1 py-2 rounded-md font-medium text-[#2563eb] bg-[#0a0a0a] transition';
    tabBtnRegister.className = 'flex-1 py-2 rounded-md font-medium text-slate-400 hover:text-white transition';
  } else {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    tabBtnRegister.className = 'flex-1 py-2 rounded-md font-medium text-[#2563eb] bg-[#0a0a0a] transition';
    tabBtnLogin.className = 'flex-1 py-2 rounded-md font-medium text-slate-400 hover:text-white transition';
  }
}

function showAuthAlert(message, type = 'error') {
  const authAlert = document.getElementById('authAlert');
  authAlert.className = type === 'error'
    ? 'p-3 rounded-lg text-xs font-medium bg-red-500/10 border border-red-500/20 text-red-400'
    : 'p-3 rounded-lg text-xs font-medium bg-[#9abc8a]/10 border border-[#9abc8a]/20 text-[#9abc8a]';
  authAlert.innerText = message;
  authAlert.classList.remove('hidden');
}

// Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('btnLoginSubmit');

  btn.disabled = true;
  btn.innerText = 'Verificando...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showAuthAlert(data.error || 'Falha ao autenticar.');
      return;
    }

    localStorage.removeItem('sevenleads_token');
    authToken = true;
    currentUser = data.user;
    initApp();
  } catch (err) {
    showAuthAlert('Erro de conexão com o servidor.');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Acessar Painel';
  }
});

// Cadastro
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const btn = document.getElementById('btnRegisterSubmit');

  btn.disabled = true;
  btn.innerText = 'Criando conta...';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      showAuthAlert(data.error || 'Erro ao registrar.');
      return;
    }

    localStorage.removeItem('sevenleads_token');
    authToken = true;
    currentUser = data.user;
    initApp();
  } catch (err) {
    showAuthAlert('Erro de conexão com o servidor.');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Criar Minha Conta';
  }
});

async function logoutApp() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('sevenleads_token');
  authToken = null;
  currentUser = null;
  if (waStatusInterval) clearInterval(waStatusInterval);
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('landingScreen')?.classList.remove('hidden');
}

// ==========================================
// 🚀 INICIALIZAÇÃO DO SISTEMA
// ==========================================

async function initApp() {
  if (!authToken) {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('landingScreen')?.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('/api/auth/me');

    if (!res.ok) {
      logoutApp();
      return;
    }

    const data = await res.json();
    currentUser = data.user;

    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('landingScreen')?.classList.add('hidden');
    document.getElementById('userGreeting').innerText = `Olá, ${currentUser.name} (${currentUser.email})`;

    // Atualiza botão Admin
    const btnAdminPanel = document.getElementById('btnAdminPanel');
    if (currentUser.role === 'admin') {
      btnAdminPanel.classList.remove('hidden');
    } else {
      btnAdminPanel.classList.add('hidden');
    }

    updateSubscriptionUI();
    loadPublicSettings();

    // Carrega leads salvos do banco (sobrevivem a reinícios do servidor)
    loadSavedLeads();

    // Inicia monitoramento do WhatsApp do usuário
    checkWhatsAppStatus();
    if (waStatusInterval) clearInterval(waStatusInterval);
    waStatusInterval = setInterval(checkWhatsAppStatus, 4000);
  } catch (err) {
    console.error('Erro ao verificar sessão:', err);
    logoutApp();
  }
}

async function loadPublicSettings() {
  try {
    const res = await fetch('/api/settings/public');
    const data = await res.json();
    if (data.pixKey) {
      currentPixKey = data.pixKey;
      document.getElementById('pixKeyDisplay').value = currentPixKey;
    }
    if (data.plans && data.plans.length) {
      availablePlans = data.plans;
    }
  } catch (e) {}
}

function updateSubscriptionUI() {
  const subBadge = document.getElementById('subBadge');
  const subBadgeText = document.getElementById('subBadgeText');
  const expiredWarningBanner = document.getElementById('expiredWarningBanner');
  const expiredBannerTitle = document.getElementById('expiredBannerTitle');
  const dailyLimitWarning = document.getElementById('dailyLimitWarning');

  if (currentUser.role === 'admin') {
    isPaidUser = true;
    subBadge.className = 'cursor-pointer text-xs px-3 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-300 flex items-center gap-1.5 font-semibold';
    subBadgeText.innerText = '👑 Administrador Vitalício';
    expiredWarningBanner.classList.add('hidden');
    dailyLimitWarning.classList.add('hidden');
    return;
  }

  const planNames = { weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral' };
  const planName = planNames[currentUser.plan] || 'Semanal';

  const expires = currentUser.subscription_expires_at ? new Date(currentUser.subscription_expires_at) : null;
  const now = new Date();
  const diffMs = expires ? expires - now : 0;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  // Teste grátis de 7 dias (1 busca/dia, WhatsApp e IA bloqueados)
  if (currentUser.is_trial) {
    isPaidUser = false;
    if (diffDays > 0) {
      subBadge.className = 'cursor-pointer text-xs px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 flex items-center gap-1.5 font-semibold';
      subBadgeText.innerText = `🎁 Teste grátis · ${diffDays} dia(s) · 1 busca/dia`;
      expiredWarningBanner.classList.add('hidden');
      dailyLimitWarning.classList.add('hidden');
    } else {
      subBadge.className = 'cursor-pointer text-xs px-3 py-1.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-400 flex items-center gap-1.5 font-medium';
      subBadgeText.innerText = '🔴 Período grátis encerrado (Renovar)';
      expiredBannerTitle.innerText = 'Seu período grátis de 7 dias terminou!';
      expiredWarningBanner.classList.remove('hidden');
      dailyLimitWarning.classList.add('hidden');
    }
    return;
  }

  if (!currentUser.subscription_expires_at) {
    // Sem assinatura alguma (sem teste, sem pagamento)
    isPaidUser = false;
    subBadge.className = 'cursor-pointer text-xs px-3 py-1.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-400 flex items-center gap-1.5 font-medium';
    subBadgeText.innerText = '🔴 Assinatura Expirada (Renovar)';
    expiredBannerTitle.innerText = 'Sua assinatura expirou!';
    expiredWarningBanner.classList.remove('hidden');
    dailyLimitWarning.classList.add('hidden');
    return;
  }

  if (diffDays > 0) {
    isPaidUser = true;
    subBadge.className = 'cursor-pointer text-xs px-3 py-1.5 rounded-full border border-[#9abc8a]/30 bg-[#9abc8a]/10 text-[#9abc8a] flex items-center gap-1.5 font-medium';
    subBadgeText.innerText = `🟢 ${planName} · ${diffDays} dia(s)`;
    expiredWarningBanner.classList.add('hidden');
    dailyLimitWarning.classList.add('hidden');
  } else {
    // Assinatura paga expirada: bloqueio total (deve renovar)
    isPaidUser = false;
    subBadge.className = 'cursor-pointer text-xs px-3 py-1.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-400 flex items-center gap-1.5 font-medium';
    subBadgeText.innerText = '🔴 Assinatura Expirada (Renovar)';
    expiredBannerTitle.innerText = `Sua assinatura ${planName} expirou!`;
    expiredWarningBanner.classList.remove('hidden');
    dailyLimitWarning.classList.add('hidden');
  }
}

// ==========================================
