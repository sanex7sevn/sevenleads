export default [
  {
    ignores: ['node_modules/**', 'data/**', 'auth_sessions/**', 'public/vendor/**', 'public/styles/tailwind.css']
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        location: 'readonly', history: 'readonly', fetch: 'readonly', FormData: 'readonly', Headers: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', Response: 'readonly', CSS: 'readonly', XLSX: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        AbortController: 'readonly', AbortSignal: 'readonly',
        console: 'readonly', process: 'readonly', Buffer: 'readonly', alert: 'readonly', confirm: 'readonly',
        currentUser: 'writable', authToken: 'writable', leadsData: 'writable', currentFilter: 'writable',
        isPaidUser: 'writable', selectedPlan: 'writable', availablePlans: 'writable', renderTable: 'writable',
        currentPixKey: 'writable', waStatusInterval: 'writable', usedAiMessages: 'writable',
        LEAD_STATUS_ORDER: 'readonly', LEAD_STATUS_LABEL: 'readonly',
        normalizeLead: 'readonly', switchAuthTab: 'readonly', openPixModal: 'readonly', closeAdminModal: 'readonly',
        loadAdminData: 'readonly', requestPayment: 'writable', openLeadWhatsApp: 'readonly',
        escapeHtml: 'readonly', initApp: 'readonly', loadSavedLeads: 'readonly', checkOllamaStatus: 'readonly',
        checkWhatsAppStatus: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
