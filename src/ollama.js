const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const VARIATION_COUNT = 4;

function buildPrompt({ name, niche, service, variationIndex }) {
  return `Você escreve mensagens curtas de prospecção comercial no WhatsApp, em português do Brasil.

Nicho do comércio que será contatado: ${niche}
Serviço que estou oferecendo: ${service}
Variação número: ${variationIndex + 1}

Regras obrigatórias:
- Escreva um MODELO de mensagem genérico. Onde o nome da empresa deve aparecer, escreva o texto exato {nome}. Onde a região/endereço puder aparecer, escreva {endereco}.
- Mensagem curta (máximo 3 frases, até 350 caracteres)
- Tom informal, natural, como se fosse uma pessoa real
- Mencione de forma natural que você viu o perfil da empresa no Google Maps
- NÃO use saudação genérica repetida (evite começar sempre com "Olá", "Oi, tudo bem?")
- NÃO pareça spam, NÃO use CAPS, NÃO use várias exclamações
- NÃO inclua links, URLs, hashtags ou call-to-action agressivo
- No máximo 1 emoji, e ele é opcional
- Não invente dados que não foram informados
- Não assine a mensagem
- Responda APENAS com o texto da mensagem, sem aspas e sem explicação`;
}

function cleanGeneratedText(text) {
  if (!text) return '';
  return String(text)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeOllamaError(err) {
  const code = err?.cause?.code || err?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
    return `Ollama não está rodando em ${OLLAMA_URL}. Abra um terminal e execute: ollama serve`;
  }
  if (String(err?.message || '').includes('fetch failed')) {
    return `Não foi possível conectar ao Ollama em ${OLLAMA_URL}. Confirme se o serviço está ativo (ollama serve).`;
  }
  return err?.message || 'Falha desconhecida ao gerar mensagem com Ollama.';
}

export async function generateOneVariation({ name, niche, service, variationIndex = 0 }) {
  const prompt = buildPrompt({ name, niche, service, variationIndex });

  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.9,
          top_p: 0.95
        }
      })
    });
  } catch (err) {
    const error = new Error(describeOllamaError(err));
    error.code = 'OLLAMA_OFFLINE';
    throw error;
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch (e) {}

    if (res.status === 404 || /model/i.test(detail)) {
      const error = new Error(`Modelo "${OLLAMA_MODEL}" não encontrado no Ollama. Baixe com: ollama pull ${OLLAMA_MODEL}`);
      error.code = 'OLLAMA_MODEL_MISSING';
      throw error;
    }

    const error = new Error(`Ollama retornou erro HTTP ${res.status}. ${detail.slice(0, 180)}`.trim());
    error.code = 'OLLAMA_HTTP';
    throw error;
  }

  const data = await res.json();
  const text = cleanGeneratedText(data.response);
  if (!text) {
    throw new Error('Ollama respondeu, mas a mensagem veio vazia. Tente outro modelo ou gere novamente.');
  }
  return text;
}

export async function generateMessageVariations({ name, niche, service, count = VARIATION_COUNT }) {
  const variations = [];
  const seen = new Set();
  let lastError = null;

  for (let i = 0; i < count; i++) {
    try {
      const text = await generateOneVariation({ name, niche, service, variationIndex: i });
      const key = text.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        variations.push(text);
      }
    } catch (err) {
      lastError = err;
      if (err.code === 'OLLAMA_OFFLINE' || err.code === 'OLLAMA_MODEL_MISSING') {
        throw err;
      }
    }
  }

  if (variations.length === 0) {
    throw lastError || new Error('Não foi possível gerar variações de mensagem.');
  }

  return variations;
}

export function pickRandomVariation(variations, usedMessages = []) {
  if (!Array.isArray(variations) || variations.length === 0) return null;
  const used = new Set((usedMessages || []).map((m) => String(m).toLowerCase()));
  const unused = variations.filter((v) => !used.has(String(v).toLowerCase()));
  const pool = unused.length ? unused : variations;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getOllamaConfig() {
  return { url: OLLAMA_URL, model: OLLAMA_MODEL, variationCount: VARIATION_COUNT };
}
