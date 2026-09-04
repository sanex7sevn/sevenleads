(function () {
  let confirmResolver = null;
  let lastFocused = null;

  function notify(message, type = 'info', title) {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const heading = title || (type === 'error' ? 'Não foi possível' : type === 'success' ? 'Tudo certo' : 'SevenLeads');
    toast.innerHTML = `<strong>${escapeHtml(heading)}</strong><span>${escapeHtml(message)}</span>`;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), type === 'error' ? 6500 : 4200);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    lastFocused = document.activeElement;
    modal.classList.remove('hidden');
    const focusable = modal.querySelector('input, select, textarea, button');
    setTimeout(() => focusable?.focus(), 0);
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
    lastFocused?.focus?.();
  }

  function confirmAction(message, title = 'Confirmar ação') {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    openModal('confirmModal');
    return new Promise((resolve) => { confirmResolver = resolve; });
  }

  document.getElementById('confirmCancel')?.addEventListener('click', () => {
    closeModal('confirmModal');
    confirmResolver?.(false);
    confirmResolver = null;
  });
  document.getElementById('confirmOk')?.addEventListener('click', () => {
    closeModal('confirmModal');
    confirmResolver?.(true);
    confirmResolver = null;
  });
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
  document.querySelectorAll('.app-modal').forEach((modal) => modal.addEventListener('mousedown', (event) => {
    if (event.target === modal && modal.id !== 'confirmModal') closeModal(modal.id);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const modal = [...document.querySelectorAll('.app-modal:not(.hidden)')].pop();
    if (modal && modal.id !== 'confirmModal') closeModal(modal.id);
  });

  window.SevenUI = { notify, openModal, closeModal, confirm: confirmAction, escapeHtml, safeUrl };
  window.alert = (message) => notify(String(message), /erro|falha|inválid|não foi/i.test(String(message)) ? 'error' : 'info');
})();
