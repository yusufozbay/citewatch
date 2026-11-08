import type { Element, ElementContent, Root, RootContent } from "hast"

import type { BrandMatcher } from "./answer"

// Links are walked too: brand names often appear as link text. Citation chips are numbers, so never match.
const SKIP = new Set(["code", "pre", "mark"])

/** Wrap brand mentions in text nodes with <mark data-brand="Name">. */
export function rehypeBrands(matcher: BrandMatcher) {
  return (tree: Root) => {
    if (matcher.active) walk(tree, matcher)
  }
}

function walk(node: Root | Element, matcher: BrandMatcher) {
  const out: (RootContent | ElementContent)[] = []
  for (const child of node.children) {
    if (child.type === "text") {
      out.push(...split(child.value, matcher))
    } else {
      if (child.type === "element" && !SKIP.has(child.tagName)) walk(child, matcher)
      out.push(child)
    }
  }
  node.children = out as typeof node.children
}

function split(value: string, matcher: BrandMatcher): ElementContent[] {
  const parts: ElementContent[] = []
  let last = 0
  for (const m of matcher.find(value)) {
    if (m.index > last) parts.push({ type: "text", value: value.slice(last, m.index) })
    parts.push({
      type: "element",
      tagName: "mark",
      properties: { dataBrand: m.brand.name },
      children: [{ type: "text", value: m.text }],
    })
    last = m.index + m.text.length
  }
  if (!parts.length) return [{ type: "text", value }]
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) })
  return parts
}
