"""L1 — anchor-based item extractor.

Goal: zero LLM cost. Find Item boundaries in the normalized text using
deterministic regex + structural heuristics. Compute confidence from
observable invariants. Hand off to L2/L3 only when confidence is low.

Approach:
  1. Scan all headings for "Item X[.] <Title>" patterns.
  2. Filter out TOC-region duplicates (we want body anchors, not the TOC).
  3. Build a sequence of (item_id, anchor_offset).
  4. For each anchor, the item's `content` = text between this anchor and
     the next anchor.
  5. Validate against SEC's expected item set and ordering.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from shared.logging import get_logger
from shared.schemas import TEN_K_ITEM_IDS, ExtractedItem

from task2_10k_extractor.pipeline.normalize import HeadingCandidate, NormalizedFiling

logger = get_logger(__name__)


# Canonical titles per SEC Form 10-K (2024). Used for title back-fill and
# weak validation. Multiple aliases allowed because filings vary slightly.
ITEM_CANONICAL_TITLE: dict[str, str] = {
    "1": "Business",
    "1A": "Risk Factors",
    "1B": "Unresolved Staff Comments",
    "1C": "Cybersecurity",
    "2": "Properties",
    "3": "Legal Proceedings",
    "4": "Mine Safety Disclosures",
    "5": "Market for Registrant's Common Equity, Related Stockholder Matters and Issuer Purchases of Equity Securities",
    "6": "[Reserved]",
    "7": "Management's Discussion and Analysis of Financial Condition and Results of Operations",
    "7A": "Quantitative and Qualitative Disclosures About Market Risk",
    "8": "Financial Statements and Supplementary Data",
    "9": "Changes in and Disagreements with Accountants on Accounting and Financial Disclosure",
    "9A": "Controls and Procedures",
    "9B": "Other Information",
    "9C": "Disclosure Regarding Foreign Jurisdictions that Prevent Inspections",
    "10": "Directors, Executive Officers and Corporate Governance",
    "11": "Executive Compensation",
    "12": "Security Ownership of Certain Beneficial Owners and Management and Related Stockholder Matters",
    "13": "Certain Relationships and Related Transactions, and Director Independence",
    "14": "Principal Accountant Fees and Services",
    "15": "Exhibits, Financial Statement Schedules",
    "16": "Form 10-K Summary",
}


# Matches: "Item 1.", "ITEM 1A", "Item 7A. Management's Discussion...", "Item 7A — MD&A"
_ITEM_HEADING_RE = re.compile(
    r"""
    ^\s*
    item\s+
    (?P<id>\d+[A-Z]?)        # e.g. 1, 1A, 9B, 16
    \s*[.\-:–—]?     # optional separator (dot, dash, em-dash)
    \s*
    (?P<title>[^\n]{0,200})?
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)


@dataclass
class _Anchor:
    item_id: str
    char_offset: int
    raw_title: str
    is_toc: bool


def _normalize_id(raw: str) -> str:
    """Item id normalization: '01' → '1', '1a' → '1A'."""
    s = raw.strip().upper()
    if re.fullmatch(r"\d+[A-Z]?", s):
        digits = re.match(r"\d+", s).group(0)
        suffix = s[len(digits):]
        return str(int(digits)) + suffix
    return s


def _scan_anchors(ir: NormalizedFiling) -> list[_Anchor]:
    anchors: list[_Anchor] = []
    for h in ir.headings:
        m = _ITEM_HEADING_RE.match(h.text)
        if not m:
            continue
        item_id = _normalize_id(m.group("id"))
        if item_id not in TEN_K_ITEM_IDS:
            continue
        anchors.append(
            _Anchor(
                item_id=item_id,
                char_offset=h.char_offset,
                raw_title=(m.group("title") or "").strip(),
                is_toc=h.is_table_of_contents,
            )
        )
    _flag_toc_by_density(anchors)
    return anchors


def _flag_toc_by_density(anchors: list[_Anchor]) -> None:
    """Density-based TOC detection.

    Find the *single densest* 3,000-char window. If it contains ≥ 10 item
    anchors, mark only those anchors as TOC. Catches filings whose
    normalizer-level Part-I detection missed (e.g. MSFT) without over-flagging
    multiple body regions as TOC.
    """
    if len(anchors) < 10:
        return
    sorted_by_off = sorted(anchors, key=lambda a: a.char_offset)
    n = len(sorted_by_off)
    best_start = best_end = -1
    best_count = 0
    for i in range(n):
        window_end = sorted_by_off[i].char_offset + 3000
        j = i
        while j + 1 < n and sorted_by_off[j + 1].char_offset <= window_end:
            j += 1
        count = j - i + 1
        if count > best_count:
            best_count = count
            best_start, best_end = i, j
    if best_count >= 10:
        for k in range(best_start, best_end + 1):
            sorted_by_off[k].is_toc = True


def _title_matches_canonical(item_id: str, raw_title: str) -> bool:
    """Loose match: does the raw_title start with words from the SEC title?

    Anchors emitted from page running-headers have empty or single-word titles;
    real section openers spell out at least the first 6 chars of the canonical.
    """
    if not raw_title:
        return False
    canonical = ITEM_CANONICAL_TITLE.get(item_id, "").upper()
    if not canonical:
        return False
    # Take the first 6 chars of canonical (after stripping punctuation) and
    # check the raw title starts with them.
    needle = re.sub(r"[^A-Z]", "", canonical)[:6]
    haystack = re.sub(r"[^A-Z]", "", raw_title.upper())
    return bool(needle) and haystack.startswith(needle)


def _pick_body_anchors(anchors: list[_Anchor]) -> list[_Anchor]:
    """Pick the canonical body anchor for each item id.

    Priority (first hit wins for each item):
      1. First NON-TOC anchor whose raw_title contains a canonical-title match.
         These are real section openers — running headers carry no title.
      2. Last NON-TOC anchor whose char_offset is followed by a substantial
         gap (≥ 1000 chars) before the next *same-item* anchor — meaning the
         anchor is the START of a section, not a page running header.
      3. Last NON-TOC anchor of that item (fallback when neither heuristic
         finds a winner).
      4. Last anchor of any kind (final fallback to keep coverage).
    """
    # Precompute "next-same-item gap" so we can find anchors that open sections
    by_id_offsets: dict[str, list[int]] = {}
    for a in anchors:
        by_id_offsets.setdefault(a.item_id, []).append(a.char_offset)
    for offsets in by_id_offsets.values():
        offsets.sort()

    def gap_to_next_same(item_id: str, off: int) -> int:
        offsets = by_id_offsets[item_id]
        for o in offsets:
            if o > off:
                return o - off
        return 10**9  # last one for this id

    by_id_title: dict[str, _Anchor] = {}
    by_id_section: dict[str, _Anchor] = {}
    by_id_body_last: dict[str, _Anchor] = {}
    by_id_any: dict[str, _Anchor] = {}

    for a in anchors:
        by_id_any[a.item_id] = a  # last-wins
        if a.is_toc:
            continue
        # Section opener: FIRST non-TOC anchor with a large gap to the next
        # same-item anchor. The "large gap" means real body content follows
        # rather than a page running-header that immediately repeats.
        if (
            a.item_id not in by_id_section
            and gap_to_next_same(a.item_id, a.char_offset) >= 1000
        ):
            by_id_section[a.item_id] = a
        by_id_body_last[a.item_id] = a  # last non-TOC anchor (fallback)
        if a.item_id not in by_id_title and _title_matches_canonical(
            a.item_id, a.raw_title
        ):
            by_id_title[a.item_id] = a  # first-wins

    chosen: dict[str, _Anchor] = {}
    for item_id in TEN_K_ITEM_IDS:
        if item_id in by_id_title:
            chosen[item_id] = by_id_title[item_id]
        elif item_id in by_id_section:
            chosen[item_id] = by_id_section[item_id]
        elif item_id in by_id_body_last:
            chosen[item_id] = by_id_body_last[item_id]
        elif item_id in by_id_any:
            chosen[item_id] = by_id_any[item_id]

    return sorted(chosen.values(), key=lambda a: a.char_offset)


def _slice_content(text: str, start: int, end: int) -> str:
    raw = text[start:end]
    # Strip leading line whitespace and the heading line itself; the heading is
    # already at `start`, so we walk past the first newline.
    first_nl = raw.find("\n")
    if first_nl > 0:
        raw = raw[first_nl + 1:]
    return raw.strip()


def extract_l1(ir: NormalizedFiling) -> list[ExtractedItem]:
    """Run L1 anchor extraction. Returns items in document order."""
    raw_anchors = _scan_anchors(ir)
    if not raw_anchors:
        logger.warning("l1_no_anchors_found")
        return []

    anchors = _pick_body_anchors(raw_anchors)
    if not anchors:
        return []

    items: list[ExtractedItem] = []
    for i, a in enumerate(anchors):
        end = anchors[i + 1].char_offset if i + 1 < len(anchors) else ir.char_total
        content = _slice_content(ir.text, a.char_offset, end)
        canonical_title = ITEM_CANONICAL_TITLE.get(a.item_id, a.raw_title or "")
        notes_parts: list[str] = []
        if a.is_toc:
            notes_parts.append("only TOC anchor found — body may be missing")
        if not content:
            notes_parts.append("empty content")
        items.append(
            ExtractedItem(
                item_id=a.item_id,
                title=canonical_title,
                content=content,
                start_offset=a.char_offset,
                end_offset=end,
                char_length=end - a.char_offset,
                confidence=0.0,  # filled by confidence.py
                extraction_method="L1",
                notes="; ".join(notes_parts) or None,
            )
        )
    return items
