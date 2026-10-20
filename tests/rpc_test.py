import unittest,importlib.util,pathlib,socket,tempfile,threading,json,struct,base64,hashlib,os
spec=importlib.util.spec_from_file_location('rpc',pathlib.Path(__file__).resolve().parents[1]/'server/rpc.py');rpc=importlib.util.module_from_spec(spec);spec.loader.exec_module(rpc)
class RPCFixture(unittest.TestCase):
 def run_server(self,state='idle',echo=True):
  directory=tempfile.TemporaryDirectory(prefix='relay-rpc-');self.addCleanup(directory.cleanup);location=pathlib.Path(directory.name)/'control.sock';rpc.sock=location;server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);server.bind(str(location));server.listen(1);self.calls=[];self.server_error=None
  def exact(client,n):
   data=b''
   while len(data)<n:
    c=client.recv(n-len(data))
    if not c:raise EOFError()
    data+=c
   return data
  def serve():
   try:
    client,_=server.accept();client.settimeout(5)
    with client:
     header=b''
     while b'\r\n\r\n' not in header:header+=client.recv(1)
     key=next(line.split(b': ',1)[1] for line in header.split(b'\r\n') if line.startswith(b'Sec-WebSocket-Key:'))
     accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest());client.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n')
     while True:
      a,b=exact(client,2);size=b&127
      if size==126:size=struct.unpack('!H',exact(client,2))[0]
      elif size==127:size=struct.unpack('!Q',exact(client,8))[0]
      self.assertTrue(b&128);mask=exact(client,4);payload=exact(client,size);message=json.loads(bytes(v^mask[i%4] for i,v in enumerate(payload)));method=message['method'];self.calls.append(method)
      if 'id'not in message:continue
      if method=='initialize':result={'userAgent':'fixture'}
      elif method=='thread/read':result={'thread':{'id':'fixture','status':{'type':state}}}
      elif method=='turn/start':result={'turn':{'id':'turn-fixture'}}
      elif method=='thread/turns/list':result={'data':[{'items':[{'type':'userMessage','content':[{'type':'text','text':'[Relay:1234]\n原文'}]}]}]} if echo else {'data':[]}
      else:result={}
      output=json.dumps({'id':message['id'],'result':result},ensure_ascii=False).encode();size=len(output);prefix=bytes([129,size]) if size<126 else bytes([129,126])+struct.pack('!H',size);client.sendall(prefix+output)
   except (EOFError,ConnectionError):pass
   except Exception as e:self.server_error=e
   finally:server.close()
  thread=threading.Thread(target=serve,daemon=True);thread.start();return thread
 def test_existing_idle_thread_receipt_is_observed(self):
  t=self.run_server();result=rpc.main({'action':'send','sessionId':'fixture','text':'[Relay:1234]\n原文'});t.join(2);self.assertIsNone(self.server_error);self.assertTrue(result['confirmed']);self.assertEqual(self.calls.count('turn/start'),1);self.assertNotIn('thread/resume',self.calls)
 def test_active_thread_is_not_written(self):
  t=self.run_server(state='active')
  with self.assertRaises(RuntimeError):rpc.main({'action':'send','sessionId':'fixture','text':'[Relay:1234]\n原文'})
  t.join(2);self.assertNotIn('turn/start',self.calls)
 def test_ack_without_exact_message_stays_unknown(self):
  t=self.run_server(echo=False);result=rpc.main({'action':'send','sessionId':'fixture','text':'[Relay:1234]\n原文'});t.join(2);self.assertTrue(result['unknown']);self.assertFalse(result['confirmed']);self.assertEqual(self.calls.count('turn/start'),1)
if __name__=='__main__':unittest.main()
