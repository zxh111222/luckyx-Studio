import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { defaultRunner } from '../src/backend/bootstrap';

function processFixture() {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() { return true; } });
    const spawnProcess = (() => child) as unknown as typeof spawn;
    return { child, spawnProcess };
}
test('进程exit后不会提前完成，stdio close后才返回完整输出', async () => {
    const f = processFixture(); let settled = false;
    const pending = defaultRunner('mock-python.exe', ['-c', 'probe'], { signal: new AbortController().signal }, f.spawnProcess).then(value => { settled = true; return value; });
    f.child.stdout.emit('data', Buffer.from('first')); f.child.emit('exit', 0); await Promise.resolve(); assert.equal(settled, false);
    f.child.stdout.emit('data', Buffer.from(' final')); f.child.emit('close', 0); assert.equal((await pending).stdout, 'first final');
});
test('进程error也等待close，不能先释放安装器再让Python继续占用目录', async () => {
    const f = processFixture(); let settled = false;
    const pending = defaultRunner('mock-python.exe', [], { signal: new AbortController().signal }, f.spawnProcess).catch(error => { settled = true; return error; });
    f.child.emit('error', Object.assign(new Error('aborted'), { name: 'AbortError' })); await Promise.resolve(); assert.equal(settled, false); f.child.emit('close', null); assert.equal((await pending).name, 'AbortError');
});
test('输出超限会停止子进程但仍等待close，避免目录配置时残留运行资源', async () => {
    const f = processFixture(); let killed = 0, settled = false; f.child.kill = () => { killed++; return true; };
    const pending = defaultRunner('mock-7za.exe', [], { signal: new AbortController().signal }, f.spawnProcess).catch(error => { settled = true; return error; });
    f.child.stdout.emit('data', Buffer.alloc(32 * 1024 * 1024 + 1, 97)); await Promise.resolve(); assert.equal(killed, 1); assert.equal(settled, false); f.child.emit('close', null); assert.match((await pending).message, /解压清单过大/);
});
