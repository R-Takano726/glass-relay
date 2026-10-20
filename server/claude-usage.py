#!/usr/bin/env python3
"""Query the installed CLI's control channel; never send an inference turn."""
import sys,os,json,time,pathlib,glob,shutil,subprocess,select,datetime,math,tempfile,signal

def normalize(payload):
    rates=payload.get('rate_limits') if isinstance(payload,dict) else None
    if not isinstance(rates,dict):return None
    found={}
    entries=rates.get('limits') or []
    if not isinstance(entries,list):return None
    for item in entries:
        if not isinstance(item,dict) or item.get('kind') not in ('session','weekly_all'):continue
        percent=item.get('percent');reset=item.get('resets_at')
        if isinstance(percent,bool) or not isinstance(percent,(float,int)) or not math.isfinite(percent) or not 0<=percent<=100 or not isinstance(reset,str):continue
        try:
            parsed=datetime.datetime.fromisoformat(reset.replace('Z','+00:00'))
            if parsed.tzinfo is None:continue
            epoch=parsed.timestamp()
        except (ValueError,OverflowError):continue
        if not 0<epoch<32503680000:continue
        found[item['kind']]={'used_percent':percent,'window_minutes':300 if item['kind']=='session' else 10080,'resets_at':epoch}
    windows=[found[k] for k in ('session','weekly_all') if k in found]
    if not windows:return None
    return {'provider':'claude','source':'Claude CLI get_usage','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'data':{'primary':windows[0],'secondary':windows[1] if len(windows)>1 else None}}

def query():
    home=pathlib.Path.home();candidates=[shutil.which('claude'),str(home/'.local/bin/claude')]+sorted(glob.glob(str(home/'.nvm/versions/node/*/bin/claude')),reverse=True)
    binary=next((p for p in candidates if p and os.path.isfile(p) and os.access(p,os.X_OK)),None)
    if not binary:return None
    env={k:v for k,v in os.environ.items() if k not in ('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL')};env['PATH']=str(pathlib.Path(binary).parent)+os.pathsep+env.get('PATH','')
    workspace=tempfile.TemporaryDirectory(prefix='glass-relay-usage-')
    child=subprocess.Popen([binary,'-p','--settings','{"disableAllHooks":true}','--safe-mode','--no-session-persistence','--input-format','stream-json','--output-format','stream-json','--verbose','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,cwd=workspace.name,start_new_session=True)
    pending=b'';deadline=time.monotonic()+12
    def control(subtype,ident):
        nonlocal pending
        child.stdin.write((json.dumps({'type':'control_request','request_id':ident,'request':{'subtype':subtype}})+'\n').encode());child.stdin.flush()
        while time.monotonic()<deadline:
            if b'\n' not in pending:
                if not select.select([child.stdout],[],[],max(0,deadline-time.monotonic()))[0]:break
                chunk=os.read(child.stdout.fileno(),65536)
                if not chunk:break
                pending+=chunk
                if len(pending)>4*1024*1024:raise RuntimeError('CLI response too large')
            while b'\n' in pending:
                line,pending=pending.split(b'\n',1)
                try:message=json.loads(line)
                except ValueError:continue
                if not isinstance(message,dict):continue
                response=message.get('response') or {}
                if not isinstance(response,dict):continue
                if message.get('type')=='control_response' and response.get('request_id')==ident:
                    if response.get('subtype')!='success':return None
                    return response.get('response')
        return None
    try:
        if control('initialize','relay-init') is None:return None
        return normalize(control('get_usage','relay-usage'))
    finally:
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:child.wait(timeout=.5)
        except subprocess.TimeoutExpired:
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            child.wait()
        workspace.cleanup()
if __name__=='__main__':
    try:print(json.dumps(query(),ensure_ascii=False))
    except Exception:print('null')
