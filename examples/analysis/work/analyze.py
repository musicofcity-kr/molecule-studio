from pathlib import Path
import csv,json,statistics
p=Path(__file__).parent
with (p/'input.csv').open() as f: rows=list(csv.DictReader(f))
result={'count':len(rows),'mean':statistics.mean(float(r['value']) for r in rows),'unit':'unitless','synthetic':True}
(p/'result.json').write_text(json.dumps(result,indent=2)+'\n')
