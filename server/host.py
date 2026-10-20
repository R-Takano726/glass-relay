#!/usr/bin/env python3
"""Read-only, dependency-free transcript adapter. Runs identically over SSH."""
import sys, os, json, hashlib, pathlib, re, datetime, glob
HOME=pathlib.Path(os.environ.get('RELAY_TRANSCRIPT_HOME',str(pathlib.Path.home())))
MAX_BYTES=32*1024*1024
MARKER=re.compile(r'^\[Relay:[0-9a-f-]+\]')
def digest(s): return hashlib.sha256(s.encode()).hexdigest()
def clean_user(text):
    return bool(text.strip()) and not re.match(r'^\s*(?:<environment_context>|<INSTRUCTIONS>|# AGENTS\.md instructions|<permissions instructions>|<turn_aborted>|<command-name>|<local-command-stdout>|<system-reminder>|<codex_internal_context\s+source=[\"\']goal[\"\'])',text)
def text_blocks(content):
    if isinstance(content,str): return content
    if not isinstance(content,list): return ''
    return '\n'.join(c.get('text','') for c in content if isinstance(c,dict) and c.get('type') in ('text','input_text','output_text'))
def normalize(records,provider):
    messages=[]; metadata={}; rate=None; context=None; model=''; title=''; warnings=[]
    # Follow the latest Claude branch instead of mixing abandoned replies.
    lineage=None
    if provider=='claude':
        nodes={r['uuid']:r for r in records if r.get('uuid') and not r.get('isSidechain')}
        leaf=next((r for r in reversed(records) if r.get('type') in ('user','assistant') and r.get('uuid') in nodes),None)
        if leaf:
            lineage=set(); cursor=leaf.get('uuid')
            while cursor in nodes and cursor not in lineage:
                lineage.add(cursor);cursor=nodes[cursor].get('parentUuid')
    recognized=False;hidden_goal_seen=False
    for index,r in enumerate(records):
        ts=r.get('timestamp') or '1970-01-01T00:00:00Z'; p=r.get('payload') or {}; typ=r.get('type')
        if typ=='event_msg' and p.get('type')=='thread_rolled_back':
            if hidden_goal_seen:
                warnings.append('unsupported-history-change');continue
            count=p.get('num_turns')
            if isinstance(count,int) and count>0:
                users=[i for i,m in enumerate(messages) if m['role']=='user']
                messages=messages[:users[-count]] if len(users)>=count else []
            else:warnings.append('unsupported-history-change')
        if typ=='event_msg' and p.get('type') in ('thread_reverted','thread_revert'):
            warnings.append('unsupported-history-change')
        if typ=='session_meta': metadata=p;recognized=True
        if typ=='turn_context': model=p.get('model',model)
        if typ=='custom-title': title=r.get('customTitle',title)
        if typ=='event_msg' and p.get('type')=='token_count':
            if p.get('rate_limits'): rate={'data':p['rate_limits'],'observedAt':ts}
            info=p.get('info') or {}; window=info.get('model_context_window'); last=(info.get('last_token_usage') or {}).get('total_tokens')
            if window and last is not None: context=max(0,min(100,round(last/window*100)))
        role=None; text=''; mid=None
        if provider=='codex' and typ=='response_item' and p.get('type')=='message':
            recognized=True;role=p.get('role');text=text_blocks(p.get('content'));mid=p.get('id')
            if role=='assistant' and p.get('phase') not in (None,'final','final_answer'):continue
        if provider=='claude' and typ in ('user','assistant'):
            recognized=True
            if r.get('isSidechain') or r.get('isCompactSummary') or r.get('isMeta'):continue
            if lineage is not None and r.get('uuid') and r['uuid'] not in lineage:continue
            msg=r.get('message') or {};role=msg.get('role',typ);content=msg.get('content',[])
            if isinstance(content,list) and any(c.get('type') in ('tool_use','tool_result','server_tool_use') for c in content if isinstance(c,dict)):continue
            text=text_blocks(content);mid=msg.get('id') if role=='assistant' else r.get('uuid');model=msg.get('model',model);metadata={'cwd':r.get('cwd',metadata.get('cwd','')),'id':r.get('sessionId',metadata.get('id',''))}
        if role not in ('user','assistant') or not text.strip():continue
        if role=='user' and not clean_user(text):
            if provider=='codex' and text.lstrip().startswith('<codex_internal_context'):hidden_goal_seen=True
            continue
        if MARKER.match(text):continue
        h=digest(text);mid=mid or f'{role}-{h[:20]}-{index}'
        previous=next((m for m in reversed(messages[-12:]) if m['id']==mid),None)
        if previous:
            if previous['text']==text:continue
            previous['text']=text if text.startswith(previous['text']) else previous['text']+'\n'+text
            previous['hash']=digest(previous['text']);continue
        messages.append({'id':mid,'role':role,'text':text,'timestamp':ts,'hash':h})
    if not recognized and records:warnings.append('unsupported-format')
    return {'messages':messages,'metadata':metadata,'rate':rate,'contextPercent':context,'model':model,'title':title,'warnings':warnings}
def records_from(path,summary=False):
    if path.stat().st_size>MAX_BYTES and not summary:raise ValueError('会話が32MBを超えています。取り込み対象を絞ってください。')
    with path.open('rb') as f:
        if summary and path.stat().st_size>240000:
            head=f.read(100000); f.seek(-140000,2); tail=f.read(); raw=head.rsplit(b'\n',1)[0]+b'\n'+tail.split(b'\n',1)[-1]
        else:raw=f.read(MAX_BYTES+1)
    records=[]
    for line in raw.splitlines():
        try:records.append(json.loads(line))
        except (ValueError,UnicodeDecodeError):pass # In-flight last line is allowed.
    return records

def files():
    candidates=[]
    for provider,root in [('codex',HOME/'.codex/sessions'),('claude',HOME/'.claude/projects')]:
        if root.exists():
            for path in root.rglob('*.jsonl'):
                if 'subagents' not in path.parts:
                    try:candidates.append((path.stat().st_mtime,provider,path))
                    except OSError:pass
    return sorted(candidates,reverse=True)[:100]
def collect():
    sessions=[]; usage=[]; errors=[]
    for modified,provider,path in files():
        try:
            result=normalize(records_from(path,True),provider);meta=result['metadata'];sid=meta.get('id') or meta.get('session_id') or path.stem
            msgs=result['messages']
            if result['model']=='codex-auto-review' or str(meta.get('originator','')).startswith('codex-auto-review') or any(m['text'].startswith('The following is the Codex agent history') for m in msgs[:1]):continue
            title=result['title'] or next((m['text'].splitlines()[0][:56] for m in msgs if m['role']=='user'),'') or pathlib.Path(meta.get('cwd','')).name or 'セッション'
            sessions.append({'key':sid,'provider':provider,'title':title,'cwd':meta.get('cwd',''),'updatedAt':datetime.datetime.fromtimestamp(modified,datetime.timezone.utc).isoformat(),'model':result['model'],'contextPercent':result['contextPercent'],'messageCount':len(msgs),'path':str(path.relative_to(HOME)),'warnings':result['warnings']})
            if result['rate']:usage.append({'provider':provider,**result['rate']})
        except (OSError,ValueError) as e:errors.append(str(e))
    usage_file=HOME/'.local/state/glass-relay/claude-usage.json'
    try:
        if usage_file.exists() and usage_file.stat().st_size<20000:
            value=json.loads(usage_file.read_text())
            if value.get('provider')=='claude' and value.get('source')=='Claude statusline' and isinstance(value.get('data'),dict):usage.append(value)
    except (OSError,ValueError):pass
    return {'sessions':sessions,'usage':usage,'errors':errors}
def read_messages(relative):
    path=(HOME/relative).resolve();allowed=[(HOME/'.codex/sessions').resolve(),(HOME/'.claude/projects').resolve()]
    if not any(path.is_relative_to(root) for root in allowed) or path.suffix!='.jsonl':raise ValueError('許可されていない会話パスです')
    provider='codex' if path.is_relative_to(allowed[0]) else 'claude'
    result=normalize(records_from(path),provider)
    if result['warnings']:raise ValueError('未対応の会話形式です')
    return result['messages']
if __name__=='__main__':
    try:
        request=json.loads(sys.argv[1]) if len(sys.argv)>1 else {}
        if request.get('action')=='request':
            request_file=HOME/'.local/state/glass-relay/request.json'
            result=json.loads(request_file.read_text()) if request_file.exists() and request_file.stat().st_size<20000 else None
        else:result=read_messages(request['path']) if request.get('action')=='messages' else collect()
        print(json.dumps(result,ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error':str(e)},ensure_ascii=False));sys.exit(1)
