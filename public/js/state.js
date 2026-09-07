let currentUser = null;
localStorage.removeItem('sevenleads_token');
let authToken = true;
let leadsData = [];
let currentFilter = 'no-site';
let currentPixKey = 'seu-pix-aqui@chave.com';
let waStatusInterval = null;
let availablePlans = [];
let selectedPlan = 'weekly';
let isPaidUser = false;
let usedAiMessages = [];
const LEAD_STATUS_ORDER = { novo: 0, contatado: 1, respondeu: 2, reuniao: 3, proposta: 4, cliente: 5 };
const LEAD_STATUS_LABEL = {
  novo: 'Novo',
  contatado: 'Contatado',
  respondeu: 'Respondeu',
  reuniao: 'Reunião',
  proposta: 'Proposta',
  cliente: 'Cliente'
};

// ==========================================
