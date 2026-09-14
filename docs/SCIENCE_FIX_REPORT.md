# Molecule Studio 과학 설명 수정 보고서

작업 ID: `molecule-studio-science-brief-20260914` · 재개일: 2026-09-15.
요청 기준: `Molecule_Studio_Codex_Fix_Brief.md`의 필수 P0·P1. 어제 남아 있던 구현을 검토하고 현재 빌드로 검증했습니다.

## 항목별 상태

| 항목 | 상태 | 확인한 결과 |
| --- | --- | --- |
| CHEM-01 | 수정 완료 | CO₂의 IR·¹³C NMR·UV–Vis에 케톤 기본값이나 임의 수치를 배정하지 않음. 실제 아세톤·알데하이드·산·에스터·아마이드는 구분 유지. |
| CHEM-02 | 수정 완료 | RDKit 원시 HBD/HBA를 보존하고 역할·부위 수·실제 결합 수를 구분. 물의 주개·받개 역할과 원시 0/0의 정의·버전·함수·수소 처리를 설명. |
| CHEM-03 | 수정 완료 | 모델 좌표 측정값, 전자영역 이상각, 물 전용 NIST 평형 참고값을 화면·카드에서 구분. 에탄올에 물 참고값을 적용하지 않음. |
| SPEC-01 | 수정 완료 | 공통 컴포넌트로 구간 막대·단위·한국어 한계 표시. 단일 피크 위치·강도·적분·원자 개수 추정치를 제공하지 않음. 자료 미지원·해당 원자 없음·범위 미제공을 구분. |
| UX-01 | 수정 완료 | 한국어 오류와 이전 결과 안내. 동일 구조 노트 보존, 재분석 시 과거 좌표 측정 초기화, 구형 컬렉션 원본 보존, 늦은 응답 덮어쓰기 방지. |

위 상태는 구현·로컬·공개 사이트 검증을 반영합니다. 게시한 앱 소스와 검증 범위는 아래에 기록합니다.

## 원인과 변경 파일

- `chemistry/functional_groups.py: carbonyl_kind`를 추가했습니다. 기존 `chemistry/spectra.py`의 포괄적인 C=O 분기가 CO₂를 케톤 범위에 연결하던 원인입니다. 이제 이웃 원소·결합 차수·전하·수소 수로 분류하고 IR·NMR·UV–Vis에서 같은 분류를 사용합니다.
- `chemistry/education.py`는 `hydrogen_bonding`, `geometry_reference`를 제공합니다. `chemistry/model.py`의 원시 Lipinski 계산은 유지하고 출처 메타데이터·한국어 오류·`analysisVersion: 2`를 추가했습니다. SMILES 원자가 오류는 RDKit의 실제 오류 종류로 구분합니다.
- `chemistry/vsepr.py`의 `idealAngles`를 전자영역 이상각으로 통일했습니다. 물의 104.4776°는 별도 참고값입니다. ETKDG·힘장 좌표를 외부 숫자로 덮어쓰지 않습니다. 아마이드 질소 등 미지원 판정도 유지합니다.
- `chemistry/spectra.py`는 범위와 설명만 반환합니다. 호환 필드명 `peaks`는 유지하지만 위치·강도·개수 필드는 제거했습니다.
- `src/components/ScienceNotes.tsx`, `SpectrumRanges.tsx`를 화면과 학습 카드가 공유합니다. `Spectra.tsx`, `src/types.ts`, `src/styles.css`, `src/App.tsx`, `src/lib/education.ts`에 범위 표시·자료 상태·구형 데이터 보호를 연결했습니다.
- `app_tests/test_science_brief.py`, `test_chemistry.py`, `scripts/science-browser-cases.mjs`, `browser-check.mjs`에 관련 과학·브라우저 회귀 검증을 반영했습니다. `docs/SCIENCE.md`의 이전 설명도 현재 구현에 맞게 갱신했습니다.

## 검증 결과

증거 루트: `evidence/science-brief/resume-20260915/`. 최초 재현 자료는 `evidence/science-brief/baseline.json`, 어제 통과 기록은 `evidence/science-brief/local-first/`에 보존했습니다.

| 검증 | 결과 |
| --- | --- |
| `.venv/Scripts/python.exe -X utf8 -B -m unittest discover -s app_tests -p "test_*.py" -v` | 19/19 통과 |
| `npm run build` | TypeScript·생산 번들 통과. Three.js 500 kB 초과 경고는 남음. |
| `BASE_URL=http://127.0.0.1:4173 EVIDENCE_DIR=evidence/science-brief/resume-20260915/local-verified node scripts/browser-check.mjs` | 23/23 통과, 페이지 미처리 오류 0건. 2026-09-15 08:17:25–08:18:28 KST. |
| 독립 검토 | 과학 구현 및 오늘 생성한 데스크톱·모바일 화면/물·아세톤 PNG 직접 검토. 전달을 막을 중대한 결함 없음. |

환경 변수 표기는 설명용입니다. PowerShell에서는 `$env:BASE_URL`과 `$env:EVIDENCE_DIR`를 설정한 뒤 명령을 실행했습니다.

### 주요 입력과 결과

- `O=C=O`: CO₂, 중심 탄소 AX2/직선형/180° 유지. 케톤·212.5 ppm 제거. IR·¹³C NMR·UV–Vis는 규칙 미지원, ¹H NMR은 해당 원자 없음.
- `CC(=O)C`: 케톤 ¹³C 참고 범위 205–220 ppm 유지. 화면과 카드의 범위 일치.
- `CC=O`, `CC(=O)O`, `CC(=O)OC`, `CC(=O)N`: 각각 알데하이드·산·에스터·아마이드. 비케톤에 케톤 범위 없음. 아마이드 질소 VSEPR 판정 보류.
- `O`, `[H]O[H]`: 원시 HBD/HBA 0/0. `CCO`는 1/1, `COC`는 0/1, `CC(=O)N`은 1/1. 같은 RDKit 함수와 비교해 확인.
- 물의 API 좌표 재계산: O–H `0.9690004418125929 Å`, H–O–H `103.97799797429015°`. UI `0.97 Å`, `104.0°`는 그 좌표의 반올림값. 별도 전자영역 이상각 109.5° 및 NIST 평형 참고값 104.4776°/0.958 Å와 구분.
- `C(C)(C)(C)(C)C`: HTTP 400, 원자 ID 0의 원자가 오류 안내. 이전 정상 결과임을 명시하며 성공 재입력 시 오류 제거.
- 물·에탄올·카페인·아스피린 예제, 2D 벤젠→실제 API→MOL 파일 재입력, 회전·확대·직접 원자 선택·H/라벨·오비탈 개념도, 거리/각도→노트→컬렉션→새로고침, 의미 있는 PNG 및 모바일 흐름 통과.
- 구형 컬렉션과 지연 응답은 통제한 테스트 자료로 검증했습니다. 실제 사용자의 저장소 데이터를 변경하지 않았습니다.

### 초기 실행 실패와 복구

제한 환경에서 Vite와 Edge의 자식 프로세스 실행이 `EPERM`으로 거부됐습니다. 각각 `build.log`, `local-browser/browser-check.json`을 보존했습니다. 허용된 환경의 동일 빌드와 브라우저 검사에서 통과했으므로 이 실패는 제품 기능 결함으로 분류하지 않습니다. 로컬 서버 시작의 PATH/Path 충돌도 허용 환경에서 해소됐습니다.

## 게시 상태

- GitHub: https://github.com/musicofcity-kr/molecule-studio · 앱 수정 커밋 `624773e6a5f3049ad8403b29e3d753488c3f642a`.
- 공개 사이트: https://molecule-studio-ee6n.vercel.app/ · 연결된 [Vercel 배포](https://vercel.com/musicofcity-krs-projects/molecule-studio-ee6n/HJB2HcwdzFLyBxpaju4GMfGuFdMY). GitHub Vercel 상태 `success`와 실제 익명 HTTPS/API를 모두 확인했습니다.
- 공개 HTML이 참조하는 JS·CSS 3개를 로컬 생산 빌드와 바이트 단위로 대조해 일치를 확인했습니다. `/api/molecule` HTTP 200, RDKit `2026.03.6`, 필수 예제 분자 9개 실제 POST 통과. 근거: `live-source-check.json`.
- 공개 브라우저 23/23 통과, 페이지 미처리 오류 0건. **2026-09-15 08:26:54–08:28:01 KST**. 로컬과 동일한 측정·구형 저장 데이터·MOL·모바일·최종 PNG 검사를 실행했습니다. 근거: `production/browser-check.json`과 같은 폴더의 화면·학습 카드.
- 최종 보고서/사용 안내의 후속 문서 커밋은 앱 소스를 변경하지 않습니다. 마지막 커밋·원격 일치·재배포 확인은 `completion-evidence.json`에 기록합니다.
- 현재 연결된 Vercel 도구의 프로젝트 조회는 404를 반환했습니다. 비공개 런타임 로그의 전체 오류 집계는 미검증입니다. 빌드 상태만으로 성공을 판단하지 않고 GitHub의 배포 상태, 공개 파일 내용, 실제 API·브라우저로 적용 결과를 확인했습니다.

## 과학 근거와 남은 제한

- [IUPAC 케톤 정의](https://goldbook.iupac.org/terms/view/K03386/plain), [RDKit 2026.03.6 HBD/HBA 공식 구현](https://raw.githubusercontent.com/rdkit/rdkit/Release_2026_03_6/Code/GraphMol/Descriptors/Lipinski.cpp), [NIST 물 평형 구조](https://cccbdb.nist.gov/expgeom2x.asp?casno=7732185)를 독립 검토에서 확인했습니다.
- 검증 브라우저는 Edge headless/SwiftShader입니다. 데스크톱 1440×1000, 모바일 뷰포트 390×844이며 실물 모바일·물리 GPU 검증은 미검증입니다.
- 공개 배포의 물·아세톤·모바일 PNG를 독립적으로 직접 열어 주요 내용과 출력 상태를 확인했습니다. 모바일 카드의 3D 그림에서 양쪽 수소 구체 가장자리가 일부 잘리는 작은 출력 문제는 남습니다. 해석과 조작을 막지 않아 사용자의 경미한 버그 허용 지침에 따라 후속 개선으로 남겼습니다.
- 단일 분자역학 배좌, 제한된 작용기 규칙, 넓은 분광 참고 범위, 오비탈 개념도입니다. 실측 스펙트럼·정밀 양자계산·동시 사용자 부하 검증을 뜻하지 않습니다.
- CO₂ 전용 분광값과 케텐·산 할로젠화물·카복실레이트·산 무수물 등의 미지원 환경은 보수적으로 판정을 보류합니다.
- P2 기본/심화 모드·탐구 노트 구조화·추가 가독성 개선·비교 학습은 이번 필수 범위에 추가하지 않은 선택적 후속안입니다.
