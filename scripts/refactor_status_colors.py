"""Rewrite hard-coded Tailwind red/emerald/amber utility classes to the new
semantic theme tokens (bg-bg-danger / fg-danger / border-danger, plus the
success and warning variants).

Idempotent: running twice produces no further changes.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

# Order matters: longer/more-specific patterns first so we don't half-replace.
REPLACEMENTS: list[tuple[str, str]] = [
    # Background washes (red)
    (r"\bbg-red-950/40\b", "bg-bg-danger"),
    (r"\bbg-red-500/70\b", "bg-fg-danger"),
    (r"\bbg-red-500\b", "bg-fg-danger"),
    # Background washes (emerald / green success)
    (r"\bbg-emerald-950/40\b", "bg-bg-success"),
    (r"\bbg-emerald-500\b", "bg-fg-success"),
    # Background washes (amber)
    (r"\bbg-amber-950/40\b", "bg-bg-warning"),
    (r"\bbg-amber-950/60\b", "bg-bg-warning"),
    # Borders
    (r"\bborder-red-900\b", "border-border-danger"),
    (r"\bborder-red-700\b", "border-border-danger"),
    (r"\bborder-emerald-800\b", "border-border-success"),
    (r"\bborder-amber-700\b", "border-border-warning"),
    # Foreground / text
    (r"\btext-red-200\b", "text-fg-danger"),
    (r"\btext-red-300\b", "text-fg-danger"),
    (r"\btext-red-400\b", "text-fg-danger"),
    (r"\btext-emerald-200\b", "text-fg-success"),
    (r"\btext-emerald-300\b", "text-fg-success"),
    (r"\btext-emerald-400\b", "text-fg-success"),
    (r"\btext-amber-200\b", "text-fg-warning"),
    (r"\btext-amber-300\b", "text-fg-warning"),
    (r"\btext-amber-400\b", "text-fg-warning"),
    # Hover variants — keep semantic by reusing the danger/warning fg
    (r"\bhover:text-red-200\b", "hover:text-fg-danger"),
    (r"\bhover:text-amber-300\b", "hover:text-fg-warning"),
    (r"\bhover:text-amber-400\b", "hover:text-fg-warning"),
    (r"\bhover:border-red-700\b", "hover:border-border-danger"),
]

EXTS = {".ts", ".tsx"}

def main() -> int:
    total_changes = 0
    files_touched = 0
    for path in SRC.rglob("*"):
        if path.suffix not in EXTS or not path.is_file():
            continue
        original = path.read_text(encoding="utf-8")
        updated = original
        local_changes = 0
        for pattern, replacement in REPLACEMENTS:
            new, n = re.subn(pattern, replacement, updated)
            if n:
                local_changes += n
                updated = new
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            files_touched += 1
            total_changes += local_changes
            print(f"  {path.relative_to(ROOT)}  ({local_changes} swaps)")
    print(f"\n{total_changes} swaps across {files_touched} files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
