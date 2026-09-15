# IUPAC 이름 표시 개선 결과

## 변경된 사용 흐름

분자 구조를 먼저 표시한 뒤 IUPAC 이름을 별도로 조회합니다. 예를 들어 직접 그린 C–C–O 구조는 `에탄올`과 `IUPAC ethanol`로 표시됩니다. 확인된 일반명이 없으면 IUPAC 이름을 제목으로 사용하고, 이름을 얻지 못하면 기존 일반명 또는 분자식과 `이름 확인 불가`를 표시합니다.

- 이름 조회 중·실패에도 구조 회전, 원자 선택, 측정, 저장을 사용할 수 있습니다.
- 9초 안에 이름 응답을 받지 못하면 조회를 종료하고 재시도 버튼을 제공합니다.
- 이전 분자의 늦은 응답은 현재 분자를 덮어쓰지 않습니다. 이름만 바뀔 때 카메라·선택·측정은 유지됩니다.
- 컬렉션·학습 카드 PNG에 이름과 출처를 포함합니다. 이전 저장 자료는 불러올 때 이름을 조회하며 구조·노트·측정 기록은 유지합니다.
- 현재 이름 조회가 끝나기 전에 저장한 같은 구조의 항목에는 이름 메타데이터만 추가합니다.
- 긴 IUPAC 이름은 화면·컬렉션·카드에서 줄바꿈하고 PNG 파일명은 길이를 제한합니다.

## 이름의 근거와 범위

IUPAC 이름은 [PubChem PUG-REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest)의 응답을 사용합니다. IUPAC 이름을 자체 생성하거나 임의로 번역하지 않습니다. 한국 일반명 표는 물·에탄올·카페인·아스피린의 정확히 일치하는 구조를 지원하며, 기존의 의미 있는 입력 이름도 표시명으로 유지합니다. 입력 이름이나 파일명은 IUPAC 이름으로 취급하지 않습니다.

SMILES를 form POST로 전송하고 `same_stereo_isotope` 동일성 조회 결과의 구조를 RDKit의 입체정보 포함 canonical SMILES로 다시 대조합니다. 반환 구조가 다르거나 여러 후보가 나오면 이름을 채택하지 않습니다. 출처 링크는 검증된 양의 정수 CID로 생성합니다. 참고: [IUPAC Chemistry Cookbook: 구조 조회와 동일성](https://iupac.github.io/WFChemCookbook/datasources/pubchem_pugrest3.html).

등록되지 않은 구조, 표준화 후 구조 불일치, 외부 서비스 장애에서는 이름을 제공하지 못할 수 있습니다. PubChem의 등록 IUPAC 필드를 보여주는 기능이며 모든 분자의 유일한 선호 IUPAC 이름을 산출하는 명명 엔진은 아닙니다.

## 구현 경계

기존 `POST /api/molecule`의 구조 계산에 외부 이름 조회를 추가하지 않았습니다. 별도 `POST /api/molecule?lookup=name`이 `{smiles}`를 받아 이름 상태와 출처를 반환합니다. 기존 입력 크기·원자·결합 한도를 재사용합니다.

외부 호출 타임아웃은 최대 5초이며 응답 크기와 프로세스 내 요청 빈도를 제한합니다. 성공은 15분, 미등록 결과는 60초 동안 최대 128개 캐시에 보존하고 일시 실패는 캐시하지 않습니다. 캐시와 요청 제한은 프로세스별이며 전체 서버 인스턴스를 합친 전역 제한을 보장하지 않습니다. [요청 제한 근거](https://iupac.github.io/WFChemCookbook/datasources/pubchem_pugrest1.html).

이름 조회를 위해 구조 SMILES를 PubChem에 전송한다는 점을 사용법 문서에 반영했습니다. 노트와 측정 기록은 이름 조회에 포함하지 않습니다.

## 검증 결과와 증거

증거 루트: `evidence/iupac-20260915/`.

| 검사 | 확인한 결과 | 증거 |
|---|---|---|
| 생산 빌드·타입 검사 | 통과; 기존 Three.js 청크 크기 경고 유지 | 완료 기록 및 UAISE 검증 로그 |
| 화학·이름 단위검사 | 27개 통과; 이름 서비스의 비정상 응답·입체정보·재시도는 mock 검사 | UAISE 검증 로그 |
| 실제 PubChem 조회 | 6개 SMILES와 직접 그린 C–C–O 구조, 총 7개 통과 | `local-api/api-check.json` |
| 기존 브라우저 | 최종 생산 빌드에서 23개 통과, 페이지 오류 0개 | `local-existing-final/browser-check.json` |
| 이름 브라우저 | 6개 모두 통과; 최종 5개와 카메라 1개 별도 실행을 합친 결과 | `local-naming-final/browser-naming-regression.json`, `local-naming-camera/browser-naming-regression.json` |
| PNG·모바일 | 일반명/IUPAC/출처/거리 기록과 390px 긴 이름 레이아웃 확인 | `local-naming-final/` |

이름 브라우저 회귀는 실제 구조 API와 통제한 이름 응답을 조합합니다. 순서 역전·조회 실패·재시도를 재현하기 위한 mock이며 실제 PubChem 성공의 근거는 별도 API 기록입니다. 긴 이름 화면도 레이아웃 검사용 합성 이름입니다.

공개 사이트는 https://molecule-studio-ee6n.vercel.app/ 입니다. 최종 공개 커밋, Vercel 상태, 공개 API·브라우저 확인 결과와 파일 해시는 `evidence/iupac-20260915/completion-evidence.json`에 기록합니다. 공개 조회 증거는 `production-api/`, `production-naming/`, `production-live/`에 구분합니다.

## 최초 실패와 수정

1. PubChem은 IsomericSMILES 요청에 현재 `SMILES` 키로 응답했습니다. 실제 응답을 확인하여 지원했고 입체정보 없는 CanonicalSMILES를 대신 쓰지 않습니다.
2. 기존 저장 자료 검사가 새 이름 정보 추가까지 오류로 판정했습니다. 이름 메타데이터만 분리하고 원래 구조·과학정보·노트·측정은 엄격한 동등성 비교를 유지했습니다.
3. 새 회귀의 상태 문구가 화면과 숨겨진 PNG 카드에 중복되어 선택자 오류가 발생했습니다. 화면 패널로 검색 범위를 한정했습니다.
4. 카메라 검사의 포인터 위치가 스크롤 상태의 영향을 받았습니다. 뷰어를 화면으로 이동한 후 실제 회전·확대와 투영 좌표 변화를 확인하고 이름 응답 뒤 위치를 비교했습니다.

최초 실패 기록은 삭제하지 않았습니다. `local-naming-final`의 전체 passed 값은 카메라 최초 실패 때문에 false이며, 해당 항목의 성공은 별도 `local-naming-camera` 기록으로 확인합니다.

## 담당과 한계

Astra가 통합·최종 실행·공개 반영을 맡았습니다. Terra가 이름 API와 단위검사를, Sol이 화면·저장 흐름과 최종 브라우저 회귀를, Luna가 초기 검사·보고서 초안과 시각 검토를 맡았습니다. Sol은 백엔드, Terra는 프론트 상태 흐름을 교차 검토했습니다.

검증은 격리된 Chrome/Edge와 모바일 크기 뷰포트에서 수행합니다. 모든 실제 기기·분자·접근성 항목에 대한 보증은 아닙니다. 현재 카메라·측정 검사의 합성 지연은 서비스 성능 측정값이 아닙니다.
