# 실행 예시

완성된 작은 합성 예시를 새 폴더로 복사해 완료 도구를 시험할 수 있습니다.

```bash
python tools/demo.py coding ../uaise_demo_coding
python tools/uaise.py --root ../uaise_demo_coding start
python tools/uaise.py --root ../uaise_demo_coding finish
```

analysis와 document도 같은 방식으로 만듭니다. 문서 예시는 의미 검토가 있어 첫 finish가 pending으로 끝납니다. 실제 source.md와 notice.md를 읽고 검토 근거를 evidence/에 작성한 뒤 review 명령으로 기록합니다. 검토를 하지 않은 상태를 자동 PASS로 만들지 않습니다.

analysis의 재생성은 새 예제 폴더에서 `python work/analyze.py`로 수행하고, 그 뒤 finish로 원자료를 대조합니다. 각 예제는 독립 환경에서 실행하는 표준 라이브러리 코드입니다.
