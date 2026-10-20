import unittest,importlib.util,pathlib
spec=importlib.util.spec_from_file_location('statusline',pathlib.Path(__file__).resolve().parents[1]/'scripts/claude-statusline.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class StatusLineTests(unittest.TestCase):
 def test_only_documented_rate_fields_are_saved(self):
  result=module.observation({'rate_limits':{'five_hour':{'used_percentage':36,'resets_at':1800000000},'seven_day':{'used_percentage':12,'resets_at':1800300000}},'access_token':'not-to-be-saved','transcript':'private'});self.assertEqual(result['data']['primary']['used_percent'],36);self.assertNotIn('access_token',str(result));self.assertNotIn('private',str(result))
 def test_absence_is_unknown_not_zero(self):self.assertIsNone(module.observation({}))
 def test_invalid_epoch_in_percentage_is_rejected(self):self.assertIsNone(module.observation({'rate_limits':{'five_hour':{'used_percentage':1800000000,'resets_at':1800000000}}}))
 def test_non_object_payloads_are_ignored(self):
  self.assertIsNone(module.observation([]));self.assertIsNone(module.observation({'rate_limits':[]}));self.assertIsNone(module.observation({'rate_limits':{'five_hour':42}}))
 def test_boolean_reset_is_not_a_timestamp(self):self.assertIsNone(module.observation({'rate_limits':{'five_hour':{'used_percentage':1,'resets_at':True}}}))
if __name__=='__main__':unittest.main()
