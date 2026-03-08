# 🚀 Notebook AI Coding Assistant

An intelligent, lightweight Chrome Extension that transforms your **Jupyter Notebook**, **JupyterLab**, and **Google Colab** environments into an AI-powered workspace. Select your code, use a quick keyboard shortcut, and instantly generate improved, refactored, or corrected code directly into your notebook. Built with support for top-tier LLMs like OpenAI, Anthropic, Google Gemini, and Groq.

## Features

- **Works in**: Jupyter Notebook (classic), JupyterLab, Google Colab
- **Shortcut**: `Ctrl+Shift+E` (Windows/Linux) or `Cmd+Shift+E` (Mac)
- **AI Providers**: OpenAI (GPT), Groq, Anthropic (Claude), Google (Gemini)
- **Context**: Add optional instructions (e.g. "optimize for speed", "add error handling") in the popup—applied to every request
- **Floating result window** (stays on top, only closes via ×):
  - **Draggable** – drag the header to move
  - **Accept** – insert code into the cell
  - **Copy** – copy to clipboard
  - **Chat** – type a follow-up message and click Send to continue the conversation
  - **×** – close (does not close when clicking elsewhere)
- **Selection popover** – select any text in the notebook to see a "Send to AI" button

## Installation

### Load the Extension in Chrome (Developer Mode)

1. **Open Chrome** and go to `chrome://extensions/`
2. **Enable Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the folder containing the extension (this `chrome_extension` folder)
5. The extension icon should appear in your toolbar

### Configure Your API Key

1. **Open the extension popup**  
   - Click the **puzzle piece** (Extensions) in the Chrome toolbar  
   - Click **"Notebook AI Coding Assistant"**  
   - Or right‑click the extension icon and choose **"Always show in toolbar"** so you can click it directly
2. In the popup, choose your **AI provider** (GPT, Claude, or Gemini)
3. Select the **model**
4. Paste your **API key** into the API Key field
5. Toggle **Auto-format** if desired
6. Click **Save Settings**

## Usage

1. Open a notebook in Jupyter, JupyterLab, or Colab
2. Select the code you want to improve, fix, or complete
3. Press **`Ctrl+Shift+E`** (or **`Cmd+Shift+E`** on Mac)
4. Wait for the AI to generate the code (a loading overlay appears)
5. The generated code is inserted directly **below** your selection

## Jupyter URL Matching

The extension runs on:

- `http://localhost/*`
- `http://localhost:8888/*`, `http://localhost:8889/*`
- `http://127.0.0.1/*`, `http://127.0.0.1:8888/*`
- `https://colab.research.google.com/*`
- `https://*.notebooks.googleusercontent.com/*`
- `https://*.jupyter.org/*`
- `file:///*`

If your Jupyter server uses a different port, you may need to add it. Go to `chrome://extensions/`, find the extension, click **Details** → **Site access** → **On specific sites** and add your URL.

## API Keys

- **OpenAI**: Get from [platform.openai.com](https://platform.openai.com/api-keys)
- **Anthropic**: Get from [console.anthropic.com](https://console.anthropic.com/)
- **Google Gemini**: Get from [aistudio.google.com](https://aistudio.google.com/app/apikey)

API keys are stored locally in Chrome's sync storage and are only sent to the chosen provider's API.

## File Structure

```
chrome_extension/
├── manifest.json    # Extension config (Manifest V3)
├── background.js    # Service worker, LLM API calls
├── content.js       # Notebook detection, selection, insertion
├── popup.html       # Settings popup UI
├── popup.js         # Popup logic
├── styles.css       # Popup + loading overlay styles
└── README.md        # This file
```

## Troubleshooting

- **Extension doesn't run on my notebook**: Ensure the notebook URL matches the patterns above. Add your URL in extension Site access if needed.
- **No code inserted**: The extension will copy the generated code to the clipboard if insertion fails. Paste manually.
- **"Please set your API key"**: Open the popup and save your API key.
- **Keyboard shortcut not working**: Check `chrome://extensions/shortcuts` to view or customize the shortcut (default: Ctrl+Shift+E).

## License

MIT
