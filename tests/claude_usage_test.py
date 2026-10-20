import unittest,importlib.util,pathlib
spec=importlib.util.spec_from_file_location('claude_usage',pathlib.Path(__file__).resolve().parents[1]/'server/claude-usage.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ClaudeUsageTests(unittest.TestCase):
 def test_normalized_percent_uses_explicit_percent_not_fractional_stream_utilization(self):
  value=module.normalize({'rate_limits':{'limits':[{'kind':'session','percent':30,'resets_at':'2026-10-20T15:10:00Z'},{'kind':'weekly_all','percent':73,'resets_at':'2026-10-24T21:00:00Z'}]},'account':{'token':'not-persisted'}});self.assertEqual(value['data']['primary']['used_percent'],30);self.assertEqual(value['data']['secondary']['used_percent'],73);self.assertNotIn('token',str(value))
 def test_signed_out_or_missing_windows_are_unknown(self):self.assertIsNone(module.normalize({'rate_limits_available':True,'rate_limits':None}));self.assertIsNone(module.normalize(None))
 def test_invalid_percent_and_dates_are_unknown(self):
  for percent,reset in [(True,'2026-10-20T15:10:00Z'),(101,'2026-10-20T15:10:00Z'),(10,'invalid')]:self.assertIsNone(module.normalize({'rate_limits':{'limits':[{'kind':'session','percent':percent,'resets_at':reset}]}}))
if __name__=='__main__':unittest.main()
