# Molecule Studio · 분자 스튜디오

분자를 직접 그리거나 SMILES/MOL로 불러와 3D 구조, 거리·각도, VSEPR 및 분광 학습 정보를 확인하는 한국어 웹앱입니다.

- React + TypeScript + Three.js 화면과 RDKit Python 계산 API
- 2D 편집 → 명시적 수소를 포함한 3D 생성 → 원자 선택·측정
- 혼성 오비탈 개념 표시, 교육용 IR/NMR/UV-Vis 범위
- 브라우저 안의 컬렉션·노트와 PNG 학습카드 저장

계산한 단일 배좌는 실험 구조와 다를 수 있습니다. 오비탈은 양자화학 계산 결과가 아니며, 분광 정보는 실측 또는 정량 분석용이 아닙니다.

설치·실행은 [사용법](docs/USER_GUIDE.md), 과학적 지원 범위는 [SCIENCE](docs/SCIENCE.md), 현재 검증·게시 상태는 [인계 기록](docs/DELIVERY.md)을 참고하세요.

## 로컬 실행

Node.js 22.12 이상과 Python 3.13에서:

```powershell
npm ci
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe api/molecule.py
```

다른 터미널에서 `npm run dev`를 실행하고 `http://127.0.0.1:5173`을 엽니다. `npm run build`로 정적 화면을 빌드합니다. 브라우저 검증은 두 서버가 실행 중이고 Microsoft Edge가 설치된 환경에서 `npm run test:browser`로 수행합니다.

## 보존된 UAISE Astra Universal v4.0.0 안내

아스트라가 방법을 선택하면서 코딩·문서·자료 분석의 완료를 확인할 수 있도록 재구축한 로컬 작업폴더입니다. v3.1.1의 완료 증거 원칙을 이어가고, 고정 역할 순회와 전 문서 선독을 제거했습니다.

시작은 START_HERE.md입니다. 늘 적용되는 행동 지침은 AGENTS.md 한 곳에 있습니다. INTENT.md는 목적, project/contract.json은 관찰 가능한 완료 조건을 담습니다. SPEC.md와 PLAN.md는 복잡도가 필요로 할 때 생성합니다.

| 구성 | 맡는 일 |
|---|---|
| AGENTS.md | 권한 범위, 지속 수행, 증거 기반 완료의 짧은 지침 |
| INTENT.md | 사용자의 문제·결과·제약 |
| project/contract.json | 산출물, 검사 명령, 내용 검토 기준 |
| tools/uaise.py | 상태 기록, 실제 검사, 결과 최신성 확인 |
| references/ROUTER.md | 필요한 분야의 참고 문서 선택 |
| examples/ | 코딩·문서·분석의 실행 가능한 작은 예시 |
| tests/ | 프레임워크를 바꿀 때 사용하는 격리 회귀검사 |

실행 시 runs/에 상태·검사 로그·완료 기록을 생성합니다. evidence/와 reviews/는 내용 검토가 있을 때 생성합니다. 기본 배포판에는 사용자 작업의 성공 기록이 없습니다.

## 바뀐 기준

기존 6개 역할 노드 순회를 working → ready → completed로 줄였습니다. 확인 실패는 working으로 돌아가고, 동일한 소스·같은 실패 기준이 반복되면 blocked가 됩니다. 작은 일은 하나의 완료 기준으로도 표현할 수 있고 복잡한 일은 필요한 기준을 추가합니다. 특정 개수의 테스트가 품질을 대신하지 않습니다.

별도 verify 없이 finish만 사용하면 검사를 한 번 실행하고 완료합니다. verify를 이미 통과했다면 finish는 파일과 증거의 해시만 확인합니다. 프레임워크 전체 검사는 제품 작업마다 자동 실행하지 않습니다.

## 실제로 강제하는 것

- 현재 작업 식별자와 전 완료 기준의 검증 방식 연결.
- 등록한 명령의 실제 종료 결과, 산출물 존재, 검토 기록의 현재 소스 결합.
- 검증 전후 파일 일치와 완료 후 소스·산출물·증거·로그 변경 탐지.
- 미검토 상태의 완료 보류, 같은 실패의 반복 제한, 상태 변경 잠금.

명령 성공은 그 명령이 검사한 범위의 근거입니다. 검사 내용의 충분성·과학적 진실·검토자의 신원은 이 도구가 자동 증명하지 않습니다. host의 권한·네트워크·파일 접근 통제는 그대로 적용됩니다. Python 검사 실행기는 보안 샌드박스가 아닙니다.

아스트라는 실행 호스트에서 선택합니다. 이 패키지의 목표 모델은 gpt-6-astra이지만 자체 모델 호출·자동 서브에이전트 생성은 없습니다. 실제 모델 선택을 감지하거나 토큰 사용을 측정한 것처럼 기록하지 않습니다.

설계 근거와 이전판 대응표는 references/DESIGN.md, 이전 작업 이식은 references/MIGRATION.md, 실제 검증 결과는 VALIDATION_REPORT.md를 확인하세요.
