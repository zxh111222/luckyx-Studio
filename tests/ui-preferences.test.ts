import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUiPreferences, resolveReducedMotion, createUiPreferencesController, createFocusTrap, UI_PREFERENCES_KEY } from '../src/renderer/src/ui-preferences'

class Events {
  listeners = new Map<string, Set<(event:any)=>void>>()
  addEventListener(type:string,fn:any){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type)!.add(fn)}
  removeEventListener(type:string,fn:any){this.listeners.get(type)?.delete(fn)}
  emit(type:string,event:any={}){for(const fn of this.listeners.get(type)??[])fn(event)}
  get count(){return [...this.listeners.values()].reduce((sum,items)=>sum+items.size,0)}
}
function hostFixture(raw:string|null=null,blocked=false){
 const attributes=new Map<string,string>(),events=new Events(),windowEvents=new Events();const media=new Map<string,Events&{matches:boolean}>();const stored=new Map<string,string>();const changes:unknown[]=[];
 const controller=createUiPreferencesController({root:{setAttribute:(k,v)=>{attributes.set(k,v)},removeAttribute:k=>{attributes.delete(k)}},storage:{getItem:()=>{if(blocked)throw new Error('blocked');return raw},setItem:(k,v)=>{if(blocked)throw new Error('blocked');stored.set(k,v)}},events:events as unknown as Document,windowEvents:windowEvents as unknown as Window,matchMedia:query=>{const entry=Object.assign(new Events(),{matches:false});media.set(query,entry);return entry},onChange:value=>changes.push(value)});
 return{controller,attributes,events,windowEvents,media,stored,changes};
}
test('无效或旧偏好安全回退，支持独立有效字段，不接受任意动画值',()=>{
 for(const raw of [null,'bad-json','null','[]','{"motion":"full","contrast":"low"}'])assert.deepEqual(parseUiPreferences(raw),{motion:'auto',transparency:'auto',contrast:'auto'});
 assert.deepEqual(parseUiPreferences('{"motion":"reduce","contrast":"more","extra":"ignore"}'),{motion:'reduce',transparency:'auto',contrast:'more'});
 for(const choice of ['auto','reduce'] as const)for(const os of [false,true])assert.equal(resolveReducedMotion(choice,os),choice==='reduce'||os);
});
test('用户选择持久化，系统变化实时生效且auto不能覆盖系统减少动效',()=>{
 const h=hostFixture();assert.equal(h.attributes.get('data-ui-motion'),'full');const query=h.media.get('(prefers-reduced-motion: reduce)')!;query.matches=true;query.emit('change');assert.equal(h.attributes.get('data-ui-motion'),'reduce');
 h.controller.update({motion:'auto',transparency:'reduce',contrast:'more'});assert.equal(h.attributes.get('data-ui-motion'),'reduce');assert.equal(h.attributes.get('data-ui-transparency'),'solid');assert.equal(h.attributes.get('data-ui-contrast'),'more');assert.deepEqual(JSON.parse(h.stored.get(UI_PREFERENCES_KEY)!),h.controller.preferences);
 query.matches=false;query.emit('change');assert.equal(h.attributes.get('data-ui-motion'),'full');const leaked=h.controller.preferences;leaked.motion='reduce';assert.equal(h.controller.preferences.motion,'auto');h.controller.dispose();
});
test('跨窗口存储同步，受限存储仍能使用且dispose完整解绑',()=>{
 const h=hostFixture(null,true);assert.doesNotThrow(()=>h.controller.update({motion:'reduce',transparency:'auto',contrast:'auto'}));assert.equal(h.attributes.get('data-ui-motion'),'reduce');
 h.windowEvents.emit('storage',{key:'other',newValue:'{"motion":"auto"}'});assert.equal(h.controller.preferences.motion,'reduce');h.windowEvents.emit('storage',{key:UI_PREFERENCES_KEY,newValue:'{"contrast":"more"}'});assert.equal(h.controller.preferences.motion,'auto');assert.equal(h.controller.preferences.contrast,'more');
 h.windowEvents.emit('storage',{key:null,newValue:null});assert.equal(h.controller.preferences.contrast,'auto');h.controller.dispose();assert.equal(h.events.count,0);assert.equal(h.windowEvents.count,0);assert.ok([...h.media.values()].every(q=>q.count===0));
});
function button(disabled=false){const classes=new Set<string>();return{classes,classList:{add:(name:string)=>classes.add(name),remove:(name:string)=>classes.delete(name)},matches:()=>disabled,getAttribute:()=>null,closest(){return this}}}
test('键盘不触发按压动效，只有主指针左键反馈并在取消或失焦立即释放',()=>{
 const h=hostFixture(),target=button();h.events.emit('keydown',{key:'Enter',target});assert.equal(h.controller.inputMethod,'keyboard');assert.equal(target.classes.size,0);
 h.events.emit('pointerdown',{button:0,isPrimary:true,target});assert.ok(target.classes.has('pointer-pressed'));assert.equal(h.controller.inputMethod,'pointer');h.events.emit('keydown',{key:'Tab'});assert.equal(target.classes.size,0);
 for(const event of [{button:2,target},{button:0,isPrimary:false,target},{button:0,target:button(true)}])h.events.emit('pointerdown',event);assert.equal(target.classes.size,0);
 for(const release of ['pointercancel','pointerup']){h.events.emit('pointerdown',{button:0,target});h.events.emit(release);assert.equal(target.classes.size,0)}h.events.emit('pointerdown',{button:0,target});h.windowEvents.emit('blur');assert.equal(target.classes.size,0);h.controller.dispose();
});
function dialogFixture(){
 const events=new Events();const doc=Object.assign(events,{activeElement:null as unknown});const all:any[]=[];
 function element(options:{disabled?:boolean,hidden?:boolean,inert?:boolean,tabIndex?:number}={}){const value={tabIndex:options.tabIndex??0,isConnected:true,ownerDocument:doc,matches:()=>Boolean(options.disabled),closest:()=>options.inert?{}:null,getClientRects:()=>options.hidden?[]:[{}],focus:()=>{doc.activeElement=value}};all.push(value);return value}
 const first=element(),disabled=element({disabled:true}),hidden=element({hidden:true}),inert=element({inert:true}),last=element();let autofocus:any=null;
 const container={ownerDocument:doc,querySelectorAll:()=>all,querySelector:()=>autofocus,contains:(el:unknown)=>all.includes(el)||el===container,focus:()=>{doc.activeElement=container}};
 const opener=element();all.pop();let escaped=0;const attach=()=>createFocusTrap(container as unknown as HTMLElement,opener as unknown as HTMLElement,()=>escaped++);
 const key=(key:string,shiftKey=false)=>{let prevented=false,stopped=false;events.emit('keydown',{key,shiftKey,preventDefault:()=>{prevented=true},stopPropagation:()=>{stopped=true}});return{prevented,stopped}};
 return{events,doc,first,last,disabled,hidden,inert,container,opener,attach,key,setAutofocus:(el:any)=>{autofocus=el},get escaped(){return escaped}};
}
test('弹窗Tab及ShiftTab只在可见可用控件中环绕，外部焦点回到弹窗',()=>{
 const h=dialogFixture(),cleanup=h.attach();assert.equal(h.doc.activeElement,h.first);assert.equal(h.key('Tab',true).prevented,true);assert.equal(h.doc.activeElement,h.last);assert.equal(h.key('Tab').prevented,true);assert.equal(h.doc.activeElement,h.first);
 h.doc.activeElement=h.opener;h.events.emit('focusin',{target:h.opener});assert.equal(h.doc.activeElement,h.first);cleanup();assert.equal(h.doc.activeElement,h.opener);assert.equal(h.events.count,0);
});
test('Escape只关闭当前弹窗，恢复有效入口；卸载或不可用入口不再抢焦点',()=>{
 const h=dialogFixture(),cleanup=h.attach();assert.deepEqual(h.key('Escape'),{prevented:true,stopped:true});assert.equal(h.escaped,1);cleanup(false);assert.equal(h.doc.activeElement,h.first);
 const disconnected=dialogFixture();disconnected.opener.isConnected=false;const stop=disconnected.attach();stop();assert.equal(disconnected.doc.activeElement,disconnected.first);
});
test('隐藏或inert的autofocus不能接收初始弹窗焦点',()=>{
 for(const kind of ['hidden','inert'] as const){const h=dialogFixture();h.setAutofocus(h[kind]);const cleanup=h.attach();assert.equal(h.doc.activeElement,h.first);cleanup();}
});
