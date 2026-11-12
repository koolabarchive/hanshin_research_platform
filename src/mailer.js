const { col } = require('./db');

// 이메일은 SMTP, 문자는 학교 문자 발송 계정(HTTP API)을 연결하면 실제로 나간다.
// 연결하지 않으면 outbox 컬렉션에만 쌓인다(시연·개발용).
let transport = null;

function getTransport() {
  if (transport !== null) return transport;
  if (!process.env.SMTP_HOST) return (transport = false);
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

const mailConfigured = () => !!process.env.SMTP_HOST;
const smsConfigured = () => !!process.env.SMS_API_URL;

// w: 쓰기를 모아 보내는 writer(store.writer()). 발송 이력을 outbox에 남긴다.
function sendMail(w, { to, subject, text }) {
  const ref = col('outbox').doc();
  const t = getTransport();
  w.set(ref, { channel: 'email', recipient: to, subject, body: text, delivered: false, created_at: Date.now() });
  if (!t) return;
  t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text })
    .then(() => ref.set({ delivered: true }, { merge: true }))
    .catch((err) => console.error(`[메일 발송 실패] ${err.message}`));
}

// 문자 발송 업체마다 요청 형식이 다르다. 계약한 업체의 형식에 맞게 이 함수의 요청 본문만 고치면 된다.
function sendSms(w, { to, text }) {
  const ref = col('outbox').doc();
  w.set(ref, { channel: 'sms', recipient: to, subject: '', body: text, delivered: false, created_at: Date.now() });
  if (!smsConfigured()) return;
  fetch(process.env.SMS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_API_KEY || ''}` },
    body: JSON.stringify({ from: process.env.SMS_SENDER, to: to.replace(/\D/g, ''), text }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ref.set({ delivered: true }, { merge: true });
    })
    .catch((err) => console.error(`[문자 발송 실패] ${err.message}`));
}

module.exports = { sendMail, sendSms, mailConfigured, smsConfigured };
