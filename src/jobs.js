// 주기 작업: 모집 마감 처리, 자동 리마인더, 방문 하루 전 안내, 만료된 세션·인증번호 정리.
const { db, all, run } = require('./db');
const D = require('./domain');
const st = require('./store');

function runJobs(now = Date.now()) {
  db.transaction(() => {
    run('DELETE FROM sessions WHERE expires_at <= ?', now);
    run('DELETE FROM email_codes WHERE expires_at <= ?', now);

    const today = D.toYMD(now);
    for (const row of all(`SELECT * FROM studies WHERE status = 'recruiting'`)) {
      const study = st.studyFromRow(row);
      if (study.end < today) {
        run(`UPDATE studies SET status = 'closed', updated_at = ? WHERE id = ?`, now, study.id);
        st.log(null, `모집 기간 종료로 자동 마감: ${study.title}`);
        continue;
      }
      const enr = st.enrollmentsOf(study.id);

      // 초대 후 3일 동안 응답이 없으면 문자 1회. 주 3회 안내 제한에 포함된다.
      if (study.templates.remind3) {
        const recent = st.recentNoticeCounts(now);
        const due = enr.filter((e) => e.status === 'invited' && e.source === 'invite' && !e.r3_sent && e.invited_at < now - 3 * D.DAY && (recent.get(e.user_id) || 0) < D.WEEKLY_NOTICE_LIMIT);
        for (const e of due) {
          const u = st.userById(e.user_id);
          st.deliver(u, { studyId: study.id, kind: 'reminder', channel: 'sms', subject: `[한신 리서치풀] ${study.title} 참여 안내`, body: D.fillTpl('[한신리서치풀] {{연구명}} 참여 안내를 다시 드려요. {{마감일}} 마감.', study, u.pid) });
          run('UPDATE enrollments SET r3_sent = 1 WHERE id = ?', e.id);
        }
        if (due.length) st.sendLog(study.id, '리마인더', '문자', '초대 후 미응답', due.length, '(자동) 초대 3일 후 미응답 리마인더');
      }

      // 모집 마감 2일 전, 동의만 하고 마치지 않은 사람에게 이메일 1회.
      if (study.templates.remindEnd && D.endTs(study.end) - now < 2 * D.DAY) {
        const due = enr.filter((e) => e.status === 'consented' && !e.rend_sent);
        for (const e of due) {
          const u = st.userById(e.user_id);
          st.deliver(u, { studyId: study.id, kind: 'reminder', channel: 'email', subject: `[한신 리서치풀] ${study.title} 마감이 다가와요`, body: `${u.pid} 님, 동의하신 ${study.title} 연구가 ${D.fmtMD(D.endTs(study.end))}에 마감됩니다.\n로그인해서 남은 단계를 마쳐 주세요. 참여를 원하지 않으면 그대로 두셔도 됩니다.` });
          run('UPDATE enrollments SET rend_sent = 1 WHERE id = ?', e.id);
        }
        if (due.length) st.sendLog(study.id, '리마인더', '이메일', '동의 후 미완료', due.length, '(자동) 마감 2일 전 리마인더');
      }
    }

    // 예약한 방문 하루 전에 다시 알린다(마감된 연구도 방문은 남아 있을 수 있다).
    const soon = all(
      `SELECT e.id, e.user_id, e.study_id, s.at FROM enrollments e JOIN slots s ON s.id = e.slot_id
       WHERE e.status = 'scheduled' AND e.dayb_sent = 0 AND s.at > ? AND s.at < ?`,
      now, now + D.DAY
    );
    for (const e of soon) {
      const study = st.getStudy(e.study_id);
      st.deliver(st.userById(e.user_id), { studyId: study.id, kind: 'schedule', channel: 'both', subject: '[한신 리서치풀] 내일 방문 일정이 있어요', body: `${study.title}\n일시: ${D.fmtDT(e.at)}\n장소: ${study.location}`, sms: `[한신리서치풀] 방문 안내 ${D.fmtDT(e.at)} ${study.location}` });
      run('UPDATE enrollments SET dayb_sent = 1 WHERE id = ?', e.id);
    }
  })();
}

module.exports = { runJobs };
