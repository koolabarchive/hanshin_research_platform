const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ── 비밀번호 ────────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

// ── 토큰 ───────────────────────────────────────────────────
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// 참여자를 연구자에게 보여 줄 때 쓰는 가명 코드. 헷갈리는 글자(0/O, 1/I)는 뺐다.
function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('base64url')}`;
}

function participantCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `P-${out}`;
}

// ── 민감정보 암호화 (AES-256-GCM) ───────────────────────────
// 참여자의 특성 정보는 DB에 평문으로 두지 않는다. DB 파일만 유출되어서는 내용을 읽을 수 없다.
let cachedKey = null;

function dataKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.DATA_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) throw new Error('DATA_KEY는 base64로 인코딩한 32바이트 값이어야 합니다.');
    cachedKey = key;
    return key;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('운영 환경에서는 DATA_KEY 환경변수가 반드시 필요합니다. (.env.example 참고)');
  }
  // 개발 편의: 키를 파일로 만들어 재사용한다. 운영에서는 절대 이 경로를 타지 않는다.
  const keyFile = path.join(__dirname, '..', 'data', 'dev-data.key');
  if (fs.existsSync(keyFile)) {
    cachedKey = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
  } else {
    cachedKey = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, cachedKey.toString('base64'), { mode: 0o600 });
  }
  return cachedKey;
}

function encryptJSON(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

function decryptJSON(blob) {
  if (!blob) return null;
  const [version, iv, tag, body] = String(blob).split('.');
  if (version !== 'v1') throw new Error('알 수 없는 암호화 형식입니다.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

module.exports = {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  safeEqual,
  participantCode,
  randomId,
  encryptJSON,
  decryptJSON,
  dataKey,
};
