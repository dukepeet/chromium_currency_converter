// Walks the page DOM, finds currency amounts in text nodes, and appends a
// small "(≈ converted amount)" annotation next to each one. Watches for
// dynamically loaded content (SPA webshops, infinite scroll, etc).
(function () {
  const { findMatches, convert, formatAmount, QUICK_TEST } = self.DoCConverter;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE', 'TITLE']);
  const WRAP_CLASS = 'doc-currencies-wrap';
  const ANNOTATION_CLASS = 'doc-currencies-annotation';
  const SKIP_SELECTOR = `.${WRAP_CLASS}, script, style, noscript, textarea, input, select, code, pre, title, [contenteditable="true"], [contenteditable=""]`;

  let targetCurrency = null;
  let rates = null;
  let ratesDate = null;
  let observer = null;
  let scheduled = false;
  const pendingRoots = new Set();

  function isReady() {
    return !!(targetCurrency && rates);
  }

  function shouldSkipElement(el) {
    if (!el) return false;
    return !!el.closest(SKIP_SELECTOR);
  }

  function annotateTextNode(textNode) {
    const text = textNode.nodeValue;
    if (!text || !QUICK_TEST.test(text)) return;

    const matches = findMatches(text).filter((m) => m.code !== targetCurrency);
    if (!matches.length) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    let appended = false;

    for (const match of matches) {
      const converted = convert(match.amount, match.code, rates);
      if (converted === null) continue;

      frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));

      const wrap = document.createElement('span');
      wrap.className = WRAP_CLASS;
      wrap.appendChild(document.createTextNode(match.raw));

      const annotation = document.createElement('span');
      annotation.className = ANNOTATION_CLASS;
      annotation.textContent = `(≈ ${formatAmount(converted, targetCurrency)})`;
      const inverse = (1 / rates[match.code]).toFixed(4);
      annotation.title = `1 ${targetCurrency} ≈ ${inverse} ${match.code} · ECB reference rates via Frankfurter, ${ratesDate}`;
      wrap.appendChild(document.createTextNode(' '));
      wrap.appendChild(annotation);

      frag.appendChild(wrap);
      cursor = match.index + match.length;
      appended = true;
    }

    if (!appended) return;
    frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(frag);
  }

  function scanRoot(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      const parent = root.parentElement;
      if (parent && !SKIP_TAGS.has(parent.tagName) && !parent.isContentEditable && !shouldSkipElement(parent)) {
        annotateTextNode(root);
      }
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && shouldSkipElement(root)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (shouldSkipElement(parent)) return NodeFilter.FILTER_REJECT;
        if (!QUICK_TEST.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(annotateTextNode);
  }

  function flushPending() {
    scheduled = false;
    if (!isReady()) {
      pendingRoots.clear();
      return;
    }
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const root of roots) {
      if (root.nodeType === Node.TEXT_NODE ? root.parentNode : document.contains(root)) {
        scanRoot(root);
      }
    }
  }

  function schedule(root) {
    pendingRoots.add(root);
    if (scheduled) return;
    scheduled = true;
    const run = () => flushPending();
    if ('requestIdleCallback' in window) {
      requestIdleCallback(run, { timeout: 1000 });
    } else {
      setTimeout(run, 150);
    }
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains(WRAP_CLASS)) {
            continue; // our own annotation, never re-scan it
          }
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            schedule(node);
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Asks the background service worker for live rates. It fetches fresh
  // rates on every call (deduping concurrent requests from multiple tabs)
  // and only falls back to its cached copy if the live fetch fails.
  async function loadState() {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'get-rates' });
    } catch (err) {
      console.error('[Dictionary of Currencies] could not reach background for rates', err);
      return;
    }
    if (!response || !response.ok) {
      console.error('[Dictionary of Currencies] rate fetch failed', response && response.error);
      return;
    }
    targetCurrency = response.targetCurrency || null;
    rates = response.rates || null;
    ratesDate = response.ratesDate || null;
  }

  (async function init() {
    await loadState();
    if (isReady() && document.body) schedule(document.body);
    startObserving();
  })();
})();
