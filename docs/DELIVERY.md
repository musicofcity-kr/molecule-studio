# Molecule Studio 인계 기록

작업 ID: `molecule-studio-public-20260914`. 2026-09-14 재개.

## 구현과 수정

SMILES/MOL/편집 그래프 입력, RDKit 3D 생성, 거리·각도, VSEPR, 오비탈 개념 표시, 교육용 분광 정보, 로컬 컬렉션·노트, PNG 저장을 구현했습니다. UAISE 원본 안내는 `docs/UAISE_FRAMEWORK.md`와 README 하단에 보존했습니다.

재개 후 독립 검토에서 VSEPR 그림의 결합수 기반 오류, 편집기 변환의 전하 손실, 빈 PNG 출력을 발견해 수정했습니다. 브라우저 러너의 숨겨진 버튼 선택과 응답 대기 오류도 수정했습니다.

## 검증 상태

- 화학 단위 테스트: 13개 통과(로컬 Windows/Python).
- TypeScript 및 생산 빌드: 통과. 최종 소스 빌드/계약 검증은 인계 전 갱신합니다.
- 브라우저: 13개 실제 조작 시나리오와 모바일 가로 넘침 확인. PNG 픽셀 내용 검사 및 최종 육안 검토를 진행 중입니다.
- 최초 실패 기록: `evidence/browser-first-resume-failure/`.
- 빈 PNG 발견 당시 기록: `evidence/browser-blank-png/`. 이 기록의 조작 PASS는 PNG 내용 검토 PASS를 의미하지 않습니다.
- 최종 로컬 증거: `evidence/browser/`.

## 게시 상태

GitHub 공개 저장소와 Vercel 운영 배포를 준비 중입니다. 공개 URL의 익명 접근 및 실제 배포 API/브라우저 동작이 확인되기 전에는 전체 완료로 처리하지 않습니다.

## 한계

과학적 지원 범위는 `SCIENCE.md`에 명시했습니다. 단일 분자역학 배좌, 규칙 기반 스펙트럼, 오비탈 개념도이며 실험·정밀 양자화학 검증을 뜻하지 않습니다. 대규모 동시 사용자 부하와 모든 물리 기기의 GPU는 검증 범위에 포함하지 않습니다.
