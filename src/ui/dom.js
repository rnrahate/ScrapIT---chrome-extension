/**
 * @module dom
 * Shared safe-DOM construction helper.
 *
 * SECURITY: This module enforces the rule that all DOM is built via
 * createElement / textContent / setAttribute / appendChild. It NEVER
 * uses innerHTML, outerHTML, insertAdjacentHTML, or document.write.
 *
 * All text rendered from model output MUST use textContent (via the
 * `textContent` attr key or string children) so that HTML entities and
 * tags are escaped automatically by the browser.
 */

/**
 * Create an element with attributes and children.
 *
 * @param {string} tag           HTML tag name.
 * @param {Object} [attrs={}]    Attribute map.  Special keys:
 *   - textContent  → sets element.textContent  (use for leaf nodes only)
 *   - className    → sets element.className
 *   - on<Event>    → calls addEventListener(<event>, fn)
 *   - style        → if object, Object.assign(element.style, value)
 *   - dataset      → if object, copies entries to element.dataset
 *   - all others   → setAttribute(key, String(value))
 * @param {Array|Node|string} [children=[]]  Child nodes or strings.
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  const childArray = Array.isArray(children) ? children : [children];

  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;

    if (key === 'textContent') {
      element.textContent = String(value);
    } else if (key === 'className') {
      element.className = value;
    } else if (key === 'htmlFor') {
      element.htmlFor = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dk, dv] of Object.entries(value)) {
        element.dataset[dk] = dv;
      }
    } else {
      element.setAttribute(key, String(value));
    }
  }

  for (const child of childArray) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      element.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      element.appendChild(child);
    }
  }

  return element;
}

/**
 * Shorthand for creating a text node.
 */
export function text(content) {
  return document.createTextNode(String(content));
}

/**
 * Build a validated <a> element.  Only allows https: (and http://localhost
 * during development).  Anything else renders as a plain <span>.
 *
 * @param {string} url
 * @param {string} linkText
 * @param {Object} [extraAttrs={}]
 * @returns {HTMLElement}
 */
export function safeLink(url, linkText, extraAttrs = {}) {
  let valid = false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') valid = true;
    if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') valid = true;
  } catch {
    /* malformed URL → invalid */
  }

  if (!valid) {
    return el('span', { textContent: linkText, className: 'invalid-link' });
  }

  return el('a', {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    textContent: linkText,
    ...extraAttrs,
  });
}

/**
 * Remove all child nodes from an element (safely, without innerHTML).
 */
export function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}
