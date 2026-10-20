#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
const args=process.argv.slice(2);const get=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined}
const provider=get('--provider');if(provider&&!['claude','codex'].includes(provider))throw new Error('provider must be claude or codex')
const request={id:randomUUID(),createdAt:new Date().toISOString(),provider:provider||null,sessionId:get('--session')||null,cwd:process.cwd(),note:get('--note')||''}
if(request.note.length>10000)throw new Error('Note is too long')
const dir=path.join(os.homedir(),'.local/state/glass-relay');fs.mkdirSync(dir,{recursive:true,mode:0o700});const temp=path.join(dir,`request-${process.pid}.tmp`);fs.writeFileSync(temp,JSON.stringify(request),{mode:0o600});fs.renameSync(temp,path.join(dir,'request.json'))
console.log('Relayを要求しました。メニューバーで送信元と送信先を確認してください。')
