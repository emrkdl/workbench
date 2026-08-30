"""데이터베이스 모델.

설계 문서 §04 의 테이블 스케치를 그대로 옮긴 것이다. 두 가지 원칙이 형태를 결정한다:

1. **질의·비교·집계의 대상만 행(row)으로 둔다.** 배선 좌표는 여기 없다 — 리비전 1,000장
   이면 2억 개가 되고, 어차피 SQL 로 물어볼 일이 없다. 그것들은 blob 스토어의 .blg 다.
2. **리비전은 불변이다.** 한 번 ready 가 되면 고치지 않는다. 파서를 개선하면 같은
   리비전 ID 를 유지한 채 내용을 갈아끼운다.

타입은 이식 가능한 것만 쓴다 (JSON, String). PostgreSQL 전용 최적화 — jsonb 캐스팅,
net_pin 해시 파티셔닝 — 는 Alembic 마이그레이션에서 붙인다. 그래야 테스트를 SQLite 로
빠르게 돌릴 수 있고, 실제 배포에서는 PostgreSQL 의 이점을 그대로 가져간다.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


#: PostgreSQL 에서는 bigint, SQLite 에서는 integer 로 내려간다. SQLite 는 INTEGER
#: PRIMARY KEY 만 자동 증가시키므로, 이걸 쓰지 않으면 테스트가 운영과 다른 스키마로 돈다.
BigIntPk = BigInteger().with_variant(Integer, "sqlite")


class Base(DeclarativeBase):
    pass


# ── 계보 ──────────────────────────────────────


class Project(Base):
    __tablename__ = "project"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    #: 권한 경계다. 보드 단위 예외는 두지 않는다 — 관리 비용 대비 실효가 없고,
    #: 예외가 쌓이면 아무도 현재 상태를 모르게 된다.
    security_level: Mapped[str] = mapped_column(String(24), default="internal")

    boards: Mapped[list["Board"]] = relationship(back_populates="project")


class Board(Base):
    __tablename__ = "board"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id"), index=True)
    board_key: Mapped[str] = mapped_column(String(96), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    part_number: Mapped[str | None] = mapped_column(String(96))
    product_family: Mapped[str | None] = mapped_column(String(96), index=True)
    owner: Mapped[str | None] = mapped_column(String(96), index=True)
    status: Mapped[str] = mapped_column(String(24), index=True, default="draft")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    project: Mapped[Project] = relationship(back_populates="boards")
    revisions: Mapped[list["Revision"]] = relationship(back_populates="board", cascade="all, delete-orphan")


class Revision(Base):
    __tablename__ = "revision"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("board.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(48))
    parent_revision_id: Mapped[str | None] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)

    ingest_state: Mapped[str] = mapped_column(String(24), default="uploaded", index=True)
    ingest_error: Mapped[str | None] = mapped_column(Text)

    author: Mapped[str | None] = mapped_column(String(96))
    designed_at: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    note: Mapped[str | None] = mapped_column(Text)

    source_tool: Mapped[str] = mapped_column(String(64), index=True, default="")
    source_version: Mapped[str] = mapped_column(String(64), default="")
    cdm_version: Mapped[str | None] = mapped_column(String(32))
    parser_name: Mapped[str | None] = mapped_column(String(64))
    #: 파서 버전이 올라가면 전체 재파싱 대상이 된다. 어느 리비전이 옛 파서로 들어왔는지
    #: 알아야 무엇을 다시 돌릴지 정할 수 있다.
    parser_version: Mapped[str | None] = mapped_column(String(32), index=True)

    #: 카탈로그 목록과 파셋이 읽는 사전 집계. 매번 집계하면 2,000만 행을 훑게 된다.
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    #: 표시용 부속 정보. 행으로 쪼갤 이유가 없는 것들만 여기 둔다.
    header: Mapped[dict] = mapped_column(JSON, default=dict)
    design_rules: Mapped[dict] = mapped_column(JSON, default=dict)
    outline: Mapped[list] = mapped_column(JSON, default=list)
    vias: Mapped[list] = mapped_column(JSON, default=list)
    drills: Mapped[list] = mapped_column(JSON, default=list)
    warnings: Mapped[list] = mapped_column(JSON, default=list)

    board: Mapped[Board] = relationship(back_populates="revisions")

    __table_args__ = (
        UniqueConstraint("board_id", "label", name="uq_revision_board_label"),
        Index("ix_revision_board_created", "board_id", "created_at"),
    )


class DesignFile(Base):
    __tablename__ = "design_file"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revision.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    #: 원본은 불변이고 내용 해시로 주소를 잡는다. 같은 파일을 두 번 올려도 하나만 남는다.
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    byte_size: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(String(512))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    uploaded_by: Mapped[str] = mapped_column(String(96))
    kind: Mapped[str | None] = mapped_column(String(32))


# ── 설계 내용 ─────────────────────────────────


class StackupLayer(Base):
    __tablename__ = "stackup_layer"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revision.id", ondelete="CASCADE"), index=True)
    index: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(64))
    source_name: Mapped[str] = mapped_column(String(96))
    role: Mapped[str] = mapped_column(String(24))
    thickness_nm: Mapped[int] = mapped_column(BigInteger)
    material: Mapped[str | None] = mapped_column(String(96))
    dk: Mapped[float | None] = mapped_column(Float)
    df: Mapped[float | None] = mapped_column(Float)
    copper_weight_um: Mapped[float | None] = mapped_column(Float)
    copper_area_ratio: Mapped[float | None] = mapped_column(Float)
    impedance_single_ohm: Mapped[float | None] = mapped_column(Float)
    impedance_diff_ohm: Mapped[float | None] = mapped_column(Float)

    __table_args__ = (UniqueConstraint("revision_id", "index", name="uq_stackup_revision_index"),)


class Part(Base):
    """리비전과 무관한 부품 마스터. 역검색의 축이다."""

    __tablename__ = "part"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    manufacturer: Mapped[str | None] = mapped_column(String(128), index=True)
    #: 공백·하이픈·포장 접미사를 제거한 정규형. 정규화 실패는 곧 역검색 누락이다.
    mpn_normalized: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    mpn_display: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text)
    lifecycle: Mapped[str | None] = mapped_column(String(24), index=True)


class Component(Base):
    __tablename__ = "component"

    id: Mapped[int] = mapped_column(BigIntPk, primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revision.id", ondelete="CASCADE"), index=True)
    refdes: Mapped[str] = mapped_column(String(48))
    part_id: Mapped[str | None] = mapped_column(ForeignKey("part.id"), index=True)
    part_number: Mapped[str | None] = mapped_column(String(128))
    manufacturer: Mapped[str | None] = mapped_column(String(128))
    value: Mapped[str | None] = mapped_column(String(64))
    package: Mapped[str] = mapped_column(String(64), index=True)
    x_nm: Mapped[int] = mapped_column(BigInteger)
    y_nm: Mapped[int] = mapped_column(BigInteger)
    rotation_mdeg: Mapped[int] = mapped_column(Integer)
    side: Mapped[str] = mapped_column(String(8))
    pin_count: Mapped[int] = mapped_column(Integer)
    pin_pitch_nm: Mapped[int | None] = mapped_column(BigInteger)

    __table_args__ = (
        # RefDes 는 리비전 내에서 유일해야 한다 — Diff 의 매칭 키라 중복되면 비교가 깨진다
        UniqueConstraint("revision_id", "refdes", name="uq_component_revision_refdes"),
        Index("ix_component_part_revision", "part_id", "revision_id"),
    )


class Net(Base):
    __tablename__ = "net"

    id: Mapped[int] = mapped_column(BigIntPk, primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revision.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    #: 정렬된 refdes.pin 집합의 해시. 이름이 바뀐 넷과 회로가 바뀐 넷을 가르는 열쇠.
    signature: Mapped[str] = mapped_column(String(32), index=True)
    net_class: Mapped[str | None] = mapped_column(String(32))
    diff_partner: Mapped[str | None] = mapped_column(String(128))
    pin_count: Mapped[int] = mapped_column(Integer)
    length_nm: Mapped[int] = mapped_column(BigInteger)
    length_by_layer: Mapped[list] = mapped_column(JSON, default=list)
    via_count: Mapped[int] = mapped_column(Integer, default=0)
    width_nm: Mapped[int | None] = mapped_column(BigInteger)
    unrouted: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (UniqueConstraint("revision_id", "name", name="uq_net_revision_name"),)


class NetPin(Base):
    """회로 연결의 원자 단위. 넷리스트 Diff 는 이 집합의 차집합이다.

    가장 큰 테이블이다 — 리비전 1,000장이면 2,000만 행. PostgreSQL 에서는 revision_id
    해시 파티션을 건다 (마이그레이션 참조). 어떤 질의든 리비전이 먼저 좁혀지므로
    파티션 프루닝이 그대로 먹는다.
    """

    __tablename__ = "net_pin"

    id: Mapped[int] = mapped_column(BigIntPk, primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revision.id", ondelete="CASCADE"), index=True)
    net_id: Mapped[int] = mapped_column(ForeignKey("net.id", ondelete="CASCADE"), index=True)
    refdes: Mapped[str] = mapped_column(String(48))
    pin_name: Mapped[str] = mapped_column(String(32))

    __table_args__ = (Index("ix_net_pin_revision_refdes", "revision_id", "refdes"),)


class DrcFinding(Base):
    __tablename__ = "drc_finding"

    id: Mapped[int] = mapped_column(BigIntPk, primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revision.id", ondelete="CASCADE"), index=True)
    rule: Mapped[str] = mapped_column(String(128))
    severity: Mapped[str] = mapped_column(String(16), index=True)
    message: Mapped[str] = mapped_column(Text)
    x_nm: Mapped[int | None] = mapped_column(BigInteger)
    y_nm: Mapped[int | None] = mapped_column(BigInteger)
    layer_index: Mapped[int | None] = mapped_column(Integer)
    net_name: Mapped[str | None] = mapped_column(String(128))
    refdes: Mapped[str | None] = mapped_column(String(48))


class LayerGeometry(Base):
    """레이어 기하 버퍼(.blg)를 가리키는 포인터. 좌표는 DB 에 들어오지 않는다."""

    __tablename__ = "layer_geometry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revision.id", ondelete="CASCADE"), index=True)
    layer_index: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(512))
    object_count: Mapped[int] = mapped_column(Integer)
    byte_size: Mapped[int] = mapped_column(BigInteger)
    bbox: Mapped[dict] = mapped_column(JSON, default=dict)
    kind_counts: Mapped[dict] = mapped_column(JSON, default=dict)

    __table_args__ = (UniqueConstraint("revision_id", "layer_index", name="uq_geometry_revision_layer"),)


# ── 운영 ──────────────────────────────────────


class IngestJob(Base):
    """인제스트 큐.

    Redis·Celery 를 쓰지 않는다. 폐쇄망 온프렘에서는 운영 인력이 붙는 미들웨어 하나하나가
    비용이고, 하루 수십 건 규모에 별도 브로커는 과잉이다. PostgreSQL 의
    SELECT … FOR UPDATE SKIP LOCKED 로 충분하며, 잡 상태를 같은 트랜잭션에서 볼 수 있어
    재파싱·실패 추적도 단순해진다.
    """

    __tablename__ = "ingest_job"

    id: Mapped[int] = mapped_column(BigIntPk, primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revision.id", ondelete="CASCADE"), index=True)
    state: Mapped[str] = mapped_column(String(24), default="uploaded", index=True)
    parser_name: Mapped[str | None] = mapped_column(String(64))
    parser_version: Mapped[str | None] = mapped_column(String(32))
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_by: Mapped[str | None] = mapped_column(String(96))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AppUser(Base):
    __tablename__ = "app_user"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    username: Mapped[str] = mapped_column(String(96), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(24), default="viewer")
    #: 로컬 계정용. 사내 AD/LDAP 연동 시에는 비어 있고 AuthProvider 가 대신 판단한다.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    projects: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class AuditLog(Base):
    """원본 다운로드·권한 변경·업로드는 예외 없이 남긴다.

    설계 데이터는 회사의 핵심 자산이고, 폐쇄망이라는 사실이 접근 기록을 면제해 주지 않는다.
    """

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigIntPk, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor: Mapped[str] = mapped_column(String(96), index=True)
    action: Mapped[str] = mapped_column(String(48), index=True)
    target_type: Mapped[str] = mapped_column(String(32))
    target_id: Mapped[str] = mapped_column(String(128), index=True)
    ip: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
