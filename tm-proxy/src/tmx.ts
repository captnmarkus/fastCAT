import { XMLParser } from "fast-xml-parser";

export type TMXUnit = {
  source?: string;
  target?: string;
  sourceLang?: string;
  targetLang?: string;
};

export function parseTMX(xml: string): TMXUnit[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true
  });

  const j = parser.parse(xml);
  const tus = j?.tmx?.body?.tu;
  if (!tus) return [];

  const arr = Array.isArray(tus) ? tus : [tus];

  const out: TMXUnit[] = [];
  for (const tu of arr) {
    const tuv = tu?.tuv;
    if (!tuv) continue;
    const tuvs = Array.isArray(tuv) ? tuv : [tuv];

    // pick first two languages if more present
    if (tuvs.length < 2) continue;
    const [a, b] = tuvs;

    const aLang: string | undefined = a?.["xml:lang"] || a?.lang;
    const bLang: string | undefined = b?.["xml:lang"] || b?.lang;
    const aSeg: string | undefined = a?.seg;
    const bSeg: string | undefined = b?.seg;

    if (aLang && bLang && aSeg && bSeg) {
      out.push({
        source: aSeg,
        target: bSeg,
        sourceLang: aLang.slice(0, 2),
        targetLang: bLang.slice(0, 2)
      });
    }
  }

  return out;
}
