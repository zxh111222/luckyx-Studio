"""Verify the design deliverables using only the Python standard library.

Run from any directory:
    python tests/validate_design_delivery.py

This checks document encoding, local Markdown links, and the seven actual PNG
files. Visual review and application/hardware tests are separate work.
"""

from __future__ import annotations

import argparse
import re
import struct
import sys
import zlib
from pathlib import Path
from urllib.parse import unquote, urlsplit


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
EXPECTED_IMAGES = (
    "01-首次安装向导.png",
    "02-首页.png",
    "03-工作流库.png",
    "04-创作工作台.png",
    "05-任务与作品.png",
    "06-资源中心.png",
    "07-设置与诊断.png",
)
REQUIRED_DOCUMENTS = (
    "docs/01-产品需求.md",
    "docs/02-技术栈与开发路线.md",
    "docs/03-MVP交付范围.md",
    "docs/04-界面风格与设计指标.md",
    "docs/定稿图/README.md",
)
# Supports the local, inline links used by these documents, including <paths>.
MARKDOWN_LINK = re.compile(r"!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)")
TARGET_RATIO = 1440 / 1024


def markdown_targets(text: str) -> list[str]:
    return [match.group(1) or match.group(2) for match in MARKDOWN_LINK.finditer(text)]


def local_target(document: Path, target: str) -> Path | None:
    if target.startswith("#"):
        return None
    is_windows_absolute = re.match(r"^[A-Za-z]:[\\/]", target) is not None
    parsed = urlsplit(target)
    if parsed.scheme and not is_windows_absolute:
        return None
    raw_path = unquote(target.split("#", 1)[0].split("?", 1)[0])
    path = Path(raw_path)
    return path if path.is_absolute() else document.parent / path


def inspect_png(path: Path) -> tuple[int, int]:
    """Validate chunks, CRCs, compressed pixel bytes, and scanline filters."""
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("invalid PNG signature")
    offset = len(PNG_SIGNATURE)
    chunks: list[tuple[bytes, bytes]] = []
    while offset < len(data):
        if len(data) - offset < 12:
            raise ValueError("truncated chunk header")
        length = struct.unpack_from(">I", data, offset)[0]
        end = offset + length + 12
        if end > len(data):
            raise ValueError("truncated chunk payload")
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        actual_crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise ValueError(f"CRC mismatch in {kind.decode('ascii', errors='replace')}")
        chunks.append((kind, payload))
        offset = end
        if kind == b"IEND":
            if length != 0 or offset != len(data):
                raise ValueError("invalid IEND or trailing bytes")
            break
    if not chunks or chunks[0][0] != b"IHDR" or chunks[-1][0] != b"IEND":
        raise ValueError("missing first IHDR or final IEND")
    if sum(kind == b"IHDR" for kind, _ in chunks) != 1:
        raise ValueError("duplicate IHDR")
    header = chunks[0][1]
    if len(header) != 13:
        raise ValueError("invalid IHDR length")
    width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", header)
    allowed_depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
    if width == 0 or height == 0 or bit_depth not in allowed_depths.get(color_type, set()):
        raise ValueError("invalid dimensions or pixel format")
    if compression != 0 or filtering != 0 or interlace not in (0, 1):
        raise ValueError("unsupported PNG header")
    compressed = b"".join(payload for kind, payload in chunks if kind == b"IDAT")
    if not compressed:
        raise ValueError("no image data")
    decompressor = zlib.decompressobj()
    pixels = decompressor.decompress(compressed) + decompressor.flush()
    if not decompressor.eof or decompressor.unused_data:
        raise ValueError("incomplete or trailing compressed image data")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    # Adam7 pass geometry supports valid interlaced PNGs too.
    passes = [(0, 0, 1, 1)] if interlace == 0 else [
        (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
        (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2),
    ]
    pixel_offset = 0
    for start_x, start_y, step_x, step_y in passes:
        pass_width = max(0, (width - start_x + step_x - 1) // step_x)
        pass_height = max(0, (height - start_y + step_y - 1) // step_y)
        if pass_width == 0 or pass_height == 0:
            continue
        row_size = (pass_width * channels * bit_depth + 7) // 8
        for _ in range(pass_height):
            if pixel_offset + row_size + 1 > len(pixels):
                raise ValueError("truncated pixel scanline")
            if pixels[pixel_offset] > 4:
                raise ValueError("invalid PNG scanline filter")
            pixel_offset += row_size + 1
    if pixel_offset != len(pixels):
        raise ValueError("unexpected uncompressed pixel length")
    return width, height


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    contents: dict[str, str] = {}
    for relative in REQUIRED_DOCUMENTS:
        path = root / relative
        try:
            text = path.read_bytes().decode("utf-8-sig", errors="strict")
            if "\ufffd" in text:
                errors.append(f"{relative}: contains a Unicode replacement character")
            if not text.strip():
                errors.append(f"{relative}: empty document")
            contents[relative] = text
            links = markdown_targets(text)
            for target in links:
                resolved = local_target(path, target)
                if resolved is not None and not resolved.exists():
                    errors.append(f"{relative}: broken local link {target}")
            print(f"OK UTF-8/link check: {relative} ({len(links)} links)")
        except (OSError, UnicodeError) as exc:
            errors.append(f"{relative}: {exc}")

    readme_relative = REQUIRED_DOCUMENTS[-1]
    readme = contents.get(readme_relative, "")
    readme_path = root / readme_relative
    readme_links = {
        path.resolve()
        for target in markdown_targets(readme)
        if (path := local_target(readme_path, target)) is not None
    }
    for filename in EXPECTED_IMAGES:
        path = root / "docs" / "定稿图" / filename
        try:
            width, height = inspect_png(path)
            if width < 1280 or height < 800:
                errors.append(f"{filename}: too small for readable desktop review ({width}x{height})")
            ratio_difference = abs((width / height) / TARGET_RATIO - 1)
            if ratio_difference >= 0.03:
                errors.append(f"{filename}: aspect ratio differs from 1440x1024 by {ratio_difference:.1%}")
            if path.resolve() not in readme_links:
                errors.append(f"{readme_relative}: no local link to {filename}")
            # The index must record actual file dimensions, not just design coordinates.
            image_lines = [line for line in readme.splitlines() if filename in unquote(line)]
            dimension_entries = [
                (int(match.group(1)), int(match.group(2)))
                for line in image_lines
                for match in re.finditer(r"(\d{3,5})\s*[x×X]\s*(\d{3,5})", line)
            ]
            if (width, height) not in dimension_entries:
                errors.append(f"{readme_relative}: missing actual {width}x{height} for {filename}")
            print(f"OK PNG integrity: {filename} | actual {width}x{height} | {path.stat().st_size:,} bytes")
        except (OSError, ValueError, zlib.error, struct.error) as exc:
            errors.append(f"{filename}: {exc}")
    print("Visual/layout and runtime/hardware validation are not performed by this script.")
    return errors


def main() -> int:
    # Windows consoles can otherwise encode Chinese paths using a legacy code page.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    errors = validate(args.root.resolve())
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)
    if errors:
        print(f"FAILED: {len(errors)} issue(s)", file=sys.stderr)
        return 1
    print("PASS: all required documents, links, and 7 PNG files validated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
