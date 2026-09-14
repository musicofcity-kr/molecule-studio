# 완료 계약

project/contract.json은 이번 작업의 완료 조건을 실행 가능한 형태로 보관합니다. 사용자의 요청에 없는 목표를 추가해 작업을 늘리지 않습니다. 입력 파일과 목적은 INTENT.md, 자세한 요구사항은 필요할 때 SPEC.md에 둡니다.

| 필드 | 의미 |
|---|---|
| schema_version | 4.0 |
| task_id | 이번 요청의 식별자 |
| request_reference | 사용자의 실제 요청을 가리키는 간단한 근거; 승인 증명서가 아님 |
| permissions.local_checks | 이 작업에서 등록된 로컬 검사 명령 실행 허용 여부 |
| source_paths | 소스·입력 자료·의존성 명세·검사 파일 등 결과에 영향을 주는 경로 |
| deliverables | 실제 인계할 비어 있지 않은 파일 경로 |
| checks | id, argv, 선택 cwd, timeout_seconds를 가진 실제 검사 명령 |
| acceptance | id, criterion, method로 정의한 완료 조건 |
| limits | 필요할 때 총 검사 시간·같은 실패 반복 횟수 설정 |

method=command는 check_ids로 하나 이상의 등록 검사를 연결합니다. method=review는 reviewer=agent 또는 human으로 내용 검토를 연결합니다. 모든 기준을 충족해야 완료하며, 모든 검사 명령은 적어도 한 기준에 연결되어야 합니다.

argv는 쉘 문자열이 아닌 인수 배열입니다. {python}은 실행 중인 Python으로 바뀝니다. 프로젝트 가상환경이 필요하면 그 Python으로 실행합니다. 다른 실행 파일은 argv의 첫 인수에 지정합니다. 쉘 자체를 명령으로 등록할 때의 영향도는 프로젝트 담당자가 확인합니다.

경로는 작업폴더 내부 상대 경로이며 Windows에서도 /를 씁니다. 디렉터리를 source_paths에 지정하면 파일의 추가·삭제도 감지합니다. 가상환경·node_modules·Python 캐시는 제외합니다. 실제 소스를 이 제외 경로에 두지 않습니다. 산출물은 미리 생성하고 검사는 읽어서 확인합니다. 검사 중 소스나 산출물을 다시 쓰면 완료를 거부합니다. 검사 로그는 runs/에 생성합니다.

INTENT.md·AGENTS.md·완료 계약·tools/ 및 존재하는 SPEC.md는 자동으로 소스 해시에 포함합니다. 외부 서비스·원격 DB·환경 변수의 변화는 파일 해시로 감지할 수 없습니다. 그 결과가 변할 수 있는 작업은 verify를 명시적으로 다시 실행하거나 필요한 입력 스냅샷을 source_paths에 포함합니다.

## 내용 검토

실제 열람·렌더링·계산 대조 등으로 검토한 근거를 evidence/에 기록한 뒤 실행합니다.

```bash
python tools/uaise.py review AC-READ --result pass --evidence evidence/review.md --reviewer agent --reference "실제 열람한 파일과 확인 내용"
python tools/uaise.py finish
```

human을 요구하는 기준은 실제 사용자의 검토 결과를 받은 경우에만 기록합니다. AI가 사람의 이름이나 승인을 만들어 입력하지 않습니다. 로컬 기록의 검토자 정보는 신고된 출처이며 신원 인증은 아닙니다. 평가·고위험 의사결정의 실제 승인 체계는 별도 시스템이 담당해야 합니다.

검토가 누락되면 pending(종료 코드 2), 명령·내용 실패는 fail(1), 성공은 0입니다. 형식·권한·경로 오류도 1입니다. 현재 파일과 다른 오래된 검토는 새 검토가 필요합니다.

실행 명령 성공만으로 내용 검토를 대체하거나, 형식 검사 하나를 의미가 다른 여러 기준에 연결해 품질을 과장하지 않습니다. 예제는 각 examples/의 계약을 확인하세요.
