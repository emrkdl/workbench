"""초기 스키마.

테이블 자체는 모델 메타데이터에서 만든다 — 손으로 옮겨 적으면 모델과 어긋나기 시작하고,
그 어긋남은 운영에서만 드러난다. 그 위에 PostgreSQL 전용 최적화를 얹는다:

  - jsonb 캐스팅: 카탈로그 파셋이 summary 안의 값을 직접 질의한다. json 인 채로 두면
    매번 파싱하므로 인덱스를 걸 수 없다
  - net_pin 부분 인덱스: 넷리스트 Diff 가 (revision_id, net_id) 로만 훑는다
  - 대소문자 무시 부품 검색: 역검색에서 사용자가 대문자로 칠지 소문자로 칠지 모른다

net_pin 해시 파티셔닝은 여기 넣지 않았다. 행이 2,000만을 넘어가는 시점에 별도
마이그레이션으로 붙이는 편이 안전하다 — 파티션 전환은 되돌리기 어렵고, 그 규모가 되기
전에는 이득도 없다.
"""

import sqlalchemy as sa
from alembic import op

from boardlens.db.models import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind)

    if bind.dialect.name != "postgresql":
        return

    op.execute("ALTER TABLE revision ALTER COLUMN summary TYPE jsonb USING summary::jsonb")
    op.execute("ALTER TABLE revision ALTER COLUMN header TYPE jsonb USING header::jsonb")
    op.execute("ALTER TABLE revision ALTER COLUMN design_rules TYPE jsonb USING design_rules::jsonb")
    op.execute("ALTER TABLE board ALTER COLUMN tags TYPE jsonb USING tags::jsonb")
    op.execute("ALTER TABLE audit_log ALTER COLUMN detail TYPE jsonb USING detail::jsonb")

    # 카탈로그가 실제로 거는 파셋들. summary 를 통째로 읽지 않고 값만 뽑아 쓴다.
    op.execute(
        "CREATE INDEX ix_revision_summary_layers ON revision "
        "(((summary->>'layer_count')::int)) WHERE ingest_state = 'ready'"
    )
    op.execute(
        "CREATE INDEX ix_revision_summary_components ON revision "
        "(((summary->>'component_count')::int)) WHERE ingest_state = 'ready'"
    )
    op.execute("CREATE INDEX ix_net_pin_rev_net ON net_pin (revision_id, net_id)")
    op.execute("CREATE INDEX ix_part_mpn_lower ON part (lower(mpn_normalized))")
    # 대기 중인 잡만 훑는 인덱스. 큐가 커져도 claim 이 느려지지 않는다.
    op.execute(
        "CREATE INDEX ix_ingest_job_pending ON ingest_job (created_at) "
        "WHERE state IN ('uploaded', 'failed')"
    )


def downgrade() -> None:
    Base.metadata.drop_all(op.get_bind())
