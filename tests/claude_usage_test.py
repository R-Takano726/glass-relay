import unittest,importlib.util,pathlib,tempfile,sys,os
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('claude_usage',pathlib.Path(__file__).resolve().parents[1]/'server/claude-usage.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ClaudeUsageTests(unittest.TestCase):
 def test_normalized_percent_uses_explicit_percent_not_fractional_stream_utilization(self):
  value=module.normalize({'rate_limits':{'limits':[{'kind':'session','percent':30,'resets_at':'2026-10-20T15:10:00Z'},{'kind':'weekly_all','percent':73,'resets_at':'2026-10-24T21:00:00Z'}]},'account':{'token':'not-persisted'}});self.assertEqual(value['data']['primary']['used_percent'],30);self.assertEqual(value['data']['secondary']['used_percent'],73);self.assertNotIn('token',str(value))
 def test_signed_out_or_missing_windows_are_unknown(self):self.assertIsNone(module.normalize({'rate_limits_available':True,'rate_limits':None}));self.assertIsNone(module.normalize(None))
 def test_invalid_percent_and_dates_are_unknown(self):
  for percent,reset in [(True,'2026-10-20T15:10:00Z'),(101,'2026-10-20T15:10:00Z'),(10,'invalid')]:self.assertIsNone(module.normalize({'rate_limits':{'limits':[{'kind':'session','percent':percent,'resets_at':reset}]}}))
 def test_gui_path_prefers_native_cli_and_control_channel_sends_no_inference(self):
  with tempfile.TemporaryDirectory() as folder:
   home=pathlib.Path(folder);binary=home/'.local/bin/claude';binary.parent.mkdir(parents=True)
   legacy=home/'legacy-claude';legacy.write_text('#!'+sys.executable+'\nraise SystemExit(1)\n');legacy.chmod(0o700)
   binary.write_text('#!'+sys.executable+'\n'+"""import sys,json,os,pathlib
assert '--safe-mode' in sys.argv
assert json.loads(sys.argv[sys.argv.index('--settings')+1])['disableAllHooks']
assert not list(pathlib.Path.cwd().iterdir())
assert 'ANTHROPIC_API_KEY' not in os.environ
for line in sys.stdin:
 message=json.loads(line)
 assert message['type']=='control_request'
 subtype=message['request']['subtype']
 assert subtype in ('initialize','get_usage')
 print('[]',flush=True)
 print(json.dumps({'type':'control_response','response':{'request_id':'unrelated','subtype':'success','response':{}}}),flush=True)
 response={} if subtype=='initialize' else {'rate_limits':{'limits':[{'kind':'session','percent':30,'resets_at':'2026-10-20T15:10:00Z'}]}}
 print(json.dumps({'type':'control_response','response':{'request_id':message['request_id'],'subtype':'success','response':response}}),flush=True)
""");binary.chmod(0o700)
   with patch.object(module.pathlib.Path,'home',return_value=home),patch.object(module.shutil,'which',return_value=str(legacy)),patch.dict(os.environ,{'ANTHROPIC_API_KEY':'test-key-not-forwarded'}):
    value=module.query(timeout=2)
   self.assertEqual(value['data']['primary']['used_percent'],30)
 def test_unresponsive_cli_is_terminated_at_deadline(self):
  with tempfile.TemporaryDirectory() as folder:
   home=pathlib.Path(folder);binary=home/'.local/bin/claude';binary.parent.mkdir(parents=True)
   binary.write_text('#!'+sys.executable+'\nimport time\ntime.sleep(60)\n');binary.chmod(0o700)
   with patch.object(module.pathlib.Path,'home',return_value=home):
    start=module.time.monotonic();self.assertIsNone(module.query(timeout=.2));self.assertLess(module.time.monotonic()-start,2)
if __name__=='__main__':unittest.main()
