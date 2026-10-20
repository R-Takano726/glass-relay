import unittest,importlib.util,pathlib
spec=importlib.util.spec_from_file_location('adapter',pathlib.Path(__file__).resolve().parents[1]/'server/host.py');adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
def codex(role,text,phase=None):return {'type':'response_item','payload':{'type':'message','id':role+text,'role':role,'phase':phase,'content':[{'type':'input_text' if role=='user' else 'output_text','text':text}]}}
def claude(uuid,parent,role,content,**extra):return {'type':role,'uuid':uuid,'parentUuid':parent,'sessionId':'test','message':{'id':uuid,'role':role,'content':content},**extra}
class ParserTests(unittest.TestCase):
 def test_codex_excludes_tools_thinking_and_commentary(self):
  result=adapter.normalize([codex('user','request'),codex('assistant','working','commentary'),{'type':'response_item','payload':{'type':'function_call_output','output':'secret'}},codex('assistant','final','final')],'codex');self.assertEqual([m['text'] for m in result['messages']],['request','final'])
 def test_current_codex_final_answer_phase_preserves_assistant_response(self):
  records=[codex('user','review this'),codex('assistant','progress only','commentary'),codex('assistant','Review result: verified.','final_answer')]
  messages=adapter.normalize(records,'codex')['messages'];self.assertEqual([(m['role'],m['text']) for m in messages],[('user','review this'),('assistant','Review result: verified.')])
 def test_automatic_goal_continuation_is_not_a_human_request(self):
  records=[codex('user','<codex_internal_context source="goal">internal continuation</codex_internal_context>'),codex('user','actual request')]
  self.assertEqual([m['text'] for m in adapter.normalize(records,'codex')['messages']],['actual request'])
 def test_rollback_after_hidden_goal_fails_closed(self):
  records=[codex('user','human request'),codex('user','<codex_internal_context source="goal">internal</codex_internal_context>'),{'type':'event_msg','payload':{'type':'thread_rolled_back','num_turns':1}}]
  self.assertIn('unsupported-history-change',adapter.normalize(records,'codex')['warnings'])
 def test_codex_environment_and_agents_are_not_user_messages(self):
  result=adapter.normalize([codex('user','# AGENTS.md instructions\nprivate'),codex('user','<environment_context>private'),codex('user','actual request')],'codex');self.assertEqual(len(result['messages']),1)
 def test_codex_event_messages_do_not_duplicate_response_items(self):
  result=adapter.normalize([{'type':'event_msg','payload':{'type':'agent_message','message':'answer'}},codex('assistant','answer','final')],'codex');self.assertEqual(len(result['messages']),1)
 def test_claude_tool_results_are_not_user_requests(self):
  result=adapter.normalize([claude('1',None,'user',[{'type':'tool_result','content':'private'}]),claude('2','1','assistant',[{'type':'text','text':'answer'}])],'claude');self.assertEqual([m['text'] for m in result['messages']],['answer'])
 def test_claude_abandoned_branch_is_excluded(self):
  records=[claude('1',None,'user','request'),claude('2','1','assistant','old answer'),claude('3','1','assistant','new answer')];result=adapter.normalize(records,'claude');self.assertEqual([m['text'] for m in result['messages']],['request','new answer'])
 def test_claude_metadata_and_sidechains_are_excluded(self):
  records=[claude('1',None,'user','request'),claude('s',None,'assistant','subagent',isSidechain=True),claude('2','1','user','summary',isCompactSummary=True),claude('3','2','assistant','answer')];result=adapter.normalize(records,'claude');self.assertEqual([m['text'] for m in result['messages']],['request','answer'])
 def test_relay_quote_is_excluded(self):self.assertEqual(adapter.normalize([codex('user','[Relay:0123-abcd]\nquote')],'codex')['messages'],[])
 def test_unknown_format_is_reported(self):self.assertIn('unsupported-format',adapter.normalize([{'type':'new-format'}],'codex')['warnings'])
 def test_codex_rollback_excludes_removed_turn(self):
  result=adapter.normalize([codex('user','one'),codex('assistant','a','final'),codex('user','two'),codex('assistant','b','final'),{'type':'event_msg','payload':{'type':'thread_rolled_back','num_turns':1}},codex('user','replacement')],'codex');self.assertEqual([m['text'] for m in result['messages']],['one','a','replacement'])
 def test_unknown_revert_fails_closed(self):
  result=adapter.normalize([codex('user','one'),{'type':'event_msg','payload':{'type':'thread_reverted','turn_id':'new'}}],'codex');self.assertIn('unsupported-history-change',result['warnings'])
 def test_path_traversal_is_rejected(self):
  with self.assertRaises(ValueError):adapter.read_messages('../../etc/passwd')
if __name__=='__main__':unittest.main()
