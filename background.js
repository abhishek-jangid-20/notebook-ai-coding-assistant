/**
 * Notebook AI Coding Assistant - Background Service Worker
 * Handles LLM API calls and message passing
 */

const SYSTEM_PROMPT = `You are an expert Python programmer working inside a Jupyter notebook.
Given the selected code, generate the corrected or completed version.
Return ONLY executable Python code with proper indentation.
Do not include explanations, markdown, or comments unless necessary.`;

const API_ENDPOINTS = {
  gpt: 'https://api.openai.com/v1/chat/completions',
  claude: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models/'
};

/**
 * Call OpenAI GPT API (supports multi-turn via messages array)
 */
async function callOpenAI(apiKey, model, code, systemPrompt, messages = null) {
  const msgs = messages || [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: code }
  ];
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: messages ? [{ role: 'system', content: systemPrompt }, ...messages] : msgs,
      temperature: 0.3,
      max_tokens: 4096
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

/**
 * Call Anthropic Claude API (supports multi-turn via messages array)
 */
async function callClaude(apiKey, model, code, systemPrompt, messages = null) {
  const msgs = messages || [{ role: 'user', content: code }];
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: systemPrompt,
      messages: msgs
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const textBlock = data.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text.trim() : '';
}

/**
 * Call Groq API (OpenAI-compatible, supports multi-turn)
 */
async function callGroq(apiKey, model, code, systemPrompt, messages = null) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'llama-3.1-8b-instant',
      messages: messages
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: code }
          ],
      temperature: 0.3,
      max_tokens: 4096
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

/**
 * Fetch available models from provider API
 */
async function fetchModelsFromAPI(provider, apiKey) {
  if (provider === 'groq') {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    return (data.data || []).map(m => ({ value: m.id, label: m.id }));
  }
  if (provider === 'gpt') {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    const chatModels = (data.data || []).filter(m =>
      m.id && (m.id.startsWith('gpt-') || m.id.includes('gpt'))
    );
    return chatModels.map(m => ({ value: m.id, label: m.id }));
  }
  if (provider === 'claude') {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    return (data.data || []).map(m => ({
      value: m.id,
      label: m.display_name || m.id
    }));
  }
  if (provider === 'gemini') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    const generateModels = (data.models || []).filter(m =>
      m.supportedGenerationMethods?.includes('generateContent')
    );
    return generateModels.map(m => ({
      value: m.name.replace('models/', ''),
      label: m.displayName || m.name
    }));
  }
  return null;
}

/**
 * Call Google Gemini API
 */
async function callGemini(apiKey, model, code, systemPrompt) {
  const modelId = model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `${systemPrompt}\n\nUser code:\n${code}` }
        ]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096
      }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? text.trim() : '';
}

/**
 * Call Gemini with multi-turn messages (converts to single concatenated text)
 */
async function callGeminiWithMessages(apiKey, model, systemPrompt, messages) {
  const parts = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
  return callGemini(apiKey, model, parts, systemPrompt);
}

/**
 * Extract code from LLM response (strip markdown code blocks if present)
 */
function extractCode(text) {
  if (!text || typeof text !== 'string') return '';
  let code = text.trim();

  // Remove markdown code blocks
  const codeBlockMatch = code.match(/```(?:python)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    code = codeBlockMatch[1].trim();
  }

  return code;
}

/**
 * Handle extension command (keyboard shortcut)
 */
chrome.commands.onCommand.addListener((command) => {
  if (command === 'improve-code') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'triggerImproveCode' });
      } catch (e) {
        // Content script may not be loaded; inject it and try again
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['content.js']
          });
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id, allFrames: true },
            files: ['styles.css']
          });
          await new Promise(r => setTimeout(r, 100));
          await chrome.tabs.sendMessage(tab.id, { action: 'triggerImproveCode' });
        } catch (e2) {
          console.warn('[Notebook AI] Could not trigger:', e2);
        }
      }
    });
  }
});

/**
 * Handle messages from content script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'improveCode') {
    handleImproveCode(
      message.code,
      message.context,
      message.autoFormat,
      message.messages,
      sender.tab?.id
    )
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === 'fetchModels') {
    fetchModelsFromAPI(message.provider, message.apiKey)
      .then(models => sendResponse({ models }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

/**
 * Main handler: call LLM and return generated code
 * messages: optional conversation history [{role, content}, ...] for multi-turn
 */
async function handleImproveCode(code, context, autoFormat, messages = null, tabId = null) {
  const { apiKey, provider, model } = await chrome.storage.sync.get(['apiKey', 'provider', 'model']);

  if (!apiKey?.trim()) {
    throw new Error('Please set your API key in the extension popup.');
  }

  const userContent = messages
    ? null
    : (context?.trim() ? `Context: ${context.trim()}\n\nSelected code:\n${code}` : code);

  if (!messages && !code?.trim()) {
    throw new Error('No code selected. Select code and try again.');
  }

  const systemPrompt = SYSTEM_PROMPT + (autoFormat ? '\nApply consistent formatting and style.' : '');

  let generatedCode;

  if (messages) {
    switch (provider) {
      case 'gpt':
        generatedCode = await callOpenAI(apiKey, model, null, systemPrompt, messages);
        break;
      case 'groq':
        generatedCode = await callGroq(apiKey, model, null, systemPrompt, messages);
        break;
      case 'claude':
        generatedCode = await callClaude(apiKey, model, null, systemPrompt, messages);
        break;
      case 'gemini':
        generatedCode = await callGeminiWithMessages(apiKey, model, systemPrompt, messages);
        break;
      default:
        throw new Error('Please select an AI provider in the extension popup.');
    }
  } else {
    switch (provider) {
      case 'gpt':
        generatedCode = await callOpenAI(apiKey, model, userContent, systemPrompt);
        break;
      case 'groq':
        generatedCode = await callGroq(apiKey, model, userContent, systemPrompt);
        break;
      case 'claude':
        generatedCode = await callClaude(apiKey, model, userContent, systemPrompt);
        break;
      case 'gemini':
        generatedCode = await callGemini(apiKey, model, userContent, systemPrompt);
        break;
      default:
        throw new Error('Please select an AI provider in the extension popup.');
    }
  }

  const extracted = extractCode(generatedCode);
  return { code: extracted };
}
