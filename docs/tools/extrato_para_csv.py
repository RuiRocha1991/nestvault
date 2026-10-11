#!/usr/bin/env python3
"""
Converte extratos bancários em PDF para o CSV genérico que o Cofre Familiar importa.

Formato de saída (separador ";", decimais com vírgula, UTF-8):
    Data;Tipo;Descrição;Valor;Saldo
    19-11-2024;Transferência;Transferência – Depósito aceite: …;100,00;100,00

  • Data   dd-mm-aaaa
  • Valor  com sinal: positivo = entrada, negativo = saída
  • Saldo  saldo após o movimento (a app usa-o para acertar o saldo inicial)

Uso:
    python3 extrato_para_csv.py Extrato_de_conta.pdf            # cria Extrato_de_conta.csv ao lado
    python3 extrato_para_csv.py Extrato_de_conta.pdf saida.csv
    python3 extrato_para_csv.py *.pdf                            # vários ficheiros de uma vez

Bancos suportados:
    • Trade Republic (extrato de conta em PT)
    • Genérico: extratos com uma linha por movimento do tipo
      "dd-mm-aaaa  descrição  valor  saldo" (funciona com muitos bancos portugueses)

Para acrescentar um banco: escreve uma função parse_<banco>(texto) que devolve uma
lista de dicts {data, tipo, descricao, valor, saldo} e regista-a em PARSERS.

Requer: pdftotext (poppler-utils). No Windows/Mac sem poppler, instala com
`pip install pdfplumber` — o script usa-o automaticamente se o pdftotext faltar.
"""
import csv
import re
import shutil
import subprocess
import sys
from pathlib import Path

MESES = {"jan": 1, "fev": 2, "feb": 2, "mar": 3, "abr": 4, "apr": 4, "mai": 5, "may": 5, "jun": 6,
         "jul": 7, "ago": 8, "aug": 8, "set": 9, "sep": 9, "out": 10, "oct": 10, "nov": 11, "dez": 12, "dec": 12}
EURO = re.compile(r"-?\d{1,3}(?:[ .  ]\d{3})*,\d{2}(?=\s*€|\s|$)")


# ---------------------------------------------------------------- utilitários
def pdf_para_texto(caminho: Path) -> str:
    """Texto do PDF mantendo o alinhamento das colunas."""
    if shutil.which("pdftotext"):
        r = subprocess.run(["pdftotext", "-layout", str(caminho), "-"], capture_output=True, text=True, check=True)
        return r.stdout
    try:
        import pdfplumber
    except ImportError:
        sys.exit("Falta o pdftotext (poppler) ou o pdfplumber. Instala um deles: `pip install pdfplumber`.")
    with pdfplumber.open(str(caminho)) as pdf:
        return "\f".join((p.extract_text(layout=True) or "") for p in pdf.pages)


def num(s: str) -> float:
    s = s.replace("€", "").replace(" ", "").replace(" ", "").replace(" ", "").strip()
    s = s.replace(".", "").replace(",", ".")
    return float(s)


def fmt(v: float) -> str:
    return f"{v:.2f}".replace(".", ",")


# ---------------------------------------------------------------- Trade Republic
def e_trade_republic(texto: str) -> bool:
    return "TRADE REPUBLIC" in texto.upper()


def parse_trade_republic(texto: str):
    """
    O extrato da Trade Republic tem cada movimento em 2-3 linhas:
        19 nov.                        Depósito aceite: … para
                    Transferência                                   100,00 €              100,00 €
        2024                           DE55502109007023130518
    Colunas (posição varia de página para página): DATA | TIPO | DESCRIÇÃO | ENTRADA | SAÍDA | SALDO.
    O sinal de cada movimento é confirmado pela variação do saldo.
    """
    # saldo inicial do resumo
    m = re.search(r"Conta corrente\s+(" + EURO.pattern + r")\s*€", texto)
    saldo_ant = num(m.group(1)) if m else 0.0

    # só a secção de transações
    ini = texto.find("TRANSAÇÕES")
    fim = texto.find("SÍNTESE DO BALANÇO")
    corpo = texto[ini if ini >= 0 else 0: fim if fim > 0 else len(texto)]

    linhas = corpo.splitlines()
    col_tipo = col_desc = col_ent = col_sai = None
    out = []
    i = 0
    while i < len(linhas):
        l = linhas[i]
        # cabeçalhos de página: guardar posições das colunas
        if "ENTRADA DE" in l and "SAÍDA DE" in l:
            col_ent, col_sai = l.index("ENTRADA DE"), l.index("SAÍDA DE")
        if re.match(r"^\s*DATA\s+TIPO\s+DESCRI", l):
            col_tipo, col_desc = l.index("TIPO"), l.index("DESCRI")
        md = re.match(r"^\s*(\d{1,2}) (\w{3})\.", l)
        if md and col_tipo is not None:
            bloco = []
            while i < len(linhas) and linhas[i].strip():
                bloco.append(linhas[i])
                i += 1
            ano = None
            tipo, desc, valores = [], [], []
            for b in bloco:
                inicio = b[:col_tipo].strip()
                ya = re.match(r"^(\d{4})\b", inicio)
                if ya:
                    ano = int(ya.group(1))
                tipo_txt = b[col_tipo:col_desc].strip()
                resto = b[col_desc:]
                # valores e respetiva coluna
                for mv in re.finditer(EURO.pattern + r"\s*€", resto):
                    valores.append((col_desc + mv.start(), num(mv.group(0))))
                desc_txt = re.sub(EURO.pattern + r"\s*€", "", resto).strip()
                if tipo_txt:
                    tipo.append(tipo_txt)
                if desc_txt:
                    desc.append(desc_txt)
            if not ano or len(valores) < 2:
                continue
            dia, mes = int(md.group(1)), MESES.get(md.group(2).lower()[:3])
            mov_pos, mov = valores[0]
            saldo = valores[-1][1]
            delta = round(saldo - saldo_ant, 2)
            # sinal: pela variação do saldo; se não bater, pela coluna
            if abs(abs(delta) - mov) < 0.011:
                valor = delta
            else:
                saida = col_sai is not None and abs(mov_pos - col_sai) < abs(mov_pos - col_ent)
                valor = -mov if saida else mov
            saldo_ant = saldo
            tipo_s = " ".join(tipo)
            desc_s = re.sub(r"\s+", " ", " ".join(desc))
            out.append({
                "data": f"{dia:02d}-{mes:02d}-{ano}",
                "tipo": tipo_s,
                "descricao": f"{tipo_s} – {desc_s}" if tipo_s and desc_s else (tipo_s or desc_s),
                "valor": valor,
                "saldo": saldo,
            })
            continue
        i += 1
    return out


# ---------------------------------------------------------------- genérico
def parse_generico(texto: str):
    """Uma linha por movimento: data no início, valor e (opcional) saldo no fim."""
    out, saldo_ant = [], None
    for l in texto.splitlines():
        m = re.match(r"^\s*(\d{2})[-/.](\d{2})[-/.](\d{2,4})\s+(?:\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+)?(.*)$", l)
        if not m:
            continue
        valores = [(x.start(), num(x.group(0))) for x in EURO.finditer(m.group(4))]
        if not valores:
            continue
        desc = EURO.sub("", m.group(4)).replace("€", "").strip()
        ano = m.group(3) if len(m.group(3)) == 4 else "20" + m.group(3)
        valor = valores[-2][1] if len(valores) >= 2 else valores[-1][1]
        saldo = valores[-1][1] if len(valores) >= 2 else None
        if saldo is not None and saldo_ant is not None and abs(abs(saldo - saldo_ant) - abs(valor)) < 0.011:
            valor = round(saldo - saldo_ant, 2)
        out.append({"data": f"{m.group(1)}-{m.group(2)}-{ano}", "tipo": "", "descricao": re.sub(r"\s+", " ", desc),
                    "valor": valor, "saldo": saldo})
        if saldo is not None:
            saldo_ant = saldo
    return out


PARSERS = [
    ("Trade Republic", e_trade_republic, parse_trade_republic),
    ("Genérico", lambda t: True, parse_generico),
]


# ---------------------------------------------------------------- principal
def converter(pdf: Path, destino: Path | None = None) -> Path:
    texto = pdf_para_texto(pdf)
    for nome, detetar, parser in PARSERS:
        if detetar(texto):
            movs = parser(texto)
            if movs:
                break
    else:
        sys.exit(f"{pdf.name}: não encontrei movimentos neste PDF.")
    destino = destino or pdf.with_suffix(".csv")
    with open(destino, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Data", "Tipo", "Descrição", "Valor", "Saldo"])
        for m in movs:
            w.writerow([m["data"], m["tipo"], m["descricao"], fmt(m["valor"]),
                        fmt(m["saldo"]) if m["saldo"] is not None else ""])
    ent = sum(m["valor"] for m in movs if m["valor"] > 0)
    sai = -sum(m["valor"] for m in movs if m["valor"] < 0)
    fim = next((m["saldo"] for m in reversed(movs) if m["saldo"] is not None), None)
    print(f"{pdf.name} → {destino.name}  [{nome}]  {len(movs)} movimentos · "
          f"entradas {fmt(ent)} € · saídas {fmt(sai)} €" + (f" · saldo final {fmt(fim)} €" if fim is not None else ""))
    return destino


if __name__ == "__main__":
    args = [Path(a) for a in sys.argv[1:]]
    if not args:
        sys.exit(__doc__)
    if len(args) == 2 and args[1].suffix.lower() == ".csv":
        converter(args[0], args[1])
    else:
        for a in args:
            converter(a)
