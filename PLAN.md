# 역할과 순서

- Astra: 범위·인터페이스·의존성·통합·브라우저 QA·GitHub/Vercel 게시·UAISE 증거.
- SOL: `api/`, `chemistry/`, 과학 근거와 backend tests.
- TERRA: App, 2D 편집기, 분광 UI, 메모와 이미지 저장, 반응형 CSS.
- LUNA: Three.js 뷰어, 원자 선택과 3D 측정, 오비탈 개념도.

공통 타입을 고정하고 다른 파일에서 병행 구현한다. 통합 빌드와 실제 입력·측정·저장·모바일 검사를 수행한다. 검사 통과 코드를 GitHub에 게시한다.

2026-09-14 후속 수정: 사용자가 연결한 Vercel의 함수 용량 초과를 처리한다. science_review가 빌더의 설치·포함 경로를 읽기 전용으로 조사하고, 메인이 중복 설치 폴더 제외·로컬 검증·GitHub 반영·실제 연결 배포 검증을 담당한다. 검증된 범위만 `tools/uaise.py finish`로 확정한다.
