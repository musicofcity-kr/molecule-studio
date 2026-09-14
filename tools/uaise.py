"""UAISE Astra: local completion records, not a model runner or security sandbox."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import signal
import subprocess
import sys
from uuid import uuid4

VERSION = '4.0.0'
TARGET_MODEL = 'gpt-6-astra'
IGNORED = {'.git', '.venv', 'venv', 'node_modules', '__pycache__',
           '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache'}
RESERVED = {'runs', 'evidence', 'reviews'}
DEFAULT_ROOT = Path(__file__).resolve().parents[1]


class Invalid(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def local(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise Invalid('경로는 /를 사용하는 프로젝트 내부 상대 경로여야 합니다.')
    p = Path(relative)
    if p.is_absolute() or PureWindowsPath(relative).is_absolute() or '..' in p.parts:
        raise Invalid('프로젝트 밖 경로는 허용하지 않습니다: ' + relative)
    candidate = root / p
    for ancestor in [candidate, *candidate.parents]:
        if ancestor == root:
            break
        if ancestor.is_symlink():
            raise Invalid('심볼릭 링크 경로는 지원하지 않습니다: ' + relative)
    try:
        candidate.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise Invalid('프로젝트 밖 경로입니다: ' + relative) from exc
    return candidate


def text_value(value, label):
    if not isinstance(value, str) or not value.strip() or '[작성' in value or value.strip() in {'TODO', 'TBD'}:
        raise Invalid(label + ': 실제 내용을 입력하세요.')
    return value


def path_list(root, values, label):
    if not isinstance(values, list) or not values:
        raise Invalid(label + ': 한 개 이상의 경로가 필요합니다.')
    if len(values) != len(set(str(v) for v in values)):
        raise Invalid(label + ': 경로가 중복됩니다.')
    for value in values:
        p = local(root, value).relative_to(root)
        if not p.parts or p.parts[0] in RESERVED or any(x in IGNORED for x in p.parts):
            raise Invalid(label + ': 전체 루트·실행 기록·캐시는 지정할 수 없습니다.')


def contract(root):
    value = read(root / 'project/contract.json')
    if not isinstance(value, dict) or value.get('schema_version') != '4.0':
        raise Invalid('contract.schema_version은 4.0이어야 합니다.')
    text_value(value.get('task_id'), 'task_id')
    text_value(value.get('request_reference'), 'request_reference')
    path_list(root, value.get('source_paths'), 'source_paths')
    path_list(root, value.get('deliverables'), 'deliverables')
    permissions = value.get('permissions')
    if not isinstance(permissions, dict) or type(permissions.get('local_checks')) is not bool:
        raise Invalid('permissions.local_checks는 true 또는 false여야 합니다.')
    checks = value.get('checks')
    acceptance = value.get('acceptance')
    if not isinstance(checks, list) or not isinstance(acceptance, list) or not acceptance:
        raise Invalid('checks 배열과 비어 있지 않은 acceptance 배열이 필요합니다.')
    ids = set()
    for check in checks:
        if not isinstance(check, dict):
            raise Invalid('각 check는 object여야 합니다.')
        name = text_value(check.get('id'), 'check.id')
        if name in ids:
            raise Invalid('check.id 중복: ' + name)
        ids.add(name)
        argv = check.get('argv')
        if not isinstance(argv, list) or not argv or not all(isinstance(a, str) and a for a in argv):
            raise Invalid('check.argv는 실행 파일과 인수의 배열이어야 합니다.')
        local(root, check.get('cwd', '.'))
        timeout = check.get('timeout_seconds', 120)
        if type(timeout) is not int or not 1 <= timeout <= 3600:
            raise Invalid('timeout_seconds는 1~3600 정수여야 합니다.')
    criteria = set()
    used_checks = set()
    for criterion in acceptance:
        if not isinstance(criterion, dict):
            raise Invalid('각 acceptance는 object여야 합니다.')
        name = text_value(criterion.get('id'), 'acceptance.id')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', name) or name in criteria:
            raise Invalid('acceptance.id는 중복 없는 영문·숫자·-·_ 식별자여야 합니다.')
        criteria.add(name)
        text_value(criterion.get('criterion'), 'criterion')
        method = criterion.get('method')
        if method == 'command':
            refs = criterion.get('check_ids')
            if not isinstance(refs, list) or not refs or not all(isinstance(x, str) and x in ids for x in refs):
                raise Invalid(name + ': 실제 check_ids를 연결하세요.')
            used_checks.update(refs)
        elif method == 'review':
            if criterion.get('reviewer') not in {'agent', 'human'}:
                raise Invalid(name + ': reviewer는 agent 또는 human이어야 합니다.')
        else:
            raise Invalid(name + ': method는 command 또는 review이어야 합니다.')
    if ids - used_checks:
        raise Invalid('완료 기준에 연결되지 않은 검사: ' + ', '.join(sorted(ids - used_checks)))
    limits = value.get('limits', {})
    if not isinstance(limits, dict):
        raise Invalid('limits는 object여야 합니다.')
    for key, default, maximum in [('max_no_progress_attempts', 2, 10), ('total_check_seconds', 600, 7200)]:
        n = limits.get(key, default)
        if type(n) is not int or not 1 <= n <= maximum:
            raise Invalid(key + ': 범위 안의 양의 정수가 필요합니다.')
    return value


def snapshot(root, value):
    files = {}
    paths = ['AGENTS.md', 'INTENT.md', 'project/contract.json', 'tools']
    if (root / 'SPEC.md').exists():
        paths.append('SPEC.md')
    paths += value['source_paths'] + value['deliverables']
    for relative in paths:
        p = local(root, relative)
        if not p.exists():
            raise Invalid('검증 대상이 없습니다: ' + relative)
        count = 0
        for item in ([p] if p.is_file() else sorted(p.rglob('*'))):
            name = item.relative_to(root)
            if any(part in IGNORED for part in name.parts):
                continue
            item = local(root, name.as_posix())
            if item.is_file():
                files[name.as_posix()] = file_hash(item)
                count += 1
        if not count:
            raise Invalid('검증 경로에 파일이 없습니다: ' + relative)
    for relative in value['deliverables']:
        p = local(root, relative)
        if not p.is_file() or p.stat().st_size == 0:
            raise Invalid('deliverables에는 실제 비어 있지 않은 파일을 지정하세요: ' + relative)
    return dict(sorted(files.items()))


def state(root):
    p = root / 'runs/state.json'
    if not p.exists():
        return {'status': 'idle', 'run_id': None}
    result = read(p)
    if not isinstance(result, dict) or result.get('status') not in {'working', 'ready', 'blocked', 'completed'}:
        raise Invalid('실행 상태가 손상되었습니다.')
    return result


def save_state(root, value):
    value['updated_at'] = now()
    write(root / 'runs/state.json', value)


def event(root, kind, detail=None):
    directory = root / 'runs'
    directory.mkdir(exist_ok=True)
    # Event messages contain no original prompts, command output, or review text.
    with (directory / 'events.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps({'at': now(), 'event': kind, **(detail or {})}, ensure_ascii=False) + '\n')


@contextmanager
def lock(root):
    directory = root / 'runs'
    directory.mkdir(exist_ok=True)
    p = directory / 'operation.lock'
    try:
        fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise Invalid('다른 실행이 작업 중입니다. 종료된 프로세스의 잠금은 references/OPERATIONS.md를 확인하세요.') from exc
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump({'pid': os.getpid(), 'created_at': now()}, f)
        yield
    finally:
        p.unlink(missing_ok=True)


def start(root, new_run=False):
    value = contract(root)
    intent = (root / 'INTENT.md').read_text(encoding='utf-8-sig')
    text_value(intent, 'INTENT.md')
    s = state(root)
    if s['status'] != 'idle':
        if not new_run:
            if s['status'] == 'completed':
                raise Invalid('완료 기록이 있습니다. 새 요청은 start --new-run으로 시작하세요.')
            if s.get('task_id') != value['task_id']:
                raise Invalid('작업 식별자가 바뀌었습니다. 새 요청은 start --new-run을 사용하세요.')
            return s
        write(root / 'runs/history' / (s['run_id'] + '.json'), s)
    s = {'status': 'working', 'run_id': uuid4().hex, 'task_id': value['task_id'],
         'started_at': now(), 'verification': None, 'failed_verifications': 0,
         'no_progress_attempts': 0, 'last_failure_key': None}
    save_state(root, s)
    event(root, 'started', {'run_id': s['run_id']})
    return s


def current_receipt(root, s):
    relative = s.get('verification')
    if not relative:
        raise Invalid('현재 실행의 검증 기록이 없습니다.')
    p = local(root, relative)
    if file_hash(p) != s.get('verification_sha256'):
        raise Invalid('검증 기록 파일이 변경되었습니다.')
    proof = read(p)
    if proof.get('run_id') != s['run_id'] or proof.get('status') != 'pass':
        raise Invalid('현재 실행에서 전 기준을 통과한 기록이 아닙니다.')
    value = contract(root)
    if value['task_id'] != s['task_id'] or digest(snapshot(root, value)) != proof.get('source_sha256'):
        raise Invalid('소스·산출물·목적·완료 기준이 바뀌어 재검증이 필요합니다.')
    for name, expected in proof['evidence_sha256'].items():
        if file_hash(local(root, name)) != expected:
            raise Invalid('검사 로그 또는 검토 증거가 변경되었습니다: ' + name)
    if s['status'] == 'completed':
        if file_hash(local(root, s['checkpoint'])) != s['checkpoint_sha256']:
            raise Invalid('완료 체크포인트 파일이 변경되었습니다.')
    return proof


def run_command(root, check, log, timeout):
    argv = [sys.executable if a == '{python}' else a for a in check['argv']]
    # A previous Python bytecode cache can refer to different bytes with the same
    # timestamp/length. Isolate it per verification so current source is executed.
    env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8',
               PYTHONPYCACHEPREFIX=str(log.parent / 'pycache'))
    code = -1
    with log.open('w', encoding='utf-8') as output:
        try:
            process = subprocess.Popen(argv, cwd=local(root, check.get('cwd', '.')),
                                       stdout=output, stderr=subprocess.STDOUT, env=env,
                                       shell=False, start_new_session=(os.name == 'posix'))
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                if os.name == 'posix':
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                else:
                    process.kill()
                process.wait()
                output.write('\nUAISE: command timeout\n')
        except OSError as exc:
            output.write('\nUAISE: ' + str(exc) + '\n')
    return {'id': check['id'], 'returncode': code, 'log': log.relative_to(root).as_posix()}


def verify(root):
    import time
    value = contract(root)
    s = state(root)
    if s['status'] not in {'working', 'ready'} or s['task_id'] != value['task_id']:
        raise Invalid('현재 작업의 실행 가능한 상태가 아닙니다. start 또는 resume을 확인하세요.')
    if value['checks'] and not value['permissions']['local_checks']:
        raise Invalid('이 작업은 로컬 검사 실행을 허용하지 않았습니다.')
    before = snapshot(root, value)
    run = root / 'runs' / s['run_id'] / uuid4().hex
    run.mkdir(parents=True)
    s['status'] = 'working'
    s['verification'] = None
    save_state(root, s)
    deadline = time.monotonic() + value.get('limits', {}).get('total_check_seconds', 600)
    commands, evidence, outcomes = [], {}, []
    for index, check in enumerate(value['checks'], 1):
        log = run / f'check-{index:03d}.log'
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            log.write_text('UAISE: total check time budget exhausted\n', encoding='utf-8')
            result = {'id': check['id'], 'returncode': -1, 'log': log.relative_to(root).as_posix()}
        else:
            result = run_command(root, check, log, min(remaining, check.get('timeout_seconds', 120)))
        commands.append(result)
        evidence[result['log']] = file_hash(log)
    by_id = {c['id']: c for c in commands}
    for ac in value['acceptance']:
        outcome = {'id': ac['id'], 'method': ac['method']}
        if ac['method'] == 'command':
            outcome['status'] = 'pass' if all(by_id[i]['returncode'] == 0 for i in ac['check_ids']) else 'fail'
        else:
            rp = root / 'reviews' / s['run_id'] / (ac['id'] + '.json')
            try:
                rp = local(root, rp.relative_to(root).as_posix())
                r = read(rp)
                ep = local(root, r['evidence_file'])
                valid = (r['source_sha256'] == digest(before) and r['run_id'] == s['run_id']
                         and r['reviewer'] == ac['reviewer'] and r['result'] in {'pass', 'fail'} and ep.is_file()
                         and ep.stat().st_size > 0 and file_hash(ep) == r['evidence_sha256'])
                outcome['status'] = r['result'] if valid else 'pending'
                if valid:
                    evidence[rp.relative_to(root).as_posix()] = file_hash(rp)
                    evidence[r['evidence_file']] = r['evidence_sha256']
                    outcome['provenance'] = 'declared_' + r['reviewer']
            except (OSError, ValueError, KeyError, TypeError):
                outcome['status'] = 'pending'
        outcomes.append(outcome)
    problems = []
    try:
        if snapshot(root, contract(root)) != before:
            problems.append('검사 중 소스·산출물·완료 기준 변경')
    except (OSError, ValueError, KeyError, TypeError) as exc:
        problems.append(str(exc))
    failed = bool(problems) or any(o['status'] == 'fail' for o in outcomes)
    passed = not problems and all(o['status'] == 'pass' for o in outcomes)
    proof = {'schema_version': '4.0', 'run_id': s['run_id'], 'task_id': s['task_id'],
             'status': 'pass' if passed else ('fail' if failed else 'pending'), 'verified_at': now(),
             'source_sha256': digest(before), 'source_files_sha256': before,
             'commands': commands, 'criteria': outcomes, 'problems': problems,
             'evidence_sha256': evidence, 'model_execution_verified': False}
    path = run / 'verification.json'
    write(path, proof)
    s['verification'] = path.relative_to(root).as_posix()
    s['verification_sha256'] = file_hash(path)
    s['last_verification_status'] = proof['status']
    if passed:
        s['status'], s['no_progress_attempts'], s['last_failure_key'] = 'ready', 0, None
    elif failed:
        key = digest({'source': before, 'failed': [o['id'] for o in outcomes if o['status'] == 'fail'], 'problems': problems})
        s['failed_verifications'] += 1
        s['no_progress_attempts'] = s['no_progress_attempts'] + 1 if s.get('last_failure_key') == key else 1
        s['last_failure_key'] = key
        if s['no_progress_attempts'] >= value.get('limits', {}).get('max_no_progress_attempts', 2):
            s['status'] = 'blocked'
    save_state(root, s)
    event(root, 'verified', {'run_id': s['run_id'], 'status': proof['status']})
    return proof


def finish(root):
    s = state(root)
    if s['status'] == 'completed':
        current_receipt(root, s)
        return {'status': 'completed', 'reused_verification': True, 'run_id': s['run_id']}
    reused = False
    try:
        current_receipt(root, s)
        reused = True
    except (OSError, ValueError, KeyError, TypeError):
        proof = verify(root)
        if proof['status'] != 'pass':
            return {'status': proof['status'], 'completed': False, 'criteria': proof['criteria'], 'problems': proof['problems']}
    s = state(root)
    current_receipt(root, s)
    s['status'], s['completed_at'] = 'completed', now()
    checkpoint = root / 'runs' / s['run_id'] / 'completion.json'
    write(checkpoint, {'run_id': s['run_id'], 'task_id': s['task_id'], 'completed_at': s['completed_at'],
                       'verification': s['verification'], 'verification_sha256': s['verification_sha256']})
    s['checkpoint'] = checkpoint.relative_to(root).as_posix()
    s['checkpoint_sha256'] = file_hash(checkpoint)
    save_state(root, s)
    event(root, 'completed', {'run_id': s['run_id']})
    return {'status': 'completed', 'reused_verification': reused, 'run_id': s['run_id']}


def review(root, criterion, result, evidence_file, reviewer, reference):
    value, s = contract(root), state(root)
    if s['status'] not in {'working', 'ready'} or s['task_id'] != value['task_id']:
        raise Invalid('현재 실행 중인 작업에서 검토를 기록하세요.')
    ac = next((a for a in value['acceptance'] if a['id'] == criterion), None)
    if not ac or ac['method'] != 'review' or ac['reviewer'] != reviewer:
        raise Invalid('완료 기준의 검토 방식·검토자와 일치하지 않습니다.')
    if result not in {'pass', 'fail'}:
        raise Invalid('검토 결과는 pass 또는 fail이어야 합니다.')
    text_value(reference, '검토자와 실제 검토 근거 reference')
    ep = local(root, evidence_file)
    if not ep.is_file() or ep.stat().st_size == 0:
        raise Invalid('비어 있지 않은 검토 증거 파일이 필요합니다.')
    if not Path(evidence_file).parts or Path(evidence_file).parts[0] != 'evidence':
        raise Invalid('검토 증거는 evidence/ 아래에 보관하세요.')
    record = {'id': criterion, 'run_id': s['run_id'], 'result': result,
              'reviewer': reviewer, 'reference': reference, 'recorded_at': now(),
              'source_sha256': digest(snapshot(root, value)), 'evidence_file': evidence_file,
              'evidence_sha256': file_hash(ep), 'identity_authenticated': False}
    write(root / 'reviews' / s['run_id'] / (criterion + '.json'), record)
    return {'status': 'recorded', 'id': criterion, 'identity_authenticated': False}


def resume(root, note):
    s = state(root)
    if s['status'] != 'blocked':
        raise Invalid('blocked 상태에서만 resume을 사용합니다.')
    text_value(note, '재개 근거')
    s['status'], s['no_progress_attempts'], s['last_failure_key'] = 'working', 0, None
    save_state(root, s)
    event(root, 'resumed', {'note_sha256': digest(note)})
    return s


def status(root):
    s = state(root)
    result = {'framework': VERSION, 'target_model': TARGET_MODEL, 'model_execution_verified': False,
              'state': s, 'evidence_current': False, 'issues': []}
    if s.get('verification'):
        try:
            current_receipt(root, s)
            result['evidence_current'] = True
        except (OSError, ValueError, KeyError, TypeError) as exc:
            result['issues'].append(str(exc))
    return result


def main():
    parser = argparse.ArgumentParser(description='UAISE Astra: 작업별 완료 검증')
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('start'); p.add_argument('--new-run', action='store_true')
    for name in ['verify', 'finish', 'status', 'doctor']:
        sub.add_parser(name)
    p = sub.add_parser('resume'); p.add_argument('--note', required=True)
    p = sub.add_parser('review')
    p.add_argument('criterion'); p.add_argument('--result', choices=['pass', 'fail'], required=True)
    p.add_argument('--evidence', required=True); p.add_argument('--reviewer', choices=['agent', 'human'], required=True)
    p.add_argument('--reference', required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        if args.command == 'doctor':
            result = {'framework': VERSION, 'python': sys.version.split()[0], 'target_model': TARGET_MODEL,
                      'model_execution_verified': False, 'host_instruction': '오르카·Codex에서 Astra를 직접 선택하세요.',
                      'contract_present': (root / 'project/contract.json').is_file()}
        elif args.command == 'status':
            result = status(root)
        else:
            with lock(root):
                if args.command == 'start': result = start(root, args.new_run)
                elif args.command == 'verify': result = verify(root)
                elif args.command == 'finish': result = finish(root)
                elif args.command == 'resume': result = resume(root, args.note)
                else: result = review(root, args.criterion, args.result, args.evidence, args.reviewer, args.reference)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get('status') == 'pending' else int(result.get('status') == 'fail')
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({'status': 'error', 'message': str(exc)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
