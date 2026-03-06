import test from "node:test";
import assert from "node:assert/strict";
import {
  concordanceTokens,
  matchConcordanceTerm,
  normalizeConcordanceText
} from "../src/routes/termbases.concordance.helpers.ts";

test("normalizeConcordanceText transliterates German umlauts", () => {
  assert.equal(normalizeConcordanceText("R\u00E4der & Gr\u00F6\u00DFe"), "raeder groesse");
  assert.equal(normalizeConcordanceText("Stra\u00DFe"), "strasse");
});

test("matchConcordanceTerm matches transliterated umlaut spellings", () => {
  const query = "Raeder";
  assert.deepEqual(
    matchConcordanceTerm({
      termText: "R\u00E4der",
      queryNorm: normalizeConcordanceText(query),
      queryTokens: concordanceTokens(query)
    }),
    { type: "exact", ratio: 1 }
  );
});
