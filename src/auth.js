const { get, run } = require('./db');
const { randomToken, sha256, safeEqual } = require('./security');
const { hydrate } = require('./store');

const SESSION_DAYS = 7;
const isProd = () => process.env.NODE_ENV === 'production';

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // 깨진 쿠키는 무시한다.
    }
  }
  return out;
}

function setCookie(res, name, value, maxAgeSec) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isProd()) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

// 모든 방문자에게 CSRF 토큰 쿠키를 주고, 로그인 세션이 있으면 사용자를 싣는다.
function sessionMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  let csrf = cookies.csrf;
  if (!csrf || csrf.length < 20) {
    csrf = randomToken(24);
    setCookie(res, 'csrf', csrf, 60 * 60 * 24 * 30);
  }
  req.csrf = csrf;
  req.user = null;
  if (cookies.sid) {
    const hash = sha256(cookies.sid);
    const row = get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ? AND u.status = 'active'`, hash, Date.now());
    if (row) {
      req.user = hydrate(row);
      req.sessionHash = hash;
    }
  }
  next();
}

// 상태를 바꾸는 요청은 화면이 받은 토큰을 헤더로 되돌려 보내야 한다(다른 사이트에서 위조한 요청 차단).
function requireCsrf(req, res, next) {
  if (!safeEqual(req.get('X-CSRF-Token'), req.csrf)) {
    return res.status(403).json({ error: '보안 토큰이 만료되었어요. 화면을 새로고침한 뒤 다시 시도해 주세요.' });
  }
  next();
}

function login(res, userId) {
  const sid = randomToken(32);
  run('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?,?,?)', sha256(sid), userId, Date.now() + SESSION_DAYS * 864e5);
  run('UPDATE users SET last_login_at = ? WHERE id = ?', Date.now(), userId);
  setCookie(res, 'sid', sid, 60 * 60 * 24 * SESSION_DAYS);
}

function logout(req, res) {
  if (req.sessionHash) run('DELETE FROM sessions WHERE id_hash = ?', req.sessionHash);
  setCookie(res, 'sid', '', 0);
}

// 시도 횟수 제한(프로세스 메모리). 서버를 여러 대로 늘리면 공유 저장소로 옮겨야 한다.
const attempts = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}
const clearRateLimit = (key) => attempts.delete(key);
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
}, 60_000).unref();

module.exports = { sessionMiddleware, requireCsrf, login, logout, rateLimit, clearRateLimit };
