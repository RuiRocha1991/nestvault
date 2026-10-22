"""Guards against hostile files: size, zip bombs and runaway regular expressions."""

import io
import zipfile
from collections.abc import AsyncIterator

import regex

from .config import Settings
from .errors import FileTooLargeError, ParserError, UnsafeArchiveError


async def read_limited(chunks: AsyncIterator[bytes], max_bytes: int) -> bytes:
    """Reads the request body and stops as soon as it is larger than `max_bytes`."""
    buffer = bytearray()
    async for chunk in chunks:
        buffer.extend(chunk)
        if len(buffer) > max_bytes:
            raise FileTooLargeError(max_bytes)
    return bytes(buffer)


def check_zip(data: bytes, settings: Settings) -> None:
    """Rejects an archive with too many entries, too much uncompressed data or a huge ratio.

    Only the central directory is read, so a bomb is refused without decompressing anything.
    Readers must still use `read_member` because the declared sizes can be forged.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
    except zipfile.BadZipFile as exc:
        raise UnsafeArchiveError("The archive is corrupt.") from exc
    if len(members) > settings.max_zip_entries:
        raise UnsafeArchiveError("The archive has too many entries.")
    total = sum(member.file_size for member in members)
    if total > settings.max_zip_uncompressed_bytes:
        raise UnsafeArchiveError("The archive expands to too much data.")
    if total > max(len(data), 1) * settings.max_zip_ratio:
        raise UnsafeArchiveError("The archive compression ratio is not plausible.")


def read_member(archive: zipfile.ZipFile, name: str, settings: Settings) -> bytes:
    """Reads one member and never returns more than the configured uncompressed limit."""
    with archive.open(name) as handle:
        content = handle.read(settings.max_zip_uncompressed_bytes + 1)
    if len(content) > settings.max_zip_uncompressed_bytes:
        raise UnsafeArchiveError("The archive expands to too much data.")
    return content


def compile_pattern(pattern: str, settings: Settings) -> "regex.Pattern[str]":
    """Compiles a bounded pattern; searching with `safe_search` stops after the regex timeout."""
    if len(pattern) > settings.max_pattern_length:
        raise ParserError(422, "pattern_too_long", "The pattern is too long.")
    try:
        return regex.compile(pattern)
    except regex.error as exc:
        raise ParserError(422, "pattern_invalid", "The pattern is not valid.") from exc


def safe_search(
    pattern: "regex.Pattern[str]", text: str, settings: Settings
) -> "regex.Match[str] | None":
    try:
        return pattern.search(text, timeout=settings.regex_timeout_seconds)
    except TimeoutError as exc:
        raise ParserError(422, "pattern_timeout", "The pattern took too long to match.") from exc
