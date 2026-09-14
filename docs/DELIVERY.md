# Molecule Studio 인계 기록

작업 ID: `molecule-studio-public-20260914`. 2026-09-14 재개.

## 구현과 수정

SMILES/MOL/편집 그래프 입력, RDKit 3D 생성, 거리·각도, VSEPR, 오비탈 개념 표시, 교육용 분광 정보, 로컬 컬렉션·노트, PNG 저장을 구현했습니다. UAISE 원본 안내는 `docs/UAISE_FRAMEWORK.md`와 README 하단에 보존했습니다.

재개 후 독립 검토에서 VSEPR 그림의 결합수 기반 오류, 편집기 변환의 전하 손실, 빈 PNG 출력을 발견해 수정했습니다. 브라우저 러너의 숨겨진 버튼 선택과 응답 대기 오류도 수정했습니다.

## 검증 상태

- 화학 단위 테스트: 13개 통과(로컬 Windows/Python).
- TypeScript 및 생산 빌드: 최종 소스 통과.
- 브라우저: 13/13 통과, uncaught page error 0개. 마지막 검증 완료 시각은 `2026-09-14T02:06:24.522Z`입니다. 실제 원자 클릭, 물의 O-H 거리 0.97 Å 및 H-O-H 각도 104.0°, 전하 보존, 그리기→3D, 컬렉션, 모바일 및 PNG 내용 검사를 포함합니다.
- 독립 화면/PNG 검토: PASS. 데스크톱·모바일 화면과 두 PNG에서 한글·2D·3D·분광선·계산 한계를 실제로 확인했습니다.
- 최초 실패 기록: `evidence/browser-first-resume-failure/`.
- 빈 PNG 발견 당시 기록: `evidence/browser-blank-png/`. 이 기록의 조작 PASS는 PNG 내용 검토 PASS를 의미하지 않습니다.
- 최종 로컬 증거: `evidence/browser/`.

## 게시 상태

- GitHub 공개 소스: https://github.com/musicofcity-kr/molecule-studio
- 검증한 앱 소스 커밋: `082dcb03ca03626085dad10f0e1e80e9e7415d67`. 원격 `main`과 대조했습니다. 후속 인계 문서 커밋은 이 소스를 바꾸지 않습니다.
- Vercel 운영 배포: **미완료 — API 403, 운영 배포 생성 권한 부족**. 실제 오류: `You don't have permission to create a Production Deployment for this project.`
- 최초 연결 도구가 반환한 배포 ID/주소는 배포 조회·빌드 로그·공개 HTTP에서 404/DEPLOYMENT_NOT_FOUND였으므로 성공 증거로 채택하지 않았습니다.
- 배포 권한이 있는 Vercel 연결을 확보한 뒤 배포하고, 익명 공개 URL·배포된 `/api/molecule`·주요 브라우저 흐름을 검증해야 합니다. 이 단계가 끝나기 전에는 계약 전체 완료로 처리하지 않습니다.
- 상세 장애물: `evidence/publication.json`. 로컬 계약 검증 결과와 로그: `runs/state.json`의 `verification` 경로. 인계 시 `finish`를 실행하되, AC-PUBLISH 미충족이면 `completed:false`로 보존합니다.

## 한계

과학적 지원 범위는 `SCIENCE.md`에 명시했습니다. 단일 분자역학 배좌, 규칙 기반 스펙트럼, 오비탈 개념도이며 실험·정밀 양자화학 검증을 뜻하지 않습니다. 대규모 동시 사용자 부하와 모든 물리 기기의 GPU는 검증 범위에 포함하지 않습니다.
