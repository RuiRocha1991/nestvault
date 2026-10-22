"""Writes schemas/rows.schema.json from the pydantic models. `--check` fails when it is stale."""

import json
import sys
from pathlib import Path

from pydantic import TypeAdapter

from parser_service.models import ParseResponse

TARGET = Path(__file__).resolve().parent.parent / "schemas" / "rows.schema.json"


def render() -> str:
    schema = TypeAdapter(ParseResponse).json_schema(mode="serialization")
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = "https://nestvault.local/schemas/parse-response.json"
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != text:
            print("schemas/rows.schema.json is out of date: run `pnpm gen:parser-schema`.")
            return 1
        return 0
    TARGET.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
