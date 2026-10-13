import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { validateReferenceUrl } from '../src/shared/reference-url';
const root=(relative:string)=>new URL(`../${relative}`,import.meta.url);
const sources=[
 {id:'wan22-ti2v-5b',image:'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_ti2v-1.webp',workflow:'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_wan2_2_5B_ti2v.json',tutorial:'https://docs.comfy.org/tutorials/video/wan/wan2_2'},
 {id:'wan21-t2v-13b',image:'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/text_to_video_wan-1.webp',workflow:'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/text_to_video_wan.json',tutorial:'https://docs.comfy.org/tutorials/video/wan/wan-video'},
 {id:'ltx-video-2b-095',image:'https://comfyanonymous.github.io/ComfyUI_examples/ltxv/ltxv_text_to_video_0.9.5.webp',workflow:'https://comfyanonymous.github.io/ComfyUI_examples/ltxv/ltxv_text_to_video_0.9.5.json',tutorial:'https://comfyanonymous.github.io/ComfyUI_examples/ltxv/'},
 {id:'minimax-h3-existing',image:'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_minimax_h3_i2v-1.webp',workflow:'https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_i2v.json',tutorial:'https://docs.comfy.org/tutorials/video/minimax/minimax-h3'},
];
test('四模型封面为单帧可完整解码WebP，体积与尺寸适合界面加载',async()=>{
 const fingerprints=new Set<string>();
 for(const {id} of sources){
  const bytes=await fs.readFile(root(`src/renderer/public/model-covers/${id}.webp`));assert.ok(bytes.length>0&&bytes.length<200*1024);
  const image=sharp(bytes,{failOn:'warning'});const metadata=await image.metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.pages??1,1);
  assert.ok(metadata.width!>=300&&metadata.width!<=960);assert.ok(metadata.height!>=300&&metadata.height!<=960);
  const pixels=await image.raw().toBuffer();fingerprints.add(createHash('sha256').update(pixels).digest('hex'));
  const original=await sharp(await fs.readFile(root(`assets/model-covers/${id}.webp`))).metadata();const originalHeight=original.pageHeight??original.height!;
  assert.ok(metadata.width!<=original.width!&&metadata.height!<=originalHeight,'封面不得放大');
  assert.ok(Math.abs(metadata.width!/metadata.height! - original.width!/originalHeight)<0.01,'封面不得裁切或改变比例');
 }
 assert.equal(fingerprints.size,4,'四模型应使用各自画面，而不是重复通用封面');
});
test('每张模型封面的原件、官方图片URL、模板及教程来源均有记录',async()=>{
 const text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(root('assets/model-covers/sources.json')));
 for(const source of sources){
  assert.ok(text.includes(source.id));
  for(const link of [source.image,source.workflow,source.tutorial]){assert.equal(validateReferenceUrl(link),link);assert.ok(text.includes(link),`${source.id} 缺少官方来源链接`);}
  for(const directory of ['assets/model-covers','src/renderer/public/model-covers']){const relative=`${directory}/${source.id}.webp`;assert.ok((await fs.stat(root(relative))).isFile());}
 }
});
