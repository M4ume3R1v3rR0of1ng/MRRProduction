// Sets the browser tab title and (for the logged-out, crawlable pages) the meta
// description while a page is mounted.
//
// Before this, every public page — landing, terms, privacy, training — shipped
// the same static <title>Steadwerk</title> and the same generic meta description
// from index.html, no matter which one a search engine or a shared link actually
// landed on. A Terms & Conditions page and the pricing page were indistinguishable
// in a browser tab, in history, and in search results.
import { useEffect } from "react";

const DEFAULT_DESCRIPTION = "Warehouse & fleet software — tools that work as hard as you do.";

/**
 * @param {string} title - shown as "<title> · Steadwerk" in the tab. Pass just
 *   "Steadwerk" (or omit) for the bare wordmark, used on the landing page itself.
 * @param {string} [description] - overrides the meta description while this page
 *   is mounted, restored to what it was before on unmount. Only worth passing on
 *   pages a crawler can actually reach — the authenticated app is not indexable
 *   regardless of what its description says.
 */
export function useDocumentMeta(title, description) {
  useEffect(() => {
    document.title = title && title !== "Steadwerk" ? `${title} · Steadwerk` : "Steadwerk";
  }, [title]);

  useEffect(() => {
    if (!description) return;
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "description");
      document.head.appendChild(tag);
    }
    const previous = tag.getAttribute("content") || DEFAULT_DESCRIPTION;
    tag.setAttribute("content", description);
    return () => {
      tag.setAttribute("content", previous);
    };
  }, [description]);
}
