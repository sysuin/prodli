import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { editorSourceHash } from "../../editor-web/sourceHash.mjs";

describe("the phone's note editor bundle", () => {
  it("is built from the current note blocks (else: pnpm --filter @workspace/prodli-mobile run build:editor)", () => {
    const generated = readFileSync(path.join(__dirname, "../../src/ui/noteEditorHtml.js"), "utf8");
    const stamped = /export const editorSourceHash = "([0-9a-f]+)"/.exec(generated)?.[1];
    expect(stamped).toBe(editorSourceHash());
  });

  it("is a single page with TenTap's boot marker and ProdLi's blocks in it", () => {
    const generated = readFileSync(path.join(__dirname, "../../src/ui/noteEditorHtml.js"), "utf8");
    for (const marker of ["<!--TENTAP_BOOT-->", 'id=\\"root\\"', "note-image", "note-link", "callout", "detailsContent", "tableWrapper"]) expect(generated).toContain(marker);
    expect(generated).not.toMatch(/<script[^>]+src=/);
  });
});
