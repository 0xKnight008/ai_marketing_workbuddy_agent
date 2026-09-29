import assert from "node:assert/strict";
import test from "node:test";
import { uniqueImportItems } from "./deduplicate";
import { csvRecordToItem, parseCsv, pasteToItems } from "./csv";
test("paste deduplicates exact normalized records, not different feedback", () => {
  assert.equal(
    uniqueImportItems(pasteToItems(" Same text\nSame text\nDifferent text"))
      .length,
    2,
  );
});
test("same text from distinct authors, platforms, products or IDs stays in scope", () => {
  const csv =
    "text,author,platform,sku,id\nGood,A,youtube,A,1\nGood,A,youtube,A,1\nGood,B,youtube,A,1\nGood,A,instagram,A,1\nGood,A,youtube,B,1\nGood,A,youtube,A,2";
  const items = parseCsv(csv)
    .map(csvRecordToItem)
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  assert.equal(uniqueImportItems(items).length, 5);
  assert.equal(items.length, 6);
});
