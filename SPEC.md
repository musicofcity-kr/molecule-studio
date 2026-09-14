# Molecule Studio

Vite + React + TypeScript 정적 UI와 Vercel Python `/api/molecule` 함수로 구성한다. RDKit이 SMILES/MOL/편집 그래프를 검증하고 명시적 수소를 포함하는 단일 3D conformer를 생성한다. 공통 계약은 `src/types.ts`이다. Three.js 측정은 모델 좌표(Å)에 근거하며 카메라와 무관하다.

사용 흐름: 분자 입력/그리기 → 3D 생성 → 원자 선택/측정 → VSEPR·분광 참고 → 메모·컬렉션·PNG 저장. 반응형 UI와 접근 가능한 버튼, 오류와 미지원 안내를 제공한다.

구조는 ETKDG와 분자역학을 이용한 한 가지 모형이다. 실험적 기하·배좌 분포·용매 효과를 증명하지 않는다. 오비탈은 혼성 개념도이며 HOMO/LUMO 계산 결과가 아니다. 스펙트럼은 기능기/원자 환경에 따른 교육용 범위이며 실측·정량 분석 결과로 표시하지 않는다. 미지원 UV-Vis/NMR 값을 만들어내지 않는다.

GitHub 공개 소스 이름은 `molecule-studio`이다. Vercel 공개 배포는 2026-09-14 사용자 지시로 보류한다. 이번 완료 범위는 로컬 앱 동작·내용 검증 및 GitHub 공개 소스 게시까지이다. 추후 배포를 다시 요청받으면 계정 권한과 실제 원격 HTTP·API·브라우저 동작을 별도로 확인한다.
