"""boardlens 명령줄.

폐쇄망 서버에서 실제로 하게 되는 일들 — 스키마 만들기, 파일 적재, 워커 돌리기,
파서를 고친 뒤 전체 재파싱하기, 계정 만들기.

    python -m boardlens init-db --admin admin --password ...
    python -m boardlens ingest /data/*.hkp --actor kim --project TITAN
    python -m boardlens worker --once
    python -m boardlens reparse --parser hkp --below 1.1.0
    python -m boardlens serve --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import func, select

from boardlens import auth
from boardlens.db import models as m
from boardlens.db.session import create_all, database_url, session_scope
from boardlens.ingest import jobs
from boardlens.ingest.pipeline import ingest_payload
from boardlens.parser import REGISTRY
from boardlens.storage import default_store


def cmd_init_db(args: argparse.Namespace) -> int:
    create_all()
    with session_scope() as s:
        if args.admin:
            auth.ensure_user(
                s, username=args.admin, display_name=args.admin, role="admin", password=args.password
            )
            print(f"관리자 계정 생성: {args.admin}")
    print(f"스키마 준비 완료 — {database_url()}")
    print("운영 배포에서는 이 명령 대신 'alembic upgrade head' 를 쓰세요.")
    return 0


def cmd_ingest(args: argparse.Namespace) -> int:
    store = default_store()
    geometry_root = Path(args.geometry_root) if args.geometry_root else None
    paths: list[Path] = []
    for pattern in args.paths:
        p = Path(pattern)
        paths.extend(sorted(p.parent.glob(p.name)) if any(c in p.name for c in "*?[") else [p])

    if not paths:
        print("적재할 파일이 없습니다", file=sys.stderr)
        return 1

    failed = 0
    with session_scope() as s:
        for path in paths:
            if not path.is_file():
                continue
            result = ingest_payload(
                s, store, payload=path.read_bytes(), filename=path.name,
                actor=args.actor, project_key=args.project,
                adapter_name=args.adapter, geometry_root=geometry_root,
            )
            mark = "OK " if result.state == "ready" else "실패"
            print(f"  [{mark}] {path.name} -> {result.revision_id or '-'}", end="")
            if result.warnings:
                print(f"  (경고 {len(result.warnings)})", end="")
            print()
            if result.error:
                print(f"         {result.error}", file=sys.stderr)
                failed += 1
    return 1 if failed else 0


def cmd_worker(args: argparse.Namespace) -> int:
    import time

    store = default_store()
    geometry_root = Path(args.geometry_root) if args.geometry_root else None
    while True:
        with session_scope() as s:
            results = jobs.run_pending(s, store, limit=args.batch, geometry_root=geometry_root)
        for r in results:
            print(f"  {r.revision_id}: {r.state}" + (f" — {r.error}" if r.error else ""))
        if args.once:
            return 0
        if not results:
            time.sleep(args.interval)


def cmd_reparse(args: argparse.Namespace) -> int:
    with session_scope() as s:
        count = jobs.enqueue_reparse(s, parser_name=args.parser, below_version=args.below)
    print(f"{count}개 리비전을 재파싱 큐에 넣었습니다. 'python -m boardlens worker' 로 처리하세요.")
    return 0


def cmd_user(args: argparse.Namespace) -> int:
    with session_scope() as s:
        auth.ensure_user(
            s, username=args.username, display_name=args.display_name or args.username,
            role=args.role, password=args.password,
            projects=args.projects.split(",") if args.projects else None,
        )
    print(f"{args.username} ({args.role}) 준비 완료")
    return 0


def cmd_status(_: argparse.Namespace) -> int:
    with session_scope() as s:
        rows = [
            ("보드", m.Board), ("리비전", m.Revision), ("부품", m.Component),
            ("넷", m.Net), ("넷핀", m.NetPin), ("부품 마스터", m.Part),
            ("원본 파일", m.DesignFile), ("감사 로그", m.AuditLog),
        ]
        print(f"DB: {database_url()}")
        for label, model in rows:
            print(f"  {label:12} {s.scalar(select(func.count()).select_from(model)):>10,}")
        states = s.execute(
            select(m.Revision.ingest_state, func.count()).group_by(m.Revision.ingest_state)
        ).all()
        print("  인제스트 상태:", ", ".join(f"{k} {v}" for k, v in states) or "없음")
        print("  어댑터:", ", ".join(f"{a.name} {a.version}" for a in REGISTRY.adapters))
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("boardlens.api.app:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="boardlens", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init-db", help="스키마 생성 (개발·초기 구축용)")
    p.add_argument("--admin")
    p.add_argument("--password")
    p.set_defaults(func=cmd_init_db)

    p = sub.add_parser("ingest", help="설계 파일 적재")
    p.add_argument("paths", nargs="+")
    p.add_argument("--actor", default="cli")
    p.add_argument("--project")
    p.add_argument("--adapter", help="어댑터 강제 지정 (기본: 확장자로 판단)")
    p.add_argument("--geometry-root", help="참조된 .blg 를 가져올 경로")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("worker", help="인제스트 큐 처리")
    p.add_argument("--once", action="store_true")
    p.add_argument("--batch", type=int, default=20)
    p.add_argument("--interval", type=float, default=5.0)
    p.add_argument("--geometry-root")
    p.set_defaults(func=cmd_worker)

    p = sub.add_parser("reparse", help="파서 개선 후 전체 재파싱")
    p.add_argument("--parser", required=True)
    p.add_argument("--below", required=True, help="이 버전보다 낮은 것만")
    p.set_defaults(func=cmd_reparse)

    p = sub.add_parser("user", help="계정 생성·수정")
    p.add_argument("username")
    p.add_argument("--display-name")
    p.add_argument("--role", default="viewer", choices=auth.ROLES)
    p.add_argument("--password")
    p.add_argument("--projects", help="쉼표로 구분. 비우면 전 프로젝트")
    p.set_defaults(func=cmd_user)

    sub.add_parser("status", help="적재 현황").set_defaults(func=cmd_status)

    p = sub.add_parser("serve", help="API 서버 실행")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(func=cmd_serve)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
