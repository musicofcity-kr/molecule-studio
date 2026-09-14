"""Execute the three bundled examples in fresh disposable projects."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

parser=argparse.ArgumentParser()
parser.add_argument('package',type=Path)
parser.add_argument('output',type=Path)
args=parser.parse_args()
package=args.package.resolve()
output=args.output.resolve()
output.mkdir(parents=True,exist_ok=True)
observations=[]
env=dict(os.environ,PYTHONUTF8='1',PYTHONIOENCODING='utf-8')

def execute(label,command,cwd,expected=0):
    r=subprocess.run(command,cwd=cwd,env=env,text=True,encoding='utf-8',errors='replace',capture_output=True,timeout=90)
    (output/(label+'.log')).write_text(r.stdout+'\n'+r.stderr,encoding='utf-8')
    observations.append({'case':label,'expected_exit':expected,'actual_exit':r.returncode,'matched':r.returncode==expected})
    if r.returncode!=expected:
        raise RuntimeError(label+' failed; inspect the log')
    print(json.dumps(observations[-1]),flush=True)
    return r.stdout

def cli(target,label,*command,expected=0):
    return json.loads(execute(label,[sys.executable,str(target/'tools/uaise.py'),*command],target,expected))

with tempfile.TemporaryDirectory(prefix='Astra E2E 한글 ') as temporary:
    for kind in ['coding','document','analysis']:
        target=Path(temporary)/kind
        execute(kind+'_setup',[sys.executable,str(package/'tools/demo.py'),kind,str(target)],package)
        cli(target,kind+'_start','start')
        if kind=='analysis':
            execute('analysis_generate',[sys.executable,'work/analyze.py'],target)
        if kind=='document':
            pending=cli(target,'document_pending','finish',expected=2)
            assert pending['status']=='pending'
            before=(target/'work/source.md').read_text(encoding='utf-8')
            after=(target/'work/notice.md').read_text(encoding='utf-8')
            assert before.replace('자료를 자료를','자료를')==after
            assert '내일' in after and '노트' in after
            evidence=target/'evidence/comparison.md'
            evidence.parent.mkdir()
            evidence.write_text('# Synthetic document comparison\n\nThe verifier read both saved files. Removing only the repeated word from the input yields the exact output. The planned activity and notebook item remain present. This is a deterministic fixture observation, not a human approval.\n\nInput:\n'+before+'\nOutput:\n'+after,encoding='utf-8')
            cli(target,'document_record_review','review','AC-MEANING','--result','pass','--evidence','evidence/comparison.md','--reviewer','agent','--reference','qualification script: exact before/after text comparison')
        completed=cli(target,kind+'_finish','finish')
        assert completed['status']=='completed'
        current=cli(target,kind+'_status','status')
        assert current['evidence_current'] and not current['model_execution_verified']
        count_before=len(list((target/'runs').rglob('verification.json')))
        repeat=cli(target,kind+'_repeat_finish','finish')
        assert repeat['reused_verification'] and len(list((target/'runs').rglob('verification.json')))==count_before
        if kind=='analysis':
            result=json.loads((target/'work/result.json').read_text())
            result['mean']=999
            (target/'work/result.json').write_text(json.dumps(result))
            stale=cli(target,'analysis_changed_status','status')
            assert not stale['evidence_current']
            cli(target,'analysis_restart','start','--new-run')
            rejected=cli(target,'analysis_wrong_mean_rejected','finish',expected=1)
            assert rejected['status']=='fail'
        (output/(kind+'_completion.json')).write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

summary={'verified_at':datetime.now(timezone.utc).isoformat(),'scope':'local framework and synthetic examples; not hosted Astra, Windows, Orca, or molecular app performance','all_expected_results_observed':True,'observations':observations}
(output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
