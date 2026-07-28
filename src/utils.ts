import { PaginationPlusOptions } from "./PaginationPlus";
import { PageSize } from "./constants";

// Header/footer heights don't change while typing, but calculatePageCount re-reads
// them 2-3x per keystroke. Coalesce the layout read to once per frame per editor.
let frameToken = 0;
let frameScheduled = false;
const bumpFrame = () => { frameToken++; frameScheduled = false; };
const scheduleFrame = (): void => {
  if (frameScheduled) { return; }
  frameScheduled = true;
  if (typeof requestAnimationFrame !== "undefined") { requestAnimationFrame(bumpFrame); }
  else { setTimeout(bumpFrame, 16); }
};

interface CssCacheHost {
  __hf?: { token: number; headerHeight: number; footerHeight: number };
  __varSig?: string;
}

const measureHeaderFooter = (targetNode: HTMLElement, host: CssCacheHost) => {
  const cached = host.__hf;
  if (cached && cached.token === frameToken) { return cached; }
  const headerHeight = targetNode.querySelector(".rm-first-page-header")?.clientHeight || 0;
  const footerHeight = targetNode.querySelector(".rm-page-footer")?.clientHeight || 0;
  host.__hf = { token: frameToken, headerHeight, footerHeight };
  scheduleFrame();
  return host.__hf;
};

/** Returns the measured header/footer heights so callers need not re-read them. */
export const updateCssVariables = (targetNode: HTMLElement, config: PaginationPlusOptions) => {

  const host = config as unknown as CssCacheHost;
  const { headerHeight, footerHeight } = measureHeaderFooter(targetNode, host);

    const _pageContentHeight = config.pageHeight - config.contentMarginTop - config.contentMarginBottom - config.marginTop - config.marginBottom - headerHeight - footerHeight;

    // Nothing that feeds the vars changed since the last write; skip the rebuild.
    const sig = `${config.pageHeight}|${config.contentMarginTop}|${config.contentMarginBottom}|${config.marginTop}|${config.marginBottom}|${config.marginLeft}|${config.marginRight}|${config.pageGapBorderColor}|${config.pageWidth}|${headerHeight}|${footerHeight}`;
    if (host.__varSig === sig) {
      return { headerHeight, footerHeight };
    }
    host.__varSig = sig;

    const cssVariables = {
        "rm-page-content-height": `${_pageContentHeight}px`,
        "rm-page-height": `${config.pageHeight}px`,
        "rm-page-header-height": `${headerHeight}px`,
        "rm-page-footer-height": `${footerHeight}px`,
        "rm-max-content-child-height": `${_pageContentHeight - 10}px`,
        "rm-margin-top": `${config.marginTop}px`,
        "rm-margin-bottom": `${config.marginBottom}px`,
        "rm-margin-left": `${config.marginLeft}px`,
        "rm-margin-right": `${config.marginRight}px`,
        "rm-content-margin-top": `${config.contentMarginTop}px`,
        "rm-content-margin-bottom": `${config.contentMarginBottom}px`,
        "rm-page-gap-border-color": `${config.pageGapBorderColor}`,
        "rm-page-width": `${config.pageWidth}px`,
      }

  // These are inherited custom properties, so every write invalidates style for
  // the whole editor subtree and the next layout read pays for it. Reading the
  // inline declaration back is layout-free, so skip writes that change nothing.
  Object.entries(cssVariables).forEach(([key, value]) => {
    const property = `--${key}`;
    if (targetNode.style.getPropertyValue(property) !== value) {
      targetNode.style.setProperty(property, value);
    }
  });

  return { headerHeight, footerHeight };
}

export const getPageSize = (height: number, width: number, marginTop: number, marginBottom: number, marginLeft: number, marginRight: number): PageSize => {
    return {
        pageHeight: height,
        pageWidth: width,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
    }
}