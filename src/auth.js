const { col, getDoc, find } = require('./db');
const { randomToken, sha256, safeEqual } = require('./security');
const { hydrate } = require('./store');

const SESSION_DAYS = 7;
const isProd = () => process.env.NODE_ENV === 'production';
// Firebase Hosting은 서버로 요청을 넘길 때 이름이 __session 인 쿠키 하나만 전달한다.
// 그래서 로그인 세션 값과 CSRF 토큰을 이 쿠키 하나에 "세션.토큰" 형태로 함께 담는다.
const COOKIE = '__session';

function readCookie(header) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      try {
        const [sid = '', csrf = ''] = decodeURIComponent(part.slice(i + 1).trim()).split('.');
        return { sid, csrf };
      } catch {
        return { sid: '', csrf: '' };
      }
    }
  }
  return { sid: '', csrf: '' };
}

function writeCookie(res, sid, csrf) {
  const attrs = [`${COOKIE}=${encodeURIComponent(`${sid}.${csrf}`)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${60 * 60 * 24 * SESSION_DAYS}`];
  if (isProd()) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

// 모든 방문자에게 CSRF 토큰을 주고, 로그인 세션이 있으면 사용자를 싣는다.
async function sessionMiddleware(req, res, next) {
  try {
    let { sid, csrf } = readCookie(req.headers.cookie);
    const fresh = !csrf || csrf.length < 20;
    if (fresh) csrf = randomToken(24);
    req.csrf = csrf;
    req.sid = '';
    req.user = null;
    if (sid) {
      const hash = sha256(sid);
      const sess = await getDoc('sessions', hash);
      const user = sess && sess.expires_at > Date.now() ? await getDoc('users', sess.user_id) : null;
      if (user && user.status === 'active') {
        req.user = hydrate(user);
        req.sid = sid;
        req.sessionHash = hash;
      }
    }
    if (fresh || (sid && !req.user)) writeCookie(res, req.sid, csrf);
    next();
  } catch (err) {
    next(err);
  }
}

// 상태를 바꾸는 요청은 화면이 받은 토큰을 헤더로 되돌려 보내야 한다(다른 사이트에서 위조한 요청 차단).
function requireCsrf(req, res, next) {
  if (!safeEqual(req.get('X-CSRF-Token'), req.csrf)) {
    return res.status(403).json({ error: '보안 토큰이 만료되었어요. 화면을 새로고침한 뒤 다시 시도해 주세요.' });
  }
  next();
}

async function login(req, res, userId) {
  const sid = randomToken(32);
  const now = Date.now();
  await col('sessions').doc(sha256(sid)).set({ user_id: userId, expires_at: now + SESSION_DAYS * 864e5 });
  await col('users').doc(userId).update({ last_login_at: now });
  writeCookie(res, sid, req.csrf);
}

async function logout(req, res) {
  if (req.sessionHash) await col('sessions').doc(req.sessionHash).delete();
  writeCookie(res, '', req.csrf);
}

// 비밀번호를 바꾸거나 탈퇴하면 그 사람의 모든 로그인을 끊는다.
async function endAllSessions(userId) {
  const list = await find(col('sessions').where('user_id', '==', userId));
  await Promise.all(list.map((s) => col('sessions').doc(s.id).delete()));
}

// 시도 횟수 제한(프로세스 메모리). 서버 인스턴스가 여러 개면 인스턴스마다 따로 센다.
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

module.exports = { sessionMiddleware, requireCsrf, login, logout, endAllSessions, rateLimit, clearRateLimit };
