'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let menuItems = [];   // Array of RSS <item> DOM elements from menu.rss
let activeIndex = -1; // Currently selected menu index
let isNarrow = false; // True when content area < 480px wide
let isManuallyExpanded = false; // True when user opened menu on narrow viewport

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);

async function init() {
    setupMenuToggle();
    setupNarrowDetection(); // sets isNarrow synchronously before anything is rendered
    updateMenuState();
    await loadMenu();

    // Handle initial deep link or load first item
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
        handleHashChange();
    } else if (menuItems.length > 0) {
        loadAndShowItem(0);
    }

    window.addEventListener('hashchange', handleHashChange);
}

// ---------------------------------------------------------------------------
// Menu toggle / responsive behaviour
// ---------------------------------------------------------------------------
function setupMenuToggle() {
    document.getElementById('expand-btn').addEventListener('click', () => {
        isManuallyExpanded = true;
        updateMenuState();
    });

    document.getElementById('collapse-btn').addEventListener('click', () => {
        isManuallyExpanded = false;
        updateMenuState();
    });

    document.getElementById('menu-backdrop').addEventListener('click', () => {
        isManuallyExpanded = false;
        updateMenuState();
    });
}

function setupNarrowDetection() {
    // Use window.matchMedia instead of ResizeObserver.
    //
    // ResizeObserver on any element inside the layout creates a feedback loop:
    //   narrow detected → collapse menu → content expands → no longer narrow
    //   → expand menu → content shrinks → narrow again → … (flicker forever)
    //
    // matchMedia fires only when the *viewport* changes size — never as a
    // side-effect of our own DOM changes — so feedback loops are impossible.
    //
    // Threshold: viewport <= menuWidth + 479 means the content area would be
    // at most 479 px wide with the menu open, so collapse it.
    const menuWidth = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--menu-width')
    ) || 260;
    const mq = window.matchMedia(`(max-width: ${menuWidth + 479}px)`);

    // Set isNarrow synchronously so updateMenuState() in init() reads the
    // correct value on the very first call.
    isNarrow = mq.matches;

    mq.addEventListener('change', e => {
        isNarrow = e.matches;
        if (!isNarrow) isManuallyExpanded = false;
        updateMenuState();
    });
}

/**
 * Apply the correct CSS classes / hidden attributes based on current state.
 *
 * States:
 *  - Wide viewport (!isNarrow):          menu always visible, no toggle buttons
 *  - Narrow + collapsed (!isManuallyExpanded): menu collapsed, expand btn shown
 *  - Narrow + expanded (isManuallyExpanded):   menu overlays content, close btn shown
 */
function updateMenuState() {
    const panel       = document.getElementById('menu-panel');
    const expandBtn   = document.getElementById('expand-btn');
    const collapseBtn = document.getElementById('collapse-btn');
    const backdrop    = document.getElementById('menu-backdrop');

    if (!isNarrow) {
        // Wide viewport — standard side-by-side layout
        panel.className = '';
        expandBtn.hidden = true;
        collapseBtn.hidden = true;
        backdrop.hidden = true;
    } else if (!isManuallyExpanded) {
        // Narrow + collapsed — show hamburger button
        panel.className = 'collapsed';
        expandBtn.hidden = false;
        collapseBtn.hidden = true;
        backdrop.hidden = true;
    } else {
        // Narrow + expanded — overlay with close button and backdrop
        panel.className = 'narrow-expanded';
        expandBtn.hidden = true;
        collapseBtn.hidden = false;
        backdrop.hidden = false;
    }
}

// ---------------------------------------------------------------------------
// Load and render the menu
// ---------------------------------------------------------------------------
async function loadMenu() {
    try {
        const doc = await fetchRss('rss/menu.rss');
        menuItems = extractItems(doc);
        renderMenu(menuItems);
    } catch (err) {
        console.error('Failed to load menu:', err);
        document.getElementById('menu-items').innerHTML =
            '<div class="error">Failed to load menu.</div>';
    }
}

function renderMenu(items) {
    const container = document.getElementById('menu-items');
    container.innerHTML = '';
    items.forEach((item, index) => {
        container.appendChild(createMenuCell(item, index));
    });
}

/**
 * Create a menu cell. Layout variant is chosen based on available data:
 *   a — enclosure + title + description
 *   b — enclosure + title
 *   c — title + description (no enclosure)
 *   d — title only
 */
function createMenuCell(item, index) {
    const { title, description, link, enclosureUrl } = extractItemData(item);

    const cell = document.createElement('div');
    cell.className = 'menu-cell';
    cell.dataset.index = index;

    const hasImage = !!enclosureUrl;
    const hasTitle = !!title;
    const hasDesc  = !!description;

    if (hasImage && hasTitle && hasDesc) {
        // Variant a
        cell.classList.add('cell-a');
        cell.appendChild(makeCellImage(enclosureUrl, title));
        const textDiv = document.createElement('div');
        textDiv.className = 'cell-text';
        textDiv.appendChild(makeCellTitle(title));
        textDiv.appendChild(makeCellDesc(description));
        cell.appendChild(textDiv);
    } else if (hasImage && hasTitle) {
        // Variant b
        cell.classList.add('cell-b');
        cell.appendChild(makeCellImage(enclosureUrl, title));
        cell.appendChild(makeCellTitle(title));
    } else if (hasTitle && hasDesc) {
        // Variant c
        cell.classList.add('cell-c');
        cell.appendChild(makeCellTitle(title));
        cell.appendChild(makeCellDesc(description));
    } else {
        // Variant d (also handles missing title gracefully)
        cell.classList.add('cell-d');
        cell.appendChild(makeCellTitle(title || '(Untitled)'));
    }

    if (link) {
        cell.addEventListener('click', () => navigateToItem(index));
    }

    return cell;
}

function makeCellImage(url, alt) {
    const img = document.createElement('img');
    img.className = 'cell-img';
    img.src = url;
    img.alt = alt || '';
    return img;
}

function makeCellTitle(text) {
    const el = document.createElement('span');
    el.className = 'cell-title';
    el.textContent = text;
    return el;
}

function makeCellDesc(text) {
    const el = document.createElement('span');
    el.className = 'cell-desc';
    el.textContent = text;
    return el;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Called when user clicks a menu cell.
 * Updates the hash (without re-triggering a full reload via hashchange guard).
 */
function navigateToItem(index) {
    if (index < 0 || index >= menuItems.length) {
        index = 0;
    }
    // Set activeIndex before updating hash so the hashchange guard skips re-load
    activeIndex = index;
    history.pushState({ index }, '', '#' + index);

    loadAndShowItem(index);

    // Auto-collapse menu overlay after selection on narrow viewport
    if (isNarrow && isManuallyExpanded) {
        isManuallyExpanded = false;
        updateMenuState();
    }
}

/**
 * Update the active cell highlight and load the corresponding content feed.
 */
async function loadAndShowItem(index) {
    // Highlight active cell
    document.querySelectorAll('.menu-cell').forEach(c => c.classList.remove('active'));
    const activeCell = document.querySelector('.menu-cell[data-index="' + index + '"]');
    if (activeCell) {
        activeCell.classList.add('active');
    }

    const { link } = extractItemData(menuItems[index]);
    if (link) {
        await loadContent(link);
    }
}

// ---------------------------------------------------------------------------
// Load and render content feed
// ---------------------------------------------------------------------------
async function loadContent(url) {
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = '<div class="loading">Loading\u2026</div>';

    try {
        const resolvedUrl = resolveUrl(url);
        const doc = await fetchRss(resolvedUrl);
        const items = extractItems(doc);
        renderContent(items);
    } catch (err) {
        console.error('Failed to load content:', err);
        contentArea.innerHTML = '<div class="error">Failed to load content.</div>';
    }
}

function renderContent(items) {
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = '';
    items.forEach(item => {
        contentArea.appendChild(createContentItem(item));
    });
}

/**
 * Create a content item block from an RSS <item>.
 * Order: title → enclosure image → description
 * If <link> is present, the whole block is clickable (opens in new tab).
 */
function createContentItem(item) {
    const { title, description, link, enclosureUrl } = extractItemData(item);

    const wrapper = document.createElement('div');
    wrapper.className = 'content-item';

    if (title) {
        const titleEl = document.createElement('span');
        titleEl.className = 'content-title';
        titleEl.textContent = title;
        wrapper.appendChild(titleEl);
    }

    if (enclosureUrl) {
        const img = document.createElement('img');
        img.className = 'content-img';
        img.src = enclosureUrl;
        img.alt = title || '';
        wrapper.appendChild(img);
    }

    if (description) {
        const descEl = document.createElement('span');
        descEl.className = 'content-desc';
        appendTextWithBreaks(descEl, description);
        wrapper.appendChild(descEl);
    }

    if (link) {
        wrapper.classList.add('clickable');
        wrapper.addEventListener('click', () => {
            window.open(link, '_blank', 'noopener,noreferrer');
        });
    }

    return wrapper;
}

// ---------------------------------------------------------------------------
// Deep linking
// ---------------------------------------------------------------------------

/**
 * Parse the URL hash as a 0-based index and navigate to that menu item.
 * Invalid or out-of-range values fall back to index 0.
 *
 * Examples with 10 items (valid range 0–9):
 *   #0   → item 0  (first)
 *   #9   → item 9  (last)
 *   #999 → item 0  (out of range → fallback)
 */
function handleHashChange() {
    if (!menuItems.length) return;

    const hash = window.location.hash;
    if (!hash || hash.length <= 1) return;

    let index = parseInt(hash.slice(1), 10);
    if (isNaN(index) || index < 0 || index >= menuItems.length) {
        index = 0;
    }

    // Guard against re-loading the same item (e.g. when navigateToItem set the hash)
    if (index === activeIndex) return;

    activeIndex = index;
    loadAndShowItem(index);
}

// ---------------------------------------------------------------------------
// RSS fetch & parse helpers
// ---------------------------------------------------------------------------

/**
 * Load an RSS/XML file via XMLHttpRequest.
 * XHR works on both http:// and file:// origins, whereas fetch() is blocked
 * by browsers (including Safari) when the page is opened via file://.
 * For file:// responses the status code is 0, so we check responseText too.
 */
function fetchRss(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onload = function () {
            // status 200 for http://, status 0 for file://
            if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText.length > 0)) {
                try {
                    resolve(parseXml(xhr.responseText));
                } catch (e) {
                    reject(e);
                }
            } else {
                reject(new Error('HTTP ' + xhr.status + ' loading: ' + url));
            }
        };
        xhr.onerror = function () {
            reject(new Error('Network error loading: ' + url));
        };
        xhr.send();
    });
}

/**
 * Parse an RSS/XML string, skipping strict XML validation.
 * Uses DOMParser with application/xml; on parse errors, logs a warning
 * and returns the (possibly partial) document anyway.
 */
function parseXml(text) {
    // Strip BOM if present
    const clean = text.replace(/^\uFEFF/, '');
    const parser = new DOMParser();
    const doc = parser.parseFromString(clean, 'application/xml');
    const errorNode = doc.querySelector('parsererror');
    if (errorNode) {
        console.warn('XML parse warning (continuing anyway):', errorNode.textContent.trim().split('\n')[0]);
    }
    return doc;
}

/** Return all <item> elements that are direct children of <channel>. */
function extractItems(doc) {
    return Array.from(doc.querySelectorAll('channel > item'));
}

/**
 * Extract text from a <description> element, converting <br/> child elements
 * to newline characters so callers can render them as line breaks.
 */
function extractDescriptionText(descEl) {
    if (!descEl) return '';
    let text = '';
    for (const node of descEl.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        } else if (node.nodeName.toLowerCase() === 'br') {
            text += '\n';
        }
    }
    return text.trim();
}

/**
 * Append text to an element, inserting <br> DOM nodes wherever the text
 * contains a newline character.
 */
function appendTextWithBreaks(el, text) {
    const parts = text.split('\n');
    parts.forEach((part, i) => {
        el.appendChild(document.createTextNode(part));
        if (i < parts.length - 1) {
            el.appendChild(document.createElement('br'));
        }
    });
}

/**
 * Extract the four data fields we care about from an RSS <item>.
 * All fields default to empty string when the element is absent.
 */
function extractItemData(item) {
    const title       = item.querySelector('title')?.textContent?.trim() ?? '';
    const description = extractDescriptionText(item.querySelector('description'));

    // <link> in XML mode contains plain text; use textContent
    const linkEl = item.querySelector('link');
    const link   = linkEl ? (linkEl.textContent?.trim() ?? '') : '';

    const enclosureEl  = item.querySelector('enclosure');
    const enclosureUrl = enclosureEl ? (enclosureEl.getAttribute('url') ?? '') : '';

    return { title, description, link, enclosureUrl };
}

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a URL that may be relative (to the current page) or absolute.
 * Relative URLs are passed through as-is — fetch() resolves them correctly
 * relative to the page's base URL.
 */
function resolveUrl(url) {
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    // Relative — return unchanged (browser fetch will resolve it)
    return url;
}
