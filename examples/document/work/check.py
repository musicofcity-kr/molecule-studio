from pathlib import Path
p=Path(__file__).parent
s=(p/'notice.md').read_text(encoding='utf-8')
if not s.startswith('# 안내\n') or '자료를 자료를' in s or not 20 <= len(s) <= 80:
    raise SystemExit('문서 구조·중복 단어·분량 검사 실패')
print('마크다운 제목, 중복 제거, 문서 분량을 확인했습니다. 의미 보존은 별도 검토입니다.')
