import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url), file = path.resolve('src/renderer/components/CustomWorkflowWorkbench.vue');
const icon = Vue.defineComponent({ render: () => Vue.h('svg') });
let invoke: (command: string, payload?: unknown) => Promise<unknown> = async () => { throw new Error('unset'); };
function productionComponent(): Vue.Component {
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file });
  const source = compileScript(descriptor, { id: 'custom-workflow-error-test', inlineTemplate: true }).content;
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code, module = { exports: {} as { default: Vue.Component } };
  const localRequire = (specifier: string) => specifier === 'vue' ? Vue : specifier === '@phosphor-icons/vue' ? new Proxy({}, { get: () => icon }) : specifier === '../src/api' ? { invoke: (command: string, payload?: unknown) => invoke(command, payload) } : require(path.resolve(path.dirname(file), specifier) + '.ts');
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports); return module.exports.default;
}
interface Node { tag: string; text: string; children: Node[]; parent: Node | null; props: Record<string, any> }
const node = (tag: string, text = ''): Node => ({ tag, text, children: [], parent: null, props: {} });
function mount() {
  const renderer = Vue.createRenderer<Node, Node>({ createElement: tag => node(tag), createText: text => node('#text', text), createComment: () => node('#comment'), setText: (n, text) => { n.text = text }, setElementText: (n, text) => { n.text = text; n.children = [] }, parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    insert(n, parent, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); const index = anchor ? parent.children.indexOf(anchor) : -1; if (index < 0) parent.children.push(n); else parent.children.splice(index, 0, n); n.parent = parent; }, remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; }, patchProp(n, key, _old, value) { n.props[key] = value; }, insertStaticContent(content, parent) { const n = node('#static', content.replace(/<[^>]*>/g, '')); parent.children.push(n); n.parent = parent; return [n, n]; } });
  const container = node('root'), app = renderer.createApp(productionComponent(), { workflow: { id: 'mine', name: '我的流程', format: 'api', nodeCount: 2, createdAt: '', updatedAt: '' }, engineReady: true }); app.mount(container);
  const all = (n: Node): Node[] => [n, ...n.children.flatMap(all)], text = (n: Node): string => n.text + n.children.map(text).join('');
  return { app, all: () => all(container), text: () => text(container), nodeText: text };
}

test('工作流分析失败显示具体错误并可在原位重试成功', async () => {
  let calls = 0;
  invoke = async (command, payload) => {
    assert.equal(command, 'workflow.analyze'); assert.deepEqual(payload, { id: 'mine' });
    if (++calls === 1) throw new Error('工作流 JSON 已损坏，请重新导入');
    return { status: 'ready', message: '已识别', analysis: { format: 'api', skipped: 0, slots: [], features: { imageInput: false, videoInput: false, audioInput: false, audioPipeline: false, videoOutput: true, lora: false } } };
  };
  const mounted = mount();
  try {
    await Promise.resolve(); await Vue.nextTick();
    assert.match(mounted.text(), /工作流 JSON 已损坏，请重新导入/); assert.doesNotMatch(mounted.text(), /undefined/);
    const retry = mounted.all().find(item => item.tag === 'button' && /重新识别/.test(mounted.nodeText(item)));
    assert.ok(retry, '分析失败后应提供重新识别按钮'); await retry.props.onClick(); await Vue.nextTick();
    assert.equal(calls, 2); assert.match(mounted.text(), /已识别/); assert.doesNotMatch(mounted.text(), /工作流 JSON 已损坏/);
  } finally { mounted.app.unmount(); }
});
