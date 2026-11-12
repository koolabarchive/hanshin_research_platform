// Firebase 프로젝트 연결 설정. 이 값들은 브라우저에 공개되는 식별자이며 비밀이 아니다.
// (접근 통제는 firestore.rules 가 한다.) 프로젝트를 새로 만들면 이 객체만 바꾸면 된다.
export const firebaseConfig = {
  apiKey: "AIzaSyDPaYAv0CsX0uYK28poPO9hUcvFhSs6cjY",
  authDomain: "hsresearch-d0c1a.firebaseapp.com",
  projectId: "hsresearch-d0c1a",
  storageBucket: "hsresearch-d0c1a.firebasestorage.app",
  messagingSenderId: "84245262808",
  appId: "1:84245262808:web:6eba01e622656f785202ad",
};

// Functions와 Firestore 리전(서울).
export const REGION = "asia-northeast3";

// 내 컴퓨터(localhost)에서 열면 실제 프로젝트 대신 에뮬레이터에 붙는다. 시연 계정 버튼도 이때만 보인다.
export const EMULATOR = ["localhost", "127.0.0.1"].includes(location.hostname);
export const EMULATOR_PROJECT = "demo-hsrp";
