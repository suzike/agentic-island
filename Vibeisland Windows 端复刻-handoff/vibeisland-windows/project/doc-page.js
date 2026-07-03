// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
/* BEGIN USAGE */
/**
 * <doc-page> — paged-document shell for printable HTML.
 *
 * On screen the document renders as a single continuous sheet on a desk
 * background (Google Docs' pageless view): you scroll one tall page card.
 * There is no manual page-splitting — write the whole document as normal
 * flow inside <doc-page> and the browser's print engine paginates it at
 * export.
 *
 * At print the component injects `@page { size: …; margin: 0 }` (which
 * leaves Chrome no margin box to draw its date/URL/page-count header in)
 * and moves the visual margin onto the sheet's own padding, so the printed
 * page has the same inset you see on screen. Standard break-hygiene rules
 * (`break-inside: avoid` on figures, code blocks, images and table rows;
 * `orphans/widows: 3`) are applied so paragraphs and groups split cleanly.
 *
 * Usage:
 *   <style>doc-page:not(:defined){visibility:hidden}</style>
 *   <doc-page size="letter" margin="0.75in">
 *     <h1>Title</h1>
 *     <p>…body…</p>
 *   </doc-page>
 *   <script src="doc-page.js"></script>
 *
 * Attributes:
 *   size    — letter | a4 | legal (default letter)
 *   width / height — explicit CSS lengths, override `size`
 *   margin  — printable inset on every page (default 0.75in)
 *
 * Running header/footer (optional): give an element `slot="header"` or
 * `slot="footer"` and it repeats on every printed page via
 * `position: fixed`. To keep body text from sliding under it, the
 * component prints inside a single-cell table whose <thead>/<tfoot> are
 * spacers sized to the header/footer height — browsers repeat thead/tfoot
 * on every page, so each sheet's content starts below the header and ends
 * above the footer. On screen the header/footer render once at the
 * top/bottom of the sheet.
 *
 * Author content as static HTML so the user can click-to-edit any text
 * directly. Do not set width/padding/background on the document body —
 * the component owns the sheet box.
 */
/* END USAGE */

(() => {
  const PAPER = {
    letter: ['8.5in', '11in'],
    a4: ['210mm', '297mm'],
    legal: ['8.5in', '14in'],
  };
  const CSS_LENGTH = /^\d+(\.\d+)?(px|in|mm|cm|pt|pc)$/;
  const safeLen = (v, fb) => (CSS_LENGTH.test((v || '').trim()) ? v.trim() : fb);

  const stylesheet = `
    :host {
      position: relative;
      display: block;
      min-height: 100vh;
      background: #ece8dd;
      padding: 48px 24px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      --doc-page-w: 8.5in;
      --doc-page-h: 11in;
      --doc-page-margin: 0.75in;
      --doc-hdr-h: 0px;
      --doc-ftr-h: 0px;
    }
    .sheet {
      width: var(--doc-page-w);
      margin: 0 auto;
      background: #fff;
      box-shadow: 0 2px 14px rgba(20, 20, 19, 0.12);
      border-radius: 2px;
      box-sizing: border-box;
      padding: var(--doc-page-margin);
    }
    .frame { width: 100%; border-collapse: collapse; }
    .frame td, .frame th { padding: 0; text-align: left; font-weight: inherit; }
    .hdr-space { height: var(--doc-hdr-h); }
    .ftr-space { height: var(--doc-ftr-h); }
    ::slotted([slot="header"]),
    ::slotted([slot="footer"]) { display: block; box-sizing: border-box; }
    @media print {
      :host { background: none; padding: 0; min-height: 0; }
      .sheet {
        width: auto; margin: 0; box-shadow: none; border-radius: 0;
        padding: 0 var(--doc-page-margin);
      }
      /* The thead/tfoot spacers repeat on every page, so they carry the
       * vertical page margin (which the sheet's own padding cannot, since
       * that padding is consumed once on the first/last page). The running
       * header/footer are fixed inside that band. */
      .hdr-space { height: max(var(--doc-page-margin), calc(var(--doc-hdr-h) + 0.35in)); }
      .ftr-space { height: max(var(--doc-page-margin), calc(var(--doc-ftr-h) + 0.35in)); }
      ::slotted([slot="header"]) {
        position: fixed; top: 0; left: 0; right: 0; margin: 0;
        padding: calc(var(--doc-page-margin) * 0.45) var(--doc-page-margin) 0;
      }
      ::slotted([slot="footer"]) {
        position: fixed; bottom: 0; left: 0; right: 0; margin: 0;
        padding: 0 var(--doc-page-margin) calc(var(--doc-page-margin) * 0.45);
      }
    }
  `;

  class DocPage extends HTMLElement {
    static get observedAttributes() { return ['size', 'width', 'height', 'margin']; }

    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      this._mo = typeof MutationObserver === 'function'
        ? new MutationObserver(() => this._scheduleMeasure())
        : null;
    }

    get pageWidth() {
      const named = PAPER[(this.getAttribute('size') || '').toLowerCase()];
      return safeLen(this.getAttribute('width'), named ? named[0] : PAPER.letter[0]);
    }
    get pageHeight() {
      const named = PAPER[(this.getAttribute('size') || '').toLowerCase()];
      return safeLen(this.getAttribute('height'), named ? named[1] : PAPER.letter[1]);
    }
    get pageMargin() { return safeLen(this.getAttribute('margin'), '0.75in'); }

    connectedCallback() {
      if (!this._sheet) this._render();
      this._syncSize();
      this._syncPrintPageRule();
      if (this._mo) this._mo.observe(this, {
        subtree: true, childList: true, characterData: true, attributes: true,
      });
      this._onResize = () => this._scheduleMeasure();
      window.addEventListener('resize', this._onResize);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this._scheduleMeasure());
      }
      this._scheduleMeasure();
    }

    disconnectedCallback() {
      window.removeEventListener('resize', this._onResize);
      if (this._mo) this._mo.disconnect();
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
      // Drop the head rule when the last doc-page leaves, so a deleted
      // document's @page geometry can't apply to whatever replaces it.
      if (!document.querySelector('doc-page')) {
        const tag = document.getElementById('doc-page-print');
        if (tag) tag.remove();
      }
    }

    attributeChangedCallback() {
      if (!this._sheet) return;
      this._syncSize();
      this._syncPrintPageRule();
      this._scheduleMeasure();
    }

    _render() {
      this._root.innerHTML = `
        <style>${stylesheet}</style>
        <style id="vars"></style>
        <div class="sheet" data-screen-label="Document">
          <table class="frame" role="presentation">
            <thead><tr><th><div class="hdr-space"><slot name="header"></slot></div></th></tr></thead>
            <tbody><tr><td class="body"><slot></slot></td></tr></tbody>
            <tfoot><tr><td><div class="ftr-space"><slot name="footer"></slot></div></td></tr></tfoot>
          </table>
        </div>`;
      this._sheet = this._root.querySelector('.sheet');
      this._vars = this._root.getElementById('vars');
    }

    /** Runtime sizing lives in a shadow <style> :host rule, never on the
     *  light-DOM host element, so serialize-persist can't write it back. */
    _syncSize(hdrH, ftrH) {
      this._vars.textContent = ':host{' +
        '--doc-page-w:' + this.pageWidth + ';' +
        '--doc-page-h:' + this.pageHeight + ';' +
        '--doc-page-margin:' + this.pageMargin + ';' +
        '--doc-hdr-h:' + (hdrH || 0) + 'px;' +
        '--doc-ftr-h:' + (ftrH || 0) + 'px}';
    }

    /** @page is a no-op inside shadow DOM, so the rule lives in <head>.
     *  Re-appended on every sync so it stays last in source order — the
     *  @page cascade is source-order per descriptor, so this rule wins
     *  over any other @page rule in the document. */
    _syncPrintPageRule() {
      const id = 'doc-page-print';
      let tag = document.getElementById(id);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
      }
      document.head.appendChild(tag);
      tag.textContent =
        '@page { size: ' + this.pageWidth + ' ' + this.pageHeight + '; margin: 0; } ' +
        '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; height: auto !important; overflow: visible !important; } ' +
        'h1,h2,h3,h4,h5,h6 { break-after: avoid; } ' +
        'figure,pre,blockquote,img,svg,tr { break-inside: avoid; } ' +
        'p,li { orphans: 3; widows: 3; } ' +
        '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; } ' +
        '*, *::before, *::after { animation-delay: -99s !important; animation-duration: .001s !important; ' +
        'animation-iteration-count: 1 !important; animation-fill-mode: both !important; ' +
        'animation-play-state: running !important; transition-duration: 0s !important; } }';
    }

    _scheduleMeasure() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this._measure(); });
    }

    /** Slot heights feed the print spacers (--doc-hdr-h / --doc-ftr-h), so
     *  they re-measure on content mutation, resize, and font load. */
    _measure() {
      const hdr = this.querySelector(':scope > [slot="header"]');
      const ftr = this.querySelector(':scope > [slot="footer"]');
      this._syncSize(hdr ? hdr.offsetHeight : 0, ftr ? ftr.offsetHeight : 0);
    }
  }

  if (!customElements.get('doc-page')) {
    customElements.define('doc-page', DocPage);
  }
})();
