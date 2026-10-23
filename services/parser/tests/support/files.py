"""Builders for the files the tests upload. Everything is generated: no real statement is stored."""

import io
import zipfile

import openpyxl


def make_xlsx(sheets: dict[str, list[list[object]]]) -> bytes:
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)  # type: ignore[arg-type]
    for name, rows in sheets.items():
        sheet = workbook.create_sheet(name)
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def make_csv(*lines: str, encoding: str = "utf-8") -> bytes:
    return ("\n".join(lines) + "\n").encode(encoding)


def make_pdf(lines: list[str]) -> bytes:
    """A one-page PDF with one text line per row (Helvetica), enough for pdfplumber."""
    text = (
        "BT /F1 11 Tf 40 780 Td 14 TL "
        + " ".join(f"({_escape(line)}) Tj T*" for line in lines)
        + " ET"
    )
    stream = text.encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_zip_bomb(uncompressed_mb: int = 150) -> bytes:
    """An xlsx-looking archive that expands to `uncompressed_mb` of zeros from ~150 KB."""
    buffer = io.BytesIO()
    chunk = b"\x00" * 1_000_000
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        with archive.open("xl/worksheets/sheet1.xml", "w", force_zip64=True) as member:
            for _ in range(uncompressed_mb):
                member.write(chunk)
    return buffer.getvalue()


def make_many_entries(count: int) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        for number in range(count):
            archive.writestr(f"xl/part{number}.xml", "x")
    return buffer.getvalue()


def make_layout_pdf(pages: list[list[str]], width: int = 1000, leading: int = 13) -> bytes:
    """Monospaced pages (Courier 12, 7.2 pt per character) so `extract_text(layout=True)` gives
    back the same columns the lines were written with. Text is WinAnsi: `€`, `ç`, `ã` work."""
    objects: list[bytes] = [b"", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier"]
    objects[2] += b" /Encoding /WinAnsiEncoding >>"
    kids: list[int] = []
    for lines in pages:
        text = f"BT /F1 12 Tf 20 800 Td {leading} TL " + " ".join(
            f"({_escape_cp1252(line)}) Tj T*" for line in lines
        )
        stream = (text + " ET").encode("latin-1")
        content = len(objects) + 2
        kids.append(content - 1)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} 842] /Contents {content} 0 R "
            f"/Resources << /Font << /F1 3 0 R >> >> >>".encode()
        )
        objects.append(
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
        )
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kid_refs = " ".join(f"{k} 0 R" for k in kids)
    objects[1] = f"<< /Type /Pages /Kids [{kid_refs}] /Count {len(kids)} >>".encode()
    return _assemble(objects)


def _escape_cp1252(text: str) -> str:
    raw = text.encode("cp1252").decode("latin-1")
    return raw.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _assemble(objects: list[bytes]) -> bytes:
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)
