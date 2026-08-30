#!/usr/bin/env python3
"""CDM 스키마 -> Pydantic 모델 + TypeScript 타입 생성기.

스키마 파일이 단일 정의(single source of truth)이고, 백엔드 모델과 프론트 타입은
전부 여기서 나온다. 손으로 두 번 쓰면 반드시 어긋나기 때문이다.

외부 의존성을 쓰지 않는다 (표준 라이브러리만). 폐쇄망 서버에서 코드 생성을 다시
돌려야 할 때 datamodel-code-generator 같은 도구를 반입할 필요가 없어야 한다.

지원하는 스키마 어휘는 의도적으로 좁다:
  - $defs 안의 이름 붙은 타입만 생성한다 (익명 인라인 객체는 지원하지 않는다)
  - type: object + properties + required + additionalProperties: false  -> 모델
  - type: object + additionalProperties: {…}                            -> 맵
  - type: string + enum                                                 -> 열거형
  - type: array + items                                                 -> 리스트
  - type: [T, "null"]                                                   -> 널 허용
  - $ref: "#/$defs/X"                                                   -> 같은 파일 참조
  - $ref: "cdm.v1.json#/$defs/X"                                        -> 다른 스키마 참조 (import)

사용:  python cdm/codegen/generate.py [--check]
       --check 는 파일을 쓰지 않고 최신 상태인지만 확인한다 (CI 용).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = ROOT / "cdm" / "schema"

PY_OUT_DIR = ROOT / "backend" / "boardlens" / "cdm"
TS_OUT_DIR = ROOT / "web" / "src" / "lib" / "cdm"

PRIMITIVE_PY = {"string": "str", "integer": "int", "number": "float", "boolean": "bool"}
PRIMITIVE_TS = {"string": "string", "integer": "number", "number": "number", "boolean": "boolean"}

#: 다른 스키마 파일을 $ref 로 가리킬 때 어느 모듈에서 가져올지. API 계약이 CDM 타입을
#: 그대로 재사용할 수 있게 해서, 같은 모양을 두 스키마에 베껴 쓰는 일을 막는다.
EXTERNAL_MODULES = {
    "cdm.v1.json": ("boardlens.cdm.cdm_v1", "./cdm.v1"),
    "api.v1.json": ("boardlens.cdm.api_v1", "./api.v1"),
}

BANNER_PY = '''"""{title}

생성된 파일이다 — 직접 고치지 말 것.
원본: cdm/schema/{source}
재생성: python cdm/codegen/generate.py
"""
'''

BANNER_TS = """/**
 * {title}
 *
 * 생성된 파일이다 — 직접 고치지 말 것.
 * 원본: cdm/schema/{source}
 * 재생성: python cdm/codegen/generate.py
 */
"""


# ── 스키마 읽기 ────────────────────────────────────────────────────


@dataclass
class Prop:
    name: str
    py_type: str
    ts_type: str
    required: bool
    description: str | None


@dataclass
class TypeDef:
    name: str
    kind: str  # "enum" | "model"
    description: str | None
    values: list[str] = field(default_factory=list)  # enum
    props: list[Prop] = field(default_factory=list)  # model
    deps: set[str] = field(default_factory=set)


class SchemaError(Exception):
    pass


def parse_ref(ref: str) -> tuple[str | None, str]:
    """$ref 를 (외부 스키마 파일 또는 None, 타입 이름) 으로 나눈다."""
    file_part, _, fragment = ref.partition("#")
    if not fragment.startswith("/$defs/"):
        raise SchemaError(f"지원하지 않는 $ref 형태: {ref!r} — …#/$defs/… 만 쓸 수 있다")
    name = fragment.split("/")[-1]
    if not file_part:
        return None, name
    if file_part not in EXTERNAL_MODULES:
        raise SchemaError(f"알 수 없는 외부 스키마: {file_part!r} — EXTERNAL_MODULES 에 등록할 것")
    return file_part, name


def split_nullable(node: dict) -> tuple[dict, bool]:
    """type: [T, "null"] 을 (T 노드, 널 허용 여부) 로 분해한다."""
    t = node.get("type")
    if isinstance(t, list):
        non_null = [x for x in t if x != "null"]
        if len(non_null) != 1:
            raise SchemaError(f"널 허용 외의 유니온은 지원하지 않는다: {t!r}")
        return {**node, "type": non_null[0]}, "null" in t
    return node, False


def resolve(node: dict, deps: set[str], ext: set[tuple[str, str]]) -> tuple[str, str, bool]:
    """스키마 노드 하나를 (python 타입, typescript 타입, 널 허용) 으로 옮긴다.

    같은 파일 참조는 deps 에, 다른 파일 참조는 ext 에 (스키마 파일, 타입명) 으로 쌓인다.
    """
    node, nullable = split_nullable(node)

    if "$ref" in node:
        source, name = parse_ref(node["$ref"])
        if source is None:
            deps.add(name)
        else:
            ext.add((source, name))
        return name, name, nullable

    t = node.get("type")

    if t in PRIMITIVE_PY:
        return PRIMITIVE_PY[t], PRIMITIVE_TS[t], nullable

    if t == "array":
        items = node.get("items")
        if items is None:
            raise SchemaError("array 에는 items 가 필요하다")
        py, ts, inner_null = resolve(items, deps, ext)
        if inner_null:
            py, ts = f"{py} | None", f"({ts} | null)"
        return f"list[{py}]", f"{ts}[]", nullable

    if t == "object":
        extra = node.get("additionalProperties")
        if isinstance(extra, dict):
            py, ts, _ = resolve(extra, deps, ext)
            return f"dict[str, {py}]", f"Record<string, {ts}>", nullable
        raise SchemaError(
            "이름 없는 인라인 객체는 지원하지 않는다 — $defs 에 이름을 붙여 정의할 것"
        )

    raise SchemaError(f"해석할 수 없는 노드: {json.dumps(node)[:160]}")


def load_defs(path: Path) -> tuple[str, list[TypeDef], set[tuple[str, str]]]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    title = doc.get("title", path.stem)
    defs = doc.get("$defs") or {}
    out: list[TypeDef] = []
    ext: set[tuple[str, str]] = set()

    for name, node in defs.items():
        desc = node.get("description")

        if "enum" in node:
            if node.get("type") != "string":
                raise SchemaError(f"{name}: 문자열 열거형만 지원한다")
            out.append(TypeDef(name, "enum", desc, values=list(node["enum"])))
            continue

        if node.get("type") != "object":
            raise SchemaError(f"{name}: $defs 의 항목은 객체이거나 문자열 열거형이어야 한다")
        if node.get("additionalProperties") is not False:
            raise SchemaError(
                f"{name}: 모델 정의에는 additionalProperties: false 가 필요하다 "
                "(오타난 필드가 조용히 통과하는 것을 막는다)"
            )

        required = set(node.get("required", []))
        deps: set[str] = set()
        props: list[Prop] = []
        for pname, pnode in (node.get("properties") or {}).items():
            py, ts, nullable = resolve(pnode, deps, ext)
            is_req = pname in required and not nullable
            props.append(Prop(pname, py, ts, is_req, pnode.get("description")))
        out.append(TypeDef(name, "model", desc, props=props, deps=deps))

    return title, out, ext


def topo_sort(defs: list[TypeDef]) -> list[TypeDef]:
    """참조 순서대로 정렬한다. Python 은 전방 참조를 못 쓰는 자리가 있어서 필요하다."""
    by_name = {d.name: d for d in defs}
    ordered: list[TypeDef] = []
    seen: set[str] = set()
    visiting: set[str] = set()

    def visit(name: str) -> None:
        if name in seen or name not in by_name:
            return
        if name in visiting:
            raise SchemaError(f"순환 참조: {name}")
        visiting.add(name)
        for dep in sorted(by_name[name].deps):
            visit(dep)
        visiting.discard(name)
        seen.add(name)
        ordered.append(by_name[name])

    for d in defs:
        visit(d.name)
    return ordered


# ── 출력 ──────────────────────────────────────────────────────────


def wrap(text: str, width: int, indent: str) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(indent + cur)
            cur = w
        else:
            cur = f"{cur} {w}" if cur else w
    if cur:
        lines.append(indent + cur)
    return lines


def enum_member(value: str) -> str:
    name = re.sub(r"[^0-9A-Za-z]+", "_", value).strip("_").upper()
    return f"V_{name}" if not name or name[0].isdigit() else name


def group_externals(ext: set[tuple[str, str]], index: int) -> list[tuple[str, list[str]]]:
    """(스키마 파일, 타입) 집합을 모듈별로 묶는다. index 0=python, 1=typescript."""
    by_module: dict[str, list[str]] = {}
    for source, name in sorted(ext):
        by_module.setdefault(EXTERNAL_MODULES[source][index], []).append(name)
    return [(mod, sorted(set(names))) for mod, names in sorted(by_module.items())]


def render_python(title: str, source: str, defs: list[TypeDef], ext: set[tuple[str, str]]) -> str:
    out = [BANNER_PY.format(title=title, source=source)]
    out.append("from __future__ import annotations\n")
    out.append("from enum import Enum\n")
    out.append("from pydantic import BaseModel, ConfigDict, Field\n")
    for module, names in group_externals(ext, 0):
        out.append(f"\nfrom {module} import {', '.join(names)}\n")
    out.append("\n")

    names = []
    for d in defs:
        names.append(d.name)
        if d.kind == "enum":
            out.append(f"class {d.name}(str, Enum):\n")
            if d.description:
                out.append('    """\n')
                out.extend(l + "\n" for l in wrap(d.description, 88, "    "))
                out.append('    """\n\n')
            for v in d.values:
                out.append(f'    {enum_member(v)} = "{v}"\n')
            out.append("\n\n")
            continue

        out.append(f"class {d.name}(BaseModel):\n")
        if d.description:
            out.append('    """\n')
            out.extend(l + "\n" for l in wrap(d.description, 88, "    "))
            out.append('    """\n\n')
        out.append('    model_config = ConfigDict(extra="forbid")\n\n')
        if not d.props:
            out.append("    pass\n\n\n")
            continue
        # 필수 필드를 먼저 — 파이썬은 기본값 없는 필드를 뒤에 둘 수 없다.
        for p in sorted(d.props, key=lambda p: not p.required):
            ann = p.py_type if p.required else f"{p.py_type} | None"
            if p.description:
                desc = p.description.replace('"', "'")
                if p.required:
                    out.append(f'    {p.name}: {ann} = Field(description="{desc}")\n')
                else:
                    out.append(f'    {p.name}: {ann} = Field(default=None, description="{desc}")\n')
            else:
                out.append(f"    {p.name}: {ann}\n" if p.required else f"    {p.name}: {ann} = None\n")
        out.append("\n\n")

    out.append("__all__ = [\n")
    out.extend(f'    "{n}",\n' for n in names)
    out.append("]\n")
    return "".join(out)


def render_typescript(title: str, source: str, defs: list[TypeDef], ext: set[tuple[str, str]]) -> str:
    out = [BANNER_TS.format(title=title, source=source), "\n"]
    imports = group_externals(ext, 1)
    for module, names in imports:
        out.append(f'import type {{ {", ".join(names)} }} from "{module}";\n')
    if imports:
        out.append("\n")

    for d in defs:
        if d.description:
            out.append("/**\n")
            out.extend(" * " + l.strip() + "\n" for l in wrap(d.description, 92, ""))
            out.append(" */\n")

        if d.kind == "enum":
            union = " | ".join(f'"{v}"' for v in d.values)
            out.append(f"export type {d.name} = {union};\n\n")
            const = re.sub(r"(?<!^)(?=[A-Z])", "_", d.name).upper() + "_VALUES"
            values = ", ".join(f'"{v}"' for v in d.values)
            out.append(f"export const {const} = [{values}] as const;\n\n")
            continue

        out.append(f"export interface {d.name} {{\n")
        for p in d.props:
            if p.description:
                lines = wrap(p.description, 88, "")
                if len(lines) == 1:
                    out.append(f"  /** {lines[0].strip()} */\n")
                else:
                    out.append("  /**\n")
                    out.extend("   * " + l.strip() + "\n" for l in lines)
                    out.append("   */\n")
            if p.required:
                out.append(f"  {p.name}: {p.ts_type};\n")
            else:
                out.append(f"  {p.name}?: {p.ts_type} | null;\n")
        out.append("}\n\n")

    return "".join(out)


# ── 실행 ──────────────────────────────────────────────────────────

TARGETS = [
    ("cdm.v1.json", "cdm_v1.py", "cdm.v1.ts"),
    ("api.v1.json", "api_v1.py", "api.v1.ts"),
]


def emit(path: Path, content: str, check: bool, stale: list[str]) -> None:
    existing = path.read_text(encoding="utf-8") if path.exists() else None
    if existing == content:
        print(f"  = {path.relative_to(ROOT)}")
        return
    if check:
        stale.append(str(path.relative_to(ROOT)))
        print(f"  ! {path.relative_to(ROOT)}  (최신 아님)")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"  + {path.relative_to(ROOT)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="쓰지 않고 최신 여부만 확인")
    args = ap.parse_args()

    stale: list[str] = []
    modules: list[tuple[str, str]] = []

    for schema_file, py_name, ts_name in TARGETS:
        src = SCHEMA_DIR / schema_file
        print(f"{schema_file}")
        try:
            title, defs, ext = load_defs(src)
            defs = topo_sort(defs)
        except SchemaError as e:
            print(f"  스키마 오류: {e}", file=sys.stderr)
            return 2
        print(f"  {len(defs)}개 타입" + (f", 외부 참조 {len(ext)}개" if ext else ""))
        emit(PY_OUT_DIR / py_name, render_python(title, schema_file, defs, ext), args.check, stale)
        emit(TS_OUT_DIR / ts_name, render_typescript(title, schema_file, defs, ext), args.check, stale)
        modules.append((py_name.removesuffix(".py"), ts_name.removesuffix(".ts")))

    init = (
        '"""생성된 CDM/API 모델. 재생성: python cdm/codegen/generate.py"""\n\n'
        + "".join(f"from . import {py} as {py}  # noqa: F401\n" for py, _ in modules)
    )
    emit(PY_OUT_DIR / "__init__.py", init, args.check, stale)

    barrel = BANNER_TS.format(title="생성 타입 배럴", source="cdm.v1.json, api.v1.json") + "\n"
    barrel += "".join(f'export * from "./{ts}";\n' for _, ts in modules)
    emit(TS_OUT_DIR / "index.ts", barrel, args.check, stale)

    if stale:
        print(f"\n{len(stale)}개 파일이 스키마와 어긋난다. 'python cdm/codegen/generate.py' 를 실행할 것.")
        return 1
    print("\n완료.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
