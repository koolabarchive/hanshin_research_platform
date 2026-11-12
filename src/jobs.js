// 주기 작업: 모집 마감 처리, 자동 리마인더, 방문 하루 전 안내, 만료된 세션·인증번호 정리.
// 서버를 직접 띄우면 30분마다 돌고, Firebase Functions에 올리면 예약 함수(index.js)가 부른다.
const { col, find } = require('./db');
const D = require('./domain');
const st = require('./store');

async function runJobs(now = Date.now()) {
  const w = st.writer();
  try {
    for (const name of ['sessions', 'email_codes']) {
      for (const row of await find(col(name).where('expires_at', '<=', now))) w.delete(col(name).doc(row.id));
    }

    const today = D.toYMD(now);
    for (const row of await find(col('studies').where('status', '==', 'recruiting'))) {
      const study = st.studyFromRow(row);
      if (study.end < today) {
        w.update(col('studies').doc(study.id), { status: 'closed', updated_at: now });
        st.log(w, null, `모집 기간 종료로 자동 마감: ${study.title}`);
        continue;
      }
      const enr = await st.enrollmentsOf(study.id, { fresh: true });
      const mark = (e, field) => w.update(col('enrollments').doc(e.id), { [field]: true });

      // 초대 후 3일 동안 응답이 없으면 문자 1회. 주 3회 안내 제한에 포함된다.
      if (study.templates.remind3) {
        const pool = new Map((await st.participants()).map((p) => [p.id, p]));
        const due = enr.filter((e) => e.status === 'invited' && e.source === 'invite' && !e.r3_sent && e.invited_at < now - 3 * D.DAY && pool.has(e.user_id) && st.noticeCount(pool.get(e.user_id), now) < D.WEEKLY_NOTICE_LIMIT);
        const users = await st.usersByIds(due.map((e) => e.user_id));
        for (const e of due) {
          const u = users.get(e.user_id);
          if (u) st.deliver(w, u, { studyId: study.id, kind: 'reminder', channel: 'sms', subject: `[한신 리서치풀] ${study.title} 참여 안내`, body: D.fillTpl('[한신리서치풀] {{연구명}} 참여 안내를 다시 드려요. {{마감일}} 마감.', study, e.pid) });
          mark(e, 'r3_sent');
        }
        if (due.length) st.sendLog(w, study.id, '리마인더', '문자', '초대 후 미응답', due.length, '(자동) 초대 3일 후 미응답 리마인더');
      }

      // 모집 마감 2일 전, 동의만 하고 마치지 않은 사람에게 이메일 1회.
      if (study.templates.remindEnd && D.endTs(study.end) - now < 2 * D.DAY) {
        const due = enr.filter((e) => e.status === 'consented' && !e.rend_sent);
        const users = await st.usersByIds(due.map((e) => e.user_id));
        for (const e of due) {
          const u = users.get(e.user_id);
          if (u) st.deliver(w, u, { studyId: study.id, kind: 'reminder', channel: 'email', subject: `[한신 리서치풀] ${study.title} 마감이 다가와요`, body: `${e.pid} 님, 동의하신 ${study.title} 연구가 ${D.fmtMD(D.endTs(study.end))}에 마감됩니다.\n로그인해서 남은 단계를 마쳐 주세요. 참여를 원하지 않으면 그대로 두셔도 됩니다.` });
          mark(e, 'rend_sent');
        }
        if (due.length) st.sendLog(w, study.id, '리마인더', '이메일', '동의 후 미완료', due.length, '(자동) 마감 2일 전 리마인더');
      }
      if (enr.some((e) => e.status === 'invited' || e.status === 'consented')) st.invalidateEnr(study.id);
    }

    // 예약한 방문 하루 전에 다시 알린다(마감된 연구도 방문은 남아 있을 수 있다).
    const scheduled = (await find(col('enrollments').where('status', '==', 'scheduled'))).filter((e) => !e.dayb_sent && e.slot_id);
    const studies = new Map();
    for (const e of scheduled) {
      if (!studies.has(e.study_id)) studies.set(e.study_id, await st.getStudy(e.study_id));
      const study = studies.get(e.study_id);
      const slot = study && study.slots.find((s) => s.id === e.slot_id);
      if (!slot || slot.at <= now || slot.at >= now + D.DAY) continue;
      const u = await st.userById(e.user_id);
      if (u) st.deliver(w, u, { studyId: study.id, kind: 'schedule', channel: 'both', subject: '[한신 리서치풀] 내일 방문 일정이 있어요', body: `${study.title}\n일시: ${D.fmtDT(slot.at)}\n장소: ${study.location}`, sms: `[한신리서치풀] 방문 안내 ${D.fmtDT(slot.at)} ${study.location}` });
      w.update(col('enrollments').doc(e.id), { dayb_sent: true });
    }
  } finally {
    await w.close();
  }
}

module.exports = { runJobs };
