"""Real subprocess and file-lifecycle regression checks in disposable projects."""
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

PACKAGE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('uaise_runtime', PACKAGE / 'tools/uaise.py')
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)


class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='UAISE 한글 시험 ')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        shutil.copytree(PACKAGE / 'tools', self.root / 'tools', ignore=shutil.ignore_patterns('__pycache__'))
        self.put('AGENTS.md', '합성 시험용 지침. 실제 프로젝트 지침이 아닙니다.\n')
        self.put('INTENT.md', '# 합성 시험\n정수 입력의 두 배를 계산한다.\n')
        self.put('work/app.py', 'def double(n):\n    return 2 * n\n')
        self.put('work/check.py', "from pathlib import Path\nfrom app import double\np=Path('runs/calls')\np.write_text(str(int(p.read_text())+1) if p.exists() else '1')\nfor n, expected in [(0,0),(3,6),(-2,-4)]:\n    if double(n)!=expected: raise SystemExit(7)\nprint('Three real input/output comparisons passed.')\n")
        self.value = {'schema_version': '4.0', 'task_id': 'synthetic-1',
                      'request_reference': 'fixture only; no real user approval',
                      'permissions': {'local_checks': True}, 'source_paths': ['work'],
                      'deliverables': ['work/app.py'],
                      'checks': [{'id': 'calc', 'argv': ['{python}', 'work/check.py'], 'timeout_seconds': 10}],
                      'acceptance': [{'id': 'AC-1', 'criterion': 'Three known integer cases match.',
                                      'method': 'command', 'check_ids': ['calc']}]}
        self.save_contract()

    def put(self, relative, content):
        p = self.root / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')

    def save_contract(self):
        u.write(self.root / 'project/contract.json', self.value)

    def start(self):
        return u.start(self.root)

    def calls(self):
        return int((self.root / 'runs/calls').read_text())

    def add_review(self, reviewer='agent'):
        self.value['acceptance'].append({'id': 'AC-READ', 'criterion': 'Inspect content.',
                                        'method': 'review', 'reviewer': reviewer})
        self.save_contract()

    def record(self, reviewer='agent'):
        self.put('evidence/inspection.md', 'Synthetic observation: the tested function doubles the three fixture inputs.\n')
        return u.review(self.root, 'AC-READ', 'pass', 'evidence/inspection.md', reviewer, 'fixture reviewer; declared identity only')

    def test_start_allows_not_yet_created_outputs(self):
        shutil.rmtree(self.root / 'work')
        self.assertEqual(self.start()['status'], 'working')
        self.assertFalse((self.root / 'runs/calls').exists())

    def test_unfilled_intent_or_contract_rejected(self):
        self.put('INTENT.md', '[작성]')
        with self.assertRaises(u.Invalid): self.start()
        self.put('INTENT.md', 'A real synthetic goal')
        self.value['acceptance'] = []
        self.save_contract()
        with self.assertRaises(u.Invalid): self.start()

    def test_start_is_idempotent_for_active_task(self):
        s = self.start()
        self.assertEqual(self.start()['run_id'], s['run_id'])

    def test_finish_executes_checks_and_records_current_completion(self):
        self.start()
        self.assertEqual(u.finish(self.root)['status'], 'completed')
        self.assertEqual(self.calls(), 1)
        result = u.status(self.root)
        self.assertTrue(result['evidence_current'])
        self.assertFalse(result['model_execution_verified'])

    def test_verify_then_finish_does_not_repeat_commands(self):
        self.start()
        self.assertEqual(u.verify(self.root)['status'], 'pass')
        self.assertTrue(u.finish(self.root)['reused_verification'])
        u.finish(self.root)
        self.assertEqual(self.calls(), 1)

    def test_source_change_after_pass_requires_actual_rerun(self):
        self.start(); u.verify(self.root)
        self.put('work/app.py', 'def double(n):\n    return n + n\n')
        self.assertFalse(u.finish(self.root)['reused_verification'])
        self.assertEqual(self.calls(), 2)

    def test_real_failure_prevents_completion_and_repair_succeeds(self):
        self.put('work/app.py', 'def double(n):\n    return -100\n')
        self.start()
        self.assertEqual(u.finish(self.root)['status'], 'fail')
        self.assertEqual(u.state(self.root)['status'], 'working')
        self.put('work/app.py', 'def double(n):\n    return n * 2\n')
        self.assertEqual(u.finish(self.root)['status'], 'completed')

    def test_missing_or_empty_deliverable_refused(self):
        self.start()
        for operation in ['delete', 'empty']:
            with self.subTest(operation=operation):
                if operation == 'delete': (self.root / 'work/app.py').unlink()
                else: self.put('work/app.py', '')
                with self.assertRaises(u.Invalid): u.finish(self.root)

    def test_file_add_edit_delete_invalidates_completion(self):
        self.start(); u.finish(self.root)
        p = self.root / 'work/app.py'; original = p.read_text()
        self.put('work/added.txt', 'new input')
        self.assertFalse(u.status(self.root)['evidence_current'])
        (self.root / 'work/added.txt').unlink()
        p.write_text(original + '# modified\n')
        self.assertFalse(u.status(self.root)['evidence_current'])
        p.unlink()
        self.assertFalse(u.status(self.root)['evidence_current'])

    def test_contract_or_intent_change_invalidates_completion(self):
        self.start(); u.finish(self.root)
        original = deepcopy(self.value)
        self.value['acceptance'][0]['criterion'] = 'A changed requirement'
        self.save_contract()
        self.assertFalse(u.status(self.root)['evidence_current'])
        self.value = original; self.save_contract()
        self.put('INTENT.md', 'A changed task purpose')
        self.assertFalse(u.status(self.root)['evidence_current'])

    def test_source_modified_by_check_prevents_completion(self):
        self.put('work/check.py', "from pathlib import Path\nPath('work/new.txt').write_text('changed during check')\n")
        self.start()
        proof = u.verify(self.root)
        self.assertEqual(proof['status'], 'fail')
        self.assertTrue(proof['problems'])

    def test_old_python_bytecode_cannot_hide_changed_source(self):
        import py_compile
        app = self.root / 'work/app.py'
        old_time = app.stat().st_mtime
        py_compile.compile(str(app), doraise=True)
        self.put('work/app.py', 'def double(n):\n    return 0 * n\n')
        os.utime(app, (old_time, old_time))
        self.start()
        self.assertEqual(u.finish(self.root)['status'], 'fail')

    def test_nonzero_check_output_is_preserved(self):
        self.put('work/check.py', "print('observable failure context')\nraise SystemExit(8)\n")
        self.start()
        proof = u.verify(self.root)
        self.assertEqual(proof['commands'][0]['returncode'], 8)
        self.assertIn('observable failure context', (self.root / proof['commands'][0]['log']).read_text())

    def test_log_tamper_invalidates_receipt(self):
        self.start(); u.finish(self.root)
        proof = u.current_receipt(self.root, u.state(self.root))
        self.put(proof['commands'][0]['log'], 'changed log')
        self.assertFalse(u.status(self.root)['evidence_current'])

    def test_receipt_and_checkpoint_tamper_detected(self):
        self.start(); u.finish(self.root)
        s = u.state(self.root)
        proof = (self.root / s['verification']).read_text()
        self.put(s['verification'], '{}')
        self.assertFalse(u.status(self.root)['evidence_current'])
        self.put(s['verification'], proof)
        self.put(s['checkpoint'], '{}')
        with self.assertRaises(u.Invalid): u.finish(self.root)

    def test_missing_review_is_pending_then_actual_record_can_complete(self):
        self.add_review(); self.start()
        self.assertEqual(u.finish(self.root)['status'], 'pending')
        self.assertEqual(u.state(self.root)['failed_verifications'], 0)
        self.record()
        self.assertEqual(u.finish(self.root)['status'], 'completed')

    def test_agent_cannot_satisfy_human_review_type(self):
        self.add_review('human'); self.start()
        with self.assertRaises(u.Invalid): self.record('agent')
        self.assertEqual(u.finish(self.root)['status'], 'pending')

    def test_review_from_prior_source_is_pending(self):
        self.add_review(); self.start(); self.record()
        self.put('work/changed.txt', 'new material')
        self.assertEqual(u.finish(self.root)['status'], 'pending')

    def test_review_evidence_tamper_is_pending(self):
        self.add_review(); self.start(); self.record()
        self.put('evidence/inspection.md', 'changed observation')
        self.assertEqual(u.finish(self.root)['status'], 'pending')

    def test_review_only_document_needs_no_command(self):
        self.value['checks'], self.value['acceptance'] = [], []
        self.value['permissions']['local_checks'] = False
        self.add_review(); self.start(); self.record()
        self.assertEqual(u.finish(self.root)['status'], 'completed')
        self.assertFalse((self.root / 'runs/calls').exists())

    def test_local_execution_permission_false_prevents_commands(self):
        self.value['permissions']['local_checks'] = False; self.save_contract(); self.start()
        with self.assertRaises(u.Invalid): u.finish(self.root)
        self.assertFalse((self.root / 'runs/calls').exists())

    def test_no_progress_limit_and_explicit_resume(self):
        self.put('work/check.py', 'raise SystemExit(9)\n'); self.start()
        u.verify(self.root); u.verify(self.root)
        self.assertEqual(u.state(self.root)['status'], 'blocked')
        with self.assertRaises(u.Invalid): u.finish(self.root)
        self.put('work/check.py', 'from app import double\nassert double(4) == 8\n')
        u.resume(self.root, 'Changed failed check based on actual source inspection.')
        self.assertEqual(u.finish(self.root)['status'], 'completed')

    def test_changed_inputs_reset_no_progress_counter(self):
        self.put('work/check.py', 'raise SystemExit(9)\n'); self.start(); u.verify(self.root)
        self.put('work/new.txt', 'meaningful new input to fixture')
        u.verify(self.root)
        self.assertEqual(u.state(self.root)['no_progress_attempts'], 1)

    def test_timeout_records_failed_command(self):
        self.put('work/check.py', 'import time\ntime.sleep(30)\n')
        self.value['checks'][0]['timeout_seconds'] = 1; self.save_contract(); self.start()
        proof = u.verify(self.root)
        self.assertEqual(proof['status'], 'fail')
        self.assertIn('timeout', (self.root / proof['commands'][0]['log']).read_text())

    def test_lock_prevents_concurrent_writer(self):
        with u.lock(self.root):
            with self.assertRaises(u.Invalid):
                with u.lock(self.root): pass
        self.assertFalse((self.root / 'runs/operation.lock').exists())

    def test_new_run_preserves_old_completion_and_needs_new_checks(self):
        self.start(); u.finish(self.root)
        old = u.state(self.root)
        u.start(self.root, new_run=True)
        self.assertNotEqual(u.state(self.root)['run_id'], old['run_id'])
        self.assertTrue((self.root / old['checkpoint']).exists())
        u.finish(self.root)
        self.assertEqual(self.calls(), 2)

    def test_unsafe_source_paths_rejected(self):
        for path in ['../outside', '/tmp/outside', 'C:/outside', 'runs', '.', 'node_modules']:
            with self.subTest(path=path):
                self.value['source_paths'] = [path]; self.save_contract()
                with self.assertRaises(u.Invalid): u.contract(self.root)

    def test_source_symlink_rejected(self):
        try: (self.root / 'work/link').symlink_to(self.root / 'INTENT.md')
        except OSError: self.skipTest('Symlinks unavailable on this platform')
        self.start()
        with self.assertRaises(u.Invalid): u.verify(self.root)

    def test_invalid_contract_mappings_and_types_rejected(self):
        original = deepcopy(self.value)
        variants = []
        v = deepcopy(original); v['checks'][0]['timeout_seconds'] = True; variants.append(v)
        v = deepcopy(original); v['acceptance'][0]['check_ids'] = ['absent']; variants.append(v)
        v = deepcopy(original); v['acceptance'].append(v['acceptance'][0]); variants.append(v)
        v = deepcopy(original); v['checks'].append({'id': 'unused', 'argv': ['echo', 'not used']}); variants.append(v)
        for v in variants:
            self.value = v; self.save_contract()
            with self.assertRaises(u.Invalid): u.contract(self.root)

    def test_bom_json_and_korean_space_path(self):
        p = self.root / 'project/contract.json'
        p.write_text(p.read_text(), encoding='utf-8-sig')
        self.start()
        self.assertEqual(u.finish(self.root)['status'], 'completed')

    def test_every_criterion_must_pass(self):
        self.value['checks'].append({'id': 'fail', 'argv': ['{python}', '-c', 'raise SystemExit(3)']})
        self.value['acceptance'].append({'id': 'AC-2', 'criterion': 'Second actual condition', 'method': 'command', 'check_ids': ['fail']})
        self.save_contract(); self.start()
        result = u.finish(self.root)
        self.assertEqual([r['status'] for r in result['criteria']], ['pass', 'fail'])

    def test_cache_files_do_not_invalidate_snapshot(self):
        self.start(); u.finish(self.root)
        self.put('work/__pycache__/unused.pyc', 'cache data')
        self.assertTrue(u.status(self.root)['evidence_current'])

    def test_framework_change_invalidates_completed_proof(self):
        self.start(); u.finish(self.root)
        self.put('tools/extra.py', '# changed verification tool\n')
        self.assertFalse(u.status(self.root)['evidence_current'])

    def test_status_is_read_only(self):
        self.start(); u.finish(self.root)
        before = {str(p.relative_to(self.root)): u.file_hash(p) for p in (self.root / 'runs').rglob('*') if p.is_file()}
        u.status(self.root); u.status(self.root)
        after = {str(p.relative_to(self.root)): u.file_hash(p) for p in (self.root / 'runs').rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_cli_works_in_populated_project_and_reports_json(self):
        for command, expected in [('start', 'working'), ('finish', 'completed'), ('status', None)]:
            result = subprocess.run([sys.executable, str(self.root / 'tools/uaise.py'), '--root', str(self.root), command],
                                    text=True, encoding='utf-8', capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            payload = json.loads(result.stdout)
            if expected: self.assertEqual(payload['status'], expected)
            else: self.assertTrue(payload['evidence_current'])


if __name__ == '__main__':
    unittest.main()
