"""Writes schemas/rows.schema.json from the pydantic models. `--check` fails when it is stale."""

import json
import sys
from pathlib import Path

from pydantic import TypeAdapter

from parser_service.engine.spec import spec_schema
from parser_service.models import ParseResponse

SCHEMAS = Path(__file__).resolve().parent.parent / "schemas"
TARGET = SCHEMAS / "rows.schema.json"
SPEC_TARGET = SCHEMAS / "import-spec.schema.json"


def render() -> str:
    schema = TypeAdapter(ParseResponse).json_schema(mode="serialization")
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = "https://nestvault.local/schemas/parse-response.json"
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def render_spec() -> str:
    return json.dumps(spec_schema(), indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    targets = {TARGET: render(), SPEC_TARGET: render_spec()}
    if "--check" in sys.argv:
        stale = [
            t
            for t, text in targets.items()
            if not t.exists() or t.read_text(encoding="utf-8") != text
        ]
        for target in stale:
            print(f"schemas/{target.name} is out of date: run `pnpm parser:schema`.")
        return 1 if stale else 0
    for target, text in targets.items():
        target.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
