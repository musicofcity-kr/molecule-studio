from pathlib import Path
import subprocess
import sys
app=Path(__file__).with_name('app.py')
for value, expected in [('0','0'), ('-3','-6'), ('17','34')]:
    r=subprocess.run([sys.executable,str(app),value],text=True,encoding='utf-8',capture_output=True)
    if r.returncode != 0 or r.stdout.strip() != expected:
        raise SystemExit('실제 CLI의 결과가 예상과 다릅니다.')
r=subprocess.run([sys.executable,str(app),'invalid'],text=True,encoding='utf-8',capture_output=True)
if r.returncode != 2 or '정수' not in r.stderr:
    raise SystemExit('잘못된 입력의 오류 처리가 다릅니다.')
print('CLI 정상 3개와 실패 입력 1개를 실제 실행해 확인했습니다.')
