import { PaginationPlusOptions } from "./PaginationPlus";
import { PageSize } from "./constants";

/** Returns the measured header/footer heights so callers need not re-read them. */
export const updateCssVariables = (targetNode: HTMLElement, config: PaginationPlusOptions) => {

  const headerHeight = targetNode.querySelector(".rm-first-page-header")?.clientHeight || 0;
  const footerHeight = targetNode.querySelector(".rm-page-footer")?.clientHeight || 0;

    const _pageContentHeight = config.pageHeight - config.contentMarginTop - config.contentMarginBottom - config.marginTop - config.marginBottom - headerHeight - footerHeight;

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