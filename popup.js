/**
 * Notebook AI Coding Assistant - Popup Script
 * Manages API key, provider, model, and settings
 */

const providerSelect = document.getElementById('provider');
const modelSelect = document.getElementById('model');
const apiKeyInput = document.getElementById('apiKey');
const contextInput = document.getElementById('context');
const autoFormatCheckbox = document.getElementById('autoFormat');
const floatingWindowCheckbox = document.getElementById('floatingWindow');
const saveButton = document.getElementById('save');
const statusEl = document.getElementById('status');
const fetchModelsBtn = document.getElementById('fetchModels');
const modelStatusEl = document.getElementById('modelStatus');

const PROVIDERS_WITH_FETCH = ['gpt', 'groq', 'claude', 'gemini'];

const MODELS = {
  gpt: [],
  groq: [],
  claude: [],
  gemini: []
};

function setModelStatus(text, loading = false) {
  modelStatusEl.textContent = text;
  modelStatusEl.className = 'hint model-status' + (loading ? ' loading' : '');
}

function populateModels(provider, preserveValue) {
  const models = MODELS[provider] || [];
  const currentValue = preserveValue ? modelSelect.value : null;
  modelSelect.innerHTML = models.length
    ? models.map(m => `<option value="${m.value}">${m.label}</option>`).join('')
    : '<option value="">Enter API key → click ↻ to fetch</option>';
  const hasCurrent = models.some(m => m.value === currentValue);
  if (preserveValue && hasCurrent) {
    modelSelect.value = currentValue;
  } else if (models.length) {
    modelSelect.value = models[0].value;
  } else {
    modelSelect.value = '';
  }
  fetchModelsBtn.style.display = PROVIDERS_WITH_FETCH.includes(provider) ? 'inline-flex' : 'none';
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + (isError ? 'status-error' : 'status-success');
  statusEl.hidden = false;
  if (message) {
    setTimeout(() => {
      statusEl.hidden = true;
      statusEl.textContent = '';
    }, 3000);
  }
}

const DEFAULT_MODELS = {
  gpt: 'gpt-4o-mini',
  groq: 'llama-3.1-8b-instant',
  claude: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-1.5-flash'
};

async function fetchModels() {
  const provider = providerSelect.value;
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showStatus('Enter API key first.', true);
    return;
  }
  if (!PROVIDERS_WITH_FETCH.includes(provider)) return;

  setModelStatus('Fetching models...', true);
  fetchModelsBtn.disabled = true;

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'fetchModels',
      provider,
      apiKey
    });
    if (res?.error) throw new Error(res.error);
    if (res?.models?.length) {
      MODELS[provider] = res.models;
      populateModels(provider, false);
      setModelStatus(`Loaded ${res.models.length} model(s)`);
    } else {
      setModelStatus('No models returned');
    }
  } catch (e) {
    setModelStatus('Failed: ' + (e.message || 'Unknown error'));
    showStatus(e.message || 'Failed to fetch models', true);
  } finally {
    fetchModelsBtn.disabled = false;
  }
}

async function loadSettings() {
  const { apiKey, provider, model, autoFormat, context, floatingWindow } = await chrome.storage.sync.get([
    'apiKey',
    'provider',
    'model',
    'autoFormat',
    'context',
    'floatingWindow'
  ]);

  const p = provider || 'gpt';
  providerSelect.value = p;
  populateModels(p, false);
  const models = MODELS[p] || [];
  const validModel = model && models.some(m => m.value === model) ? model : DEFAULT_MODELS[p];
  if (validModel) modelSelect.value = validModel;
  apiKeyInput.value = apiKey || '';
  contextInput.value = context || '';
  autoFormatCheckbox.checked = autoFormat !== false;
  floatingWindowCheckbox.checked = floatingWindow !== false;

  if (apiKey && PROVIDERS_WITH_FETCH.includes(p) && (!MODELS[p] || MODELS[p].length === 0)) {
    fetchModels();
  }
}

function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  const provider = providerSelect.value;
  let model = modelSelect.value;
  if (!model && DEFAULT_MODELS[provider]) model = DEFAULT_MODELS[provider];

  if (!apiKey) {
    showStatus('Please enter an API key.', true);
    return;
  }
  chrome.storage.sync.set({
    apiKey,
    provider,
    model,
    context: contextInput.value.trim(),
    autoFormat: autoFormatCheckbox.checked,
    floatingWindow: floatingWindowCheckbox.checked
  }, () => {
    showStatus('Settings saved.');
  });
}

providerSelect.addEventListener('change', () => {
  const p = providerSelect.value;
  populateModels(p, true);
  setModelStatus('');
  if (apiKeyInput.value.trim() && PROVIDERS_WITH_FETCH.includes(p) && (!MODELS[p] || MODELS[p].length === 0)) {
    fetchModels();
  }
});

fetchModelsBtn.addEventListener('click', fetchModels);

apiKeyInput.addEventListener('blur', () => {
  const p = providerSelect.value;
  if (apiKeyInput.value.trim() && PROVIDERS_WITH_FETCH.includes(p) && (!MODELS[p] || MODELS[p].length === 0)) {
    fetchModels();
  }
});

saveButton.addEventListener('click', saveSettings);

document.addEventListener('DOMContentLoaded', loadSettings);
