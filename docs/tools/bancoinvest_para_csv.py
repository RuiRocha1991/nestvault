#!/usr/bin/env python3
"""
Converte o ficheiro "Posição Actual" do Banco Invest (xlsx) em CSV de transações
para o Cofre Familiar (Portfolios → Importar transações).

Cada lote da secção "Investimentos (por lote)" passa a uma compra, com a subconta
igual ao primeiro nome do titular. Cria um CSV com todas as subcontas e um por titular.

Uso:
    python3 bancoinvest_para_csv.py InvestTendenciasGlobais_PosicaoActual.xlsx
    python3 bancoinvest_para_csv.py ficheiro.xlsx --ticker INVTG --tipo PPR --pasta saida/

Formato de saída (separador ";", decimais com vírgula, UTF-8):
    Data;Tipo;Ticker;Nome;Tipo de ativo;Moeda;Quantidade;Preço;Comissão;Subconta;Titular;Cotação atual;Data cotação
"""
import argparse
import csv
import datetime as dt
import re
import sys
import unicodedata
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("Falta o openpyxl: pip install openpyxl")


def sem_acentos(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn").upper().strip()


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").strip().replace(" ", "").replace("\xa0", "")
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    return float(s)


def data(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    m = re.match(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", str(v or ""))
    return dt.date(int(m[3]), int(m[2]), int(m[1])) if m else None


def fmt(v, casas):
    return f"{v:.{casas}f}".replace(".", ",")


def ler(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True)
    ws = wb.worksheets[0]
    linhas = [list(r) for r in ws.iter_rows(values_only=True) if any(c not in (None, "") for c in r)]
    titulo = str(linhas[0][0] or "")
    fundo = re.sub(r"\s*-\s*Posi[cç][aã]o Actual\s*$", "", titulo, flags=re.I).strip() or "Fundo Banco Invest"
    data_rel = data(linhas[1][0]) or dt.date.today()
    conta = moeda = None
    resumo, lotes = {}, []
    i = 0
    while i < len(linhas):
        a = sem_acentos(linhas[i][0] or "")
        if a == "CONTA":
            conta = str(linhas[i + 1][0]).replace("\xa0", " ").strip()
        elif a == "MOEDA":
            moeda = str(linhas[i + 1][0]).strip()
        elif a == "TITULAR" and sem_acentos(linhas[i][2] or "") == "QTD":
            # tabela resumo: TITULAR | INÍCIO | QTD | P.M.S | COTAÇÃO | VAR % | VAR MOEDA | VALOR
            j = i + 1
            while j < len(linhas) and isinstance(linhas[j][2], (int, float)):
                r = linhas[j]
                resumo[sem_acentos(r[0])] = {"nome": str(r[0]).strip(), "qtd": num(r[2]), "pms": num(r[3]), "cot": num(r[4]), "valor": num(r[7])}
                j += 1
            i = j
            continue
        elif a.startswith("INVESTIMENTOS (POR LOTE)"):
            titular = None
            j = i + 1
            while j < len(linhas):
                r = linhas[j]
                c0 = sem_acentos(r[0] or "")
                if c0 in resumo:
                    titular = resumo[c0]["nome"]
                elif c0 == "TIPO":
                    pass
                elif titular and data(r[1]) and isinstance(r[2], (int, float)):
                    lotes.append({"titular": titular, "tipo": str(r[0]).strip(), "data": data(r[1]), "qtd": num(r[2]), "preco": num(r[3])})
                elif c0.startswith("WWW."):
                    break
                j += 1
            i = j
            continue
        i += 1
    return {"fundo": fundo, "data": data_rel, "conta": conta, "moeda": moeda or "EUR", "resumo": resumo, "lotes": lotes}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx")
    ap.add_argument("--ticker", default="INVTG", help="código do fundo na app (por defeito INVTG)")
    ap.add_argument("--tipo", default="PPR", help="tipo de ativo na app: PPR, Fundo, ETF… (por defeito PPR)")
    ap.add_argument("--pasta", default=None, help="pasta de saída (por defeito, ao lado do xlsx)")
    a = ap.parse_args()

    R = ler(a.xlsx)
    if not R["lotes"]:
        sys.exit("Não encontrei a secção 'Investimentos (por lote)'.")
    pasta = Path(a.pasta or Path(a.xlsx).parent)
    pasta.mkdir(parents=True, exist_ok=True)
    cot = next(iter(R["resumo"].values()))["cot"] if R["resumo"] else None

    cab = ["Data", "Tipo", "Ticker", "Nome", "Tipo de ativo", "Moeda", "Quantidade", "Preço", "Comissão", "Subconta", "Titular", "Cotação atual", "Data cotação"]
    def linha(l):
        return [l["data"].strftime("%d-%m-%Y"), "Compra", a.ticker, R["fundo"], a.tipo, R["moeda"], fmt(l["qtd"], 4), fmt(l["preco"], 4), "0",
                l["titular"].split()[0].capitalize(), l["titular"], fmt(cot, 4) if cot else "", R["data"].strftime("%d-%m-%Y")]

    lotes = sorted(R["lotes"], key=lambda l: (l["titular"], l["data"]))
    base = re.sub(r"[^A-Za-z0-9]+", "_", sem_acentos(R["fundo"])).strip("_")
    ficheiros = []

    def escrever(nome, ls):
        p = pasta / nome
        with open(p, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(cab)
            w.writerows(linha(l) for l in ls)
        ficheiros.append(p)

    escrever(f"{base}_todas_subcontas.csv", lotes)
    titulares = list(dict.fromkeys(l["titular"] for l in lotes))
    for t in titulares:
        escrever(f"{base}_{sem_acentos(t.split()[0]).capitalize()}.csv", [l for l in lotes if l["titular"] == t])

    # verificação contra a tabela resumo do banco
    print(f"{R['fundo']} · conta {R['conta']} · {R['moeda']} · cotação {cot} em {R['data']:%d-%m-%Y}")
    ok = True
    for t in titulares:
        ls = [l for l in lotes if l["titular"] == t]
        q = sum(l["qtd"] for l in ls)
        custo = sum(l["qtd"] * l["preco"] for l in ls)
        rs = R["resumo"].get(sem_acentos(t), {})
        dq = q - (rs.get("qtd") or 0)
        pm = custo / q if q else 0
        flag = "ok" if abs(dq) < 0.001 else "DIFERENÇA"
        ok &= flag == "ok"
        print(f"  {t.split()[0]:<8} {len(ls):>3} lotes · {q:10.4f} un. (banco {rs.get('qtd')}) {flag} · investido {custo:9.2f} € · preço médio {pm:.4f} (banco {rs.get('pms')})")
    for p in ficheiros:
        print("  →", p.name)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
