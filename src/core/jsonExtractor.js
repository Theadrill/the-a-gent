/**
 * jsonExtractor.js
 *
 * Função utilitária pura que extrai e valida JSON de respostas brutas do LLM.
 *
 * Propósito: Blindar o Node.js contra respostas malformadas da IA ("alucinações" de formatação).
 *
 * Como funciona:
 * 1. Recebe a resposta em texto bruto da IA
 * 2. Encontra a primeira '{' e a última '}'
 * 3. Extrai o substring entre essas posições
 * 4. Tenta fazer JSON.parse() do conteúdo
 * 5. Retorna um objeto envelope {success, data, error}
 *
 * Formato de retorno:
 * {
 *   success: boolean,
 *   data: object|null,   // JSON parseado se bem-sucedido
 *   error: string|null   // Mensagem de erro se falhar
 * }
 */

/**
 * Objeto de resposta padrão — usado como fallback seguro quando o JSON é inválido.
 * Garante que o código downstream nunca quebre ao acessar .resposta, .acao ou .parametros.
 */
const FALLBACK_RESPONSE = {
  resposta: 'Não foi possível interpretar a resposta da IA. Por favor, tente novamente.',
  acao: null,
  parametros: null,
};

/**
 * Extrai JSON de uma resposta bruta do LLM.
 * @param {string} rawResponse - A resposta em texto bruto da IA
 * @returns {{success: boolean, data: object|null, error: string|null}}
 */
function extractJson(rawResponse) {
  // Validação inicial: resposta deve ser uma string não vazia
  if (typeof rawResponse !== 'string' || rawResponse.trim() === '') {
    return {
      success: false,
      data: null,
      error: 'Resposta vazia ou não é uma string',
    };
  }

  // Encontra a primeira '{' e a última '}'
  const firstBrace = rawResponse.indexOf('{');
  const lastBrace = rawResponse.lastIndexOf('}');

  // CORREÇÃO: usa '<' (menor estrito), não '<='.
  // Rejeita apenas quando '}' aparece ANTES de '{' (ex: string "} algum texto {").
  // lastBrace === firstBrace é impossível (um char não pode ser '{' e '}' ao mesmo tempo).
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return {
      success: false,
      data: null,
      error: 'Resposta não contém JSON válido (faltam chaves de abertura/fechamento)',
    };
  }

  // Extrai o substring entre as chaves (incluindo as chaves)
  const jsonSubstring = rawResponse.substring(firstBrace, lastBrace + 1);

  try {
    const parsedData = JSON.parse(jsonSubstring);
    return {
      success: true,
      data: parsedData,
      error: null,
    };
  } catch (parseError) {
    return {
      success: false,
      data: null,
      error: `Falha ao parsear JSON: ${parseError.message}`,
    };
  }
}

/**
 * Valida a estrutura do JSON extraído.
 * @param {object} jsonData - O JSON parseado para validar
 * @returns {{valid: boolean, missingFields: string[]}}
 */
function validateJsonStructure(jsonData) {
  if (typeof jsonData !== 'object' || jsonData === null || Array.isArray(jsonData)) {
    return {
      valid: false,
      missingFields: ['estrutura de objeto'],
    };
  }

  const missingFields = [];
  const hasResposta = 'resposta' in jsonData;
  const hasAcao = 'acao' in jsonData || 'tool_call' in jsonData;

  if (!hasResposta && !hasAcao) {
    missingFields.push('resposta', 'acao');
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

function isUsingFallback(parsed) {
  return parsed && parsed.data &&
    parsed.data.resposta === FALLBACK_RESPONSE.resposta &&
    parsed.success === false;
}

/**
 * Pipeline completo: extrai o JSON bruto e valida a estrutura.
 * Retorna sempre um objeto seguro para o downstream consumir.
 *
 * @param {string} rawResponse - A resposta bruta da IA
 * @returns {{success: boolean, data: object, error: string|null}}
 */
function parseAndValidate(rawResponse) {
  const extracted = extractJson(rawResponse);

  if (!extracted.success) {
    return {
      success: false,
      data: FALLBACK_RESPONSE,
      error: extracted.error,
    };
  }

  const validation = validateJsonStructure(extracted.data);

  if (!validation.valid) {
    const error = `JSON extraído com campos faltando: [${validation.missingFields.join(', ')}]`;
    console.warn('[JSONExtractor]', error);
    const merged = { ...FALLBACK_RESPONSE, ...extracted.data };
    const hasAcao = !!(merged.acao || merged.tool_call);
    return {
      success: hasAcao,
      data: merged,
      error: hasAcao ? null : error,
    };
  }

  return {
    success: true,
    data: extracted.data,
    error: null,
  };
}

module.exports = {
  extractJson,
  validateJsonStructure,
  parseAndValidate,
  isUsingFallback,
  FALLBACK_RESPONSE,
};