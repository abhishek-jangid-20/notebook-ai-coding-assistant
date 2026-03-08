/**
 * Notebook AI Coding Assistant - Content Script
 * Detects notebook environments, captures selection, inserts AI-generated code
 */

(function() {
  'use strict';

  let isLoading = false;
  let lastInsertionTime = 0;
  let lastMouseX = 0;
  let lastMouseY = 0;
  const DUPLICATE_THRESHOLD_MS = 2000;

  document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }, { passive: true });

  /**
   * Detect if current page is a notebook environment
   */
  function isNotebookEnvironment() {
    const url = window.location.href;
    const body = document.body;

    return (
      url.includes('localhost') ||
      url.includes('127.0.0.1') ||
      url.includes('colab.research.google.com') ||
      url.includes('notebooks.googleusercontent.com') ||
      url.includes('jupyter') ||
      body.querySelector('.jp-Notebook, .notebook_app, [data-notebook], .colab-container') !== null ||
      body.querySelector('.cell, .jp-Cell, .code_cell') !== null ||
      body.querySelector('.CodeMirror, .cm-editor') !== null
    );
  }

  /**
   * Get selected text from the page
   */
  function getSelectedCode() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;
    return selection.toString().trim();
  }

  /**
   * Find the cell element containing the selection
   */
  function findContainingCell(selection) {
    if (!selection || selection.rangeCount === 0) return null;

    let node = selection.anchorNode;
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node = node.parentElement;
    }

    while (node && node !== document.body) {
      if (node.classList) {
        const classList = Array.from(node.classList);
        const isCell = classList.some(c =>
          c.includes('cell') ||
          c.includes('Cell') ||
          c === 'jp-CodeCell' ||
          c === 'code_cell' ||
          c === 'input'
        );
        if (isCell) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Get the end position of the selection within the cell
   */
  function getSelectionEndPosition(selection, cell) {
    if (!selection || !cell) return null;

    const range = selection.getRangeAt(0);
    const pre = selection.anchorNode && selection.anchorNode.nodeType === Node.TEXT_NODE
      ? selection.anchorNode.parentElement
      : selection.anchorNode;

    // Find the editor element (CodeMirror or textarea)
    const editorEl = cell.querySelector('.CodeMirror, .cm-editor, .cm-content, textarea, pre');
    if (!editorEl) return null;

    return { range, editorEl };
  }

  /**
   * Insert code using CodeMirror 5 API
   */
  function insertViaCodeMirror5(editorEl, code, afterSelection) {
    const cm = editorEl.CodeMirror || (editorEl.classList?.contains('CodeMirror') && editorEl);
    if (!cm) return false;

    const cmInstance = cm.CodeMirror ? cm : cm;
    if (typeof cmInstance.replaceRange !== 'function') return false;

    const cursor = cmInstance.getCursor();
    const line = cmInstance.getLine(cursor.line);
    const insertPos = afterSelection
      ? { line: cursor.line, ch: cursor.ch }
      : { line: cursor.line + 1, ch: 0 };

    const prefix = insertPos.ch === 0 ? '' : '\n';
    cmInstance.replaceRange(prefix + code + '\n', insertPos);
    return true;
  }

  /**
   * Insert code using CodeMirror 6 API
   */
  function insertViaCodeMirror6(editorEl, code) {
    const cmEditor = editorEl.closest('.cm-editor');
    if (!cmEditor) return false;

    try {
      const view = cmEditor.__cm_view || cmEditor.querySelector('[data-cm-editor]')?.__cm_view;
      if (!view?.dispatch) return false;

      const state = view.state;
      const selection = state.selection.main;
      const pos = selection.to;
      const line = state.doc.lineAt(pos);
      const insertPos = line.to;

      const transaction = state.update({
        changes: { from: insertPos, to: insertPos, insert: '\n' + code + '\n' }
      });
      view.dispatch(transaction);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Insert code by finding and manipulating the underlying editor
   */
  function insertCode(cell, code, selection) {
    if (!cell || !code) return false;

    // Try CodeMirror 5 (Jupyter Notebook classic, some Colab)
    const cm5 = cell.querySelector('.CodeMirror');
    if (cm5) {
      const cmInstance = cm5.CodeMirror;
      if (cmInstance) {
        const cursor = cmInstance.getCursor('head');
        const from = cmInstance.getCursor('anchor');
        const to = cmInstance.getCursor('head');
        const endPos = from.line > to.line ? from : to.line > from.line ? to : (from.ch > to.ch ? from : to);
        const insertLine = endPos.line + 1;
        const insertCh = 0;
        cmInstance.replaceRange('\n' + code + '\n', { line: insertLine, ch: insertCh });
        return true;
      }
    }

    // Try CodeMirror 6 (JupyterLab)
    const cm6 = cell.querySelector('.cm-editor, .jp-InputArea-editor');
    if (cm6) {
      const editor = cm6.querySelector('.cm-editor') || cm6;
      const view = editor.__cm_view;
      if (view?.state) {
        try {
          const pos = view.state.selection.main.to;
          const line = view.state.doc.lineAt(pos);
          view.dispatch({
            changes: { from: line.to, to: line.to, insert: '\n' + code + '\n' }
          });
          return true;
        } catch (e) {}
      }

      // Alternative: access via wrapper
      const wrapper = cell.closest('.jp-Cell')?.querySelector('.cm-editor');
      if (wrapper) {
        const widgets = document.querySelectorAll('.cm-editor');
        for (const w of widgets) {
          if (cell.contains(w) && w.__cm_view) {
            try {
              const pos = w.__cm_view.state.selection.main.to;
              const line = w.__cm_view.state.doc.lineAt(pos);
              w.__cm_view.dispatch({
                changes: { from: line.to, to: line.to, insert: '\n' + code + '\n' }
              });
              return true;
            } catch (e) {}
          }
        }
      }
    }

    // Fallback: textarea (basic notebooks)
    const textarea = cell.querySelector('textarea');
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const beforeSelection = text.substring(0, end);
      const afterSelection = text.substring(end);
      const lineEnd = beforeSelection.lastIndexOf('\n') + 1;
      const insertPos = end;
      const newValue = text.substring(0, insertPos) + '\n' + code + '\n' + text.substring(insertPos);
      textarea.value = newValue;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    // Fallback: contenteditable or pre
    const pre = cell.querySelector('pre, [contenteditable="true"]');
    if (pre && document.getSelection) {
      const sel = document.getSelection();
      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const textNode = document.createTextNode('\n' + code + '\n');
        range.collapse(false);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
        pre.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }

    // Fallback: simulate paste (works with Monaco, CM6, and most editors)
    return insertViaPaste(cell, code);
  }

  /**
   * Insert code by simulating paste - works with most editors (Monaco, CM6, etc.)
   */
  function insertViaPaste(cell, code) {
    const focusable = cell.querySelector('.CodeMirror, .cm-editor, .cm-content, textarea, [contenteditable="true"], .inputarea');
    if (!focusable) return false;

    const textToPaste = '\n' + code + '\n';
    navigator.clipboard.writeText(textToPaste).then(() => {
      focusable.focus();
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      });
      pasteEvent.clipboardData.setData('text/plain', textToPaste);
      focusable.dispatchEvent(pasteEvent);
    }).catch(() => {});

    return true;
  }

  /**
   * Show loading overlay
   */
  function showLoading() {
    if (isLoading) return;
    isLoading = true;

    const overlay = document.createElement('div');
    overlay.id = 'nb-ai-loading-overlay';
    overlay.className = 'nb-ai-loading';
    overlay.innerHTML = `
      <div class="nb-ai-loading-spinner"></div>
      <span class="nb-ai-loading-text">AI is generating code...</span>
    `;
    document.body.appendChild(overlay);
  }

  /**
   * Hide loading overlay
   */
  function hideLoading() {
    isLoading = false;
    const overlay = document.getElementById('nb-ai-loading-overlay');
    if (overlay) overlay.remove();
  }

  /**
   * Prevent duplicate rapid insertions
   */
  function isDuplicateInsertion() {
    const now = Date.now();
    if (now - lastInsertionTime < DUPLICATE_THRESHOLD_MS) {
      return true;
    }
    lastInsertionTime = now;
    return false;
  }

  /**
   * Show floating result window: draggable, chat input, Accept/Copy, close only via ×
   */
  function showFloatingResult(generatedCode, cell, selection, onAccept, initialCode, initialContext) {
    const existing = document.getElementById('nb-ai-floating-result');
    if (existing) existing.remove();

    const padding = 16;
    let x = lastMouseX + 12;
    let y = lastMouseY + 12;
    const w = 480;
    const maxH = 420;

    if (x + w > window.innerWidth - padding) x = window.innerWidth - w - padding;
    if (y + maxH > window.innerHeight - padding) y = window.innerHeight - maxH - padding;
    if (x < padding) x = padding;
    if (y < padding) y = padding;

    const panel = document.createElement('div');
    panel.id = 'nb-ai-floating-result';
    panel.className = 'nb-ai-floating-panel nb-ai-top-layer';
    panel.style.cssText = `left:${x}px;top:${y}px;width:${w}px;max-height:${maxH}px;`;

    let conversationHistory = [
      { role: 'user', content: initialContext?.trim() ? `Context: ${initialContext}\n\nSelected code:\n${initialCode}` : initialCode },
      { role: 'assistant', content: generatedCode }
    ];

    panel.innerHTML = `
      <div class="nb-ai-floating-header nb-ai-drag-handle">
        <span>AI Assistant</span>
        <button type="button" class="nb-ai-floating-close" title="Close">×</button>
      </div>
      <div class="nb-ai-floating-body">
        <pre class="nb-ai-floating-code"><code>${escapeHtml(generatedCode)}</code></pre>
        <div class="nb-ai-chat-area">
          <textarea class="nb-ai-chat-input" placeholder="Reply to AI..." rows="2"></textarea>
          <button type="button" class="nb-ai-btn nb-ai-btn-send">Send</button>
        </div>
      </div>
      <div class="nb-ai-floating-actions">
        <button type="button" class="nb-ai-btn nb-ai-btn-accept">Accept</button>
        <button type="button" class="nb-ai-btn nb-ai-btn-copy">Copy</button>
      </div>
    `;

    document.body.appendChild(panel);

    // Draggable
    const header = panel.querySelector('.nb-ai-drag-handle');
    let dragging = false, startX, startY, startLeft, startTop;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.nb-ai-floating-close')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(panel.style.left, 10) || 0;
      startTop = parseInt(panel.style.top, 10) || 0;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = (startLeft + e.clientX - startX) + 'px';
      panel.style.top = (startTop + e.clientY - startY) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    function updateCode(newCode) {
      panel.querySelector('.nb-ai-floating-code code').textContent = newCode;
    }

    function close() {
      panel.remove();
    }

    panel.querySelector('.nb-ai-floating-close').onclick = close;

    panel.querySelector('.nb-ai-btn-accept').onclick = () => {
      const code = panel.querySelector('.nb-ai-floating-code code').textContent;
      if (onAccept && cell) {
        const inserted = insertCode(cell, code, selection);
        if (!inserted) navigator.clipboard.writeText(code).catch(() => {});
      }
      close();
    };

    panel.querySelector('.nb-ai-btn-copy').onclick = () => {
      const code = panel.querySelector('.nb-ai-floating-code code').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const btn = panel.querySelector('.nb-ai-btn-copy');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 800);
      }).catch(() => {});
    };

    // Chat / Reply
    const chatInput = panel.querySelector('.nb-ai-chat-input');
    const sendBtn = panel.querySelector('.nb-ai-btn-send');
    async function sendReply() {
      const msg = chatInput.value.trim();
      if (!msg) return;
      chatInput.value = '';
      sendBtn.disabled = true;
      sendBtn.textContent = '...';

      conversationHistory.push({ role: 'user', content: msg });

      try {
        const { autoFormat = false } = await chrome.storage.sync.get(['autoFormat']);
        const res = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'improveCode',
            code: initialCode,
            context: initialContext,
            autoFormat,
            messages: conversationHistory
          }, (r) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
          });
        });
        if (res?.error) throw new Error(res.error);
        const newCode = res?.code || '';
        conversationHistory.push({ role: 'assistant', content: newCode });
        updateCode(newCode);
      } catch (err) {
        updateCode('Error: ' + (err.message || 'Unknown error'));
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    }
    sendBtn.onclick = sendReply;
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Main: capture selection, call API, show floating window or insert
   */
  async function improveCode() {
    if (!isNotebookEnvironment()) {
      console.warn('[Notebook AI] Not a recognized notebook environment.');
      return;
    }

    const selection = window.getSelection();
    const code = getSelectedCode();

    if (!code) {
      alert('Please select code in a notebook cell first, then press Ctrl+Shift+E.');
      return;
    }

    if (isDuplicateInsertion()) {
      return;
    }

    const cell = findContainingCell(selection);
    if (!cell) {
      alert('Could not find the containing notebook cell.');
      return;
    }

    showLoading();

    try {
      const { autoFormat = false, context = '', floatingWindow: useFloating = true } =
        await chrome.storage.sync.get(['autoFormat', 'context', 'floatingWindow']);

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: 'improveCode', code, context: context || '', autoFormat },
          (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(res);
            }
          }
        );
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      const generatedCode = response?.code;
      if (!generatedCode) {
        throw new Error('No code received from AI.');
      }

      if (useFloating) {
        showFloatingResult(generatedCode, cell, selection, true, code, context || '');
      } else {
        const inserted = insertCode(cell, generatedCode, selection);
        if (!inserted) {
          navigator.clipboard.writeText(generatedCode).then(() => {
            alert('Could not insert into cell. Generated code copied to clipboard.');
          }).catch(() => {
            alert('Generated code:\n\n' + generatedCode.substring(0, 500) + (generatedCode.length > 500 ? '...' : ''));
          });
        }
      }
    } catch (err) {
      alert('Error: ' + (err.message || 'Unknown error'));
    } finally {
      hideLoading();
    }
  }

  /**
   * Listen for messages from background (e.g. keyboard shortcut)
   */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'triggerImproveCode') {
      if (!document.hasFocus()) return; // Only respond in focused frame (e.g. notebook iframe)
      improveCode().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
      return true;
    }
  });

  /**
   * Selection popover: show "Send to AI" when text is selected
   */
  let selectionPopover = null;
  let selectionPopoverTimer = null;

  function showSelectionPopover(x, y, selectedText) {
    const existing = document.getElementById('nb-ai-selection-popover');
    if (existing) existing.remove();

    const popover = document.createElement('div');
    popover.id = 'nb-ai-selection-popover';
    popover.className = 'nb-ai-selection-popover nb-ai-top-layer';
    popover.innerHTML = '<button type="button" class="nb-ai-popover-btn">Send to AI</button>';
    popover.style.left = x + 'px';
    popover.style.top = (y - 40) + 'px';

    popover.querySelector('button').onclick = () => {
      selectionPopover = null;
      popover.remove();
      triggerImproveWithCode(selectedText);
    };

    document.body.appendChild(popover);
    selectionPopover = popover;
  }

  function hideSelectionPopover() {
    if (selectionPopover) {
      selectionPopover.remove();
      selectionPopover = null;
    }
  }

  async function triggerImproveWithCode(code) {
    const selection = window.getSelection();
    const cell = findContainingCell(selection);
    const { floatingWindow: useFloating = true, context = '' } = await chrome.storage.sync.get(['context', 'floatingWindow']);
    showLoading();
    try {
      const { autoFormat = false } = await chrome.storage.sync.get(['autoFormat']);
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'improveCode', code, context, autoFormat }, (res) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        });
      });
      if (response?.error) throw new Error(response.error);
      const generatedCode = response?.code;
      if (!generatedCode) throw new Error('No code received.');
      if (useFloating) {
        showFloatingResult(generatedCode, cell, selection, true, code, context || '');
      } else {
        if (cell) insertCode(cell, generatedCode, selection);
        else navigator.clipboard.writeText(generatedCode).catch(() => {});
      }
    } catch (err) {
      alert('Error: ' + (err.message || 'Unknown error'));
    } finally {
      hideLoading();
    }
  }

  document.addEventListener('mouseup', () => {
    clearTimeout(selectionPopoverTimer);
    if (!isNotebookEnvironment()) return;
    const sel = window.getSelection();
    const text = sel?.toString()?.trim();
    const anchor = sel?.anchorNode;
    const inOurUI = anchor && (
      document.getElementById('nb-ai-floating-result')?.contains(anchor) ||
      document.getElementById('nb-ai-selection-popover')?.contains(anchor)
    );
    if (text && text.length > 2 && !inOurUI) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      selectionPopoverTimer = setTimeout(() => {
        showSelectionPopover(rect.left, rect.bottom, text);
      }, 200);
    } else {
      hideSelectionPopover();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.nb-ai-selection-popover')) return;
    clearTimeout(selectionPopoverTimer);
    if (!e.target.closest('#nb-ai-floating-result')) {
      hideSelectionPopover();
    }
  });

  /**
   * Listen for keyboard shortcut locally (backup for when command doesn't reach content)
   */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
      if (isNotebookEnvironment()) {
        e.preventDefault();
        improveCode();
      }
    }
  }, true);

  /**
   * Re-attach to dynamically added cells (JupyterLab/Colab)
   */
  const observer = new MutationObserver(() => {
    // Cells are added dynamically; our handlers work on document level
    // No need to reattach - getSelection() and traversal work globally
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  console.log('[Notebook AI] Content script loaded. Select code and press Ctrl+Shift+E.');
})();
