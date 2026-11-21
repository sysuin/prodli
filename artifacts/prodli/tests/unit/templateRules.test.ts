import { describe, expect, it } from "vitest";
import { ruleTemplate, ruleWords, type TemplateRule } from "../../src/lib/templateRules";

const rules: TemplateRule[] = [
  { id: "1", match: "interview, phone screen", template: "interview" },
  { id: "2", match: "standup, stand-up", template: "standup" },
  { id: "3", match: "Acme", template: "custom:sales1" },
];

describe("ruleWords", () => {
  it("splits, trims, lowercases and drops blanks and doubles", () => {
    expect(ruleWords(" Interview,, phone  Screen , interview")).toEqual(["interview", "phone screen"]);
  });
});

describe("ruleTemplate", () => {
  it("picks the first rule whose words are in the name", () => {
    expect(ruleTemplate("Interview: Priya (backend)", rules)).toBe("interview");
    expect(ruleTemplate("Phone screen with Bo", rules)).toBe("interview");
    expect(ruleTemplate("Daily Stand-up", rules)).toBe("standup");
    expect(ruleTemplate("Acme pilot review", rules)).toBe("custom:sales1");
  });
  it("matches whole words only, ignoring case and accents", () => {
    expect(ruleTemplate("Interviewing tips", rules)).toBeUndefined();
    expect(ruleTemplate("ACMÉ kickoff", rules)).toBe("custom:sales1");
    expect(ruleTemplate("Planning", rules)).toBeUndefined();
  });
});
