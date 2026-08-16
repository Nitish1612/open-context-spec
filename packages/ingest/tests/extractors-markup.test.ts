import { describe, expect, it } from "vitest";
import { htmlExtractor, xmlExtractor, SecurityRejectionError } from "../src/index.js";
import type { ResolvedInput } from "../src/index.js";

function bufInput(content: string, filename: string): ResolvedInput {
  return { source: { kind: "text", content }, data: new TextEncoder().encode(content), filename };
}

describe("html extractor", () => {
  it("strips scripts and styles and never executes them", async () => {
    const html = `<html><head><title>T</title><style>body{color:red}</style></head>
      <body><script>window.pwned = true;</script><h1>Heading</h1><p>Body text.</p></body></html>`;
    const doc = await htmlExtractor.extract(bufInput(html, "p.html"), {});
    const allContent = doc.sections.map((s) => s.content).join("\n");
    expect(allContent).not.toContain("pwned");
    expect(allContent).not.toContain("color:red");
    expect(doc.title).toBe("T");
  });

  it("preserves headings, lists, and tables as readable text", async () => {
    const html = `<body>
      <h1>Report</h1>
      <ul><li>First</li><li>Second</li></ul>
      <table><tr><th>Name</th><th>Score</th></tr><tr><td>Alice</td><td>90</td></tr></table>
    </body>`;
    const doc = await htmlExtractor.extract(bufInput(html, "p.html"), {});
    const allContent = doc.sections.map((s) => s.content).join("\n");
    expect(allContent).toContain("First");
    expect(allContent).toContain("Alice");
    expect(allContent).toContain("90");
  });

  it("records the canonical URL when present", async () => {
    const html = `<head><link rel="canonical" href="https://example.com/a"/></head><body><p>x</p></body>`;
    const doc = await htmlExtractor.extract(bufInput(html, "p.html"), {});
    expect(doc.metadata.canonicalUrl).toBe("https://example.com/a");
  });
});

describe("xml extractor", () => {
  it("parses well-formed XML and preserves element paths", async () => {
    const xml = `<?xml version="1.0"?><root><item>One</item><item>Two</item></root>`;
    const doc = await xmlExtractor.extract(bufInput(xml, "d.xml"), {});
    expect(doc.sections.map((s) => s.content)).toEqual(["One", "Two"]);
  });

  it("rejects a DOCTYPE with an external SYSTEM entity (XXE attempt)", async () => {
    const xxe = `<?xml version="1.0"?>
      <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
      <root>&xxe;</root>`;
    await expect(xmlExtractor.extract(bufInput(xxe, "evil.xml"), {})).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("rejects a DOCTYPE declaring a custom ENTITY (billion-laughs shape)", async () => {
    const bomb = `<?xml version="1.0"?>
      <!DOCTYPE lolz [ <!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"> ]>
      <root>&lol2;</root>`;
    await expect(xmlExtractor.extract(bufInput(bomb, "bomb.xml"), {})).rejects.toThrow(
      SecurityRejectionError,
    );
  });

  it("accepts a harmless internal DOCTYPE with no external subset or entities", async () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE root><root><a>text</a></root>`;
    const doc = await xmlExtractor.extract(bufInput(xml, "ok.xml"), {});
    expect(doc.sections).toHaveLength(1);
  });
});
