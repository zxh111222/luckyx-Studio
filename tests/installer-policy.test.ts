import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read=(name:string)=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const source=read('build/installer.nsh');
function block(kind:'macro'|'function',name:string){const start=kind==='macro'?`!macro ${name}`:`Function ${name}`;const end=kind==='macro'?'!macroend':'FunctionEnd';const at=source.indexOf(start);assert.ok(at>=0,`缺少${name}`);return source.slice(source.indexOf('\n',at)+1,source.indexOf(end,at)).trim();}
const appData='C:\\Users\\test\\AppData\\Roaming';const appRoot=appData+'\\luckyx-studio';
type Entry={directory?:boolean;reparse?:boolean};
// In-memory execution of the relevant NSIS instructions. No filesystem deletion,
// installation or uninstallation is performed; unsupported instructions fail closed.
function policy(options:{updated?:boolean;silent?:boolean;checked?:boolean;rootLink?:boolean;studioLink?:boolean;cacheLink?:boolean}={}){
 const entries=new Map<string,Entry>();const put=(name:string,entry:Entry={})=>entries.set(path.win32.normalize(name).toLowerCase(),entry);
 const normalFiles=['studio\\studio.sqlite','studio\\studio.sqlite.tmp','studio\\studio.sqlite-wal','studio\\studio.sqlite-shm','Preferences','Local State','studio\\input\\original.png','studio\\output\\video.mp4','studio\\comfy-user\\workflow.json'];
 put(appRoot,{directory:true,reparse:options.rootLink});put(appRoot+'\\studio',{directory:true,reparse:options.studioLink});for(const name of normalFiles)put(appRoot+'\\'+name);
 put(appRoot+'\\Cache',{directory:true,reparse:options.cacheLink});put(appRoot+'\\Cache\\normal.tmp');put(appRoot+'\\Cache\\nested',{directory:true});put(appRoot+'\\Cache\\nested\\data.tmp');put(appRoot+'\\Cache\\outside-link',{directory:true,reparse:true});put(appRoot+'\\Cache\\outside-link\\model.safetensors');put(appRoot+'\\Cache\\file-link',{reparse:true});
 put('F:\\VideoModels\\model.safetensors');put('F:\\ComfyUI\\main.py');put('F:\\custom-userdata\\studio.sqlite');
 const variables:Record<string,any>={LuckyxDeleteData:options.checked?1:0,installMode:'all'};const stack:any[]=[];const effects:{op:string;path:string}[]=[];let context='all',errors=false;let steps=0;let handle=0;const finds=new Map<number,{names:string[];index:number}>();
 function value(token:string):any{token=token.trim().replace(/^"|"$/g,'');if(token==='${isUpdated}')return !!options.updated;if(token==='${Silent}')return !!options.silent;if(token==='${BST_UNCHECKED}')return 0;if(token==='${BST_CHECKED}')return 1;if(/^0x[0-9a-f]+$/i.test(token))return Number(token);if(/^-?\d+$/.test(token))return Number(token);if(/^\$[A-Za-z0-9]+$/.test(token))return variables[token.slice(1)]??'';return token.replace(/\$APPDATA/g,context==='current'?appData:'C:\\ProgramData').replace(/\$([A-Za-z0-9]+)/g,(_,key)=>String(variables[key]??''));}
 const tokens=(line:string)=>line.match(/"[^"]*"|\S+/g)??[];
 function condition(expression:string){const match=expression.match(/^(.*?)\s+(==|!=)\s+(.*)$/);if(match){const equal=String(value(match[1]))===String(value(match[3]));return match[2]==='=='?equal:!equal;}return !!value(expression);}
 function execute(body:string){const lines=body.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith(';'));const labels=new Map(lines.flatMap((line,i)=>line.endsWith(':')?[[line.slice(0,-1),i] as const]:[]));const branches:{parent:boolean;active:boolean;taken:boolean}[]=[];let pc=0;
  const jump=(target:string|undefined)=>{if(!target||target==='0')return;if(target.startsWith('+'))pc+=Number(target)-1;else{assert.ok(labels.has(target),`未知跳转${target}`);pc=labels.get(target)!+1;}};
  while(pc<lines.length){assert.ok(++steps<10000,'NSIS模拟陷入循环');const line=lines[pc++];let match;
   if((match=line.match(/^\$\{If\}\s+(.*)$/i))){const parent=branches.every(branch=>branch.active);const active=parent&&condition(match[1]);branches.push({parent,active,taken:active});continue;}
   if((match=line.match(/^\$\{ElseIf\}\s+(.*)$/i))){const current=branches.at(-1)!;current.active=current.parent&&!current.taken&&condition(match[1]);current.taken||=current.active;continue;}
   if(/^\$\{Else\}$/i.test(line)){const current=branches.at(-1)!;current.active=current.parent&&!current.taken;current.taken=true;continue;}
   if(/^\$\{EndIf\}$/i.test(line)){branches.pop();continue;}
   if(branches.some(branch=>!branch.active))continue;
   if(line.endsWith(':'))continue;const args=tokens(line);
   switch(args[0]){
    case 'StrCpy':variables[args[1].slice(1)]=value(args[2]);break;
    case 'SetShellVarContext':context=args[1];break;
    case 'System::Call':{const query=line.match(/GetFileAttributesW\(w "([^"]+)"\) i \.r(\d)/);assert.ok(query,'仅支持读取文件属性');const entry=entries.get(path.win32.normalize(value(query[1])).toLowerCase());variables[query[2]]=entry?(entry.directory?0x10:0)|(entry.reparse?0x400:0):-1;break;}
    case 'IntOp':assert.equal(args[3],'&');variables[args[1].slice(1)]=Number(value(args[2]))&Number(value(args[4]));break;
    case 'IntCmp':{const left=Number(value(args[1])),right=Number(value(args[2]));jump(args[left===right?3:left<right?4:5]);break;}
    case 'Delete':{const filename=path.win32.normalize(value(args[1]));effects.push({op:'delete',path:filename});entries.delete(filename.toLowerCase());break;}
    case 'RMDir':{assert.notEqual(args[1],'/r','不允许模拟递归删除');const directory=path.win32.normalize(value(args[1]));effects.push({op:'rmdir',path:directory});break;}
    case 'Push':stack.push(value(args[1]));break;
    case 'Pop':variables[args[1].slice(1)]=stack.pop()??'';break;
    case 'Exch':{const key=args[1].slice(1);const old=variables[key]??'';variables[key]=stack.at(-1)??'';stack[stack.length-1]=old;break;}
    case 'Call':execute(block('function',args[1]));break;
    case '!insertmacro':{assert.equal(args[1],'LuckyxClearCache');execute(block('macro','LuckyxClearCache').replaceAll('${NAME}',String(value(args[2]))));break;}
    case 'ClearErrors':errors=false;break;
    case 'FindFirst':{const glob=path.win32.normalize(value(args[3])).toLowerCase();const parent=glob.slice(0,-2);const names=[...entries.keys()].filter(name=>path.win32.dirname(name)===parent).map(name=>path.win32.basename(name));const id=++handle;finds.set(id,{names,index:0});variables[args[1].slice(1)]=id;variables[args[2].slice(1)]=names[0]??'';errors=names.length===0;break;}
    case 'FindNext':{const find=finds.get(Number(value(args[1])))!;variables[args[2].slice(1)]=find.names[++find.index]??'';break;}
    case 'FindClose':break;
    case 'IfErrors':if(errors)jump(args[1]);break;
    case 'StrCmp':if(String(value(args[1]))===String(value(args[2])))jump(args[3]);else jump(args[4]);break;
    case 'Goto':jump(args[1]);break;
    default:throw new Error(`模拟器不支持的NSIS指令：${line}`);
   }
  }
 }
 execute(block('macro','customUnInstall'));return {effects,entries,variables,context};
}
test('升级与静默卸载无论checkbox如何都保留数据，默认普通卸载也保留',()=>{
 for(const updated of [false,true])for(const silent of [false,true])for(const checked of [false,true]){if(!updated&&!silent&&checked)continue;const result=policy({updated,silent,checked});assert.deepEqual(result.effects,[]);if(updated||silent)assert.equal(result.variables.LuckyxDeleteData,0);}
});
test('显式选择清理只移除记录与缓存，不删除作品、原图、ComfyUI或外部目录',()=>{
 const result=policy({checked:true});assert.ok(result.effects.some(effect=>effect.path===appRoot+'\\studio\\studio.sqlite'));assert.ok(result.effects.some(effect=>effect.path.toLowerCase().endsWith('cache\\nested\\data.tmp')));assert.equal(result.context,'all','清理后恢复shell上下文');
 for(const effect of result.effects){assert.ok(effect.path.toLowerCase().startsWith(appRoot.toLowerCase()+'\\'));assert.doesNotMatch(effect.path,/\\studio\\(?:input|output|comfy-user)(?:\\|$)/i);assert.notEqual(effect.path.toLowerCase(),appRoot.toLowerCase());assert.notEqual(effect.path.toLowerCase(),(appRoot+'\\studio').toLowerCase());}
 for(const filename of ['studio\\input\\original.png','studio\\output\\video.mp4','studio\\comfy-user\\workflow.json'])assert.ok(result.entries.has((appRoot+'\\'+filename).toLowerCase()));
 for(const filename of ['F:\\VideoModels\\model.safetensors','F:\\ComfyUI\\main.py','F:\\custom-userdata\\studio.sqlite'])assert.ok(result.entries.has(filename.toLowerCase()));
});
test('userdata与每层缓存的目录链接均不跟随，防止清理越界',()=>{
 assert.deepEqual(policy({checked:true,rootLink:true}).effects,[]);
 const studio=policy({checked:true,studioLink:true});assert.ok(studio.effects.every(effect=>!effect.path.toLowerCase().startsWith((appRoot+'\\studio\\').toLowerCase())));
 const cache=policy({checked:true,cacheLink:true});assert.ok(cache.effects.every(effect=>!effect.path.toLowerCase().startsWith((appRoot+'\\Cache').toLowerCase())));
 const normal=policy({checked:true});assert.ok(normal.effects.every(effect=>!effect.path.toLowerCase().includes('outside-link')&&!effect.path.toLowerCase().includes('file-link')));
});
test('卸载界面checkbox和内部变量默认未选，builder旧删除参数被禁用',()=>{
 assert.match(block('macro','customUnInit'),/StrCpy\s+\$LuckyxDeleteData\s+\$\{BST_UNCHECKED\}/);assert.match(block('function','un.LuckyxDataPage'),/\$\{NSD_SetState\}\s+\$LuckyxDeleteCheckbox\s+\$\{BST_UNCHECKED\}/);assert.match(block('function','un.LuckyxDataLeave'),/\$\{NSD_GetState\}\s+\$LuckyxDeleteCheckbox\s+\$LuckyxDeleteData/);
 const noCli=block('macro','_LuckyxNeverDeleteCli');assert.match(noCli,/Goto\s+`\$\{_f\}`/);assert.doesNotMatch(noCli,/\$\{_t\}/);assert.match(source,/!undef\s+DELETE_APP_DATA_ON_UNINSTALL/);
 const legacy=block('macro','LuckyxGetOptions');const branch=legacy.split('!else')[0];assert.match(branch,/"--delete-app-data"/);assert.match(branch,/SetErrors/);assert.doesNotMatch(branch,/!insertmacro\s+GetOptions/);
 const packageJson=JSON.parse(read('package.json'));assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall,false);assert.equal(packageJson.name,'luckyx-studio');
});
test('实际Electron数据目录与清理命名匹配，标准升级仍带保留参数',()=>{
 const main=read('src/main/index.ts');assert.match(main,/app\.getPath\(['"]userData['"]\)/);assert.match(main,/join\(app\.getPath\(['"]userData['"]\),\s*['"]studio['"]\)/);assert.match(main,/LUCKYX_DATA_DIR/);assert.match(main,/app\.setName\(['"]luckyx-studio['"]\)/);assert.ok(main.indexOf('app.setName(')<main.indexOf("app.getPath('userData')"));
 assert.ok(source.includes('$APPDATA\\luckyx-studio\\studio\\studio.sqlite'));assert.doesNotMatch(source.replace(/^\s*;.*$/gm,''),/RMDir\s+\/r/);
 const standard=read('node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh');assert.match(standard,/--updated/);assert.match(standard,/\/KEEP_APP_DATA/);assert.match(standard,/\$\{if\}\s+\$\{isDeleteAppData\}[\s\S]*?--delete-app-data/i);
});


test('显式清理目标严格限制为记录文件及固定Electron缓存白名单',()=>{
 const records=new Set(['studio\\studio.sqlite','studio\\studio.sqlite.tmp','studio\\studio.sqlite-wal','studio\\studio.sqlite-shm','preferences','local state']);
 const cacheRoots=new Set(['cache','code cache','gpucache','dawncache','dawnwebgpucache','session storage','local storage','indexeddb','blob_storage','network','partitions']);
 for(const effect of policy({checked:true}).effects){const relative=effect.path.slice(appRoot.length+1).toLowerCase();assert.ok(records.has(relative)||cacheRoots.has(relative.split('\\')[0]),`超出清理白名单：${effect.path}`);}
});
