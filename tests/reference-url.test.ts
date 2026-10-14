import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReferenceUrl } from '../src/shared/reference-url';

test('允许教程列出的官方HTTPS域名与标准443端口',()=>{
 for(const url of ['https://docs.comfy.org/tutorials/video/wan/wan2_2','https://github.com/MiniMax-AI/MiniMax-H3','https://huggingface.co/Comfy-Org/MiniMax-H3','https://comfyanonymous.github.io/ComfyUI_examples/ltxv/','https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_ti2v.json','https://blog.comfy.org/','https://docs.comfy.org:443/tutorials']) assert.equal(validateReferenceUrl(url),new URL(url).href);
});
test('拒绝非HTTPS、认证信息、伪造域名与非标准端口',()=>{
 for(const value of ['http://docs.comfy.org','file:///C:/secret','javascript:alert(1)','https://docs.comfy.org.evil.test/','https://evil-docs.comfy.org/','https://docs.comfy.org@evil.test/','https://user@docs.comfy.org/','https://user:secret@docs.comfy.org/','https://docs.comfy.org:8443/','https://localhost/','https://github.com.evil.test/','https://example.com','invalid','',null,undefined,42,{}]) assert.throws(()=>validateReferenceUrl(value),Error);
});
test('驱动帮助仅允许NVIDIA官方驱动入口，不扩大到任意下载或重定向地址',()=>{
 assert.equal(validateReferenceUrl('https://www.nvidia.com/en-us/drivers/'),'https://www.nvidia.com/en-us/drivers/');
 for(const value of ['https://www.nvidia.com/redirect?url=https://evil.test','https://www.nvidia.com/en-us/drivers/?target=evil','https://www.nvidia.com/en-us/drivers/#script','https://www.nvidia.com.evil.test/en-us/drivers/','https://download.nvidia.com/driver.exe'])assert.throws(()=>validateReferenceUrl(value));
});
