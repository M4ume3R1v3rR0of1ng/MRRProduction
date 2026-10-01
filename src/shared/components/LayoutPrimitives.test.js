// src/shared/components/LayoutPrimitives.test.js
//
// Pins the contracts views rely on when they swap a hand-built div for one of
// these: which classes land (the hover lift and sticky header are CSS, so a
// dropped class is a silent visual regression), that a clickable Card is a real
// keyboard control, and that spacing stays on the --space-* scale.
// renderToString, same as views.render.test.js — no DOM needed for any of it.
import { describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";

import {
  Card,
  Stack,
  Row,
  Eyebrow,
  SectionTitle,
  Muted,
  Text,
  Table,
  Callout,
  Btn,
} from "@/shared/components/UIPrimitives";

describe("Card", () => {
  it("is a plain surface by default", () => {
    const html = renderToString(h(Card, null, "body"));
    expect(html).toContain('class="mrr-card"');
    expect(html).not.toContain('role="button"');
    expect(html).toContain("padding:var(--space-7)");
  });

  it("becomes a focusable button with the hover lift when clickable", () => {
    const html = renderToString(h(Card, { onClick: () => {} }, "body"));
    expect(html).toContain('class="mrr-card mrr-card-click"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it("activates on Enter and Space but not from a nested control", () => {
    const onClick = vi.fn();
    const el = Card({ onClick, children: "x" });
    const self = {};
    const key = (k, target = self) => ({
      key: k,
      target,
      currentTarget: self,
      preventDefault() {},
    });
    el.props.onKeyDown(key("Enter"));
    el.props.onKeyDown(key(" "));
    el.props.onKeyDown(key("a"));
    el.props.onKeyDown(key("Enter", {})); // e.g. Enter inside an <input> in the card
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("stays a plain clickable region when it holds its own buttons", () => {
    const onClick = vi.fn();
    const html = renderToString(h(Card, { onClick, containsActions: true }, "body"));
    expect(html).toContain("mrr-card-click");
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("tabindex");
    Card({ onClick, containsActions: true, children: "x" }).props.onClick();
    expect(onClick).toHaveBeenCalled();
  });

  it("gets the lift without the button semantics when only `hover` is set", () => {
    const html = renderToString(h(Card, { hover: true }, "body"));
    expect(html).toContain('class="mrr-card mrr-card-hover"');
    expect(html).not.toContain('role="button"');
  });

  it("reads a numeric pad as a --space-* step", () => {
    expect(renderToString(h(Card, { pad: 8 }, "body"))).toContain("padding:var(--space-8)");
  });

  it("lets style override one property without losing the variant", () => {
    const html = renderToString(h(Card, { variant: "flat", style: { marginBottom: 16 } }, "body"));
    expect(html).toContain("box-shadow:none");
    expect(html).toContain("margin-bottom:16px");
  });
});

describe("Stack / Row", () => {
  it("maps a numeric gap onto the spacing scale and passes strings through", () => {
    expect(renderToString(h(Stack, { gap: 6 }))).toContain("gap:var(--space-6)");
    expect(renderToString(h(Row, { gap: "3px" }))).toContain("gap:3px");
  });

  it("treats gap={0} as no gap rather than a missing --space-0", () => {
    const html = renderToString(h(Row, { gap: 0 }));
    expect(html).toContain("gap:0");
    expect(html).not.toContain("--space-0");
  });

  it("only wraps a Row when asked", () => {
    expect(renderToString(h(Row))).not.toContain("flex-wrap");
    expect(renderToString(h(Row, { wrap: true }))).toContain("flex-wrap:wrap");
  });
});

describe("text", () => {
  it("renders the eyebrow as the majority label style", () => {
    const html = renderToString(h(Eyebrow, null, "Status"));
    expect(html).toContain("text-transform:uppercase");
    expect(html).toContain("font-size:var(--text-xs)");
  });

  it("puts SectionTitle actions on the same row as the heading", () => {
    const html = renderToString(h(SectionTitle, { actions: h("button", null, "Add") }, "Crew"));
    expect(html).toMatch(/<h2[^>]*>Crew<\/h2>/);
    expect(html).toContain("justify-content:space-between");
    expect(html).toContain("<button>Add</button>");
  });

  it("sizes Muted from the text scale", () => {
    expect(renderToString(h(Muted, { size: "sm" }, "x"))).toContain("font-size:var(--text-sm)");
  });

  it("maps Text size and weight names onto the tokens", () => {
    const html = renderToString(h(Text, { size: "lg", weight: "black", color: "red" }, "x"));
    expect(html).toContain("font-size:var(--text-lg)");
    expect(html).toContain("font-weight:var(--weight-black)");
    expect(html).toContain("color:red");
  });

  it("leaves unset Text properties to inherit, margins included", () => {
    expect(renderToString(h(Text, { as: "p" }, "x"))).toBe("<p>x</p>");
  });
});

describe("Table", () => {
  it("wraps in the scroll container with cell padding and row rules opted in", () => {
    const html = renderToString(h(Table, null, h("tbody")));
    expect(html).toContain('class="sw-table-scroll"');
    expect(html).toContain('class="mrr-table mrr-table-pad mrr-table-ruled"');
  });

  it("sets every cell's padding from one pad step", () => {
    const html = renderToString(h(Table, { pad: "lg", size: "base", minWidth: 560 }, h("tbody")));
    expect(html).toContain("--cell-pad:var(--space-4) var(--space-5)");
    expect(html).toContain("font-size:var(--text-base)");
    expect(html).toContain("min-width:560px");
  });

  it("leaves padding and rules to the cells when asked", () => {
    const html = renderToString(h(Table, { pad: "none", ruled: false }, h("tbody")));
    expect(html).toContain('class="mrr-table"');
  });

  it("pins the header when stickyHead is set", () => {
    const html = renderToString(h(Table, { stickyHead: true, maxHeight: 400 }, h("tbody")));
    expect(html).toContain("mrr-table-sticky");
    expect(html).toContain("max-height:400px");
  });
});

describe("Callout", () => {
  it("is a neutral well with inherited text by default", () => {
    const html = renderToString(h(Callout, null, "note"));
    expect(html).toContain("background:var(--c-subtle)");
    expect(html).not.toContain("border:");
    expect(html).not.toMatch(/[;"]color:/);
  });

  it("borders in the tone's own color", () => {
    const html = renderToString(h(Callout, { tone: "danger", bordered: true }, "x"));
    expect(html).toContain("background:var(--c-rust-wash)");
    expect(html).toContain("border:1.5px solid var(--c-rust)");
  });

  it("lays an icon beside the content, top-aligned", () => {
    const Icon = (p) => h("svg", p);
    const html = renderToString(h(Callout, { icon: Icon }, "wrapped message"));
    expect(html).toContain("align-items:flex-start");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("wrapped message");
  });
});

describe("Btn", () => {
  it("recolors an outline button with tone", () => {
    const html = renderToString(h(Btn, { v: "outline", tone: "red" }, "Delete"));
    expect(html).toContain("color:red");
    expect(html).toContain("border:2px solid red");
  });

  it("shows a not-allowed cursor while disabled", () => {
    expect(renderToString(h(Btn, { disabled: true }, "x"))).toContain("cursor:not-allowed");
  });
});
