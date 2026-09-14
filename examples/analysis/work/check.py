from pathlib import Path
import csv,json
from decimal import Decimal
p=Path(__file__).parent
with (p/'input.csv').open() as f: rows=list(csv.DictReader(f))
result=json.loads((p/'result.json').read_text())
expected=sum(Decimal(r['value']) for r in rows)/Decimal(len(rows))
if result['count']!=len(rows) or Decimal(str(result['mean']))!=expected:
    raise SystemExit('원자료 대조: 개수 또는 평균 불일치')
if {r['unit'] for r in rows}!={result['unit']} or result['synthetic'] is not True:
    raise SystemExit('단위 또는 자료 출처 표시 오류')
print('원자료에서 Decimal 합계/개수로 평균을 독립 계산하고 단위·합성 표시를 확인했습니다.')
