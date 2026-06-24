import { Extension } from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { updateCssVariables } from "./utils";
import { PageSize } from "./constants";

export interface PaginationPlusOptions {
  pageHeight: number;
  pageWidth: number;
  pageGap: number;
  pageBreakBackground: string;
  pageGapBorderSize: number;
  footerRight: string;
  footerLeft: string;
  headerRight: string;
  headerLeft: string;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  contentMarginTop: number;
  contentMarginBottom: number;
  pageGapBorderColor: string;
  showPageNumber: boolean;
}
const page_count_meta_key = "PAGE_COUNT_META_KEY";

// Per-editor rAF recalc scheduler, registered by addProseMirrorPlugins so the
// onCreate MutationObserver can reach it without a circular closure.
const schedulers = new WeakMap<object, () => void>();

// The single canonical options object the plugin reads. tiptap hands different
// `this.options` references to addCommands vs addProseMirrorPlugins, so a command
// mutating `this.options` does NOT reach the plugin. addProseMirrorPlugins
// publishes its own options object here; commands mutate THIS one so the live
// margin/size change is actually seen by the decoration build.
const liveOptions = new WeakMap<object, PaginationPlusOptions>();

// Sets the editor root's min-height to the bottom of the last page break so the
// final page renders its full height. DOM-only, safe to call from a rAF.
const refreshPage = (targetNode: HTMLElement) => {
  const paginationElement = targetNode.querySelector("[data-rm-pagination]");
  if (paginationElement) {
    const lastPageBreak = paginationElement.lastElementChild?.querySelector(
      ".breaker"
    ) as HTMLElement;
    if (lastPageBreak) {
      const minHeight = lastPageBreak.offsetTop + lastPageBreak.offsetHeight;
      targetNode.style.minHeight = `${minHeight}px`;
    }
  }
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    PaginationPlus: {
      updatePageBreakBackground: (color: string) => ReturnType;
      updatePageSize: (size: PageSize) => ReturnType;
      updatePageHeight: (height: number) => ReturnType;
      updatePageWidth: (width: number) => ReturnType;
      updatePageGap: (gap: number) => ReturnType;
      updateMargins: (margins: { top: number, bottom: number, left: number, right: number }) => ReturnType;
      updateContentMargins: (margins: { top: number, bottom: number }) => ReturnType;
      updateHeaderContent: (left: string, right: string) => ReturnType;
      updateFooterContent: (left: string, right: string) => ReturnType;
    };
  }
  interface Storage {
    PaginationPlus: PaginationPlusOptions
  }
}

const defaultOptions: PaginationPlusOptions = {
  pageHeight: 800,
  pageWidth: 789,
  pageGap: 50,
  pageGapBorderSize: 1,
  pageBreakBackground: "#ffffff",
  footerRight: "{page}",
  footerLeft: "",
  headerRight: "",
  headerLeft: "",
  marginTop: 20,
  marginBottom: 20,
  marginLeft: 50,
  marginRight: 50,
  contentMarginTop: 10,
  contentMarginBottom: 10,
  pageGapBorderColor: "#e5e5e5",
  showPageNumber: false,
}

export const PaginationPlus = Extension.create<PaginationPlusOptions>({
  name: "PaginationPlus",
  addOptions() {
    return defaultOptions;
  },
  addStorage() {
    return defaultOptions;
  },
  onCreate() {
    const targetNode = this.editor.view.dom;
    targetNode.classList.add("rm-with-pagination");
    targetNode.style.border = `1px solid var(--rm-page-gap-border-color)`;
    targetNode.style.paddingLeft = `var(--rm-margin-left)`;
    targetNode.style.paddingRight = `var(--rm-margin-right)`;
    targetNode.style.width = `var(--rm-page-width)`;

    const config = { attributes: true };

    updateCssVariables(targetNode, liveOptions.get(this.editor) ?? this.options);

    const style = document.createElement("style");
    style.dataset.rmPaginationStyle = "";

    style.textContent = `
      .rm-pagination-gap{
        border-top: 1px solid;
        border-bottom: 1px solid;
        border-color: var(--rm-page-gap-border-color);
      }
      .rm-with-pagination {
        counter-reset: page-number page-number-plus 1;
      }
      .rm-with-pagination .image-plus-wrapper,
      .rm-with-pagination .table-plus td,
      .rm-with-pagination .table-plus th {
        max-height: var(--rm-max-content-child-height);
        overflow-y: auto;
      }
      .rm-with-pagination .image-plus-wrapper {
        overflow-y: visible;
      }
      .rm-with-pagination .rm-page-break {
        counter-increment: page-number page-number-plus;
      }
      .rm-with-pagination .rm-page-footer {
        margin-bottom: var(--rm-margin-bottom);
      }
      .rm-with-pagination .rm-page-break:last-child .rm-pagination-gap {
        display: none;
      }
      .rm-with-pagination .rm-page-break:last-child .rm-page-header {
        display: none;
      }

      .rm-with-pagination table tr td,
      .rm-with-pagination table tr th {
        word-break: break-all;
      }
      .rm-with-pagination table > tr {
        display: grid;
        min-width: 100%;
      }
      .rm-with-pagination table {
        border-collapse: collapse;
        width: 100%;
        display: contents;
      }
      .rm-with-pagination table tbody{
        display: table;
        max-height: 300px;
        overflow-y: auto;
      }
      .rm-with-pagination table tbody > tr{
        display: table-row !important;
      }
      .rm-with-pagination *:has(>br.ProseMirror-trailingBreak:only-child) {
        display: table;
        width: 100%;
      }
      .rm-with-pagination .rm-br-decoration {
        display: table;
        width: 100%;
      }
      .rm-with-pagination .table-row-group {
        max-height: var(--rm-page-content-height);
        overflow-y: auto;
        width: 100%;
      }
      .rm-with-pagination .rm-page-footer-left,
      .rm-with-pagination .rm-page-footer-right,
      .rm-with-pagination .rm-page-header-left,
      .rm-with-pagination .rm-page-header-right {
        display: inline-block;
      }

      .rm-with-pagination .rm-page-header-left,
      .rm-with-pagination .rm-page-footer-left{
        float: left;
        margin-left: var(--rm-margin-left);
      }
      .rm-with-pagination .rm-page-header-right,
      .rm-with-pagination .rm-page-footer-right{
        float: right;
        margin-right: var(--rm-margin-right);
      }
      .rm-with-pagination .rm-page-number::before {
        content: counter(page-number);
      }
      .rm-with-pagination .rm-page-number-plus::before {
        content: counter(page-number-plus);
      }
      .rm-with-pagination .rm-first-page-header,
      .rm-with-pagination .rm-page-header,
      .rm-with-pagination .rm-page-footer{
        width: 100%;
      }
      .rm-with-pagination .rm-page-header,
      .rm-with-pagination .rm-first-page-header{
        margin-bottom: var(--rm-content-margin-top) !important;
        margin-top: var(--rm-margin-top) !important;
        display: inline-flex;
        justify-content: space-between;
        max-height: calc(calc(var(--rm-page-height) * 0.35) - var(--rm-margin-top) - var(--rm-content-margin-top));
        overflow-y: hidden;
      }
      .rm-with-pagination .rm-page-footer{
        margin-top: var(--rm-content-margin-bottom) !important;
        margin-bottom: var(--rm-margin-bottom) !important;
        display: inline-flex;
        justify-content: space-between;
        max-height: calc(calc(var(--rm-page-height) * 0.35) - var(--rm-content-margin-bottom) - var(--rm-margin-bottom));
        overflow-y: hidden;
      }
      .rm-with-pagination .rm-merge-rect {
          pointer-events: none;
      }
    .rm-with-pagination .rm-merge-surface { pointer-events: none; }
    `;
    document.head.appendChild(style);

    const callback = (
      mutationList: MutationRecord[]
    ) => {
      if (mutationList.length > 0 && mutationList[0].target) {
        const _target = mutationList[0].target as HTMLElement;
        if (_target.classList.contains("rm-with-pagination")) {
          // Reflows not driven by a doc transaction (image/font load, async
          // resize) land here. Coalesce them into one rAF measurement instead
          // of measuring + dispatching synchronously — the synchronous path
          // thrashed layout and could re-enter via the plugin's own style writes.
          schedulers.get(this.editor)?.();
        }
      }
    };
    const observer = new MutationObserver(callback);
    observer.observe(targetNode, config);
    refreshPage(targetNode);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;

    // Canonical options object. tiptap gives addCommands a DIFFERENT `this.options`
    // than the one read here, so commands mutate `opts` (published via liveOptions)
    // rather than their own `this.options`. The plugin and the decoration build use
    // `opts` exclusively so a live margin/size change is actually rendered.
    const opts = this.options;
    liveOptions.set(editor, opts);
    let storage: PaginationPlusOptions = { ...opts };

    // Coalesce expensive pagination measurement into a single animation frame.
    // Typing dispatches a transaction per keystroke; measuring (reflow + style
    // writes) on each one is the layout thrash that stutters long docs. Instead
    // we map decorations cheaply on each edit and remeasure once per frame.
    let recalcScheduled = false;
    // Stability gate: the page-count algorithm is delta-based and returns
    // transient values while the layout is mid-reflow (it oscillated 1→3→4→…).
    // We only rebuild when two consecutive frames agree on a count that differs
    // from the DOM; a disagreeing measurement just re-arms another frame. This
    // converges instead of forming a rebuild storm (frozen tab).
    let lastMeasured = -1;
    const scheduleRecalc = () => {
      if (recalcScheduled) {
        return;
      }
      recalcScheduled = true;
      requestAnimationFrame(() => {
        recalcScheduled = false;
        const view = editor.view;
        if (!view || !view.dom || !(view.dom as HTMLElement).isConnected) {
          return;
        }
        const measured = calculatePageCount(view, opts);
        const target = measured > 1 ? measured : 1;
        const currentPageCount = getExistingPageCount(view);
        if (target !== currentPageCount) {
          if (target === lastMeasured) {
            view.dispatch(view.state.tr.setMeta(page_count_meta_key, Date.now()));
          } else {
            lastMeasured = target;
            scheduleRecalc();
          }
        } else {
          lastMeasured = target;
        }
        refreshPage(view.dom as HTMLElement);
      });
    };
    schedulers.set(editor, scheduleRecalc);

    const optionsChangedFrom = (prev: PaginationPlusOptions) =>
      prev.pageBreakBackground !== opts.pageBreakBackground ||
      prev.pageHeight !== opts.pageHeight ||
      prev.pageWidth !== opts.pageWidth ||
      prev.marginTop !== opts.marginTop ||
      prev.marginBottom !== opts.marginBottom ||
      prev.marginLeft !== opts.marginLeft ||
      prev.marginRight !== opts.marginRight ||
      prev.pageGap !== opts.pageGap ||
      prev.contentMarginTop !== opts.contentMarginTop ||
      prev.contentMarginBottom !== opts.contentMarginBottom ||
      prev.headerLeft !== opts.headerLeft ||
      prev.headerRight !== opts.headerRight ||
      prev.footerLeft !== opts.footerLeft ||
      prev.footerRight !== opts.footerRight;

    return [
      new Plugin({
        key: new PluginKey("pagination"),

        state: {
          init:(_, state) => {
            const widgetList = createDecoration(state, opts);
            storage = { ...opts };
            return DecorationSet.create(state.doc, widgetList);
          },
          apply:(tr, oldDeco, oldState, newState) => {
            const optionChanged = optionsChangedFrom(storage);
            const forced = tr.getMeta(page_count_meta_key) != null;

            // Option change (live margins/size/header) or a forced recalc (from
            // the rAF measurement or the MutationObserver) rebuilds the page
            // widgets synchronously so the change is visible this frame. An
            // option change re-measures from a CLEAN baseline (ignoring stale
            // tiles) so the count converges; rAF-forced refinements keep the
            // delta measurement.
            if (optionChanged || forced) {
              const widgetList = createDecoration(newState, opts, false, optionChanged);
              storage = { ...opts };
              // A rebuild resets the layout, so drop any pending stability vote.
              lastMeasured = -1;
              return DecorationSet.create(newState.doc, [...widgetList]);
            }

            // Plain doc edits never need a synchronous remeasure: map the pos-0
            // widgets through the change and schedule one measurement per frame.
            if (tr.docChanged) {
              scheduleRecalc();
              return oldDeco.map(tr.mapping, tr.doc);
            }

            // Selection-only / meta-less transactions can't change pagination.
            return oldDeco;
          },
        },

        props: {
          decorations(state: EditorState) {
            return this.getState(state) as DecorationSet;
          },
        },
      }),
      new Plugin({
        key: new PluginKey('brDecoration'),
        state: {
          init() { return DecorationSet.empty },
          apply(tr, old) {
            // Map decorations through document changes
            return old.map(tr.mapping, tr.doc);
          }
        },
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'hardBreak') {
                const afterPos = pos + 1;
                const widget = Decoration.widget(afterPos, () => {
                  const el = document.createElement('span');
                  el.classList.add('rm-br-decoration');
                  return el;
                });
                decorations.push(widget);
              }
            });
            return DecorationSet.create(state.doc, decorations);
          }
        }
      }),
    ];
  },
  addCommands() {
    // Mutate the SAME options object the plugin reads (published in liveOptions
    // by addProseMirrorPlugins) — NOT `this.options`, which tiptap scopes
    // separately for commands — then dispatch a meta transaction so the plugin's
    // `apply` rebuilds the decorations with the new options. This is what makes a
    // margin/size change apply live, with no editor remount.
    const apply = (
      props: { editor?: any, tr: any, dispatch?: (tr: any) => void },
      mutate: (o: PaginationPlusOptions) => void,
    ) => {
      const o = liveOptions.get((props.editor ?? this.editor) as object) ?? this.options;
      mutate(o);
      if (props.dispatch) {
        props.dispatch(props.tr.setMeta(page_count_meta_key, Date.now()));
      }
      return true;
    };
    return {
      updatePageBreakBackground: (color: string) => (props) =>
        apply(props, (o) => { o.pageBreakBackground = color; }),
      updatePageSize: (size: PageSize) => (props) =>
        apply(props, (o) => {
          o.pageHeight = size.pageHeight;
          o.pageWidth = size.pageWidth;
          o.marginTop = size.marginTop;
          o.marginBottom = size.marginBottom;
          o.marginLeft = size.marginLeft;
          o.marginRight = size.marginRight;
        }),
      updatePageWidth: (width: number) => (props) =>
        apply(props, (o) => { o.pageWidth = width; }),
      updatePageHeight: (height: number) => (props) =>
        apply(props, (o) => { o.pageHeight = height; }),
      updatePageGap: (gap: number) => (props) =>
        apply(props, (o) => { o.pageGap = gap; }),
      updateMargins: (margins: { top: number, bottom: number, left: number, right: number }) => (props) =>
        apply(props, (o) => {
          o.marginTop = margins.top;
          o.marginBottom = margins.bottom;
          o.marginLeft = margins.left;
          o.marginRight = margins.right;
        }),
      updateContentMargins: (margins: { top: number, bottom: number }) => (props) =>
        apply(props, (o) => {
          o.contentMarginTop = margins.top;
          o.contentMarginBottom = margins.bottom;
        }),
      updateHeaderContent: (left: string, right: string) => (props) =>
        apply(props, (o) => { o.headerLeft = left; o.headerRight = right; }),
      updateFooterContent: (left: string, right: string) => (props) =>
        apply(props, (o) => { o.footerLeft = left; o.footerRight = right; }),
    };
  },
});

const getExistingPageCount = (view: EditorView) => {
  const editorDom = view.dom;
  const paginationElement = editorDom.querySelector("[data-rm-pagination]");
  if (paginationElement) {
    return paginationElement.children.length;
  }
  return 0;
};
const needNewDecoration = (view: EditorView, pageOptions: PaginationPlusOptions, storage: PaginationPlusOptions) => {
  let recalculatePageCount = false;

  const editorDom = view.dom;
  const paginationElement = editorDom.querySelector("[data-rm-pagination]");



  if(paginationElement) {
    const firstPageBreakPage = paginationElement.querySelector(".rm-page-break > .page") as HTMLElement;

    if(firstPageBreakPage) {
      const marginTop = parseFloat(getComputedStyle(firstPageBreakPage).marginTop);
      const headerHeight = paginationElement.querySelector(".rm-first-page-header")?.clientHeight || 0;
      const pageFooter = paginationElement.querySelector(".rm-page-footer") as HTMLElement;
      if(storage.footerLeft !== pageOptions.footerLeft || storage.footerRight !== pageOptions.footerRight) {
        pageFooter.innerHTML = getFooter(pageOptions.footerRight, pageOptions.footerLeft, {
            showPageNumber: pageOptions.showPageNumber,
        }).innerHTML;
      }

      const footerHeight = pageFooter ? pageFooter.clientHeight : 0;

      const _pageHeaderHeight = pageOptions.contentMarginTop + pageOptions.marginTop + headerHeight;
      const _pageFooterHeight = pageOptions.contentMarginBottom + pageOptions.marginBottom + footerHeight;
      const _pageHeight = pageOptions.pageHeight - _pageHeaderHeight - _pageFooterHeight;

      // Tolerate sub-pixel / line-box rounding. An exact `!==` here can stay
      // perpetually true after an in-place option change (e.g. live margins),
      // which makes the MutationObserver dispatch on every tick and freeze the tab.
      if (Math.abs(marginTop - (_pageHeight + _pageHeaderHeight)) > 1) {
        recalculatePageCount = true;
      }

    }
  }

  return recalculatePageCount;
}
const calculatePageCount = (
  view: EditorView,
  pageOptions: PaginationPlusOptions,
  clean: boolean = false,
) => {
  const editorDom = view.dom;
  updateCssVariables(editorDom, pageOptions);
  const headerHeight = editorDom.querySelector(".rm-first-page-header")?.clientHeight || 0;
  const footerHeight = editorDom.querySelector(".rm-page-footer")?.clientHeight || 0;

  const _pageHeaderHeight = pageOptions.contentMarginTop + pageOptions.marginTop + headerHeight;
  const _pageFooterHeight = pageOptions.contentMarginBottom + pageOptions.marginBottom + footerHeight;

  const pageContentAreaHeight =
    pageOptions.pageHeight - _pageHeaderHeight - _pageFooterHeight;

  // Guard the divisor: if margins/header/footer ever sum to >= page height the
  // content area is <= 0, and dividing a gap by it yields Infinity/negative —
  // which then drives an unbounded page-tile render loop (frozen tab). Floor it.
  const safeArea = pageContentAreaHeight > 1 ? pageContentAreaHeight : 1;

  const paginationElement = editorDom.querySelector("[data-rm-pagination]") as HTMLElement | null;
  const currentPageCount = getExistingPageCount(view);

  // Clean baseline (used on an in-place option change, e.g. live margins). The
  // delta branch below grows `currentPageCount + addPage`; in place the existing
  // page tiles + the root's tile-derived min-height inflate every measurement,
  // so it never converges (runaway → frozen tab). Hiding the tiles and dropping
  // min-height reproduces the FRESH-MOUNT measurement (content height ÷ page
  // area) — the exact basis that already paginates tables/images correctly on
  // load. The subsequent delta passes then refine overflow from a correct base.
  if (clean) {
    const prevDisplay = paginationElement ? paginationElement.style.display : "";
    const prevMinHeight = editorDom.style.minHeight;
    if (paginationElement) {
      paginationElement.style.display = "none";
    }
    editorDom.style.minHeight = "0px";
    const contentHeight = editorDom.scrollHeight;
    editorDom.style.minHeight = prevMinHeight;
    if (paginationElement) {
      paginationElement.style.display = prevDisplay;
    }
    const cleanCount = Math.ceil(contentHeight / safeArea);
    return Number.isFinite(cleanCount) && cleanCount >= 1 ? Math.min(cleanCount, 5000) : 1;
  }

  let result = 1;
  if (paginationElement) {
    const lastElementOfEditor = editorDom.lastElementChild;
    const lastPageBreak =
    paginationElement.lastElementChild?.querySelector(".breaker");
    if (lastElementOfEditor && lastPageBreak) {
      const lastElementRect = lastElementOfEditor.getBoundingClientRect();
      const lastPageBreakRect = lastPageBreak.getBoundingClientRect();
      const lastPageGap =
        lastElementRect.bottom -
        lastPageBreakRect.bottom;
      if (lastPageGap > 0) {
        const addPage = Math.ceil(lastPageGap / safeArea);
        result = currentPageCount + addPage;
      } else {
        const lpFrom = -10;
        const lpTo = -(pageOptions.pageHeight - 10);
        if (lastPageGap > lpTo && lastPageGap < lpFrom) {
          result = currentPageCount;
        } else if (lastPageGap < lpTo) {
          const pageHeightOnRemove =
            pageOptions.pageHeight + pageOptions.pageGap;
          const removePage = Math.floor(lastPageGap / pageHeightOnRemove);
          result = currentPageCount + removePage;
        } else {
          result = currentPageCount;
        }
      }
    } else {
      result = 1;
    }
  } else {
    const editorHeight = editorDom.scrollHeight;
    result = Math.ceil(editorHeight / safeArea);
  }

  // Final safety net: never return a non-finite or absurd page count (which
  // would drive an unbounded tile-render loop).
  if (!Number.isFinite(result) || result > 5000) {
    result = currentPageCount > 0 ? currentPageCount : 1;
  }
  return result < 1 ? 1 : result;
};

function applyPageToken(template: string, enabled: boolean, klass: string) {
    if (!enabled) return template.replaceAll("{page}", "");
    return template.replaceAll("{page}", `<span class="${klass}"></span>`);
}

function getFooter(footerRightContent: string, footerLeftContent: string,
                   opts?: { showPageNumber?: boolean })
{
    const enabled = opts?.showPageNumber ?? false;

    const pageFooter = document.createElement("div");
    pageFooter.classList.add("rm-page-footer");
    // pageFooter.style.height = pageOptions.pageFooterHeight + "px";
    pageFooter.style.overflow = "hidden";

    const footerRight = applyPageToken(footerRightContent, enabled, "rm-page-number");
    const footerLeft  = applyPageToken(footerLeftContent,  enabled, "rm-page-number");

    const pageFooterLeft = document.createElement("div");
    pageFooterLeft.classList.add("rm-page-footer-left");
    pageFooterLeft.innerHTML = footerLeft;

    const pageFooterRight = document.createElement("div");
    pageFooterRight.classList.add("rm-page-footer-right");
    pageFooterRight.innerHTML = footerRight;

    pageFooter.append(pageFooterLeft);
    pageFooter.append(pageFooterRight);

    return pageFooter;
}

function createDecoration(
  state: EditorState,
  pageOptions: PaginationPlusOptions,
  isInitial: boolean = false,
  clean: boolean = false
): Decoration[] {
  const pageWidget = Decoration.widget(
    0,
    (view) => {
      const editorDom = view.dom;
      const _pageGap = pageOptions.pageGap;
      const _pageBreakBackground = pageOptions.pageBreakBackground;
      const headerHeight = editorDom.querySelector(".rm-first-page-header")?.clientHeight || 0;
      const footerHeight = editorDom.querySelector(".rm-page-footer")?.clientHeight || 0;
      const _pageHeaderHeight = pageOptions.contentMarginTop + pageOptions.marginTop + headerHeight;
      const _pageFooterHeight = pageOptions.contentMarginBottom + pageOptions.marginBottom + footerHeight;
      const _pageHeight = pageOptions.pageHeight - _pageHeaderHeight - _pageFooterHeight;

      const el = document.createElement("div");
      el.dataset.rmPagination = "true";

      const pageBreakDefinition = ({
        firstPage = false,
      }: {
        firstPage: boolean;
      }) => {
        const pageContainer = document.createElement("div");
        pageContainer.classList.add("rm-page-break");

        const page = document.createElement("div");
        page.classList.add("page");
        page.style.position = "relative";
        page.style.float = "left";
        page.style.clear = "both";
        page.style.marginTop = firstPage
          ? `calc(${_pageHeaderHeight}px + ${_pageHeight}px)`
          : _pageHeight + "px";

        const pageBreak = document.createElement("div");
        pageBreak.classList.add("breaker");
        pageBreak.style.width = `calc(100% + var(--rm-margin-left) + var(--rm-margin-right))`;
        pageBreak.style.marginLeft = `calc(-1 * var(--rm-margin-left))`;
        pageBreak.style.marginRight = `calc(-1 * var(--rm-margin-right))`;
        pageBreak.style.position = "relative";
        pageBreak.style.float = "left";
        pageBreak.style.clear = "both";
        pageBreak.style.left = `0px`;
        pageBreak.style.right = `0px`;
        pageBreak.style.zIndex = "2";

        const pageFooter = getFooter(pageOptions.footerRight, pageOptions.footerLeft, {
            showPageNumber: pageOptions.showPageNumber,
        });


        const pageSpace = document.createElement("div");
        pageSpace.classList.add("rm-pagination-gap");
        pageSpace.style.height = _pageGap + "px";
        pageSpace.style.borderLeft = "1px solid";
        pageSpace.style.borderRight = "1px solid";
        pageSpace.style.position = "relative";
        pageSpace.style.setProperty("width", "calc(100% + 3px)", "important");
        pageSpace.style.setProperty("inset-inline-start", "-2px");
        pageSpace.style.backgroundColor = _pageBreakBackground;
        pageSpace.style.borderLeftColor = _pageBreakBackground;
        pageSpace.style.borderRightColor = _pageBreakBackground;

        const pageHeader = document.createElement("div");
        pageHeader.classList.add("rm-page-header");
        // pageHeader.style.height = pageOptions.pageHeaderHeight + "px";
        pageHeader.style.overflow = "hidden";

        const headerLeft = pageOptions.headerLeft.replace(
          "{page}",
          `<span class="rm-page-number-plus"></span>`
        );
        const headerRight = pageOptions.headerRight.replace(
          "{page}",
          `<span class="rm-page-number-plus"></span>`
        );

        const pageHeaderLeft = document.createElement("div");
        pageHeaderLeft.classList.add("rm-page-header-left");
        pageHeaderLeft.innerHTML = headerLeft;

        const pageHeaderRight = document.createElement("div");
        pageHeaderRight.classList.add("rm-page-header-right");
        pageHeaderRight.innerHTML = headerRight;

        pageHeader.append(pageHeaderLeft, pageHeaderRight);
        pageBreak.append(pageFooter, pageSpace, pageHeader);
        pageContainer.append(page, pageBreak);

        return pageContainer;
      };

      const page = pageBreakDefinition({ firstPage: false });
      const firstPage = pageBreakDefinition({
        firstPage: true,
      });
      const fragment = document.createDocumentFragment();

      const rawCount = calculatePageCount(view, pageOptions, clean);
      const pageCount = Number.isFinite(rawCount) ? Math.max(1, Math.min(rawCount, 1000)) : 1;

      for (let i = 0; i < pageCount; i++) {
        if (i === 0) {
          fragment.appendChild(firstPage.cloneNode(true));
        } else {
          fragment.appendChild(page.cloneNode(true));
        }
      }
      el.append(fragment);
      el.id = "pages";

      return el;
    },
    { side: -1 }
  );
  const firstHeaderWidget = Decoration.widget(
    0,
    () => {
      const el = document.createElement("div");
      el.style.position = "relative";
      el.classList.add("rm-first-page-header");

      const headerLeft = pageOptions.headerLeft.replace(
        "{page}",
        `1`
      );
      const headerRight = pageOptions.headerRight.replace(
        "{page}",
        `1`
      );

      const pageHeaderLeft = document.createElement("div");
      pageHeaderLeft.classList.add("rm-first-page-header-left");
      pageHeaderLeft.innerHTML = headerLeft;
      el.append(pageHeaderLeft);

      const pageHeaderRight = document.createElement("div");
      pageHeaderRight.classList.add("rm-first-page-header-right");
      pageHeaderRight.innerHTML = headerRight;
      el.append(pageHeaderRight);

      // el.style.height = `${pageOptions.pageHeaderHeight}px`;
      el.style.overflow = "hidden";
      return el;
    },
    { side: -1 }
  );

  return !isInitial ? [pageWidget, firstHeaderWidget] : [pageWidget];
}
