const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pool.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 시각은 모두 ms 단위 정수(Date.now())로 저장한다. 화면 코드가 같은 단위를 쓴다.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('participant','researcher','admin')),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  pid TEXT UNIQUE,                    -- 참여자 가명 ID (P-1043). 연구자에게는 이것만 보인다.
  pii_enc TEXT NOT NULL,              -- 이름·휴대전화 (암호문)
  profile_enc TEXT,                   -- 참여자 매칭 정보 (암호문)
  affiliation TEXT,                   -- campus: 학교 메일로 소속 확인 / external: 학외
  contact_sms INTEGER NOT NULL DEFAULT 1,
  pool_joined INTEGER NOT NULL DEFAULT 0,
  pool_paused INTEGER NOT NULL DEFAULT 0,
  pool_since INTEGER,
  program TEXT, dept TEXT, advisor TEXT, ethics_date TEXT, ethics_file_id TEXT,
  verified INTEGER NOT NULL DEFAULT 0,  -- 연구자: 연구지원팀의 재학·이수 확인
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  synthetic INTEGER NOT NULL DEFAULT 0, -- 시연용 가상 계정. 실제 메일·문자를 보내지 않는다.
  joined_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS studies (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','recruiting','closed','rejected')),
  doc TEXT NOT NULL,                  -- 제목·설명문·동의서·설문지·조건·보상·안내 문구 (JSON)
  irb_file_id TEXT,
  review_comment TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  submitted_at INTEGER,
  approved_at INTEGER
);

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  cap INTEGER NOT NULL,
  booked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('invited','consented','scheduled','completed','paid','withdrawn')),
  source TEXT NOT NULL CHECK (source IN ('invite','self')),
  invited_at INTEGER NOT NULL,
  consent_at INTEGER,
  signature_enc TEXT,                 -- 전자서명(성명). 참여자 본인과 플랫폼만 본다.
  consent_doc_enc TEXT,               -- 서명 시점의 동의서 문항 사본
  consent_version TEXT,
  slot_id TEXT,
  responses_enc TEXT,                 -- 설문 응답 (암호문)
  completed_at INTEGER,
  paid_at INTEGER,
  reward_sent_at INTEGER,             -- 모바일 상품권을 실제로 발송한 시각(연구지원팀 처리)
  withdrawn_at INTEGER,
  data_choice TEXT,
  r3_sent INTEGER NOT NULL DEFAULT 0,
  rend_sent INTEGER NOT NULL DEFAULT 0,
  dayb_sent INTEGER NOT NULL DEFAULT 0,
  UNIQUE (study_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_id TEXT,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS send_logs (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  segment TEXT NOT NULL,
  count INTEGER NOT NULL,
  subject TEXT NOT NULL DEFAULT ''
);

-- 참여자가 연구자에게 보내는 문의. 연구자에게는 가명 ID로만 보이고, 답변은 플랫폼이 전달한다.
CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  reply TEXT,
  replied_at INTEGER,
  reported INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_id INTEGER,
  actor_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  pid TEXT                            -- 이 기록이 다루는 참여자(본인의 '내 정보 처리 기록'에 표시)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_id INTEGER,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, purpose)
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_enr_study ON enrollments(study_id, status);
CREATE INDEX IF NOT EXISTS idx_enr_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_msg_user ON messages(to_user_id, at);
CREATE INDEX IF NOT EXISTS idx_msg_recent ON messages(kind, channel, at);
CREATE INDEX IF NOT EXISTS idx_studies_owner ON studies(owner_id);
CREATE INDEX IF NOT EXISTS idx_audit_pid ON audit(pid);
`);

const get = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

module.exports = { db, get, all, run };
