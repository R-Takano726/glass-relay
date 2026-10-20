#!/usr/bin/env python3
"""Record only documented rate-limit fields; never store the full stdin payload."""
import sys,json,pathlib,datetime,os,tempfile,math

def observation(payload):
    if not isinstance(payload,dict):return None
    rates=payload.get('rate_limits') or {};rates=rates if isinstance(rates,dict) else {};windows=[]
    for name,minutes in [('five_hour',300),('seven_day',10080)]:
        window=rates.get(name) or {};window=window if isinstance(window,dict) else {};used=window.get('used_percentage');reset=window.get('resets_at')
        if isinstance(used,(int,float)) and not isinstance(used,bool) and math.isfinite(used) and 0<=used<=100 and isinstance(reset,(int,float)) and not isinstance(reset,bool) and math.isfinite(reset) and 0<reset<32503680000:
            windows.append({'used_percent':used,'window_minutes':minutes,'resets_at':reset})
    if not windows:return None
    return {'provider':'claude','source':'Claude statusline','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'data':{'primary':windows[0],'secondary':windows[1] if len(windows)>1 else None}}

def main():
    raw=sys.stdin.buffer.read(1024*1024)
    try:payload=json.loads(raw)
    except (ValueError,UnicodeDecodeError):return
    if not isinstance(payload,dict):payload={}
    value=observation(payload)
    try:
        if value:
            directory=pathlib.Path(os.environ.get('RELAY_OBSERVATION_DIR',str(pathlib.Path.home()/'.local/state/glass-relay')));directory.mkdir(parents=True,exist_ok=True,mode=0o700)
            fd,name=tempfile.mkstemp(prefix='usage-',dir=directory)
            try:
                os.fchmod(fd,0o600)
                with os.fdopen(fd,'w') as file:json.dump(value,file);file.flush();os.fsync(file.fileno())
                os.replace(name,directory/'claude-usage.json')
            finally:
                if os.path.exists(name):os.unlink(name)
    except OSError:pass
    model=(payload.get('model') if isinstance(payload.get('model'),dict) else {}).get('display_name','Claude')
    context=(payload.get('context_window') if isinstance(payload.get('context_window'),dict) else {}).get('used_percentage')
    print(model+(f' · {context}% context' if isinstance(context,(int,float)) else ''))
if __name__=='__main__':main()
