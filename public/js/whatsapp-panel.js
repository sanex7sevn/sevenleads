// 🤖 WHATSAPP MULTI-TENANT (DO USUÁRIO LOGADO)
// ==========================================

function openQrModal() {
  document.getElementById('qrModal').classList.remove('hidden');
  checkWhatsAppStatus();
}

function closeQrModal() {
  document.getElementById('qrModal').classList.add('hidden');
}

async function checkWhatsAppStatus() {
  if (!authToken) return;

  try {
    const res = await fetch('/api/whatsapp/status', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!res.ok) return;
    const data = await res.json();

    const waStatusBadge = document.getElementById('waStatusBadge');
    const waStatusText = document.getElementById('waStatusText');
    const qrLoading = document.getElementById('qrLoading');
    const qrImage = document.getElementById('qrImage');
    const btnLogoutWa = document.getElementById('btnLogoutWa');

    if (data.connected) {
      waStatusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#9abc8a]/10 border border-[#9abc8a]/20 text-[#9abc8a] text-xs cursor-pointer font-medium hover:bg-[#9abc8a]/20 transition';
      waStatusBadge.querySelector('span').className = 'w-2 h-2 rounded-full bg-[#9abc8a]';
      waStatusText.innerText = 'WhatsApp Conectado';
      btnLogoutWa.classList.remove('hidden');
      qrLoading.innerHTML = '<span class="text-[#9abc8a] font-bold text-sm"><i class="fa-solid fa-circle-check text-xl block mb-1"></i> WhatsApp Conectado!</span>';
      qrLoading.classList.remove('hidden');
      qrImage.classList.add('hidden');
    } else {
      waStatusBadge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs cursor-pointer font-medium hover:bg-red-500/20 transition';
      waStatusBadge.querySelector('span').className = 'w-2 h-2 rounded-full bg-red-500 animate-pulse';
      waStatusText.innerText = 'WhatsApp Desconectado';
      btnLogoutWa.classList.add('hidden');

      if (data.qrCode) {
        qrImage.src = data.qrCode;
        qrImage.classList.remove('hidden');
        qrLoading.classList.add('hidden');
      } else {
        qrLoading.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xl text-[#087CFF] mb-2"></i><span>Aguardando QR Code...</span>';
        qrLoading.classList.remove('hidden');
        qrImage.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Erro status WA:', err);
  }
}

async function resetUserWhatsApp() {
  const btn = document.getElementById('btnResetQr');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';

  try {
    await fetch('/api/whatsapp/reset', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    setTimeout(checkWhatsAppStatus, 1500);
  } catch (e) {
    alert('Erro ao resetar: ' + e.message);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Novo QR';
    }, 2500);
  }
}

async function logoutUserWhatsApp() {
  if (await window.SevenUI.confirm('Deseja realmente desconectar seu WhatsApp?', 'Desconectar WhatsApp')) {
    try {
      await fetch('/api/whatsapp/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      checkWhatsAppStatus();
    } catch (e) {
      alert('Erro ao desconectar.');
    }
  }
}

// ==========================================
