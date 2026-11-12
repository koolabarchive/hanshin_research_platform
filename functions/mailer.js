// 이메일은 SMTP, 문자는 학교 문자 발송 계정(HTTP API)을 연결하면 실제로 나간다.
// 연결하지 않으면 outbox 컬렉션에만 쌓인다(시연·개발용).
let transport = null;
function getTransport() {
  if (transport !== null) return transport;
  if (!process.env.SMTP_HOST) return (transport = false);
  transport = require('nodemailer').createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

// 발송 결과까지 기다렸다가 outbox에 한 번에 기록한다(함수가 끝나면 남은 작업이 끊기므로).
async function sendMail(db, { to, subject, text }) {
  let delivered = false;
  const t = getTransport();
  if (t) {
    try {
      await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
      delivered = true;
    } catch (err) {
      console.error(`[메일 발송 실패] ${err.message}`);
    }
  }
  await db.collection('outbox').add({ channel: 'email', recipient: to, subject, body: text, delivered, createdAt: Date.now() });
}

// 문자 발송 업체마다 요청 형식이 다르다. 계약한 업체의 형식에 맞게 이 함수의 요청 본문만 고치면 된다.
async function sendSms(db, { to, text }) {
  let delivered = false;
  if (process.env.SMS_API_URL) {
    try {
      const res = await fetch(process.env.SMS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_API_KEY || ''}` },
        body: JSON.stringify({ from: process.env.SMS_SENDER, to: to.replace(/\D/g, ''), text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      delivered = true;
    } catch (err) {
      console.error(`[문자 발송 실패] ${err.message}`);
    }
  }
  await db.collection('outbox').add({ channel: 'sms', recipient: to, subject: '', body: text, delivered, createdAt: Date.now() });
}

module.exports = { sendMail, sendSms };
