# 轻图工坊 · OTools Image Tools

面向普通用户的独立图片查看器与轻量编辑插件。默认只显示图片、顶栏和底部状态栏，底部缩略图与右侧编辑工具均按需展开，不做 Lightroom 式专业工作流。

许可证：主插件代码采用 Apache-2.0；随包离线解码组件及其各自许可证列在 `web/vendor/NOTICE`。

## 功能

- 查看 JPG/JPEG/JFIF、PNG/APNG、WebP、BMP、GIF、AVIF、SVG、ICO；TIFF 和 HEIC/HEIF 使用随包离线解码器。
- 打开一张本地图片后自动列出同目录图片，支持上一张/下一张、键盘左右切图、底栏多选。
- 底部状态栏提供图片列表开关、图片信息、像素尺寸、文件大小、真实百分比缩放、适合窗口、旋转。
- 顶部右侧提供返回、前进、导出、另存为和编辑入口。
- 裁剪、水平翻转、旋转、亮度、对比度、饱和度、冷暖、简单滤镜；肤色加权自然美白和轻柔肤（非 AI）。
- 各图片独立保留调整，提供最多 25 步撤销；支持 JPG/PNG/WebP 导出，透明图片转 JPG 自动铺白底。
- 底栏支持批量转换、压缩、应用当前调整；只选一次输出目录，顺序处理，可中止，遇错停止，自动避开已有文件名。
- 多图导出 PDF，每图一页，A4 自动适配方向或跟随图片比例；PDF 内图片最长边最多 3200 像素，避免文档过大。
- 默认保存副本；拒绝覆盖任何已打开原图和已存在目标，取消保存不写文件。
- 完全本地处理，无上传、无运行时 CDN 请求。

## 使用边界

- GIF/APNG/动态 WebP 原图查看由浏览器播放；编辑和导出为静态帧。
- 多页 TIFF 当前显示和编辑第一页；HEIC/HEIF 支持取决于内置解码器可识别的编码特性，不能保证所有变体。
- 原图上限 160 MB、8000 万像素；单次渲染上限 4000 万像素，过大的图片可先设置缩小导出。
- 浏览器预览支持选图、编辑和下载副本；真实路径、自动列同目录和批量写入目录需要 OTools 桌面宿主。
- 关闭插件会清空尚未另存的调整；不提供跨会话编辑项目。

## 开发和打包

```bash
node --test tests/*.test.mjs tests/verify-ui.mjs scripts/*.test.mjs
python scripts/make-test-images.py
node scripts/build-web.mjs
node scripts/browser-smoke.mjs
python scripts/verify-output-files.py
node scripts/serve-dist.mjs 6498
node scripts/pack-plugin.mjs --out dist-pack
node scripts/verify-plugin.mjs dist-pack
```

前端为原生 ES Modules，web 原样构建至 dist，不需要安装前端框架。第三方解码资源固定版本并纳入源码，正常构建不联网。更新解码依赖时运行 `python scripts/fetch-codecs.py` 并核对 `web/vendor/codecs.json`，许可文本与来源见 `web/vendor/NOTICE`。

## 验证

```bash
python scripts/make-test-images.py
node scripts/browser-smoke.mjs
python scripts/verify-output-files.py
```

浏览器回归脚本使用 playwright-core 与本机 Chrome；`PLAYWRIGHT_CORE` 和 `CHROME_PATH` 可覆盖默认路径。测试中的宿主读写通道仅访问 outputs 下的合成样本，并将实际导出的图片和 PDF 落盘。独立验证需 Pillow、pypdf 和 pypdfium2（建议安装在隔离环境），检查图片尺寸/旋转像素并实际解析、渲染 PDF。测试产物位于 outputs，不入库、不打包。

## 主仓库本地加载

```powershell
powershell -NoProfile -File scripts/deploy-to-otools.ps1 -OtoolsRoot D:/Repos/xyito/otools/otools
```

部署脚本仅复制 manifest、logo、dist，并移除开发模式配置，不依赖开发服务器。也可以在 OTools 中本地安装 dist-pack 中的 oplg 包。
