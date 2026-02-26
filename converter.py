#!/usr/bin/env python3
"""
Tolerant converter for MultiTerm/MTF-like XML -> bilingual CSV.

Output columns (entry_class included only if non-empty in at least one row):
concept_id,alternative_id,entry_class,category,product_type,graphic,concept_note,
created_by,created_at,modified_by,modified_at,
src_lang,src_term,tgt_lang,tgt_term,term_note
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Iterable, Set

XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


# -------------------------
# Helpers
# -------------------------
def lname(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def lnamel(tag: str) -> str:
    return lname(tag).lower()


def txt(el: Optional[ET.Element]) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def iter_desc(el: ET.Element, local: str) -> Iterable[ET.Element]:
    local = local.lower()
    for d in el.iter():
        if lnamel(d.tag) == local:
            yield d


def iter_children(el: ET.Element, local: str) -> Iterable[ET.Element]:
    local = local.lower()
    for c in list(el):
        if lnamel(c.tag) == local:
            yield c


def first_child(el: ET.Element, local: str) -> Optional[ET.Element]:
    for c in iter_children(el, local):
        return c
    return None


def first_desc(el: ET.Element, local: str) -> Optional[ET.Element]:
    for d in iter_desc(el, local):
        return d
    return None


def dedupe_keep_order(items: List[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for x in items:
        x = (x or "").strip()
        if not x or x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


# -------------------------
# Language normalization (key fix)
# -------------------------
LCID_TO_ISO = {
    "1031": "de",  # German (Germany)
    "1033": "en",  # English (United States)
    "2057": "en",  # English (United Kingdom)
    "1036": "fr",  # French (France)
    "1040": "it",  # Italian (Italy)
    "1043": "nl",  # Dutch (Netherlands)
    "1034": "es",  # Spanish (Spain)
    "1045": "pl",  # Polish
    "1029": "cs",  # Czech
    "1038": "hu",  # Hungarian
    "1049": "ru",  # Russian
}

ISO3_TO_ISO2 = {
    "deu": "de",
    "ger": "de",
    "eng": "en",
    "fra": "fr",
    "fre": "fr",
    "ita": "it",
    "nld": "nl",
    "dut": "nl",
    "spa": "es",
    "pol": "pl",
    "ces": "cs",
    "cze": "cs",
}

NAME_HINTS = [
    (("german", "deutsch"), "de"),
    (("english", "englisch"), "en"),
    (("french", "français", "francais", "französisch", "franzoesisch"), "fr"),
    (("italian", "italiano", "italienisch"), "it"),
    (("dutch", "nederlands", "holländisch", "hollaendisch"), "nl"),
    (("spanish", "español", "espanol", "spanisch"), "es"),
    (("polish", "polski", "polnisch"), "pl"),
    (("czech", "čeština", "cestina", "tschechisch"), "cs"),
    (("hungarian", "magyar", "ungarisch"), "hu"),
    (("russian", "русский", "russisch"), "ru"),
]


def norm_lang_token(token: str) -> str:
    """
    Accepts language tokens from MTF like:
      - "de", "de-DE", "DE"
      - "German", "Deutsch"
      - LCID numbers: "1031"
      - ISO-639-2/3: "DEU", "ENG"
      - noisy strings: "German (Germany)"
    Returns ISO-639-1 if we can guess; else returns "".
    """
    token = (token or "").strip()
    if not token:
        return ""

    low = token.strip().lower()

    # If it's an LCID-like number
    if low.isdigit() and low in LCID_TO_ISO:
        return LCID_TO_ISO[low]

    # If it looks like "de-DE" / "de_DE"
    m = re.match(r"^([a-z]{2,3})([-_][a-z0-9]{2,8})*$", low)
    if m:
        base = m.group(1)
        if len(base) == 2:
            return base
        if len(base) == 3 and base in ISO3_TO_ISO2:
            return ISO3_TO_ISO2[base]

    # Try to find a name hint inside the string
    for needles, iso2 in NAME_HINTS:
        if any(n in low for n in needles):
            return iso2

    # Last resort: maybe the token IS the language name exactly (single word)
    if low in ISO3_TO_ISO2:
        return ISO3_TO_ISO2[low]

    return ""


# -------------------------
# Metadata extraction
# -------------------------
def transac_info(concept: ET.Element, kind: str) -> Tuple[str, str]:
    """kind: 'origination' or 'modification' -> returns (person, date_str)"""
    kind = (kind or "").strip().lower()

    for tg in iter_desc(concept, "transacGrp"):
        transac = first_child(tg, "transac")
        if transac is None:
            continue
        if (transac.get("type") or "").strip().lower() != kind:
            continue

        person = txt(transac)
        date_el = first_child(tg, "date")
        date_str = txt(date_el)
        return person, date_str

    return "", ""


def concept_meta(concept: ET.Element) -> Dict[str, str]:
    meta = {
        "concept_id": "",
        "alternative_id": "",
        "entry_class": "",
        "category": "",
        "product_type": "",
        "graphic": "",
        "concept_note": "",
    }

    c = first_child(concept, "concept") or first_desc(concept, "concept")
    if c is not None:
        meta["concept_id"] = txt(c)
        meta["alternative_id"] = (c.get("alternativeId") or "").strip()

    for s in iter_desc(concept, "system"):
        if (s.get("type") or "").strip().lower() == "entryclass":
            meta["entry_class"] = txt(s)
            break

    def consume_descripgrps(grps: Iterable[ET.Element]) -> None:
        for dg in grps:
            d = first_child(dg, "descrip")
            if d is None:
                continue
            dtype = (d.get("type") or "").strip().lower()
            val = txt(d)
            if not val:
                continue

            if dtype in ("kategorie", "category"):
                meta["category"] = val
            elif dtype in ("produkttyp", "product_type", "product type"):
                meta["product_type"] = val
            elif dtype == "graphic":
                meta["graphic"] = val
            elif dtype in ("erläuterung", "erlaeuterung", "note", "concept_note", "concept note"):
                meta["concept_note"] = (meta["concept_note"] + " | " + val).strip(" |") if meta["concept_note"] else val

    direct = list(iter_children(concept, "descripGrp"))
    if direct:
        consume_descripgrps(direct)
    else:
        consume_descripgrps(iter_desc(concept, "descripGrp"))

    return meta


# -------------------------
# Term extraction (MTF-friendly)
# -------------------------
def extract_terms_from_languagegrp(language_grp: ET.Element) -> Tuple[List[str], str]:
    """
    languageGrp typically contains:
      <language type="German">...</language>
      <termGrp><term>...</term>...</termGrp>
    """
    terms: List[str] = []
    notes: List[str] = []

    # terms are under termGrp/term
    for t in iter_desc(language_grp, "term"):
        v = txt(t)
        if v:
            terms.append(v)

    # notes: termNote, note, and (some) descrip types
    for n in iter_desc(language_grp, "termNote"):
        v = txt(n)
        if v:
            notes.append(v)
    for n in iter_desc(language_grp, "note"):
        v = txt(n)
        if v:
            notes.append(v)

    for d in iter_desc(language_grp, "descrip"):
        dtype = (d.get("type") or "").strip().lower()
        if dtype in ("erläuterung", "erlaeuterung", "note", "comment", "remark", "definition"):
            v = txt(d)
            if v:
                notes.append(v)

    return dedupe_keep_order(terms), " | ".join(dedupe_keep_order(notes))


def detect_lang_from_languagegrp(language_grp: ET.Element) -> str:
    """
    In your file, languageGrp contains <language ...>.
    The actual language is often in:
      - <language type="German">   (type attr)
      - <language>German</language> (text)
      - <language type="1031">     (LCID)
    """
    lang_el = first_child(language_grp, "language") or first_desc(language_grp, "language")
    if lang_el is None:
        return ""

    # 1) Prefer attribute "type" (common in MultiTerm exports)
    token = (lang_el.get("type") or "").strip()
    iso = norm_lang_token(token)
    if iso:
        return iso

    # 2) Then try other attrs
    for k in (XML_LANG, "xml:lang", "lang", "language", "locale", "lcid", "langid"):
        if k in lang_el.attrib:
            iso = norm_lang_token(lang_el.attrib.get(k, ""))
            if iso:
                return iso

    # 3) Then try text content
    iso = norm_lang_token(txt(lang_el))
    if iso:
        return iso

    return ""


def extract_terms_by_lang(concept: ET.Element) -> Dict[str, List[Tuple[str, str]]]:
    """
    Returns: {lang: [(term, note), ...], ...}
    """
    by_lang: Dict[str, List[Tuple[str, str]]] = {}

    # This is the key structure in your XML
    for lg in iter_desc(concept, "languageGrp"):
        lang = detect_lang_from_languagegrp(lg)
        if not lang:
            continue
        terms, note = extract_terms_from_languagegrp(lg)
        if not terms:
            continue
        for term in terms:
            by_lang.setdefault(lang, []).append((term, note))

    # Deduplicate pairs while preserving order
    for lang, pairs in list(by_lang.items()):
        seen: Set[Tuple[str, str]] = set()
        cleaned: List[Tuple[str, str]] = []
        for term, note in pairs:
            key = (term.strip(), note.strip())
            if not key[0] or key in seen:
                continue
            seen.add(key)
            cleaned.append(key)
        by_lang[lang] = cleaned

    return by_lang


def pick_source_lang(terms_by_lang: Dict[str, List[Tuple[str, str]]], preferred: str) -> str:
    pref = norm_lang_token(preferred)
    if pref and pref in terms_by_lang:
        return pref
    if "de" in terms_by_lang:
        return "de"
    return sorted(terms_by_lang.keys())[0] if terms_by_lang else ""


# -------------------------
# Debug
# -------------------------
def debug_summary(root: ET.Element, concepts: List[ET.Element]) -> None:
    tags: Dict[str, int] = {}
    for el in root.iter():
        tags[lname(el.tag)] = tags.get(lname(el.tag), 0) + 1
    top = sorted(tags.items(), key=lambda x: (-x[1], x[0]))[:40]

    print("\nDEBUG SUMMARY", file=sys.stderr)
    print(f"- root tag: {lname(root.tag)}", file=sys.stderr)
    print(f"- concepts found: {len(concepts)}", file=sys.stderr)
    print("- top tags:", file=sys.stderr)
    for t, c in top:
        print(f"  {t}: {c}", file=sys.stderr)

    # show a few concepts with what we detect + show raw language tokens
    for i, concept in enumerate(concepts[:3], start=1):
        meta = concept_meta(concept)
        t_by_l = extract_terms_by_lang(concept)
        langs = sorted(t_by_l.keys())
        print(f"\n- concept #{i}: concept_id={meta.get('concept_id','')!r} alternative_id={meta.get('alternative_id','')!r}", file=sys.stderr)

        # raw language tokens
        raw = []
        for lg in list(iter_desc(concept, "languageGrp"))[:6]:
            le = first_child(lg, "language") or first_desc(lg, "language")
            if le is None:
                continue
            raw.append({
                "language_text": txt(le),
                "language_type": (le.get("type") or "").strip(),
                "language_attrib": dict(le.attrib),
                "norm": norm_lang_token((le.get("type") or "").strip() or txt(le)),
            })
        print(f"  raw language samples (first few): {raw}", file=sys.stderr)

        print(f"  detected langs: {langs}", file=sys.stderr)
        for lg in langs[:6]:
            sample_terms = [t for (t, _) in t_by_l[lg]][:5]
            print(f"   - {lg}: {sample_terms}", file=sys.stderr)
    print("", file=sys.stderr)


# -------------------------
# Main
# -------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("xml_in", help="Input XML file (MTF/TBX-like)")
    ap.add_argument("csv_out", help="Output CSV file")
    ap.add_argument("--source-lang", default="de", help="Preferred source language (default: de)")
    ap.add_argument("--debug", action="store_true", help="Print debug info to stderr")
    args = ap.parse_args()

    xml_path = Path(args.xml_in)
    if not xml_path.exists():
        print(f"ERROR: input file not found: {xml_path}", file=sys.stderr)
        return 2

    try:
        tree = ET.parse(str(xml_path))
        root = tree.getroot()
    except Exception as e:
        print(f"ERROR: cannot parse XML: {e}", file=sys.stderr)
        return 2

    concepts = [el for el in root.iter() if lnamel(el.tag) in ("conceptgrp", "termentry")]
    if not concepts:
        # fallback: any element that contains at least one <term>
        for el in root.iter():
            if any(lnamel(d.tag) == "term" for d in el.iter()):
                concepts.append(el)

    rows: List[Dict[str, str]] = []
    any_entry_class = False

    for concept in concepts:
        meta = concept_meta(concept)

        created_by, created_at = transac_info(concept, "origination")
        modified_by, modified_at = transac_info(concept, "modification")

        meta["created_by"] = created_by
        meta["created_at"] = created_at
        meta["modified_by"] = modified_by
        meta["modified_at"] = modified_at

        if meta.get("entry_class", "").strip():
            any_entry_class = True

        terms_by_lang = extract_terms_by_lang(concept)
        if not terms_by_lang:
            continue

        src_lang = pick_source_lang(terms_by_lang, args.source_lang)
        if not src_lang or src_lang not in terms_by_lang:
            continue

        src_terms = terms_by_lang[src_lang]

        for tgt_lang, tgt_terms in terms_by_lang.items():
            if tgt_lang == src_lang:
                continue
            for s_term, s_note in src_terms:
                for t_term, t_note in tgt_terms:
                    term_note = " | ".join([x for x in [s_note, t_note] if x]).strip()
                    rows.append({
                        "concept_id": meta.get("concept_id", ""),
                        "alternative_id": meta.get("alternative_id", ""),
                        "entry_class": meta.get("entry_class", ""),
                        "category": meta.get("category", ""),
                        "product_type": meta.get("product_type", ""),
                        "graphic": meta.get("graphic", ""),
                        "concept_note": meta.get("concept_note", ""),
                        "created_by": meta.get("created_by", ""),
                        "created_at": meta.get("created_at", ""),
                        "modified_by": meta.get("modified_by", ""),
                        "modified_at": meta.get("modified_at", ""),
                        "src_lang": src_lang,
                        "src_term": s_term,
                        "tgt_lang": tgt_lang,
                        "tgt_term": t_term,
                        "term_note": term_note,
                    })

    base_cols = [
        "concept_id",
        "alternative_id",
        "entry_class",
        "category",
        "product_type",
        "graphic",
        "concept_note",
        "created_by",
        "created_at",
        "modified_by",
        "modified_at",
        "src_lang",
        "src_term",
        "tgt_lang",
        "tgt_term",
        "term_note",
    ]
    cols = [c for c in base_cols if c != "entry_class"] if not any_entry_class else base_cols

    out_path = Path(args.csv_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print(f"OK: wrote {len(rows)} rows -> {out_path}")

    if args.debug or len(rows) == 0:
        debug_summary(root, concepts)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
