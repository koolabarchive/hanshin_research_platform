# 한신 리서치풀

한신대학교 일반대학원 연구자를 위한 연구참여자 모집 플랫폼입니다.

참여자는 대기풀에 조건을 한 번 등록해 두면 맞는 연구가 열릴 때 안내를 받고, 연구자는 참여자의 이름과 연락처를 모른 채 가명 ID로만 모집·안내·보상을 처리합니다. 모든 연구는 연구윤리지원팀이 IRB 승인을 확인한 뒤 공개됩니다.

## 구조

```
브라우저(web/ → public/)                    Firebase
  화면 ── Firebase Auth ─────────────────▶  로그인·이메일 인증
       ── Firestore (보안 규칙 아래 직접) ─▶  데이터
       ── Functions 호출 ────────────────▶  대기풀 집계·초대, 안내 발송
                                             └ 상태가 바뀌면 Functions가 알림·메일·문자·처리 기록을 남김
```

- **화면**은 정적 파일입니다. GitHub Pages(또는 Firebase Hosting)에 올립니다.
- **데이터 접근 통제는 `firestore.rules`가 전부 맡습니다.** 누가 무엇을 읽고 쓸 수 있는지는 이 파일을 보면 됩니다.
- **Functions**(`functions/index.js`)에는 브라우저에 맡길 수 없는 일만 있습니다: 대기풀을 읽어야 하는 일(인원수, 무작위 초대, 새 연구 안내)과 참여자의 주소·번호가 필요한 일(이메일·문자 발송).

## 누가 무엇을 볼 수 있나 (규칙 요약)

| 정보 | 참여자 본인 | 연구자 | 연구윤리지원팀 |
| --- | --- | --- | --- |
| 이름·이메일·휴대전화 (`users/{uid}/private`) | O | X | 한 건씩 열람(상품권 발송용) |
| 매칭 정보 (`pool/{uid}`) | O | X — 인원수·분포만 Functions로 | X |
| 참여 기록 (`enrollments`) | 자기 것 | 자기 연구의 것: 가명 ID·신분·연령대·번호 끝 4자리·설문 응답 | X |
| 전자서명·동의서 사본 (`enrollments/{id}/private`) | O | X (동의 일시만) | X |
| 알림함 (`messages`) | 자기 것 | X | X |
| 이수증·IRB 통지서 (`files`) | - | 본인이 올린 것 | O |

규칙이 직접 막는 것들:

- 연구자는 스스로 연구를 공개하거나 연구자 확인 표시를 바꿀 수 없습니다. 심사 중·공개된 연구의 내용도 고칠 수 없습니다(공지와 자동 리마인더 설정만 가능).
- 참여자는 조건(나이·신분·성별·학과)에 맞는 모집 중 연구에만 신청할 수 있습니다. 신분·출생연도는 가입 후 바꿀 수 없습니다.
- 재학생·교직원 신분과 연구자 가입은 학교 메일(@hs.ac.kr)이어야 하고, 이메일 인증 전에는 연구 목록을 읽거나 안내 대상이 될 수 없습니다.
- 동의는 가입한 이름과 같은 서명이 함께 저장될 때만, 예약은 정원이 남아 있을 때만(예약 수 +1과 참여 기록 변경이 한 트랜잭션), 철회는 자리 반환과 함께만 됩니다.
- 상품권 지급 처리는 발송 요청(`rewards`)이 함께 만들어질 때만 됩니다. 발송 완료 표시는 관리자만 합니다.
- 알림함과 발송 기록은 Functions만 씁니다. 관리자 지정(`admins/{uid}`)은 콘솔이나 스크립트로만 합니다.

그 밖에 Functions가 지키는 것: 한 사람에게 가는 모집 안내는 일주일에 3번까지, 연구자가 직접 쓰는 안내는 연구당 하루 3번까지, 등록 화면의 "조건에 맞는 인원"은 5명 미만이면 가리고, 대기풀 분포는 20명 이상일 때만 보여 줍니다.

## 로컬에서 실행 (에뮬레이터)

Node.js 22 이상과 Java가 필요합니다. 터미널 두 개를 씁니다.

```bash
npm install
npm --prefix functions install
npm run emulators
```

```bash
npm run seed
```

http://localhost:3000 을 열고 `로그인`을 누르면 시연 계정(참여자·연구자·관리자) 버튼이 보입니다. localhost에서 열면 실제 프로젝트가 아니라 에뮬레이터에 붙습니다. 시연 데이터는 모두 가상이고 메일·문자는 실제로 나가지 않습니다. 새로 가입해 볼 때 필요한 이메일 인증 링크는 에뮬레이터를 띄운 터미널에 출력됩니다.

- 화면 코드(`web/`)를 고치면 `npm run build`로 `public/app.js`를 다시 만듭니다.
- 테스트: 에뮬레이터를 내린 상태에서 `npm test` (규칙 테스트 8개, 매칭·검증 테스트 7개)

## 실제 Firebase 프로젝트에 올리기

**아래 절차는 실제 프로젝트에서 확인하지 못했습니다.** 이 저장소의 검증은 모두 에뮬레이터에서 했습니다.

먼저 정할 것: 이 플랫폼 전용 Firebase 프로젝트를 새로 만드는 것을 권합니다. `firebase deploy`는 그 프로젝트의 **기존 Firestore 규칙을 통째로 바꾸므로**, 다른 앱이 쓰는 프로젝트(예: 지금 `.firebaserc`와 `web/firebase-config.js`에 적힌 `koolab-33917`)에 그대로 배포하면 그 앱이 막힐 수 있습니다. 프로젝트를 바꾸려면 이 두 파일만 고치면 됩니다.

1. Firebase 콘솔에서: Firestore 데이터베이스를 **서울(asia-northeast3)** 에 만들고, Authentication에서 **이메일/비밀번호** 로그인을 켭니다. Functions를 쓰려면 Blaze(종량제) 요금제가 필요합니다.
2. Authentication > Settings > Authorized domains 에 화면을 올릴 주소(예: `koolabarchive.github.io`)를 추가합니다.
3. 규칙·색인·Functions 배포:

   ```bash
   firebase login
   firebase deploy --only firestore,functions
   ```

4. 화면 배포: `main`에 올리면 `.github/workflows/pages.yml`이 빌드해서 GitHub Pages에 올립니다(저장소 Settings > Pages > Source 를 "GitHub Actions"로). Firebase Hosting을 쓰려면 `npm run build && firebase deploy --only hosting`.
5. 관리자 지정: 콘솔의 Authentication에서 연구윤리지원팀 계정을 만든 뒤

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json ADMIN_EMAIL=... npm run create-admin
   ```

6. 메일·문자 발송: `functions/.env`에 `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `MAIL_FROM`, `SMS_API_URL`, `SMS_SENDER`를 적고, 비밀번호·키(`SMTP_PASS`, `SMS_API_KEY`)는 `firebase functions:secrets:set`으로 등록한 뒤 `functions/index.js`의 `setGlobalOptions`에 `secrets`로 추가합니다. 연결 전에는 실제로 발송되지 않고 `outbox` 컬렉션에만 쌓입니다. 가입 인증·비밀번호 재설정 메일은 Firebase Auth가 직접 보내므로 따로 설정하지 않아도 갑니다.

알아 둘 점:

- **색인**: 에뮬레이터는 복합 색인 없이도 쿼리가 돌기 때문에 `firestore.indexes.json`이 충분한지는 실제 프로젝트에서만 확인됩니다. 부족하면 브라우저 콘솔이나 Functions 로그에 색인을 만드는 링크가 나옵니다.
- **알림의 시간차**: 참여자 알림과 처리 기록, 연구의 완료 인원은 Functions가 상태 변화를 보고 뒤따라 씁니다. 화면에 반영되기까지 몇 초가 걸릴 수 있습니다.
- **비용**: Firestore는 읽은 문서 수만큼 과금됩니다. 연구자 화면은 자기 연구의 참여 기록을 전부 읽으므로(연구당 수백 건) 사용량이 늘면 화면별로 나눠 읽도록 바꿔야 합니다.
- **저장 시 암호화**: 이름·연락처·설문 응답은 Firestore에 평문으로 저장됩니다(Google의 기본 저장 암호화만 적용). 접근 통제는 규칙이 하며, 프로젝트 소유자·편집자 권한이 있는 사람은 콘솔에서 내용을 볼 수 있습니다. 콘솔 접근 권한을 최소한으로 관리해야 합니다.
- **브라우저에서 검증하는 것의 한계**: 연구 초안의 세부 형식, 문의 횟수 제한 같은 것은 화면 코드가 확인하고 규칙은 큰 틀만 확인합니다. 연구는 공개 전에 관리자 심사를 거칩니다.

## 폴더 구조

```
web/                     화면 소스
  main.js                화면 코드(그리기와 동작 연결)
  data.js                Firebase 연결: 역할별 데이터 읽기, 동작(쓰기·Functions 호출)
  firebase-config.js     프로젝트 설정(공개 식별자), 리전, 에뮬레이터 전환
public/                  배포되는 정적 파일. app.js는 빌드 결과물(npm run build)
functions/
  index.js               대기풀 집계·초대·안내 발송, 상태 변화 알림, 주기 작업
  domain.js              매칭·검증 규칙(화면과 함께 씀)
  mailer.js              이메일(SMTP)·문자 발송
firestore.rules          보안 규칙 ← 접근 통제의 전부
firestore.indexes.json   복합 색인
firebase.json            배포·에뮬레이터 설정
scripts/                 시연 데이터(에뮬레이터 전용), 관리자 지정
test/                    규칙 테스트, 매칭·검증 테스트
```

학과 목록, 관심 분야, 연구 유형 같은 선택지는 `functions/domain.js`와 `web/main.js` 맨 위의 상수를 함께 고칩니다. 규칙에도 신분·연구 유형 목록이 들어 있으니 같이 고쳐야 합니다.

## 운영 전에 해야 할 일

1. **IRB·개인정보 보호책임자 검토.** 대기풀 운영 방식, 가입 화면의 수집·이용 동의 문구, 전자동의 방식(성명 입력 서명), 동의서를 플랫폼이 보관하는 구조.
2. **외부 클라우드 보관 검토.** 참여자 정보가 Google Cloud(Firebase)에 평문으로 저장됩니다. 개인정보 처리 위탁에 해당하므로 처리방침 기재와 학교 승인이 필요합니다.
3. **학교 로고 사용 승인.** 화면에 한신대학교 엠블럼과 로고가 들어 있습니다.
4. **보상 발송 주체 결정.** 지금은 연구윤리지원팀이 상품권을 직접 보내는 구조입니다.
5. **Firebase 콘솔 권한 관리, 백업(Firestore 예약 백업), 보관 기간이 지난 자료의 폐기 절차.** 자동 폐기는 없습니다.

## 아직 없는 것

- 본인 확인은 이메일 인증뿐입니다. 학외 참여자는 한 사람이 여러 계정을 만들 수 있습니다.
- 가입 후 이름·휴대전화·출생연도·신분을 고치는 화면이 없습니다.
- 종단 연구의 회차별 일정, 상담 프로그램의 회기별 출석 관리가 없습니다. 한 번의 예약과 한 번의 설문만 다룹니다.
- 승인된 연구의 수정 요청 절차, 연구자 계정 정지·탈퇴, 관리자 2단계 인증이 없습니다.
- 문의 본문의 연락처 자동 차단, 문의 횟수 제한이 없습니다(신고로 대응).
- `scripts/create-admin.js`와 Functions의 예약 작업(`jobs`)은 에뮬레이터에서 실행해 보지 못했습니다.
