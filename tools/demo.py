"""Create a disposable example project; never overwrite an existing folder."""
import argparse
from pathlib import Path
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('example', choices=['coding', 'document', 'analysis'])
parser.add_argument('destination', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
target = args.destination.resolve()
if target.exists() or root == target or root in target.parents:
    parser.error('기존 경로 또는 템플릿 내부를 덮어쓰지 않습니다. 새 외부 폴더를 지정하세요.')
example = root / 'examples' / args.example
if not example.is_dir():
    parser.error('원본 템플릿의 examples 폴더가 필요합니다.')
target.mkdir(parents=True)
for name in ['AGENTS.md', 'INTENT.md', 'VERSION', 'README.md', 'START_HERE.md', 'VALIDATION_REPORT.md']:
    shutil.copy2(root / name, target / name)
for name in ['tools', 'references', 'project', 'tests']:
    shutil.copytree(root / name, target / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
shutil.copytree(example, target, dirs_exist_ok=True)
print(target)
