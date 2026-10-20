#!/usr/bin/env python3
"""Connect only to the existing Codex daemon; never resume a second writer."""
import os,sys,json,pathlib,subprocess,select,time,shutil,glob
home=pathlib.Path.home();sock=home/'.codex/app-server-control/app-server-control.sock'
def main(req):
    if not sock.exists(): raise RuntimeError('既存Codexデーモンの接続口がありません。コピーで引き継げます。')
    import socket,base64,hashlib,struct
    client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.settimeout(12);client.connect(str(sock))
    key=base64.b64encode(os.urandom(16)).decode()
    client.sendall((f'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
    header=b''
    while b'\r\n\r\n' not in header:
        chunk=client.recv(1)
        if not chunk or len(header)>16384:raise RuntimeError('Codex WebSocket handshake failed')
        header+=chunk
    expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
    if not header.startswith(b'HTTP/1.1 101') or expected.lower() not in header.lower():raise RuntimeError('Codex WebSocket handshake was rejected')
    def exact(n):
        out=b''
        while len(out)<n:
            chunk=client.recv(n-len(out))
            if not chunk:raise RuntimeError('Codex connection closed')
            out+=chunk
        return out
    def send_frame(payload,opcode=1):
        mask=os.urandom(4);size=len(payload);head=bytes([128|opcode,128|(size if size<126 else 126 if size<65536 else 127)])
        if size>=126:head+=struct.pack('!H' if size<65536 else '!Q',size)
        client.sendall(head+mask+bytes(b^mask[i%4] for i,b in enumerate(payload)))
    def receive():
        result=b''
        while True:
            a,b=exact(2);size=b&127
            if size==126:size=struct.unpack('!H',exact(2))[0]
            elif size==127:size=struct.unpack('!Q',exact(8))[0]
            if size>32*1024*1024:raise RuntimeError('Codex response too large')
            mask=exact(4) if b&128 else None;data=exact(size)
            if mask:data=bytes(v^mask[i%4] for i,v in enumerate(data))
            opcode=a&15
            if opcode==8:raise RuntimeError('Codex connection closed')
            if opcode==9:send_frame(data,10);continue
            if opcode==10:continue
            result+=data
            if len(result)>32*1024*1024:raise RuntimeError('Codex response too large')
            if a&128:return json.loads(result)
    counter=0;sent=False;receipt=False
    def contains(value):
        if isinstance(value,str):return req.get('text')==value
        if isinstance(value,dict):return any(contains(v) for v in value.values())
        if isinstance(value,list):return any(contains(v) for v in value)
        return False
    def observe(message):
        nonlocal receipt
        params=message.get('params') or {};item=params.get('item') or {}
        if message.get('method')=='item/completed' and params.get('threadId')==req.get('sessionId') and item.get('type')=='userMessage' and contains(item):receipt=True
    def notify(method,params):send_frame(json.dumps({'method':method,'params':params}).encode())
    def rpc(method,params):
        nonlocal counter
        counter+=1;ident=counter;send_frame(json.dumps({'id':ident,'method':method,'params':params}).encode());deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            msg=receive();observe(msg)
            if msg.get('id')==ident and ('result'in msg or 'error'in msg):
                if 'error'in msg:raise RuntimeError(msg['error'].get('message','Codex RPC error'))
                return msg['result']
        raise RuntimeError('Codex応答を確認できません')
    try:
        rpc('initialize',{'clientInfo':{'name':'glass-relay','title':'Relay','version':'0.1.3'},'capabilities':{'experimentalApi':True}})
        notify('initialized',{})
        if req.get('action')=='probe':return {'available':True}
        if req.get('action')=='catalog':
            catalog=rpc('thread/list',{'limit':100,'sortKey':'updated_at'})
            try:usage=rpc('account/rateLimits/read',{})
            except Exception:usage=None
            return {'available':True,'threads':[{'id':t['id'],'title':t.get('name'),'state':(t.get('status') or {}).get('type')} for t in catalog.get('data',[])],'usage':usage}

        thread=rpc('thread/read',{'threadId':req['sessionId']})['thread']
        if thread.get('id')!=req['sessionId']:raise RuntimeError('送信先の会話IDが一致しません')
        if (thread.get('status') or {}).get('type')!='idle':raise RuntimeError('送信先は待機状態ではありません。コピーで引き継いでください。')
        if req.get('action')=='status':return {'available':True,'idle':True}
        sent=True
        result=rpc('turn/start',{'threadId':req['sessionId'],'input':[{'type':'text','text':req['text']}]})
        if not result.get('turn',{}).get('id'):raise RuntimeError('送信先の受領を確認できません')
        # RPC acceptance is not enough: locate the exact relay text in persisted turn items.
        for _ in range(8):
            if receipt:return {'confirmed':True}
            try:result=rpc('thread/turns/list',{'threadId':req['sessionId'],'limit':3,'sortDirection':'desc','itemsView':'full'})
            except RuntimeError as e:
                if 'ephemeral' not in str(e):raise
                deadline=time.monotonic()+4
                while time.monotonic()<deadline and not receipt:
                    observe(receive())
                return {'confirmed':receipt,'unknown':not receipt}
            if contains(result):return {'confirmed':True}
            time.sleep(.25)
        return {'confirmed':False,'unknown':True}
    except Exception as e:
        if sent:return {'confirmed':False,'unknown':True,'error':str(e)}
        raise
    finally:client.close()
if __name__=='__main__':
    try:
        print(json.dumps(main(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error':str(e),'unknown':False},ensure_ascii=False));sys.exit(1)
