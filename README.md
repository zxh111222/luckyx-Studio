# luckyx. Studio

本地视频工作流启动器。当前版本接入已有 MiniMax H3 环境，支持首帧生成、结果预览、任务记录、参数预设、资源诊断及设备模型推荐。

## 运行

- 安装版：打开 `dist/installer/luckyx-Studio-Setup-0.1.0-x64.exe`，按提示选择目录；先退出正在运行的旧版。
- 免安装版：打开 `dist/installer/win-unpacked/luckyx. Studio.exe`，请保留同目录其他文件。
- 开发：Node.js 22.12 以上，执行 `npm install`、`npm run dev`。
- 浏览器预览：执行 `npm run preview`，打开 http://127.0.0.1:4173/ 。目录选择使用桌面版。
- 检查：`npm run check`、`npm test`、`npm run build`。

## 窗口与界面

初始 1440×1024，正常最小 1200×720，尺寸不超过屏幕工作区。小窗口将最近任务收为抽屉，参数区单独滚动；生成按钮固定在参数卡底部。正文及输入为 14px，辅助文字至少 12px，按钮至少 40px。

## 当前边界

这是一版可运行的本地原型。已有环境无需再次下载模型；新电脑自动安装、模型下载续传、更新回滚仍属于后续 MVP 工作。任务和路径保存在本地 SQLite。浏览器预览与桌面开发分别保存数据，避免互相覆盖。

安装包包含启动器，不包含 Python、ComfyUI 和模型权重。请在应用中连接已有环境或已运行的本地 ComfyUI 服务。模型安装教程可在资源中心查看。

执行 `npm run dist` 生成 Windows 安装包。当前版本未做代码签名。图标和模型封面可用 `npm run assets:brand`、`npm run assets:covers` 离线重建；封面来源记录在 `assets/model-covers/sources.json`。

`docs/`、设计截图、本地说明及 `dist/` 安装产物均被 Git 忽略，仅保留在本地。仓库保留程序源码、必要资源、测试和本运行说明。

