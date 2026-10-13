import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAssetUrl } from '../src/shared/public-asset';

test('HTTP预览资源相对于当前文档解析，保留本机来源',()=>{
 assert.equal(publicAssetUrl('/brand/icon-32.png','http://127.0.0.1:4173/'),'http://127.0.0.1:4173/brand/icon-32.png');
 assert.equal(publicAssetUrl('/model-covers/wan22-ti2v-5b.webp','http://localhost:4173/index.html'),'http://localhost:4173/model-covers/wan22-ti2v-5b.webp');
 assert.equal(publicAssetUrl('/brand/luckyx-symbol.svg','http://localhost:4173/app/index.html'),'http://localhost:4173/app/brand/luckyx-symbol.svg');
});
test('打包file文档解析到renderer资源目录，不误指向磁盘根目录',()=>{
 const document='file:///F:/luckyx%20Studio/resources/app.asar/out/renderer/index.html';
 assert.equal(publicAssetUrl('/brand/icon-256.png',document),'file:///F:/luckyx%20Studio/resources/app.asar/out/renderer/brand/icon-256.png');
 assert.equal(publicAssetUrl('/model-covers/minimax-h3-existing.webp',document),'file:///F:/luckyx%20Studio/resources/app.asar/out/renderer/model-covers/minimax-h3-existing.webp');
});
test('拒绝完整外域URL、协议相对URL、目录逃逸和反斜线路径',()=>{
 for(const asset of ['https://evil.test/icon.png','http://localhost/icon.png','//evil.test/icon.png','../secret.png','/../secret.png','/brand/../../secret.png','/brand/..','/brand\\icon.png','/brand\\..\\secret.png','/C:/secret.png','/%2e%2e/secret.png','/brand/%2Fsecret.png','/brand/icon.png?url=https://evil.test','/brand/icon.png#x',''])assert.throws(()=>publicAssetUrl(asset,'file:///F:/app/renderer/index.html'),/无效的应用资源路径/);
});
