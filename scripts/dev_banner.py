"""Render the README's dev-build banner from the repository's GitHub releases.

The README on master embeds banner.svg from the unprotected `readme-banner`
branch, which .github/workflows/dev-banner.yml rewrites after every Docker
Release run. When a pre-release is newer than the newest stable release, the
banner names it, gives its one-line summary and the image to pull; otherwise it
is an empty 1x1 image, so the README shows nothing.

Usage:
  gh api repos/OWNER/REPO/releases --paginate \
    | DEV_BANNER_IMAGE=ghcr.io/OWNER/dockge python3 scripts/dev_banner.py > banner.svg
"""
from __future__ import annotations

import json
import os
import re
import sys
import textwrap
from html import escape

VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-(dev|alpha|beta|rc)\.(\d+))?$")
PRE_RANK = {"dev": 0, "alpha": 1, "beta": 2, "rc": 3}
EMPTY = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\n'

# Dockge's dark theme (frontend/src/styles/vars.scss): background, header, text, dim text, primary.
BG, SURFACE, TEXT, DIM, BRASS = "#0d1117", "#161b22", "#e9ebee", "#b1b8c0", "#74c2ff"
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
SERIF = "Georgia,'Times New Roman',serif"
WIDTH, WRAP = 820, 96


def version_key(tag: str) -> tuple[int, ...] | None:
    """Sort key where 2.8.0-dev.6 < 2.8.0-rc.1 < 2.8.0; None for tags we don't recognise."""
    m = VERSION_RE.match(tag)
    if not m:
        return None
    major, minor, patch, pre, num = m.groups()
    if pre is None:
        return (int(major), int(minor), int(patch), 1, 0, 0)
    return (int(major), int(minor), int(patch), 0, PRE_RANK[pre], int(num))


def pick_dev(releases: list[dict]) -> dict | None:
    """The newest published pre-release, if it is newer than every stable release."""
    best_pre = best_stable = None
    for rel in releases:
        if rel.get("draft"):
            continue
        key = version_key(rel.get("tag_name", ""))
        if key is None:
            continue
        if rel.get("prerelease"):
            if best_pre is None or key > best_pre[0]:
                best_pre = (key, rel)
        elif best_stable is None or key > best_stable[0]:
            best_stable = (key, rel)
    if best_pre is None or (best_stable is not None and best_stable[0] > best_pre[0]):
        return None
    return best_pre[1]


def summary(body: str) -> str:
    """The release notes' opening paragraph as plain text, minus the boilerplate warning."""
    first = (body or "").strip().replace("\r\n", "\n").split("\n\n", 1)[0]
    if not first or first.startswith("#"):
        return ""
    text = re.sub(r"\*\*|__|`", "", " ".join(first.split()))
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    return re.sub(r"\s*Not for production\.?\s*$", "", text).strip()


def image(body: str, tag: str) -> str | None:
    """A `docker pull` named in the notes, else DEV_BANNER_IMAGE tagged with the version."""
    m = re.search(r"docker pull (\S+)", body or "")
    if m:
        return m.group(1)
    repo = os.environ.get("DEV_BANNER_IMAGE", "").strip()
    return f"{repo}:{tag.removeprefix('v')}" if repo else None


def render(release: dict | None) -> str:
    if release is None:
        return EMPTY
    tag = release["tag_name"]
    body = release.get("body") or ""
    lines = textwrap.wrap(summary(body), WRAP)
    if len(lines) > 3:
        lines = lines[:3]
        lines[2] = lines[2][: WRAP - 1].rstrip() + "…"
    pull = image(body, tag)

    y = 34
    parts = [
        f'<text x="30" y="{y}" font-family="{MONO}" font-size="12" font-weight="700" '
        f'letter-spacing="1.5" fill="{BRASS}">DEV BUILD AVAILABLE · {escape(tag)} · NOT FOR PRODUCTION</text>'
    ]
    for line in lines:
        y += 24
        parts.append(f'<text x="30" y="{y}" font-family="{SERIF}" font-size="16" fill="{TEXT}">{escape(line)}</text>')
    if pull:
        y += 16
        parts.append(f'<rect x="30" y="{y}" width="{WIDTH - 60}" height="30" rx="5" fill="{BG}"/>')
        parts.append(
            f'<text x="44" y="{y + 20}" font-family="{MONO}" font-size="13" fill="{DIM}">$ '
            f'<tspan fill="{TEXT}">docker pull {escape(pull)}</tspan></text>'
        )
        y += 30
    height = y + 22
    label = escape(f"Dev build {tag} available" + (f": docker pull {pull}" if pull else ""))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" '
        f'viewBox="0 0 {WIDTH} {height}" role="img" aria-label="{label}">\n'
        f"<title>{label}</title>\n"
        f'<clipPath id="card"><rect width="{WIDTH}" height="{height}" rx="10"/></clipPath>\n'
        f'<g clip-path="url(#card)"><rect width="{WIDTH}" height="{height}" fill="{SURFACE}"/>'
        f'<rect width="6" height="{height}" fill="{BRASS}"/></g>\n'
        + "\n".join(parts)
        + "\n</svg>\n"
    )


def parse_pages(data: str) -> list[dict]:
    """`gh api --paginate` prints one JSON array per page, back to back."""
    releases: list[dict] = []
    decoder, pos = json.JSONDecoder(), 0
    while pos < len(data):
        if data[pos].isspace():
            pos += 1
            continue
        page, pos = decoder.raw_decode(data, pos)
        releases.extend(page)
    return releases


def main() -> int:
    sys.stdout.write(render(pick_dev(parse_pages(sys.stdin.read()))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
